import { describe, expect, test } from 'bun:test'
import { MailDeliveryError, mailTransport, sendVerificationEmail } from '../src/worker/mail'
import { buildMessage, envelopeAddress, sendSmtpMail, type ConnectFn, type SocketLike } from '../src/worker/smtp'
import type { Env } from '../src/worker/auth'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A scripted TLS SMTP server: records the conversation, answers like Gmail. */
function fakeServer(options: { passwordOk?: boolean } = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const readable = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
    },
  })
  const commands: string[] = []
  const data: string[] = []
  let pending = ''
  let inData = false
  let sockets = 0

  const reply = (text: string) => controller.enqueue(encoder.encode(`${text}\r\n`))

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      pending += decoder.decode(chunk, { stream: true })
      for (;;) {
        const newline = pending.indexOf('\r\n')
        if (newline < 0) break
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 2)
        if (inData) {
          if (line === '.') {
            inData = false
            reply('250 2.0.0 OK queued')
          } else {
            data.push(line)
          }
          continue
        }
        commands.push(line)
        if (line.startsWith('EHLO')) reply('250-smtp.test\r\n250 AUTH PLAIN')
        else if (line.startsWith('AUTH PLAIN ')) {
          const decoded = atob(line.slice('AUTH PLAIN '.length))
          if (options.passwordOk === false) reply('535 5.7.8 Username and Password not accepted')
          else if (decoded.length > 0) reply('235 2.7.0 Accepted')
          else reply('334 ')
        } else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) reply('250 2.1.0 OK')
        else if (line === 'DATA') {
          inData = true
          reply('354 Go ahead')
        } else if (line === 'QUIT') reply('221 2.0.0 Bye')
        else reply('502 5.5.2 Command not implemented')
      }
    },
  })

  const connect: ConnectFn = () => {
    sockets += 1
    reply('220 smtp.test ESMTP ready')
    const socket: SocketLike = {
      readable,
      writable,
      opened: Promise.resolve(),
      startTls: () => socket,
      close: async () => undefined,
    }
    return socket
  }

  return {
    connect,
    commands,
    data,
    get sockets() {
      return sockets
    },
  }
}

function decodeBodies(lines: string[]): string {
  const joined = lines.join('\n')
  const parts = joined.split(/Content-Transfer-Encoding: base64\n\n/)
  return parts
    .slice(1)
    .map((part) => atob(part.split('\n--')[0].replace(/\s+/g, '')))
    .join('\n')
}

describe('SMTP client', () => {
  test('speaks the SMTP conversation and transmits the message', async () => {
    const server = fakeServer()
    await sendSmtpMail(
      server.connect,
      { host: 'smtp.gmail.com', port: 465, user: 'me@gmail.com', password: 'abcdefghijklmnop' },
      {
        from: 'EncryDB <me@gmail.com>',
        to: 'ada@example.com',
        subject: 'Your code: 123456',
        text: 'Your code is 123456.',
        html: '<p>Your code is 123456.</p>',
      },
    )

    expect(server.sockets).toBe(1)
    expect(server.commands[0]).toBe('EHLO gmail.com')
    const auth = server.commands.find((line) => line.startsWith('AUTH PLAIN '))!
    expect(atob(auth.slice('AUTH PLAIN '.length))).toBe('\0me@gmail.com\0abcdefghijklmnop')
    expect(server.commands).toContain('MAIL FROM:<me@gmail.com>')
    expect(server.commands).toContain('RCPT TO:<ada@example.com>')
    expect(server.commands).toContain('QUIT')

    const body = server.data.join('\n')
    expect(body).toContain('Subject: Your code: 123456')
    expect(body).toContain('multipart/alternative')
    expect(decodeBodies(server.data)).toContain('Your code is 123456.')
  })

  test('surfaces a rejected app password', async () => {
    const server = fakeServer({ passwordOk: false })
    expect(
      sendSmtpMail(
        server.connect,
        { host: 'smtp.gmail.com', port: 465, user: 'me@gmail.com', password: 'wrong' },
        {
          from: 'EncryDB <me@gmail.com>',
          to: 'ada@example.com',
          subject: 'x',
          text: 'x',
          html: 'x',
        },
      ),
    ).rejects.toThrow(/AUTH failed: 535/)
  })
})

describe('mailer selection', () => {
  test('prefers an app password over Resend, and previews only with no transport', () => {
    expect(mailTransport({} as Env)).toBe('none')
    expect(mailTransport({ RESEND_API_KEY: 're_123' } as Env)).toBe('resend')
    expect(
      mailTransport({ MAIL_USER: 'me@gmail.com', MAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' } as Env),
    ).toBe('smtp')
  })

  test('verification codes go out over SMTP, and failures never return the code', async () => {
    const server = fakeServer()
    const sent = await sendVerificationEmail(
      {
        MAIL_USER: 'me@gmail.com',
        MAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
        MAIL_FROM: 'EncryDB <me@gmail.com>',
      } as Env,
      'ada@example.com',
      '123456',
      server.connect,
    )
    expect(sent).toBe('email')
    const auth = server.commands.find((line) => line.startsWith('AUTH PLAIN '))!
    expect(atob(auth.slice('AUTH PLAIN '.length))).toBe('\0me@gmail.com\0abcdefghijklmnop')
    expect(decodeBodies(server.data)).toContain('123456')
    expect(server.data.join('\n')).toContain('Subject: Your EncryDB verification code: 123456')

    const failing = fakeServer({ passwordOk: false })
    expect(
      sendVerificationEmail(
        { MAIL_USER: 'me@gmail.com', MAIL_APP_PASSWORD: 'wrong' } as Env,
        'ada@example.com',
        '123456',
        failing.connect,
      ),
    ).rejects.toBeInstanceOf(MailDeliveryError)

    // No transport configured: the caller is told to use preview mode.
    expect(
      await sendVerificationEmail({} as Env, 'ada@example.com', '123456'),
    ).toBe('preview')
  })
})

test('message headers are RFC 5322 safe', () => {
  const message = buildMessage({
    from: 'EncryDB <me@gmail.com>',
    to: 'ada@example.com',
    subject: 'Héllo — code 123456',
    text: 'line',
    html: '<p>line</p>',
  })
  expect(message).toContain('Subject: =?UTF-8?B?')
  expect(message).toContain('MIME-Version: 1.0')
  expect(message).toContain('Message-ID: <')
  expect(envelopeAddress('EncryDB <me@gmail.com>')).toBe('me@gmail.com')
  expect(envelopeAddress('me@gmail.com')).toBe('me@gmail.com')
})
