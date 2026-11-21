import type { Env } from './auth'
import { sendSmtpMail, type ConnectFn } from './smtp'

/**
 * Verification-code delivery.
 *
 * Preferred transport is SMTP straight from the Worker (`MAIL_USER` +
 * `MAIL_APP_PASSWORD`, an app password such as Gmail's). Workers cannot reach
 * port 25, but a TLS submission socket to 465/587 is enough, and that is what
 * `src/worker/smtp.ts` speaks.
 *
 * `RESEND_API_KEY` remains supported as an HTTP fallback. With neither
 * configured the app is in local preview mode and returns the code to the
 * client; that only ever happens on an unconfigured deployment.
 */

export type MailTransport = 'smtp' | 'resend' | 'none'

export class MailDeliveryError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message)
    this.name = 'MailDeliveryError'
  }
}

export function mailTransport(env: Env): MailTransport {
  if (env.MAIL_USER?.trim() && env.MAIL_APP_PASSWORD?.trim()) return 'smtp'
  if (env.RESEND_API_KEY) return 'resend'
  return 'none'
}

/** `From` header. `MAIL_FROM` overrides; otherwise the sending mailbox. */
export function mailFrom(env: Env): string {
  const override = env.MAIL_FROM?.trim()
  if (override) return override
  const user = env.MAIL_USER?.trim()
  return user ? `EncryDB <${user}>` : 'EncryDB <no-reply@localhost>'
}

function content(code: string, minutes: number) {
  const text = [
    'Welcome to EncryDB.',
    '',
    `Your verification code is ${code}. It expires in ${minutes} minutes.`,
    '',
    'Enter it on the sign-up screen to create your user id.',
    '',
    'If you did not ask for this, you can ignore this message.',
  ].join('\n')
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#ffffff;padding:32px;color:#0f172a">
  <div style="max-width:480px;margin:0 auto;border:1px solid #d1fae5;border-radius:16px;overflow:hidden">
    <div style="background:#047857;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:600">EncryDB</div>
    <div style="padding:24px">
      <p style="margin:0 0 12px">Welcome to EncryDB. Use this code to verify your email and create your user id:</p>
      <p style="margin:0 0 16px;font-size:32px;letter-spacing:8px;font-weight:700;color:#047857">${code}</p>
      <p style="margin:0 0 8px;color:#475569">The code expires in ${minutes} minutes and can be used once.</p>
      <p style="margin:0;color:#64748b;font-size:13px">If you did not ask for this, you can ignore this message.</p>
    </div>
  </div>
</div>`
  return { text, html }
}

/**
 * Returns 'email' when the code was accepted by a mail server, 'preview' when
 * no transport is configured. Throws MailDeliveryError when a configured
 * transport could not deliver, so the API never leaks the code as a fallback.
 */
export async function sendVerificationEmail(
  env: Env,
  email: string,
  code: string,
  connect?: ConnectFn,
): Promise<'email' | 'preview'> {
  const transport = mailTransport(env)
  if (transport === 'none') return 'preview'

  const { text, html } = content(code, 10)
  const subject = `Your EncryDB verification code: ${code}`

  if (transport === 'smtp') {
    if (!connect) {
      throw new MailDeliveryError(
        'SMTP transport is not available in this runtime.',
        'connect() from cloudflare:sockets was not provided',
      )
    }
    const port = Number(env.SMTP_PORT || 465)
    if (!Number.isInteger(port) || port <= 0) {
      throw new MailDeliveryError(`Invalid SMTP_PORT: ${env.SMTP_PORT}`)
    }
    try {
      await sendSmtpMail(
        connect,
        {
          host: (env.SMTP_HOST || 'smtp.gmail.com').trim(),
          port,
          user: env.MAIL_USER!.trim(),
          password: env.MAIL_APP_PASSWORD!.replace(/\s+/g, ''),
        },
        { from: mailFrom(env), to: email, subject, text, html },
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error('smtp delivery failed', detail)
      throw new MailDeliveryError('The verification email could not be sent.', detail)
    }
    return 'email'
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'EncryDB <onboarding@resend.dev>',
      to: [email],
      subject,
      text,
      html,
    }),
  }).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('resend delivery failed', detail)
    throw new MailDeliveryError('The verification email could not be sent.', detail)
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('resend delivery failed', response.status, detail.slice(0, 300))
    throw new MailDeliveryError('The verification email could not be sent.', detail.slice(0, 300))
  }
  return 'email'
}
