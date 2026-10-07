'use server';

import { GoogleGenAI, Type } from '@google/genai';
import { searchNgosByKeywords, type NgoCandidate } from '@/lib/tools/searchNgos';
import { supabaseAdmin } from '@/lib/supabase';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export interface AgentDecision {
  selected_ngo_id: string;
  selected_ngo_name: string;
  selected_ngo_phone: string;
  selected_ngo_email: string | null;
  rationale_for_selection: string;
  urgency: 'Critical' | 'Standard';
  dispatch_message: string;
}

export interface RouterInput {
  description: string;
  userPhone: string;
  latitude?: number | null;
  longitude?: number | null;
  // Optional photo of the scene/injury — base64-encoded (no data: prefix) plus its MIME type.
  // When present, the agent visually assesses severity as part of its urgency call.
  imageBase64?: string | null;
  imageMediaType?: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | null;
}

const SYSTEM_PROMPT = `You are the Crisis Dispatch Commander, an autonomous triage agent for an NGO emergency routing platform.

Your job, in strict order:
1. Read the user's raw emergency description carefully, and examine any attached photo if one was provided. Identify the TRUE nature of the emergency — do not guess broad categories; be precise (e.g. "injured stray dog" not just "animal issue").
2. Extract 3-6 sharp search keywords from the description (species, injury type, medical need, disaster type) and call the search_ngos tool with them to discover candidate NGOs. You may call this tool more than once with different keyword sets if your first results are weak or empty — for example, broaden from a specific term to a more general category term.
3. Evaluate each candidate NGO's capabilities_description against the actual emergency. Do not pick an NGO just because it was returned — verify its capabilities genuinely match. If nothing matches well, say so honestly in your rationale rather than forcing a bad pick.
4. Autonomously select the SINGLE best-fit NGO. Do not ask the user for clarification — you must decide with the information given.
5. Classify urgency as "Critical" or "Standard". This decision determines which channel is used to contact the NGO, so weigh it carefully using BOTH sources of evidence:
   - The photo, if provided: visible heavy bleeding, exposed bone, severe trauma, unconsciousness, a trapped or crushed subject, or similarly severe visual signs indicate Critical. Minor visible injury, limping, or no clearly severe visual sign indicates Standard.
   - The text: explicit urgency language from the user ("emergency", "dying", "can't breathe", "bleeding heavily", "trapped") indicates Critical. A calmer or non-urgent description indicates Standard.
   - If either the photo or the text signals Critical, classify as Critical — treat it as the more cautious signal winning. Only classify Standard when neither source suggests severe/life-threatening conditions.
6. Write a dispatch_message: a short, clear message (under 300 characters) written TO the selected NGO, summarizing the emergency, urgency, and that a responder is needed. Professional, urgent, factual tone — no fluff. This same message is used whether it's sent by phone/WhatsApp or by email, so do not reference a specific channel in it.

When you are done, respond with ONLY a single JSON object matching this exact shape, with no markdown fences and no extra commentary:
{
  "selected_ngo_id": "<uuid of chosen NGO>",
  "rationale_for_selection": "<2-3 sentences explaining why this NGO was chosen, and why you classified the urgency the way you did, citing the photo and/or text as relevant>",
  "urgency": "Critical" | "Standard",
  "dispatch_message": "<message to send to the NGO>"
}

If, after searching, truly no NGO in the system has any relevant capability, set selected_ngo_id to "NONE_FOUND" and explain why in rationale_for_selection.`;

const tools = [
  {
    functionDeclarations: [
      {
        name: 'search_ngos',
        description:
          'Search the NGO database for organizations matching given keywords. Matches against organization name, category, and capabilities description using fuzzy text search. Call with sharp, specific keywords extracted from the emergency description. Returns up to 8 candidate NGOs with their id, name, category, capabilities_description, phone_number, and email.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            keywords: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description:
                '3-6 specific keywords describing the emergency, e.g. ["injured", "stray dog", "leg wound"] or ["blood shortage", "O negative", "surgery"]',
            },
          },
          required: ['keywords'],
        },
      },
    ],
  },
];

