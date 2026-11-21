import { isSameOriginRequest } from '@freebuff/auth'
import type { FreebuffUser } from '@freebuff/auth'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  appOrigin,
  clearedSessionCookie,
  currentUser,
  hashPassword,
  sessionCookie,
  verifyPassword,
  type Env,
} from './auth'
import { MailDeliveryError, mailTransport, sendVerificationEmail } from './mail'
import type { ConnectFn } from './smtp'
import {
  ensureSchema,
  mapChannel,
  mapMember,
  mapMessage,
  mapPeer,
  mapUser,
} from './db'
import type { Channel, DmMessage } from '../shared/types'

type AccountRow = {
  id: string
  user_id: string | null
  email: string
  name: string
  role: string
  created_at: number
}

type Variables = { account: AccountRow; db: D1Database }
type Authenticate = (request: Request, env: Env) => Promise<FreebuffUser | null>

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000
const PEER_TIMEOUT = 20_000
const MAX_IMAGE_CHARS = 900_000
const CODE_TTL = 10 * 60 * 1000

const uuid = () => crypto.randomUUID()
const now = () => Date.now()

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomFrom(alphabet: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  for (const byte of bytes) out += alphabet[byte % alphabet.length]
  return out
}

/** Human-friendly login id, e.g. EDB-7K4M-9QX2. */
function generateUserId(): string {
  return `EDB-${randomFrom(ID_ALPHABET, 4)}-${randomFrom(ID_ALPHABET, 4)}`
}

function tempPassword(): string {
  return randomFrom('abcdefghijkmnpqrstuvwxyz23456789', 12)
}

function inviteCode(): string {
  return randomFrom('abcdefghijkmnpqrstuvwxyz23456789', 8)
}

