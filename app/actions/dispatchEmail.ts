'use server';

export interface EmailResult {
  success: boolean;
  detail: string;
}

/**
 * Sends the agent's dispatch_message via Resend's email API.
 * Used for Standard-urgency cases (Critical cases go through WhatsApp instead
 * — see dispatchWhatsapp.ts).
 *
 * NOTE: On Resend's free/unverified tier, you can only send to the email
 * address associated with your own Resend account — this is exactly right
 * for a hackathon demo where the "NGO" email is your own inbox. To send to
 * arbitrary recipients you'd need to verify a sending domain.
 */
export async function sendEmailDispatch(
  toEmail: string,
  ngoName: string,
  message: string
): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return { success: false, detail: 'RESEND_API_KEY not configured.' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Crisis Router <onboarding@resend.dev>',
        to: [toEmail],
        subject: `[Crisis Router] Dispatch request for ${ngoName}`,
        text: message,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { success: false, detail: `Resend error (${res.status}): ${JSON.stringify(data)}` };
    }

    return { success: true, detail: data.id ?? 'sent' };
  } catch (err) {
    return {
      success: false,
      detail: err instanceof Error ? err.message : 'Unknown network error dispatching email.',
    };
  }
}
