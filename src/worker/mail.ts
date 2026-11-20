import type { Env } from './auth'

/**
 * Deliver the six-digit verification code.
 *
 * Cloudflare Workers cannot open an SMTP connection, so a mail provider's HTTP
 * API is required — Gmail "app passwords" will not work here. Set RESEND_API_KEY
 * (and optionally MAIL_FROM with a verified sender domain) to enable delivery.
 * Without it the app returns the code to the client so a preview build stays
 * usable; that is reported to the UI as `delivery: "preview"`.
 */
export async function sendVerificationEmail(
  env: Env,
  email: string,
  code: string,
): Promise<'email' | 'preview'> {
  if (!env.RESEND_API_KEY) return 'preview'
  const from = env.MAIL_FROM || 'EncryDB <onboarding@resend.dev>'
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `Your EncryDB verification code: ${code}`,
        text: `Welcome to EncryDB.\n\nYour verification code is ${code}. It expires in 10 minutes.\n\nIf you did not ask for this, ignore the message.`,
      }),
    })
    return response.ok ? 'email' : 'preview'
  } catch {
    return 'preview'
  }
}
