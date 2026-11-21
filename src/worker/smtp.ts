/**
 * A small, dependency-free SMTP client for Cloudflare Workers.
 *
 * Workers block outbound port 25, but they can open a TLS TCP socket to a
 * submission server: 465 (implicit TLS) or 587/2525/2587 (STARTTLS). That is
 * exactly what a Gmail/Workspace "app password" needs, so the app can send the
 * verification code straight from the Worker with no email API in between.
 *
 * `connect` is injected by the Worker entry point (the only file that imports
 * `cloudflare:sockets`), which keeps this module portable and loadable in tests.
 */

export type SocketAddress = { hostname: string; port: number }
export type SocketOptions = { secureTransport?: 'off' | 'on' | 'starttls' }

export type SocketLike = {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  opened: Promise<unknown>
  startTls(): SocketLike
  close(): Promise<void>
}

export type ConnectFn = (address: SocketAddress, options?: SocketOptions) => SocketLike

export type SmtpConfig = {
  host: string
  port: number
  /** Full mailbox address that authenticates, e.g. me@gmail.com */
  user: string
  /** App password (spaces are stripped). */
  password: string
  /** Name used in EHLO. Defaults to the user's domain. */
  helloName?: string
}

export type SmtpMessage = {
  /** From header, e.g. `EncryDB <me@gmail.com>` */
  from: string
  to: string
  subject: string
  text: string
  html: string
}

const TIMEOUT_MS = 12_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class SmtpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SmtpError'
  }
}

type Reply = { code: number; text: string }

function timeout<T>(promise: Promise<T>, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new SmtpError(`SMTP timed out while waiting for ${step}.`)),
      TIMEOUT_MS,
    )
  })
  return Promise.race([promise, limit]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

function base64(value: string): string {
  const bytes = encoder.encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function wrap(value: string, width = 76): string {
  return value.replace(new RegExp(`(.{1,${width}})`, 'g'), '$1\r\n').replace(/\r\n$/, '')
}

/** UTF-8-safe RFC 2047 header. */
function headerValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64(value)}?=`
}

/** The bare address inside `Name <a@b>` or `a@b`. */
export function envelopeAddress(value: string): string {
  const bracket = value.match(/<([^>]+)>/)
  return (bracket ? bracket[1] : value).trim()
}

/** Build the RFC 5322 message (multipart/alternative, base64 bodies). */
export function buildMessage(message: SmtpMessage): string {
  const boundary = `encrydb-${crypto.randomUUID()}`
  const domain = envelopeAddress(message.from).split('@')[1] || 'encrydb.local'
  const headers = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${headerValue(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
  const bodies = [
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(base64(message.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(base64(message.html)),
    `--${boundary}--`,
    '',
  ]
  return headers.concat(bodies).join('\r\n')
}

class Session {
  private writer: WritableStreamDefaultWriter<Uint8Array>
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private buffer = ''

  constructor(private socket: SocketLike) {
    this.writer = socket.writable.getWriter()
    this.reader = socket.readable.getReader()
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline >= 0) {
        const line = this.buffer.slice(0, newline).replace(/\r$/, '')
        this.buffer = this.buffer.slice(newline + 1)
        return line
      }
      if (this.buffer.length > 65_536) throw new SmtpError('SMTP reply was too large.')
      const { value, done } = await timeout(this.reader.read(), 'a reply')
      if (done) throw new SmtpError('The SMTP server closed the connection.')
      if (value) this.buffer += decoder.decode(value, { stream: true })
    }
  }

  async reply(): Promise<Reply> {
    const lines: string[] = []
    for (;;) {
      const line = await this.readLine()
      if (!/^\d{3}[ -]/.test(line)) throw new SmtpError(`Unexpected SMTP reply: ${line}`)
      lines.push(line)
      if (line[3] !== '-') break
    }
    const last = lines[lines.length - 1]
    return {
      code: Number(last.slice(0, 3)),
      text: lines.map((line) => line.slice(4)).join(' '),
    }
  }

  async send(line: string): Promise<void> {
    await timeout(this.writer.write(encoder.encode(`${line}\r\n`)), 'a write')
  }

  async command(line: string, expected: number[], step: string): Promise<Reply> {
    await this.send(line)
    const reply = await this.reply()
    if (!expected.includes(reply.code)) {
      throw new SmtpError(`${step} failed: ${reply.code} ${reply.text}`.trim())
    }
    return reply
  }

  async close(): Promise<void> {
    try {
      await this.writer.close()
    } catch {
      // already closed
    }
    try {
      this.reader.releaseLock()
    } catch {
      // ignore
    }
  }
}

/**
 * Send one message. Throws SmtpError with the server's reply on any failure.
 * Ports 465/2465 use implicit TLS; other ports start in the clear and upgrade
 * with STARTTLS before any credential leaves the Worker.
 */
export async function sendSmtpMail(
  connect: ConnectFn,
  config: SmtpConfig,
  message: SmtpMessage,
): Promise<void> {
  const implicitTls = config.port === 465 || config.port === 2465
  let socket = connect(
    { hostname: config.host, port: config.port },
    { secureTransport: implicitTls ? 'on' : 'starttls' },
  )
  let session = new Session(socket)

  try {
    await timeout(socket.opened, 'the connection')
    const greeting = await session.reply()
    if (greeting.code !== 220) {
      throw new SmtpError(`Server refused the connection: ${greeting.code} ${greeting.text}`)
    }

    const hello =
      config.helloName ||
      envelopeAddress(config.user).split('@')[1] ||
      'localhost'

    await session.command(`EHLO ${hello}`, [250], 'EHLO')

    if (!implicitTls) {
      await session.command('STARTTLS', [220], 'STARTTLS')
      socket = socket.startTls()
      session = new Session(socket)
      await session.command(`EHLO ${hello}`, [250], 'EHLO after STARTTLS')
    }

    const credentials = base64(`\0${config.user}\0${config.password}`)
    const auth = await session.command(`AUTH PLAIN ${credentials}`, [235, 334], 'AUTH')
    if (auth.code === 334) {
      await session.command(credentials, [235], 'AUTH')
    }

    // Gmail requires the envelope sender to be the authenticated mailbox.
    await session.command(`MAIL FROM:<${envelopeAddress(config.user)}>`, [250], 'MAIL FROM')
    await session.command(`RCPT TO:<${envelopeAddress(message.to)}>`, [250, 251], 'RCPT TO')
    await session.command('DATA', [354], 'DATA')

    // Base64 bodies never start with a dot, so no dot-stuffing is required.
    await timeout(session.send(buildMessage(message)), 'a write')
    await timeout(session.send('.'), 'a write')
    const accepted = await session.reply()
    if (accepted.code !== 250) {
      throw new SmtpError(`Message was rejected: ${accepted.code} ${accepted.text}`)
    }

    await session.command('QUIT', [221], 'QUIT').catch(() => undefined)
  } finally {
    await session.close()
    await socket.close().catch(() => undefined)
  }
}
