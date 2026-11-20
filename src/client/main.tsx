import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  Channel,
  ChatMessage,
  DmMessage,
  Inbox,
  Peer,
  ServerSummary,
  SessionInfo,
  User,
} from '../shared/types'
import { ApiError, api, formatDay, formatTime, initials, post, readAsDataUrl } from './api'
import { VoiceSession } from './voice'
import './style.css'

type Me = User

/* ------------------------------------------------------------------ auth ----- */

function AuthScreen({ onDone, mailer }: { onDone: () => void; mailer: boolean }) {
  const [step, setStep] = useState<'signin' | 'email' | 'code'>('signin')
  const [identifier, setIdentifier] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function signIn(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!identifier.trim() || !password) {
      setError('Enter your user id and password.')
      return
    }
    setBusy(true)
    try {
      await post('/api/auth/signin', { identifier: identifier.trim(), password })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign you in.')
    } finally {
      setBusy(false)
    }
  }

  async function requestCode(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    setBusy(true)
    try {
      const data = await post<{ delivery: string; code?: string }>(
        '/api/auth/request-code',
        { email: email.trim(), name: name.trim() },
      )
      setInfo(
        data.delivery === 'email'
          ? `We sent a six-digit code to ${email.trim()}.`
          : 'Email delivery is not configured yet, so your code is shown below.',
      )
      setDevCode(data.code || '')
      setStep('code')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code.')
    } finally {
      setBusy(false)
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Pick a display name.')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.')
      return
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the six-digit code.')
      return
    }
    setBusy(true)
    try {
      await post('/api/auth/verify', {
        email: email.trim(),
        code: code.trim(),
        name: name.trim(),
        password,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify that code.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="logo">E</div>
        {step === 'signin' && (
          <>
            <h1>Welcome back</h1>
            <p className="sub">Sign in with your EncryDB user id and password.</p>
            <form onSubmit={signIn}>
              <div className="field">
                <label htmlFor="identifier">User id or email</label>
                <input
                  id="identifier"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  autoComplete="username"
                  placeholder="EDB-7K4M-9QX2"
                  autoCapitalize="characters"
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Your password"
                />
              </div>
              {error && <div className="error">{error}</div>}
              <button type="submit" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <div className="switch">
              New here?{' '}
              <a
                onClick={() => {
                  setStep('email')
                  setError('')
                  setInfo('')
                }}
              >
                Create an account
              </a>
            </div>
          </>
        )}

        {step === 'email' && (
          <>
            <h1>Create your id</h1>
            <p className="sub">
              Verify your email and we will generate your EncryDB user id.
            </p>
            <form onSubmit={requestCode}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </div>
              <div className="field">
                <label htmlFor="name">Display name</label>
                <input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  maxLength={60}
                  placeholder="Ada"
                />
              </div>
              {error && <div className="error">{error}</div>}
              <button type="submit" disabled={busy}>
                {busy ? 'Sending code…' : 'Send verification code'}
              </button>
            </form>
            <div className="switch">
              Already have an id?{' '}
              <a
                onClick={() => {
                  setStep('signin')
                  setError('')
                }}
              >
                Sign in
              </a>
            </div>
          </>
        )}

        {step === 'code' && (
          <>
            <h1>Verify your email</h1>
            <p className="sub">{info || 'Enter the six-digit code we sent you.'}</p>
            {devCode && (
              <div className="code-hint">
                Your code: <strong>{devCode}</strong>
              </div>
            )}
            <form onSubmit={verify}>
              <div className="field">
                <label htmlFor="code">Verification code</label>
                <input
                  id="code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="code-input"
                />
              </div>
              <div className="field">
                <label htmlFor="vname">Display name</label>
                <input
                  id="vname"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={60}
                  placeholder="Ada"
                />
              </div>
              <div className="field">
                <label htmlFor="vpassword">Password</label>
                <input
                  id="vpassword"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
              </div>
              {error && <div className="error">{error}</div>}
              <button type="submit" disabled={busy}>
                {busy ? 'Creating id…' : 'Verify and create id'}
              </button>
            </form>
            <div className="switch">
              <a
                onClick={() => {
                  setStep('email')
                  setError('')
                }}
              >
                Use a different email
              </a>
              {!mailer && <span className="muted-note"> · mail delivery not set up</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------- message pieces ----- */

function MessageRow({ message }: { message: ChatMessage }) {
  return (
    <div className="message">
      <div className="avatar">{initials(message.authorName)}</div>
      <div className="body">
        <div className="line">
          <span className="author">{message.authorName}</span>
          <span className="time">{formatTime(message.createdAt)}</span>
        </div>
        {message.content && <div className="text">{message.content}</div>}
        {message.kind === 'image' && message.fileId && (
          <a
            className="attachment"
            href={`/api/files/${message.fileId}`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={`/api/files/${message.fileId}`}
              alt={message.fileName || 'Shared image'}
              loading="lazy"
            />
            {message.fileName && <span>{message.fileName}</span>}
          </a>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ voice view ---- */

function VoiceRoom({
  channel,
  peers,
  status,
  muted,
  deafened,
  onMute,
  onDeafen,
  onLeave,
  meId,
}: {
  channel: Channel
  peers: Peer[]
  status: string
  muted: boolean
  deafened: boolean
  onMute: () => void
  onDeafen: () => void
  onLeave: () => void
  meId: string
}) {
  return (
    <div className="voice-room">
      <div className="voice-room-head">
        <div>
          <h2>{channel.name}</h2>
          <p>
            {status === 'connected'
              ? `${peers.length} ${peers.length === 1 ? 'person' : 'people'} in the call`
              : status === 'joining'
                ? 'Connecting…'
                : 'Not connected'}
          </p>
        </div>
        {status === 'connected' && (
          <div className="voice-controls">
            <button
              className={muted ? 'btn-mic muted' : 'btn-mic'}
              onClick={onMute}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? '🔇' : '🎤'}
            </button>
            <button
              className={deafened ? 'btn-deafen active' : 'btn-deafen'}
              onClick={onDeafen}
              title={deafened ? 'Undeafen' : 'Deafen'}
            >
              {deafened ? '🔕' : '🎧'}
            </button>
            <button className="btn-leave" onClick={onLeave}>
              Leave
            </button>
          </div>
        )}
      </div>
      <div className="voice-grid">
        {peers.length === 0 && (
          <p className="empty">
            Nobody else is here yet. Share the invite code so friends can join.
          </p>
        )}
        {peers.map((peer) => (
          <div className="voice-tile" key={peer.peerId}>
            <div className="avatar">{initials(peer.name)}</div>
            <div className="name">
              {peer.name}
              {peer.userId === meId && ' (you)'}
            </div>
            <div className={peer.muted ? 'mic muted' : 'mic'}>
              {peer.muted ? 'Muted' : 'Live'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- inbox ----- */

function InboxView({
  messages,
  onOpen,
}: {
  messages: DmMessage[]
  onOpen: (message: DmMessage) => void
}) {
  return (
    <div className="panel-page">
      <div className="panel-page-head">
        <div>
          <h2>Direct messages</h2>
          <p>Announcements from Server arrive here.</p>
        </div>
      </div>
      <div className="dm-list">
        {messages.length === 0 && (
          <p className="empty">Nothing yet. You will be told here when a meeting starts.</p>
        )}
        {messages.map((message) => (
          <div className="dm-item" key={message.id}>
            <div className="avatar bot">S</div>
            <div className="dm-body">
              <div className="line">
                <span className="author">Server</span>
                <span className="bot-tag">bot</span>
                <span className="time">{formatTime(message.createdAt)}</span>
              </div>
              <div className="text">{message.body}</div>
              {message.channelId && (
                <button className="dm-action" onClick={() => onOpen(message)}>
                  Open channel
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- admin ----- */

function AdminView({ me }: { me: Me }) {
  const [users, setUsers] = useState<User[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [created, setCreated] = useState<{ userId: string; password: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api<{ users: User[] }>('/api/admin/users')
      setUsers(data.users)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load accounts.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setNotice('')
    try {
      const data = await post<{ user: User; password: string }>('/api/admin/users', {
        name: name.trim(),
        email: email.trim(),
      })
      setCreated({ userId: data.user.userId, password: data.password })
      setName('')
      setEmail('')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create that id.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel-page">
      <div className="panel-page-head">
        <div>
          <h2>Workspace admin</h2>
          <p>You are signed in as {me.name}. Create ids for people on your team.</p>
        </div>
      </div>
      <form className="admin-form" onSubmit={create}>
        <div className="field">
          <label htmlFor="new-name">Display name</label>
          <input
            id="new-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Grace"
            maxLength={60}
          />
        </div>
        <div className="field">
          <label htmlFor="new-email">Email (optional)</label>
          <input
            id="new-email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="grace@example.com"
          />
        </div>
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create id'}
        </button>
      </form>
      {created && (
        <div className="credentials">
          <div>
            <span>User id</span>
            <strong>{created.userId}</strong>
          </div>
          <div>
            <span>Temporary password</span>
            <strong>{created.password}</strong>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(
                `EncryDB id: ${created.userId}\nPassword: ${created.password}`,
              )
              setNotice('Credentials copied.')
            }}
          >
            Copy
          </button>
        </div>
      )}
      {notice && <div className="inline-note">{notice}</div>}
      <div className="admin-list">
        <div className="admin-row head">
          <span>User id</span>
          <span>Name</span>
          <span>Role</span>
        </div>
        {users.map((user) => (
          <div className="admin-row" key={user.id}>
            <span className="mono">{user.userId}</span>
            <span>{user.name}</span>
            <span className={user.role === 'admin' ? 'role admin' : 'role'}>{user.role}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- main app --- */

type View = 'chat' | 'inbox' | 'admin'

function Workspace({
  me,
  onSignOut,
}: {
  me: Me
  onSignOut: () => void
}) {
  const [servers, setServers] = useState<ServerSummary[]>([])
  const [activeServerId, setActiveServerId] = useState('')
  const [activeChannelId, setActiveChannelId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [image, setImage] = useState<{ name: string; mime: string; dataUrl: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const [loadingServers, setLoadingServers] = useState(true)
  const [view, setView] = useState<View>('chat')
  const [menuOpen, setMenuOpen] = useState(false)
  const [inbox, setInbox] = useState<Inbox>({ unread: 0, messages: [] })

  const [creatingServer, setCreatingServer] = useState(false)
  const [newServerName, setNewServerName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [creatingChannel, setCreatingChannel] = useState<'text' | 'voice' | null>(null)
  const [newChannelName, setNewChannelName] = useState('')

  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null)
  const [voicePeers, setVoicePeers] = useState<Peer[]>([])
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'joining' | 'connected' | 'error'>('idle')
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const voiceRef = useRef<VoiceSession | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const activeServer = useMemo(
    () => servers.find((server) => server.id === activeServerId) ?? null,
    [servers, activeServerId],
  )
  const activeChannel = useMemo(
    () => activeServer?.channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeServer, activeChannelId],
  )
  const textChannels = activeServer?.channels.filter((channel) => channel.kind === 'text') ?? []
  const voiceChannels = activeServer?.channels.filter((channel) => channel.kind === 'voice') ?? []

  const loadServers = useCallback(async () => {
    try {
      const data = await api<{ servers: ServerSummary[] }>('/api/servers')
      setServers(data.servers)
      setActiveServerId((current) => {
        if (data.servers.some((server) => server.id === current)) return current
        return data.servers[0]?.id ?? ''
      })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load servers.')
    } finally {
      setLoadingServers(false)
    }
  }, [])

  const loadInbox = useCallback(async () => {
    try {
      const data = await api<Inbox>('/api/dm')
      setInbox(data)
    } catch {
      // The next poll retries.
    }
  }, [])

  useEffect(() => {
    void loadServers()
    void loadInbox()
    const timer = window.setInterval(() => void loadInbox(), 15_000)
    return () => window.clearInterval(timer)
  }, [loadServers, loadInbox])

  // Opening the inbox clears the unread badge.
  useEffect(() => {
    if (view !== 'inbox' || inbox.unread === 0) return
    void post('/api/dm/read').then(() => setInbox((current) => ({ ...current, unread: 0 })))
  }, [view, inbox.unread])

  // Keep a text channel selected inside the active server.
  useEffect(() => {
    if (!activeServer) {
      setActiveChannelId('')
      return
    }
    if (activeServer.channels.some((channel) => channel.id === activeChannelId)) return
    setActiveChannelId(activeServer.channels[0]?.id ?? '')
  }, [activeServer, activeChannelId])

  // Load history, then poll for anything newer.
  useEffect(() => {
    if (!activeChannel || activeChannel.kind !== 'text') {
      setMessages([])
      return
    }
    let live = true
    setMessages([])
    const load = async (after: number) => {
      try {
        const data = await api<{ messages: ChatMessage[] }>(
          `/api/channels/${activeChannel.id}/messages?after=${after}`,
        )
        if (!live || data.messages.length === 0) return
        setMessages((current) => {
          const seen = new Set(current.map((message) => message.id))
          const merged = [...current]
          for (const message of data.messages)
            if (!seen.has(message.id)) merged.push(message)
          merged.sort((a, b) => a.createdAt - b.createdAt)
          return merged.slice(-300)
        })
      } catch {
        // The next poll retries.
      }
    }
    void load(0)
    const timer = window.setInterval(() => {
      setMessages((current) => {
        const last = current[current.length - 1]
        void load(last ? last.createdAt : 0)
        return current
      })
    }, 2500)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [activeChannel])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, activeChannelId])

  const send = useCallback(async () => {
    if (!activeChannel || activeChannel.kind !== 'text') return
    if (!draft.trim() && !image) return
    setSending(true)
    setNotice('')
    try {
      const data = await post<{ message: ChatMessage | null }>(
        `/api/channels/${activeChannel.id}/messages`,
        { content: draft.trim(), ...(image ? { image } : {}) },
      )
      if (data.message) {
        setMessages((current) =>
          current.some((message) => message.id === data.message!.id)
            ? current
            : [...current, data.message!],
        )
      }
      setDraft('')
      setImage(null)
      if (fileInput.current) fileInput.current.value = ''
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not send that.')
    } finally {
      setSending(false)
    }
  }, [activeChannel, draft, image])

  async function attach(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setNotice('Only images can be shared right now.')
      return
    }
    if (file.size > 600_000) {
      setNotice('Pick an image under 600 KB.')
      return
    }
    const dataUrl = await readAsDataUrl(file)
    setImage({ name: file.name, mime: file.type, dataUrl })
  }

  async function createServer(event: React.FormEvent) {
    event.preventDefault()
    if (!newServerName.trim()) return
    try {
      const data = await post<{ server: ServerSummary }>('/api/servers', {
        name: newServerName.trim(),
      })
      setNewServerName('')
      setCreatingServer(false)
      await loadServers()
      setActiveServerId(data.server.id)
      setActiveChannelId(data.server.channels[0]?.id ?? '')
      setView('chat')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create that server.')
    }
  }

  async function joinServer(event: React.FormEvent) {
    event.preventDefault()
    if (!joinCode.trim()) return
    try {
      const data = await post<{ serverId: string }>('/api/servers/join', {
        code: joinCode.trim(),
      })
      setJoinCode('')
      await loadServers()
      setActiveServerId(data.serverId)
      setView('chat')
      setMenuOpen(false)
      void loadInbox()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not join that server.')
    }
  }

  async function createChannel(event: React.FormEvent) {
    event.preventDefault()
    if (!activeServer || !creatingChannel || !newChannelName.trim()) return
    try {
      const data = await post<{ channel: Channel }>(
        `/api/servers/${activeServer.id}/channels`,
        { name: newChannelName, kind: creatingChannel },
      )
      setNewChannelName('')
      setCreatingChannel(null)
      await loadServers()
      if (data.channel.kind === 'text') setActiveChannelId(data.channel.id)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add that channel.')
    }
  }

  async function toggleVoice(channel: Channel) {
    if (voiceChannelId === channel.id) {
      await voiceRef.current?.leave()
      voiceRef.current = null
      setVoiceChannelId(null)
      setVoicePeers([])
      setVoiceStatus('idle')
      return
    }
    await voiceRef.current?.leave()
    const session = new VoiceSession({
      onPeers: setVoicePeers,
      onStatus: setVoiceStatus,
      onError: setNotice,
    })
    voiceRef.current = session
    setVoiceChannelId(channel.id)
    setActiveChannelId(channel.id)
    setView('chat')
    await session.start(channel.id, muted)
  }

  useEffect(
    () => () => {
      void voiceRef.current?.leave()
    },
    [],
  )

  function toggleMute() {
    const next = !muted
    setMuted(next)
    voiceRef.current?.setMuted(next)
  }

  function toggleDeafen() {
    const next = !deafened
    setDeafened(next)
    voiceRef.current?.setDeafened(next)
  }

  function selectChannel(channel: Channel) {
    setActiveChannelId(channel.id)
    setView('chat')
    setMenuOpen(false)
    if (channel.kind === 'voice' && voiceChannelId !== channel.id) void toggleVoice(channel)
  }

  function openInboxMessage(message: DmMessage) {
    if (!message.serverId) return
    const server = servers.find((item) => item.id === message.serverId)
    setActiveServerId(message.serverId)
    if (server && message.channelId) {
      const channel = server.channels.find((item) => item.id === message.channelId)
      setActiveChannelId(channel?.id ?? server.channels[0]?.id ?? '')
    }
    setView('chat')
    setMenuOpen(false)
  }

  const connectedVoice = voiceChannelId
    ? activeServer?.channels.find((channel) => channel.id === voiceChannelId) ?? null
    : null

  return (
    <div className={menuOpen ? 'app menu-open' : 'app'}>
      <div className="side">
        <div className="rail">
          <div className="rail-logo" title="EncryDB">E</div>
          {servers.map((server) => (
            <button
              key={server.id}
              className={
                view === 'chat' && server.id === activeServerId ? 'rail-item active' : 'rail-item'
              }
              title={server.name}
              onClick={() => {
                setActiveServerId(server.id)
                setActiveChannelId(server.channels[0]?.id ?? '')
                setView('chat')
                setMenuOpen(false)
              }}
            >
              {initials(server.name)}
            </button>
          ))}
          <button
            className="rail-item add"
            title="Create a server"
            onClick={() => {
              setCreatingServer((value) => !value)
              setMenuOpen(true)
            }}
          >
            +
          </button>
          <div className="rail-spacer" />
          <button
            className={view === 'inbox' ? 'rail-item active' : 'rail-item'}
            title="Direct messages"
            onClick={() => {
              setView('inbox')
              setMenuOpen(false)
            }}
          >
            ✉
            {inbox.unread > 0 && <span className="badge">{inbox.unread}</span>}
          </button>
          {me.role === 'admin' && (
            <button
              className={view === 'admin' ? 'rail-item active' : 'rail-item'}
              title="Admin"
              onClick={() => {
                setView('admin')
                setMenuOpen(false)
              }}
            >
              ⚙
            </button>
          )}
        </div>

        <div className="sidebar">
          {creatingServer ? (
            <form className="sidebar-form" onSubmit={createServer}>
              <h2>New server</h2>
              <input
                autoFocus
                value={newServerName}
                onChange={(event) => setNewServerName(event.target.value)}
                placeholder="Server name"
                maxLength={60}
              />
              <div className="row">
                <button type="submit">Create</button>
                <button type="button" className="quiet" onClick={() => setCreatingServer(false)}>
                  Cancel
                </button>
              </div>
              <form onSubmit={joinServer} className="join">
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  placeholder="or paste an invite code"
                />
                <button type="submit" className="quiet">
                  Join
                </button>
              </form>
            </form>
          ) : activeServer ? (
            <>
              <div className="server-header">
                <h2>{activeServer.name}</h2>
                <button
                  className="quiet"
                  title="Invite code"
                  onClick={() => {
                    void navigator.clipboard?.writeText(activeServer.inviteCode)
                    setNotice(`Invite code ${activeServer.inviteCode} copied.`)
                  }}
                >
                  Invite
                </button>
              </div>
              <div className="channels">
                <div className="section">
                  <span>Text channels</span>
                  <button onClick={() => setCreatingChannel('text')} title="Add text channel">
                    +
                  </button>
                </div>
                {textChannels.map((channel) => (
                  <button
                    key={channel.id}
                    className={
                      view === 'chat' && channel.id === activeChannelId ? 'channel active' : 'channel'
                    }
                    onClick={() => selectChannel(channel)}
                  >
                    <span className="icon">#</span>
                    <span className="name">{channel.name}</span>
                  </button>
                ))}
                <div className="section">
                  <span>Voice channels</span>
                  <button onClick={() => setCreatingChannel('voice')} title="Add voice channel">
                    +
                  </button>
                </div>
                {voiceChannels.map((channel) => (
                  <button
                    key={channel.id}
                    className={
                      channel.id === voiceChannelId
                        ? 'channel active'
                        : view === 'chat' && channel.id === activeChannelId
                          ? 'channel current'
                          : 'channel'
                    }
                    onClick={() => selectChannel(channel)}
                  >
                    <span className="icon">🔊</span>
                    <span className="name">{channel.name}</span>
                    {channel.id === voiceChannelId && <span className="live">live</span>}
                  </button>
                ))}
                {creatingChannel && (
                  <form className="channel-form" onSubmit={createChannel}>
                    <input
                      autoFocus
                      value={newChannelName}
                      onChange={(event) => setNewChannelName(event.target.value)}
                      placeholder={creatingChannel === 'text' ? 'new-channel' : 'New voice room'}
                      maxLength={40}
                    />
                    <div className="row">
                      <button type="submit">Add</button>
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => setCreatingChannel(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
              <div className="me">
                <div className="avatar">{initials(me.name)}</div>
                <div className="me-info">
                  <div className="name">{me.name}</div>
                  <div className="email">{me.userId}</div>
                </div>
                <button className="quiet" onClick={onSignOut}>
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <div className="sidebar-empty">
              <h2>No servers yet</h2>
              <p>Create one, or join with an invite code.</p>
              <form onSubmit={createServer}>
                <input
                  value={newServerName}
                  onChange={(event) => setNewServerName(event.target.value)}
                  placeholder="Server name"
                  maxLength={60}
                />
                <button type="submit">Create server</button>
              </form>
              <form onSubmit={joinServer}>
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  placeholder="Invite code"
                />
                <button type="submit">Join</button>
              </form>
              <div className="me-inline">
                <div className="avatar">{initials(me.name)}</div>
                <div>
                  <div className="name">{me.name}</div>
                  <div className="email">{me.userId}</div>
                </div>
                <button className="quiet" onClick={onSignOut}>
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}

      <div className="main">
        <div className="mobile-bar">
          <button className="burger" onClick={() => setMenuOpen((open) => !open)} aria-label="Menu">
            ☰
          </button>
          <span className="mobile-title">
            {view === 'inbox' ? 'Direct messages' : view === 'admin' ? 'Admin' : activeChannel?.name ?? 'EncryDB'}
          </span>
        </div>
        {notice && (
          <button className="toast" onClick={() => setNotice('')} title="Dismiss">
            {notice}
          </button>
        )}

        {view === 'inbox' ? (
          <InboxView messages={inbox.messages} onOpen={openInboxMessage} />
        ) : view === 'admin' && me.role === 'admin' ? (
          <AdminView me={me} />
        ) : activeChannel ? (
          <>
            <div className="chat-header">
              <span className="icon">{activeChannel.kind === 'voice' ? '🔊' : '#'}</span>
              <h2>{activeChannel.name}</h2>
              <span className="count">{activeServer?.members.length ?? 0} members</span>
            </div>
            {activeChannel.kind === 'voice' ? (
              <VoiceRoom
                channel={activeChannel}
                peers={voicePeers}
                status={voiceChannelId === activeChannel.id ? voiceStatus : 'idle'}
                muted={muted}
                deafened={deafened}
                onMute={toggleMute}
                onDeafen={toggleDeafen}
                onLeave={() => void toggleVoice(activeChannel)}
                meId={me.id}
              />
            ) : (
              <>
                <div className="messages">
                  {messages.length === 0 && (
                    <p className="empty">
                      This is the start of #{activeChannel.name}. Say hello.
                    </p>
                  )}
                  {messages.map((message, index) => {
                    const previous = messages[index - 1]
                    const newDay =
                      !previous ||
                      new Date(previous.createdAt).toDateString() !==
                        new Date(message.createdAt).toDateString()
                    return (
                      <div key={message.id}>
                        {newDay && (
                          <div className="message-date">{formatDay(message.createdAt)}</div>
                        )}
                        <MessageRow message={message} />
                      </div>
                    )
                  })}
                  <div ref={bottomRef} />
                </div>
                <form
                  className="composer"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void send()
                  }}
                >
                  {image && (
                    <div className="image-chip">
                      <span>{image.name}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setImage(null)
                          if (fileInput.current) fileInput.current.value = ''
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  <div className="composer-row">
                    <button
                      type="button"
                      className="attach"
                      title="Share an image"
                      onClick={() => fileInput.current?.click()}
                    >
                      +
                    </button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => void attach(event.target.files?.[0])}
                    />
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          void send()
                        }
                      }}
                      placeholder={`Message #${activeChannel.name}`}
                      maxLength={2000}
                      rows={1}
                    />
                    <button type="submit" disabled={sending || (!draft.trim() && !image)}>
                      {sending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </>
        ) : (
          <div className="main-empty">
            {loadingServers ? 'Loading…' : 'Pick a channel to start talking.'}
          </div>
        )}
      </div>

      <div className="members">
        <div className="panel-header">
          Members <span className="count">{activeServer?.members.length ?? 0}</span>
        </div>
        <div className="member-list">
          {activeServer?.members.map((member) => {
            const inVoice = voicePeers.some((peer) => peer.userId === member.userId)
            return (
              <div className="member" key={member.userId}>
                <div className="avatar">{initials(member.name)}</div>
                <div className="info">
                  <div className="name">
                    {member.name}
                    {member.role === 'owner' && <span className="role">owner</span>}
                  </div>
                  <div className={inVoice ? 'status voice' : 'status'}>
                    {inVoice ? 'In voice' : 'Member'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {connectedVoice && (
          <div className="voice-dock">
            <div>
              <div className="dock-title">
                {voiceStatus === 'connected' ? 'Voice connected' : 'Connecting…'}
              </div>
              <div className="dock-sub">{connectedVoice.name}</div>
            </div>
            <button onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
              {muted ? '🔇' : '🎤'}
            </button>
            <button onClick={() => void toggleVoice(connectedVoice)} title="Leave">
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ shell --- */

function App() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api<SessionInfo>('/api/session')
      setSession(data)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the app.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading)
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="logo">E</div>
          <p className="sub">Loading EncryDB…</p>
        </div>
      </div>
    )

  if (error)
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="logo">E</div>
          <h1>Something went wrong</h1>
          <p className="sub">{error}</p>
          <button onClick={() => void load()}>Try again</button>
        </div>
      </div>
    )

  if (!session?.user)
    return <AuthScreen mailer={Boolean(session?.mailer)} onDone={() => void load()} />

  return (
    <Workspace
      me={session.user}
      onSignOut={async () => {
        try {
          await post('/api/auth/signout')
        } catch (err) {
          if (!(err instanceof ApiError)) console.error(err)
        }
        setSession(null)
        void load()
      }}
    />
  )
}

createRoot(document.getElementById('root')!).render(<App />)
