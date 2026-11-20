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
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
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
export function ensureSchema(db: D1Database): Promise<void> {
  if (!ready) {
    ready = db
      .batch(SCHEMA.map((sql) => db.prepare(sql)))
      .then(() => undefined)
      .catch((error) => {
        ready = undefined
        throw error
      })
  }
  return ready
}

type UserRow = { id: string; email: string; name: string; created_at: number }
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
  email: row.email,
  name: row.name,
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
