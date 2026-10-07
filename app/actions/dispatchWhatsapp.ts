'use server';

import twilio from 'twilio';

export interface WhatsappResult {
  success: boolean;
  detail: string;
}

/**
 * Sends the agent's dispatch_message via Twilio's WhatsApp Sandbox using a
 * Content Template (required — this sandbox account requires ContentSid for
 * every outbound message, not just ones outside the 24-hour session window).
 *
 * TWILIO_CONTENT_SID defaults to the sandbox's built-in "Appointment
 * Reminders" template (2 variables), which works immediately with no
 * approval wait. The real dispatch message goes in variable 1; the
 * reporter's phone goes in variable 2, so both pieces of real info still
 * reach the NGO even though the surrounding template wording is generic.
 *
 * To use a nicer custom template later: create one in Twilio Console ->
 * Messaging -> Content Editor, submit for WhatsApp approval, then once
 * approved set TWILIO_CONTENT_SID to its HX... id and adjust the variable
 * mapping below to match your template's placeholders.
 */
export async function sendWhatsappDispatch(
  toPhoneE164: string,
  message: string,
  reporterPhone?: string
): Promise<WhatsappResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM;
  const contentSid = process.env.TWILIO_CONTENT_SID || 'HXfe5ab5f00277942d4d4200328b4d403c';

  if (!accountSid || !authToken || !fromNumber) {
    return { success: false, detail: 'Twilio env vars not fully configured.' };
  }

  try {
    const client = twilio(accountSid, authToken);
    const toDigitsOnly = toPhoneE164.startsWith('+') ? toPhoneE164 : `+${toPhoneE164}`;

    const msg = await client.messages.create({
      from: fromNumber,
      to: `whatsapp:${toDigitsOnly}`,
      contentSid,
      contentVariables: JSON.stringify({
        '1': message,
        '2': reporterPhone || 'reporter contact not provided',
      }),
    });

    return { success: true, detail: msg.sid };
  } catch (err) {
    return {
      success: false,
      detail: err instanceof Error ? err.message : 'Unknown error dispatching WhatsApp message.',
    };
  }
}
