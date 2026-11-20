import { isSameOriginRequest } from '@freebuff/auth'
import type { FreebuffUser } from '@freebuff/auth'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  appOrigin,
  clearedSessionCookie,
  currentUser,
  hashPassword,
  isLocalPreview,
  sessionCookie,
  verifyPassword,
  type Env,
} from './auth'
import {
  ensureSchema,
  mapChannel,
  mapMember,
  mapMessage,
  mapPeer,
  mapUser,
} from './db'
import type { Channel, Peer } from '../shared/types'

type Variables = { user: FreebuffUser; db: D1Database }
type Authenticate = (request: Request, env: Env) => Promise<FreebuffUser | null>

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000
const PEER_TIMEOUT = 20_000
const MAX_IMAGE_CHARS = 900_000

const uuid = () => crypto.randomUUID()
const now = () => Date.now()

function inviteCode(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let code = ''
  for (const byte of bytes) code += alphabet[byte % alphabet.length]
  return code
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

/** Upsert the profile row for an identity (real accounts already have one). */
async function ensureProfile(
  db: D1Database,
  sub: string,
  fallbackName: string,
): Promise<{ id: string; name: string; email: string }> {
  const existing = await db
    .prepare('SELECT id, name, email FROM users WHERE id = ?')
    .bind(sub)
    .first<{ id: string; name: string; email: string }>()
  if (existing) return existing
  const name = fallbackName.slice(0, 60) || 'Member'
  await db
    .prepare(
      'INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(sub, `${sub}@local.invalid`, 'none', name, now())
    .run()
  return { id: sub, name, email: `${sub}@local.invalid` }
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

export function createApp(authenticate: Authenticate = currentUser) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>()

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })

  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) => c.json({ error: 'Request is too large.' }, 413),
    }),
  )

  app.onError((error, c) => {
    console.error('api error', error)
    return c.json({ error: 'Something went wrong. Please try again.' }, 500)
  })

  app.get('/api/session', async (c) => {
    const user = await authenticate(c.req.raw, c.env)
    let profile: { id: string; name: string; email: string } | null = null
    if (user && c.env.DB) {
      await ensureSchema(c.env.DB)
      profile = await ensureProfile(
        c.env.DB,
        user.sub,
        user.name || user.email || 'Member',
      )
    }
    return c.json({
      user: profile,
      mode: isLocalPreview(c.req.raw, c.env)
        ? 'local'
        : c.env.FREEBUFF_CLIENT_ID && c.env.APP_ORIGIN
          ? 'freebuff'
          : 'setup',
      database: Boolean(c.env.DB),
    })
  })

  /** Every route below needs a signed-in identity and a database. */
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/') || c.req.path === '/api/health')
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
      if (!origin || !isSameOriginRequest(c.req.raw, origin))
        return c.json({ error: 'Cross-origin request refused.' }, 403)
    }
    await ensureSchema(c.env.DB)
    await ensureProfile(c.env.DB, user.sub, user.name || 'Member')
    c.set('user', user)
    c.set('db', c.env.DB)
    await next()
  })

  /* ---------------- accounts ---------------- */

  app.post('/api/auth/signup', async (c) => {
    if (!c.env.DB) return c.json({ error: 'Database unavailable.' }, 503)
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object')
      return c.json({ error: 'Invalid request body.' }, 400)
    const { email, password, name } = body as Record<string, unknown>
    if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      return c.json({ error: 'Enter a valid email address.' }, 400)
    if (typeof password !== 'string' || password.length < 8)
      return c.json({ error: 'Password must be at least 8 characters.' }, 400)
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60)
      return c.json({ error: 'Display name is required (max 60 characters).' }, 400)
    await ensureSchema(c.env.DB)
    const lower = email.trim().toLowerCase()
    const taken = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?')
      .bind(lower)
      .first()
    if (taken)
      return c.json({ error: 'An account with that email already exists.' }, 409)
    const id = uuid()
    const hash = await hashPassword(password)
    await c.env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, lower, hash, name.trim(), now())
      .run()
    const sessionId = await createSession(c.env.DB, id)
    return c.json(
      { user: { id, email: lower, name: name.trim() } },
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
    if (!body || typeof body !== 'object')
      return c.json({ error: 'Invalid request body.' }, 400)
    const { email, password } = body as Record<string, unknown>
    if (typeof email !== 'string' || typeof password !== 'string')
      return c.json({ error: 'Email and password are required.' }, 400)
    await ensureSchema(c.env.DB)
    const row = await c.env.DB.prepare(
      'SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?',
    )
      .bind(email.trim().toLowerCase())
      .first<{
        id: string
        email: string
        name: string
        password_hash: string
        created_at: number
      }>()
    if (!row || !(await verifyPassword(password, row.password_hash)))
      return c.json({ error: 'Incorrect email or password.' }, 401)
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
    return c.json({ ok: true }, 200, {
      'Set-Cookie': clearedSessionCookie(),
    })
  })

  app.get('/api/me', async (c) => {
    const row = await c
      .get('db')
      .prepare('SELECT id, email, name, created_at FROM users WHERE id = ?')
      .bind(c.get('user').sub)
      .first<{ id: string; email: string; name: string; created_at: number }>()
    return row
      ? c.json({ user: mapUser(row) })
      : c.json({ error: 'Account not found.' }, 404)
  })

  app.patch('/api/me', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object')
      return c.json({ error: 'Invalid request body.' }, 400)
    const name = (body as Record<string, unknown>).name
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60)
      return c.json({ error: 'Name must be 1–60 characters.' }, 400)
    await c
      .get('db')
      .prepare('UPDATE users SET name = ? WHERE id = ?')
      .bind(name.trim(), c.get('user').sub)
      .run()
    return c.json({ ok: true, name: name.trim() })
  })

  /* ---------------- servers ---------------- */

  app.get('/api/servers', async (c) => {
    const db = c.get('db')
    const userId = c.get('user').sub
    const rows = await db
      .prepare(
        'SELECT s.id, s.name, s.owner_id, s.invite_code, m.role FROM servers s JOIN server_members m ON m.server_id = s.id WHERE m.user_id = ? ORDER BY s.created_at ASC',
      )
      .bind(userId)
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
    const userId = c.get('user').sub
    const id = uuid()
    const code = inviteCode()
    const created = now()
    await db
      .prepare(
        'INSERT INTO servers (id, name, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(id, name.trim(), userId, code, created)
      .run()
    await db
      .prepare(
        'INSERT INTO server_members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
      )
      .bind(id, userId, 'owner', created)
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
          ownerId: userId,
          role: 'owner',
          inviteCode: code,
          channels: [
            { id: general, serverId: id, name: 'general', kind: 'text', position: 0 },
            { id: voice, serverId: id, name: 'Voice', kind: 'voice', position: 1 },
          ],
          members: [
            { userId, name: c.get('user').name || 'You', role: 'owner' },
          ],
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
    const userId = c.get('user').sub
    const server = await db
      .prepare('SELECT id, name FROM servers WHERE invite_code = ?')
      .bind(code.trim().toLowerCase())
      .first<{ id: string; name: string }>()
    if (!server) return c.json({ error: 'That invite code is not valid.' }, 404)
    await db
      .prepare(
        'INSERT OR IGNORE INTO server_members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
      )
      .bind(server.id, userId, 'member', now())
      .run()
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
      .bind(serverId, c.get('user').sub)
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
    const userId = c.get('user').sub
    const serverId = c.req.param('id')
    const owner = await db
      .prepare('SELECT owner_id FROM servers WHERE id = ?')
      .bind(serverId)
      .first<{ owner_id: string }>()
    if (owner?.owner_id === userId)
      return c.json(
        { error: 'You own this server, so it cannot be left.' },
        400,
      )
    await db
      .prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?')
      .bind(serverId, userId)
      .run()
    return c.json({ ok: true })
  })

  /* ---------------- messages ---------------- */

  app.get('/api/channels/:id/messages', async (c) => {
    const db = c.get('db')
    const found = await membership(db, c.req.param('id'), c.get('user').sub)
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

  app.post(
    '/api/channels/:id/messages',
    bodyLimit({
      maxSize: MAX_IMAGE_CHARS + 32 * 1024,
      onError: (c) => c.json({ error: 'That image is too large.' }, 413),
    }),
    async (c) => {
      const db = c.get('db')
      const userId = c.get('user').sub
      const found = await membership(db, c.req.param('id'), userId)
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
            userId,
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
          userId,
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
    },
  )

  app.get('/api/files/:id', async (c) => {
    const db = c.get('db')
    const row = await db
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
    const userId = c.get('user').sub
    const found = await membership(db, c.req.param('id'), userId)
    if (!found) return c.json({ error: 'Access denied.' }, 404)
    if (found.channel.kind !== 'voice')
      return c.json({ error: 'That is not a voice channel.' }, 400)
    const body = await c.req.json().catch(() => null)
    const muted =
      (body as Record<string, unknown> | null)?.muted === true ? 1 : 0
    const profile = await db
      .prepare('SELECT name FROM users WHERE id = ?')
      .bind(userId)
      .first<{ name: string }>()
    const peerId = uuid()
    const stamp = now()
    await db
      .prepare(
        'INSERT INTO voice_peers (id, channel_id, user_id, name, muted, last_seen) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(peerId, found.channel.id, userId, profile?.name || 'Member', muted, stamp)
      .run()
    return c.json({ peerId, channel: found.channel })
  })

  app.post('/api/channels/:id/voice/heartbeat', async (c) => {
    const db = c.get('db')
    const found = await membership(db, c.req.param('id'), c.get('user').sub)
    if (!found) return c.json({ error: 'Access denied.' }, 404)
    const body = await c.req.json().catch(() => null)
    const peerId = (body as Record<string, unknown> | null)?.peerId
    const muted =
      (body as Record<string, unknown> | null)?.muted === true ? 1 : 0
    if (typeof peerId !== 'string')
      return c.json({ error: 'A peer id is required.' }, 400)
    const stamp = now()
    await db
      .prepare(
        'UPDATE voice_peers SET last_seen = ?, muted = ? WHERE id = ? AND channel_id = ?',
      )
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
    const found = await membership(db, c.req.param('id'), c.get('user').sub)
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
    const found = await membership(db, c.req.param('id'), c.get('user').sub)
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
    const found = await membership(db, c.req.param('id'), c.get('user').sub)
    if (!found) return c.json({ error: 'Access denied.' }, 404)
    const body = await c.req.json().catch(() => null)
    const peerId = (body as Record<string, unknown> | null)?.peerId
    if (typeof peerId === 'string') {
      await db.prepare('DELETE FROM voice_peers WHERE id = ? AND channel_id = ?')
        .bind(peerId, found.channel.id)
        .run()
      await db.prepare('DELETE FROM voice_signals WHERE channel_id = ? AND (from_peer = ? OR to_peer = ?)')
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
