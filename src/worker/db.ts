import type {
  Channel,
  ChatMessage,
  Member,
  Peer,
  ServerSummary,
  SessionRow,
  User,
} from '../shared/types'

export const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS pending_signups (
    email TEXT PRIMARY KEY,
    name TEXT,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS server_members (
    server_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (server_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS channels_server ON channels(server_id, position)`,
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    content TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text',
    file_id TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel_id, created_at, id)`,
  `CREATE TABLE IF NOT EXISTS dm_threads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    bot_name TEXT NOT NULL DEFAULT 'Server',
    last_read_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dm_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    body TEXT NOT NULL,
    server_id TEXT,
    channel_id TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS dm_messages_thread ON dm_messages(thread_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS voice_peers (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    muted INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS voice_peers_channel ON voice_peers(channel_id, last_seen)`,
  `CREATE TABLE IF NOT EXISTS voice_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    from_peer TEXT NOT NULL,
    to_peer TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS voice_signals_target ON voice_signals(to_peer, id)`,
]

let ready: Promise<void> | undefined

/** Create tables, then add columns that older databases are missing. */
export function ensureSchema(db: D1Database): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.batch(SCHEMA.map((sql) => db.prepare(sql)))
      await addColumn(db, 'users', 'user_id', 'TEXT')
      await addColumn(db, 'users', 'role', `TEXT NOT NULL DEFAULT 'member'`)
      // Give legacy accounts an id and make sure somebody can administer.
      await db
        .prepare(
          "UPDATE users SET user_id = 'EDB-' || upper(substr(replace(id, '-', ''), 1, 8)) WHERE user_id IS NULL",
        )
        .run()
      const admin = await db
        .prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1")
        .first()
      if (!admin) {
        const first = await db
          .prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1')
          .first<{ id: string }>()
        if (first)
          await db
            .prepare("UPDATE users SET role = 'admin' WHERE id = ?")
            .bind(first.id)
            .run()
      }
    })().catch((error) => {
      ready = undefined
      throw error
    })
  }
  return ready
}

async function addColumn(
  db: D1Database,
  table: string,
  column: string,
  definition: string,
) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  if (!info.results.some((row) => row.name === column))
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run()
}

type UserRow = {
  id: string
  user_id: string | null
  email: string
  name: string
  role: string
  created_at: number
}
type ServerRow = { id: string; name: string; owner_id: string; invite_code: string }
type ChannelRow = {
  id: string
  server_id: string
  name: string
  kind: string
  position: number
}

export const mapUser = (row: UserRow): User => ({
  id: row.id,
  userId: row.user_id || row.id,
  email: row.email,
  name: row.name,
  role: row.role === 'admin' ? 'admin' : 'member',
  createdAt: row.created_at,
})

export const mapSession = (row: SessionRow) => ({
  id: row.id,
  userId: row.user_id,
  acquiredAt: row.acquired_at,
  expiresAt: row.expires_at,
})

export const mapChannel = (row: ChannelRow): Channel => ({
  id: row.id,
  serverId: row.server_id,
  name: row.name,
  kind: row.kind === 'voice' ? 'voice' : 'text',
  position: row.position,
})

export const mapServer = (row: ServerRow): ServerSummary => ({
  id: row.id,
  name: row.name,
  ownerId: row.owner_id,
  inviteCode: row.invite_code,
  role: 'member',
  channels: [],
  members: [],
})

export function mapMessage(row: {
  id: string
  channel_id: string
  author_id: string
  content: string
  kind: string
  file_id: string | null
  created_at: number
  author_name?: string | null
  filename?: string | null
}): ChatMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    authorName: row.author_name || 'Member',
    content: row.content,
    kind: row.kind === 'image' ? 'image' : 'text',
    fileId: row.file_id ?? null,
    fileName: row.filename ?? null,
    createdAt: row.created_at,
  }
}

export function mapMember(row: {
  user_id: string
  name: string
  role: string
}): Member {
  return { userId: row.user_id, name: row.name, role: row.role }
}

export function mapPeer(row: {
  id: string
  user_id: string
  name: string
  muted: number
}): Peer {
  return {
    peerId: row.id,
    userId: row.user_id,
    name: row.name,
    muted: row.muted === 1,
  }
}
