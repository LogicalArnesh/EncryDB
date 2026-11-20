export type Role = 'admin' | 'member'

export type User = {
  id: string
  userId: string
  email: string
  name: string
  role: Role
  createdAt: number
}

export type SessionRow = {
  id: string
  user_id: string
  acquired_at: number
  expires_at: number
}

export type ServerSummary = {
  id: string
  name: string
  ownerId: string
  role: string
  inviteCode: string
  channels: Channel[]
  members: Member[]
}

export type Channel = {
  id: string
  serverId: string
  name: string
  kind: 'text' | 'voice'
  position: number
}

export type Member = {
  userId: string
  name: string
  role: string
}

export type ChatMessage = {
  id: string
  channelId: string
  authorId: string
  authorName: string
  content: string
  kind: 'text' | 'image'
  fileId: string | null
  fileName: string | null
  createdAt: number
}

export type DmMessage = {
  id: string
  body: string
  serverId: string | null
  channelId: string | null
  createdAt: number
}

export type Inbox = {
  unread: number
  messages: DmMessage[]
}

export type Peer = {
  peerId: string
  userId: string
  name: string
  muted: boolean
}

export type Signal = {
  id: number
  from: string
  kind: string
  payload: string
}

export type SessionInfo = {
  user: User | null
  mode: 'local' | 'freebuff' | 'setup'
  database: boolean
  mailer: boolean
}