export async function routeEmergency(
  input: RouterInput
): Promise<{ success: true; decision: AgentDecision } | { success: false; error: string }> {
  const { description, userPhone, latitude, longitude, imageBase64, imageMediaType } = input;

  if (!description || description.trim().length < 5) {
    return { success: false, error: 'Description too short to triage.' };
  }

  const locationContext =
    latitude != null && longitude != null
      ? `\n\nUser's GPS location: ${latitude}, ${longitude}`
      : '\n\nUser did not share GPS location.';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initialParts: any[] = [];

  if (imageBase64 && imageMediaType) {
    initialParts.push({
      inlineData: {
        mimeType: imageMediaType,
        data: imageBase64,
      },
    });
  }

  initialParts.push({
    text: `Emergency description from user:\n"${description.trim()}"${locationContext}\n\nUser contact phone: ${userPhone}\n${
      imageBase64 ? '\nA photo of the situation is attached above — use it to help assess severity.\n' : ''
    }\nTriage this now.`,
  });

  const chat = ai.chats.create({
    model: 'gemini-3.5-flash',
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools,
    },
  });

  let candidatesSeen: NgoCandidate[] = [];
  const MAX_TURNS = 4;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentMessage: any = initialParts;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await chat.sendMessage({ message: currentMessage });

    const functionCalls = response.functionCalls;

    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];

      let toolResult: NgoCandidate[] = [];
      if (call.name === 'search_ngos') {
        const keywords = (call.args as { keywords: string[] }).keywords ?? [];
        toolResult = await searchNgosByKeywords(keywords);
        candidatesSeen = [...candidatesSeen, ...toolResult];
      }

      currentMessage = [
        {
          functionResponse: {
            name: call.name,
            response: {
              result:
                toolResult.length > 0
                  ? toolResult
                  : { message: 'No NGOs matched these keywords. Try broader or different terms.' },
            },
          },
        },
      ];

      continue;
    }

    const textOut = response.text;

    if (!textOut) {
      return { success: false, error: 'Agent returned no usable output.' };
    }

    let parsed: {
      selected_ngo_id: string;
      rationale_for_selection: string;
      urgency: 'Critical' | 'Standard';
      dispatch_message: string;
    };

    try {
      const cleaned = textOut.trim().replace(/^```json\s*|\s*```$/g, '');
      parsed = JSON.parse(cleaned);
    } catch {
      return { success: false, error: 'Agent response was not valid JSON. Raw: ' + textOut.slice(0, 200) };
    }

    if (parsed.selected_ngo_id === 'NONE_FOUND') {
      return {
        success: false,
        error: `No matching NGO found. Agent rationale: ${parsed.rationale_for_selection}`,
      };
    }

    const matchedNgo = candidatesSeen.find((n) => n.id === parsed.selected_ngo_id);

    if (!matchedNgo) {
      const { data: dbNgo } = await supabaseAdmin
        .from('ngos')
        .select('id, name, phone_number, email')
        .eq('id', parsed.selected_ngo_id)
        .single();

      if (!dbNgo) {
        return { success: false, error: 'Agent selected an NGO id that does not exist. Please retry.' };
      }

      return {
        success: true,
        decision: {
          selected_ngo_id: dbNgo.id,
          selected_ngo_name: dbNgo.name,
          selected_ngo_phone: dbNgo.phone_number,
          selected_ngo_email: dbNgo.email ?? null,
          rationale_for_selection: parsed.rationale_for_selection,
          urgency: parsed.urgency,
          dispatch_message: parsed.dispatch_message,
        },
      };
    }

    await supabaseAdmin.from('dispatch_logs').insert({
      ngo_id: matchedNgo.id,
      user_phone: userPhone,
      description,
      urgency: parsed.urgency,
      rationale: parsed.rationale_for_selection,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
    });

    return {
      success: true,
      decision: {
        selected_ngo_id: matchedNgo.id,
        selected_ngo_name: matchedNgo.name,
        selected_ngo_phone: matchedNgo.phone_number,
        selected_ngo_email: matchedNgo.email ?? null,
        rationale_for_selection: parsed.rationale_for_selection,
        urgency: parsed.urgency,
        dispatch_message: parsed.dispatch_message,
      },
    };
  }

  return { success: false, error: 'Agent exceeded maximum reasoning turns without a decision.' };
}