function cleanChannelName(value: string): string | null {
  const name = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
  return name || null
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const codeHash = (email: string, code: string) =>
  sha256(`${email.toLowerCase()}:${code}`)

/** Freebuff identities are provisioned on first sight; email accounts are real. */
async function provision(db: D1Database, user: FreebuffUser): Promise<void> {
  if (user.sub === 'local-preview') return
  await db
    .prepare(
      `INSERT OR IGNORE INTO users (id, user_id, email, password_hash, name, role, created_at)
       VALUES (?, ?, ?, 'none', ?, 'member', ?)`,
    )
    .bind(
      user.sub,
      generateUserId(),
      `${user.sub}@freebuff.local`,
      (user.name || user.email || 'Member').slice(0, 60),
      now(),
    )
    .run()
}

async function membership(
  db: D1Database,
  channelId: string,
  userId: string,
): Promise<{ channel: Channel; serverId: string } | null> {
  const row = await db
    .prepare(
      'SELECT c.id, c.server_id, c.name, c.kind, c.position FROM channels c JOIN server_members m ON m.server_id = c.server_id WHERE c.id = ? AND m.user_id = ?',
    )
    .bind(channelId, userId)
    .first<{
      id: string
      server_id: string
      name: string
      kind: string
      position: number
    }>()
  if (!row) return null
  return { channel: mapChannel(row), serverId: row.server_id }
}

async function isAdmin(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT role FROM users WHERE id = ?')
    .bind(userId)
    .first<{ role: string }>()
  return row?.role === 'admin'
}

/** Append an announcement to a member's "Server" direct messages. */
async function notify(
  db: D1Database,
  userId: string,
  body: string,
  serverId: string | null = null,
  channelId: string | null = null,
): Promise<void> {
  const existing = await db
    .prepare('SELECT id FROM dm_threads WHERE user_id = ?')
    .bind(userId)
    .first<{ id: string }>()
  let threadId = existing?.id
  if (!threadId) {
    threadId = uuid()
    await db
      .prepare(
        'INSERT INTO dm_threads (id, user_id, bot_name, last_read_at, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(threadId, userId, 'Server', 0, now())
      .run()
  }
  await db
    .prepare(
      'INSERT INTO dm_messages (id, thread_id, body, server_id, channel_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(uuid(), threadId, body, serverId, channelId, now())
    .run()
}

export function createApp(
  authenticate: Authenticate = currentUser,
  smtpConnect?: ConnectFn,
) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>()

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })

  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_IMAGE_CHARS + 64 * 1024,
      onError: (c) => c.json({ error: 'Request is too large.' }, 413),
    }),
  )

  app.onError((error, c) => {
    console.error('api error', error)
    return c.json({ error: 'Something went wrong. Please try again.' }, 500)
  })

  /* ---------------- session + account ---------------- */

  app.get('/api/session', async (c) => {
    const user = await authenticate(c.req.raw, c.env)
    let account: AccountRow | null = null
    if (user && c.env.DB) {
      await ensureSchema(c.env.DB)
      await provision(c.env.DB, user)
      account = await c.env.DB.prepare(
        'SELECT id, user_id, email, name, role, created_at FROM users WHERE id = ?',
      )
        .bind(user.sub)
        .first<AccountRow>()
    }
    return c.json({
      user: account ? mapUser(account) : null,
      mode: c.env.FREEBUFF_CLIENT_ID && c.env.APP_ORIGIN ? 'freebuff' : 'local',
      database: Boolean(c.env.DB),
      mailer: mailTransport(c.env) !== 'none',
      mailTransport: mailTransport(c.env),
    })
  })

  /* ---------------- accounts ---------------- */

  app.post('/api/auth/request-code', async (c) => {
    if (!c.env.DB) return c.json({ error: 'Database unavailable.' }, 503)
    const body = await c.req.json().catch(() => null)
    const raw = (body as Record<string, unknown> | null) || {}
    const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : ''
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : ''
    if (!EMAIL.test(email))
      return c.json({ error: 'Enter a valid email address.' }, 400)
    await ensureSchema(c.env.DB)
    const taken = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?')
      .bind(email)
      .first()
    if (taken)
      return c.json(
        { error: 'That email already has an account. Sign in instead.' },
        409,
      )
    const code = randomFrom('0123456789', 6)
    const stamp = now()
    await c.env.DB.prepare(
      `INSERT INTO pending_signups (email, name, code_hash, attempts, expires_at, created_at)
       VALUES (?, ?, ?, 0, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         name = excluded.name,
         code_hash = excluded.code_hash,
         attempts = 0,
         expires_at = excluded.expires_at,
         created_at = excluded.created_at`,
    )
      .bind(email, name, await codeHash(email, code), stamp + CODE_TTL, stamp)
      .run()
    let delivery: 'email' | 'preview'
    try {
      delivery = await sendVerificationEmail(c.env, email, code, smtpConnect)
    } catch (error) {
      // Never fall back to showing the code: an unconfigured preview build is
      // the only case where the client may see it.
      const detail = error instanceof Error ? error.message : 'unknown error'
      console.error('verification email failed', detail)
      return c.json(
        {
          error:
            error instanceof MailDeliveryError && error.detail
              ? `We could not send the verification email (${error.detail}).`
              : 'We could not send the verification email. Please try again.',
        },
        502,
      )
    }
    return c.json({
      delivery,
      ...(delivery === 'preview' ? { code } : {}),
      message:
        delivery === 'email'
          ? `We sent a six-digit code to ${email}.`
          : 'Email delivery is not configured, so here is your code.',
    })
  })

  app.post('/api/auth/verify', async (c) => {
    if (!c.env.DB) return c.json({ error: 'Database unavailable.' }, 503)
    const body = await c.req.json().catch(() => null)
    const raw = (body as Record<string, unknown> | null) || {}
    const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : ''
    const code = typeof raw.code === 'string' ? raw.code.trim() : ''
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : ''
    const password = typeof raw.password === 'string' ? raw.password : ''
    if (!EMAIL.test(email)) return c.json({ error: 'Enter a valid email address.' }, 400)
    if (!/^\d{6}$/.test(code)) return c.json({ error: 'Enter the six-digit code.' }, 400)
    if (!name) return c.json({ error: 'Choose a display name.' }, 400)
    if (password.length < 8)
      return c.json({ error: 'Password must be at least 8 characters.' }, 400)
    await ensureSchema(c.env.DB)

    const pending = await c.env.DB.prepare(
      'SELECT code_hash, attempts, expires_at FROM pending_signups WHERE email = ?',
    )
      .bind(email)
      .first<{ code_hash: string; attempts: number; expires_at: number }>()
    if (!pending)
      return c.json({ error: 'Request a code before verifying.' }, 400)
    if (pending.expires_at < now()) {
      await c.env.DB.prepare('DELETE FROM pending_signups WHERE email = ?')
        .bind(email)
        .run()
      return c.json({ error: 'That code has expired. Request a new one.' }, 400)
    }
    if (pending.attempts >= 6)
      return c.json(
        { error: 'Too many attempts. Request a new code.' },
        429,
      )
    if ((await codeHash(email, code)) !== pending.code_hash) {
      await c.env.DB.prepare(
        'UPDATE pending_signups SET attempts = attempts + 1 WHERE email = ?',
      )
        .bind(email)
        .run()
      return c.json({ error: 'That code is not right.' }, 400)
    }
    if (await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first())
      return c.json({ error: 'That email already has an account.' }, 409)

    const total = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM users')
      .first<{ total: number }>()
    const role = (total?.total ?? 0) === 0 ? 'admin' : 'member'
    const id = uuid()
    const userId = generateUserId()
    const created = now()
    await c.env.DB.prepare(
      'INSERT INTO users (id, user_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, userId, email, await hashPassword(password), name, role, created)
      .run()
    await c.env.DB.prepare('DELETE FROM pending_signups WHERE email = ?')
      .bind(email)
      .run()
    const sessionId = await createSession(c.env.DB, id)
    return c.json(
      {
        user: {
          id,
          userId,
          email,
          name,
          role,
          createdAt: created,
        },
      },
      201,
      {
        'Set-Cookie': sessionCookie(
          sessionId,
          appOrigin(c.req.raw, c.env),
          Math.floor(SESSION_TTL / 1000),
        ),
      },
    )
  })

  app.post('/api/auth/signin', async (c) => {
    if (!c.env.DB) return c.json({ error: 'Database unavailable.' }, 503)
    const body = await c.req.json().catch(() => null)
    const raw = (body as Record<string, unknown> | null) || {}
    const identifier =
      typeof raw.identifier === 'string' ? raw.identifier.trim() : ''
    const password = typeof raw.password === 'string' ? raw.password : ''
    if (!identifier || !password)
      return c.json({ error: 'Enter your user id and password.' }, 400)
    await ensureSchema(c.env.DB)
    const row = await c.env.DB.prepare(
      `SELECT id, user_id, email, name, role, password_hash, created_at
         FROM users
        WHERE lower(email) = lower(?) OR upper(user_id) = upper(?)`,
    )
      .bind(identifier, identifier)
      .first<AccountRow & { password_hash: string }>()
    if (!row || !(await verifyPassword(password, row.password_hash)))
      return c.json({ error: 'Wrong user id or password.' }, 401)
    const sessionId = await createSession(c.env.DB, row.id)
    return c.json(
      { user: mapUser(row) },
      200,
      {
        'Set-Cookie': sessionCookie(
          sessionId,
          appOrigin(c.req.raw, c.env),
          Math.floor(SESSION_TTL / 1000),
        ),
      },
    )
  })

  app.post('/api/auth/signout', async (c) => {
    const cookie = c.req.header('Cookie') || ''
    const match = /encrydb_session=([^;]+)/.exec(cookie)
    if (match && c.env.DB)
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?')
        .bind(match[1])
        .run()
    return c.json({ ok: true }, 200, { 'Set-Cookie': clearedSessionCookie() })
  })

  /* ---------------- everything below needs an account ---------------- */

  app.use('/api/*', async (c, next) => {
    if (
      c.req.path.startsWith('/api/auth/') ||
      c.req.path === '/api/health' ||
      c.req.path === '/api/session'
    )
      return next()
    const user = await authenticate(c.req.raw, c.env)
    if (!user) return c.json({ error: 'Sign in required.' }, 401)
    if (!c.env.DB)
      return c.json(
        { error: 'This app is still being set up. Please try again later.' },
        503,
      )
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      const origin = appOrigin(c.req.raw, c.env)
      if (!isSameOriginRequest(c.req.raw, origin))
        return c.json({ error: 'Cross-origin request refused.' }, 403)
    }
    await ensureSchema(c.env.DB)
    await provision(c.env.DB, user)
    const account = await c.env.DB.prepare(
      'SELECT id, user_id, email, name, role, created_at FROM users WHERE id = ?',
    )
      .bind(user.sub)
      .first<AccountRow>()
    if (!account) return c.json({ error: 'Sign in required.' }, 401)
    c.set('account', account)
    c.set('db', c.env.DB)
    await next()
  })

  app.get('/api/me', (c) => c.json({ user: mapUser(c.get('account')) }))

  app.patch('/api/me', async (c) => {
    const body = await c.req.json().catch(() => null)
    const name = (body as Record<string, unknown> | null)?.name
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60)
      return c.json({ error: 'Name must be 1–60 characters.' }, 400)
    await c
      .get('db')
      .prepare('UPDATE users SET name = ? WHERE id = ?')
      .bind(name.trim(), c.get('account').id)
      .run()
    return c.json({ ok: true, name: name.trim() })
  })

  /* ---------------- admin ---------------- */

  app.get('/api/admin/users', async (c) => {
    if (!(await isAdmin(c.get('db'), c.get('account').id)))
      return c.json({ error: 'Admins only.' }, 403)
    const rows = await c
      .get('db')
      .prepare(
        'SELECT id, user_id, email, name, role, created_at FROM users ORDER BY created_at ASC',
      )
      .all<AccountRow>()
    return c.json({ users: rows.results.map(mapUser) })
  })

  app.post('/api/admin/users', async (c) => {
    const db = c.get('db')
    if (!(await isAdmin(db, c.get('account').id)))
      return c.json({ error: 'Admins only.' }, 403)
    const body = await c.req.json().catch(() => null)
    const raw = (body as Record<string, unknown> | null) || {}
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : ''
    const email =
      typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : ''
    if (!name) return c.json({ error: 'A display name is required.' }, 400)
    if (email && !EMAIL.test(email))
      return c.json({ error: 'Enter a valid email address.' }, 400)
    if (email) {
      const taken = await db.prepare('SELECT 1 FROM users WHERE email = ?')
        .bind(email)
        .first()
      if (taken) return c.json({ error: 'That email is already registered.' }, 409)
    }
    const id = uuid()
    const userId = generateUserId()
    const password = tempPassword()
    const createdAt = now()
    await db
      .prepare(
        'INSERT INTO users (id, user_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        id,
        userId,
        email || `${userId.toLowerCase()}@users.encrydb.local`,
        await hashPassword(password),
        name,
        'member',
        createdAt,
      )
      .run()
    return c.json(
      {
        user: {
          id,
          userId,
          email,
          name,
          role: 'member',
          createdAt,
        },
        password,
      },
      201,
    )
  })

  /* ---------------- servers ---------------- */

  app.get('/api/servers', async (c) => {
    const db = c.get('db')
    const account = c.get('account')
    const rows = await db
      .prepare(
        'SELECT s.id, s.name, s.owner_id, s.invite_code, m.role FROM servers s JOIN server_members m ON m.server_id = s.id WHERE m.user_id = ? ORDER BY s.created_at ASC',
      )
      .bind(account.id)
      .all<{
        id: string
        name: string
        owner_id: string
        invite_code: string
        role: string
      }>()
    const servers = []
    for (const row of rows.results) {
      const channels = await db
        .prepare(
          'SELECT id, server_id, name, kind, position FROM channels WHERE server_id = ? ORDER BY position ASC, name ASC',
        )
        .bind(row.id)
        .all<{
          id: string
          server_id: string
          name: string
          kind: string
          position: number
        }>()
      const members = await db
        .prepare(
          'SELECT m.user_id, u.name, m.role FROM server_members m JOIN users u ON u.id = m.user_id WHERE m.server_id = ? ORDER BY m.joined_at ASC',
        )
        .bind(row.id)
        .all<{ user_id: string; name: string; role: string }>()
      servers.push({
        id: row.id,
        name: row.name,
        ownerId: row.owner_id,
        role: row.role,
        inviteCode: row.invite_code,
        channels: channels.results.map(mapChannel),
        members: members.results.map(mapMember),
      })
    }
    return c.json({ servers })
  })

  app.post('/api/servers', async (c) => {
    const body = await c.req.json().catch(() => null)
    const name = (body as Record<string, unknown> | null)?.name
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60)
      return c.json({ error: 'Server name is required (max 60 characters).' }, 400)
    const db = c.get('db')
    const account = c.get('account')
    const id = uuid()
    const code = inviteCode()
    const created = now()
    await db
      .prepare(
        'INSERT INTO servers (id, name, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(id, name.trim(), account.id, code, created)
      .run()
    await db
      .prepare(
        'INSERT INTO server_members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
      )
      .bind(id, account.id, 'owner', created)
      .run()
    const general = uuid()
    const voice = uuid()
    await db.batch([
      db
        .prepare(
          'INSERT INTO channels (id, server_id, name, kind, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(general, id, 'general', 'text', 0, created),
      db
        .prepare(
          'INSERT INTO channels (id, server_id, name, kind, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(voice, id, 'Voice', 'voice', 1, created),
    ])
    return c.json(
      {
        server: {
          id,
          name: name.trim(),
          ownerId: account.id,
          role: 'owner',
          inviteCode: code,
          channels: [
            { id: general, serverId: id, name: 'general', kind: 'text', position: 0 },
            { id: voice, serverId: id, name: 'Voice', kind: 'voice', position: 1 },
          ],
          members: [{ userId: account.id, name: account.name, role: 'owner' }],
        },
      },
      201,
    )
  })

  app.post('/api/servers/join', async (c) => {
    const body = await c.req.json().catch(() => null)
    const code = (body as Record<string, unknown> | null)?.code
    if (typeof code !== 'string' || !code.trim())
      return c.json({ error: 'An invite code is required.' }, 400)
    const db = c.get('db')
    const account = c.get('account')
    const server = await db
      .prepare('SELECT id, name FROM servers WHERE invite_code = ?')
      .bind(code.trim().toLowerCase())
      .first<{ id: string; name: string }>()
    if (!server) return c.json({ error: 'That invite code is not valid.' }, 404)
    const added = await db
      .prepare(
        'INSERT OR IGNORE INTO server_members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
      )
      .bind(server.id, account.id, 'member', now())
      .run()
    if (added.meta.changes)
      await notify(
        db,
        account.id,
        `You were added to ${server.name}. Open it from the left to join the conversation.`,
        server.id,
      )
    return c.json({ ok: true, serverId: server.id, name: server.name })
  })

  app.post('/api/servers/:id/channels', async (c) => {
    const serverId = c.req.param('id')
    const body = await c.req.json().catch(() => null)
    const raw = (body as Record<string, unknown> | null) || {}
    const name = cleanChannelName(String(raw.name ?? ''))
    const kind = raw.kind === 'voice' ? 'voice' : 'text'
    if (!name) return c.json({ error: 'Enter a channel name.' }, 400)
    const db = c.get('db')
    const member = await db
      .prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?')
      .bind(serverId, c.get('account').id)
      .first()
    if (!member) return c.json({ error: 'Access denied.' }, 403)
    const count = await db
      .prepare('SELECT COUNT(*) AS total FROM channels WHERE server_id = ?')
      .bind(serverId)
      .first<{ total: number }>()
    if ((count?.total ?? 0) >= 40)
      return c.json({ error: 'This server has the maximum number of channels.' }, 400)
    const id = uuid()
    await db
      .prepare(
        'INSERT INTO channels (id, server_id, name, kind, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(id, serverId, name, kind, count?.total ?? 0, now())
      .run()
    return c.json(
      { channel: { id, serverId, name, kind, position: count?.total ?? 0 } },
      201,
    )
  })

  app.post('/api/servers/:id/leave', async (c) => {
    const db = c.get('db')
    const account = c.get('account')
    const serverId = c.req.param('id')
    const owner = await db
      .prepare('SELECT owner_id FROM servers WHERE id = ?')
      .bind(serverId)
      .first<{ owner_id: string }>()
    if (owner?.owner_id === account.id)
      return c.json({ error: 'You own this server, so it cannot be left.' }, 400)
    await db
      .prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?')
      .bind(serverId, account.id)
      .run()
    return c.json({ ok: true })
  })

  /* ---------------- direct messages from Server ---------------- */

  app.get('/api/dm', async (c) => {
    const db = c.get('db')
    const account = c.get('account')
    const thread = await db
      .prepare('SELECT id, last_read_at FROM dm_threads WHERE user_id = ?')
      .bind(account.id)
      .first<{ id: string; last_read_at: number }>()
    if (!thread) return c.json({ unread: 0, messages: [] })
    const rows = await db
      .prepare(
        'SELECT id, body, server_id, channel_id, created_at FROM dm_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 100',
      )
      .bind(thread.id)
      .all<{
        id: string
        body: string
        server_id: string | null
        channel_id: string | null
        created_at: number
      }>()
    const messages: DmMessage[] = rows.results.map((row) => ({
      id: row.id,
      body: row.body,
      serverId: row.server_id,
      channelId: row.channel_id,
      createdAt: row.created_at,
    }))
    const unread = messages.filter((m) => m.createdAt > thread.last_read_at).length
    return c.json({ unread, messages })
  })

  app.post('/api/dm/read', async (c) => {
    await c
      .get('db')
      .prepare('UPDATE dm_threads SET last_read_at = ? WHERE user_id = ?')
      .bind(now(), c.get('account').id)
      .run()
    return c.json({ ok: true })
  })

  /* ---------------- messages ---------------- */

  app.get('/api/channels/:id/messages', async (c) => {
    const db = c.get('db')
    const found = await membership(db, c.req.param('id'), c.get('account').id)
    if (!found) return c.json({ error: 'Access denied.' }, 404)
    const after = Number(c.req.query('after') || 0)
    const rows = await db
      .prepare(
        `SELECT m.id, m.channel_id, m.author_id, m.content, m.kind, m.file_id, m.created_at,
                u.name AS author_name, f.filename
           FROM messages m
           JOIN users u ON u.id = m.author_id
           LEFT JOIN files f ON f.id = m.file_id
          WHERE m.channel_id = ? AND m.created_at >= ?
          ORDER BY m.created_at ASC, m.id ASC
          LIMIT 200`,
      )
      .bind(found.channel.id, Number.isFinite(after) ? after : 0)
      .all<Parameters<typeof mapMessage>[0]>()
    return c.json({ messages: rows.results.map(mapMessage) })
  })

  app.post('/api/channels/:id/messages', async (c) => {
    const db = c.get('db')
    const account = c.get('account')
    const found = await membership(db, c.req.param('id'), account.id)
    if (!found) return c.json({ error: 'Access denied.' }, 404)
    if (found.channel.kind !== 'text')
      return c.json({ error: 'Voice channels do not take messages.' }, 400)
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object')
      return c.json({ error: 'Invalid request body.' }, 400)
    const raw = body as Record<string, unknown>
    const content = typeof raw.content === 'string' ? raw.content.trim() : ''
    const image = raw.image as
      | { name?: unknown; mime?: unknown; dataUrl?: unknown }
      | undefined
    if (!content && !image)
      return c.json({ error: 'Write a message or attach an image.' }, 400)
    if (content.length > 2000)
      return c.json({ error: 'Messages are limited to 2000 characters.' }, 400)

    let fileId: string | null = null
    if (image) {
      const dataUrl = typeof image.dataUrl === 'string' ? image.dataUrl : ''
      const name = typeof image.name === 'string' ? image.name : 'image'
      const mime = typeof image.mime === 'string' ? image.mime : 'image/png'
      const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
      if (!match || !mime.startsWith('image/'))
        return c.json({ error: 'Attach a valid image file.' }, 400)
      if (match[2].length > MAX_IMAGE_CHARS)
        return c.json({ error: 'That image is too large (max ~650 KB).' }, 413)
      fileId = uuid()
      await db
        .prepare(
          'INSERT INTO files (id, owner_id, filename, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          fileId,
          account.id,
          name.slice(0, 120),
          mime,
          Math.floor((match[2].length * 3) / 4),
          match[2],
          now(),
        )
        .run()
    }

    const id = uuid()
    const created = now()
    await db
      .prepare(
        'INSERT INTO messages (id, channel_id, author_id, content, kind, file_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        id,
        found.channel.id,
        account.id,
        content,
        fileId ? 'image' : 'text',
        fileId,
        created,
      )
      .run()
    const saved = await db
      .prepare(
        `SELECT m.id, m.channel_id, m.author_id, m.content, m.kind, m.file_id, m.created_at,
                u.name AS author_name, f.filename
           FROM messages m JOIN users u ON u.id = m.author_id
           LEFT JOIN files f ON f.id = m.file_id
          WHERE m.id = ?`,
      )
      .bind(id)
      .first<Parameters<typeof mapMessage>[0]>()
    return c.json({ message: saved ? mapMessage(saved) : null }, 201)
  })

  app.get('/api/files/:id', async (c) => {
    const row = await c
      .get('db')
      .prepare('SELECT id, mime, data FROM files WHERE id = ?')
      .bind(c.req.param('id'))
      .first<{ id: string; mime: string; data: string }>()
    if (!row) return c.json({ error: 'File not found.' }, 404)
    const binary = atob(row.data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new Response(bytes, {
      headers: {
        'Content-Type': row.mime,
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': 'inline',
      },
    })
  })

  /* ---------------- voice rooms ---------------- */

  app.post('/api/channels/:id/voice/join', async (c) => {
    const db = c.get('db')
    const account = c.get('account')
    const found = await membership(db, c.req.param('id'), account.id)
    if (!found) return c.json({ error: 'Access denied.' }, 404)
    if (found.channel.kind !== 'voice')
      return c.json({ error: 'That is not a voice channel.' }, 400)
    const body = await c.req.json().catch(() => null)
    const muted = (body as Record<string, unknown> | null)?.muted === true ? 1 : 0
    const stamp = now()
    const peerId = uuid()
    await db
      .prepare(
        'INSERT INTO voice_peers (id, channel_id, user_id, name, muted, last_seen) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(peerId, found.channel.id, account.id, account.name, muted, stamp)
      .run()

    // Announce a new meeting once, to everyone in the server but the host.
    const others = await db
      .prepare(
        'SELECT COUNT(*) AS total FROM voice_peers WHERE channel_id = ? AND id <> ? AND last_seen >= ?',
      )
      .bind(found.channel.id, peerId, stamp - PEER_TIMEOUT)
      .first<{ total: number }>()
    if ((others?.total ?? 0) === 0) {
      const recent = await db
        .prepare(
          'SELECT 1 FROM dm_messages WHERE channel_id = ? AND created_at > ? LIMIT 1',
        )
        .bind(found.channel.id, stamp - 15 * 60 * 1000)
        .first()
      if (!recent) {
        const server = await db
          .prepare('SELECT name FROM servers WHERE id = ?')
          .bind(found.serverId)
          .first<{ name: string }>()
        const audience = await db
          .prepare('SELECT user_id FROM server_members WHERE server_id = ? AND user_id <> ?')
          .bind(found.serverId, account.id)
          .all<{ user_id: string }>()
        for (const member of audience.results)
          await notify(
            db,
            member.user_id,
            `Meeting started in ${server?.name ?? 'a server'} · #${found.channel.name}. Open the channel to join the call.`,
            found.serverId,
            found.channel.id,
          )
      }
    }
    return c.json({ peerId, channel: found.channel })
  })

  app.post('/api/channels/:id/voice/heartbeat', async (c) => {
    const db = c.get('db')
    const found = await membership(db, c.req.param('id'), c.get('account').id)
    if (!found) return c.json({ error: 'Access denied.' }, 404)
    const body = await c.req.json().catch(() => null)
    const raw = (body as Record<string, unknown> | null) || {}
    const peerId = raw.peerId
    const muted = raw.muted === true ? 1 : 0
    if (typeof peerId !== 'string')
      return c.json({ error: 'A peer id is required.' }, 400)
    const stamp = now()
    await db
      .prepare('UPDATE voice_peers SET last_seen = ?, muted = ? WHERE id = ? AND channel_id = ?')
      .bind(stamp, muted, peerId, found.channel.id)
      .run()
    await db
      .prepare('DELETE FROM voice_peers WHERE channel_id = ? AND last_seen < ?')
      .bind(found.channel.id, stamp - PEER_TIMEOUT)
      .run()
    await db
      .prepare('DELETE FROM voice_signals WHERE channel_id = ? AND created_at < ?')
      .bind(found.channel.id, stamp - 120_000)
      .run()
    const peers = await db
      .prepare(
        'SELECT id, user_id, name, muted FROM voice_peers WHERE channel_id = ? AND last_seen >= ? ORDER BY last_seen ASC',
      )
      .bind(found.channel.id, stamp - PEER_TIMEOUT)
      .all<{ id: string; user_id: string; name: string; muted: number }>()
    return c.json({ peers: peers.results.map(mapPeer) })
  })

  app.post('/api/channels/:id/voice/signal', async (c) => {
    const db = c.get('db')
    const found = await membership(db, c.req.param('id'), c.get('account').id)
    if (!found) return c.json({ error: 'Access denied.' }, 404)
    const body = await c.req.json().catch(() => null)
    const raw = (body as Record<string, unknown> | null) || {}
    const { peerId, to, kind, payload } = raw
    if (
      typeof peerId !== 'string' ||
      typeof to !== 'string' ||
      typeof kind !== 'string' ||
      typeof payload !== 'string'
    )
      return c.json({ error: 'Invalid signal.' }, 400)
    if (payload.length > 16_000)
      return c.json({ error: 'Signal is too large.' }, 413)
    await db
      .prepare(
        'INSERT INTO voice_signals (channel_id, from_peer, to_peer, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(found.channel.id, peerId, to, kind.slice(0, 16), payload, now())
      .run()
    return c.json({ ok: true })
  })

  app.get('/api/channels/:id/voice/signals', async (c) => {
    const db = c.get('db')
    const found = await membership(db, c.req.param('id'), c.get('account').id)
    if (!found) return c.json({ error: 'Access denied.' }, 404)
    const peerId = c.req.query('peerId') || ''
    const after = Number(c.req.query('after') || 0)
    const rows = await db
      .prepare(
        'SELECT id, from_peer, kind, payload FROM voice_signals WHERE channel_id = ? AND to_peer = ? AND id > ? ORDER BY id ASC LIMIT 50',
      )
      .bind(found.channel.id, peerId, Number.isFinite(after) ? after : 0)
      .all<{ id: number; from_peer: string; kind: string; payload: string }>()
    return c.json({
      signals: rows.results.map((row) => ({
        id: row.id,
        from: row.from_peer,
        kind: row.kind,
        payload: row.payload,
      })),
    })
  })

  app.post('/api/channels/:id/voice/leave', async (c) => {
    const db = c.get('db')
    const found = await membership(db, c.req.param('id'), c.get('account').id)
    if (!found) return c.json({ error: 'Access denied.' }, 404)
    const body = await c.req.json().catch(() => null)
    const peerId = (body as Record<string, unknown> | null)?.peerId
    if (typeof peerId === 'string') {
      await db
        .prepare('DELETE FROM voice_peers WHERE id = ? AND channel_id = ?')
        .bind(peerId, found.channel.id)
        .run()
      await db
        .prepare(
          'DELETE FROM voice_signals WHERE channel_id = ? AND (from_peer = ? OR to_peer = ?)',
        )
        .bind(found.channel.id, peerId, peerId)
        .run()
    }
    return c.json({ ok: true })
  })

  app.notFound((c) =>
    c.req.path === '/api' || c.req.path.startsWith('/api/')
      ? c.json({ error: 'Endpoint not found.' }, 404)
      : c.env.ASSETS.fetch(c.req.raw),
  )

  return app
}

async function createSession(db: D1Database, userId: string): Promise<string> {
  const id = uuid()
  const stamp = now()
  await db
    .prepare(
      'INSERT INTO sessions (id, user_id, acquired_at, expires_at) VALUES (?, ?, ?, ?)',
    )
    .bind(id, userId, stamp, stamp + SESSION_TTL)
    .run()
  return id
}
