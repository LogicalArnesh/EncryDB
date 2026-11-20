import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  Channel,
  ChatMessage,
  Peer,
  ServerSummary,
  SessionInfo,
} from '../shared/types'
import { ApiError, api, formatDay, formatTime, initials, post, readAsDataUrl } from './api'
import { VoiceSession } from './voice'
import './style.css'

/* ------------------------------------------------------------------ auth ----- */

function AuthScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }
    if (mode === 'signup' && (!name.trim() || password.length < 8)) {
      setError(
        !name.trim()
          ? 'Pick a display name.'
          : 'Use at least 8 characters for your password.',
      )
      return
    }
    setBusy(true)
    try {
      await post(`/api/auth/${mode}`, {
        email: email.trim().toLowerCase(),
        password,
        ...(mode === 'signup' ? { name: name.trim() } : {}),
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign you in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="logo">E</div>
        <h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="sub">
          {mode === 'signin'
            ? 'Sign in with the email you registered.'
            : 'One account for every server, channel and call.'}
        </p>
        <form onSubmit={submit}>
          {mode === 'signup' && (
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
          )}
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
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
            />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={busy}>
            {busy
              ? 'Please wait…'
              : mode === 'signin'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>
        <div className="switch">
          {mode === 'signin' ? (
            <>
              New here?{' '}
              <a onClick={() => setMode('signup')}>Create an account</a>
            </>
          ) : (
            <>
              Already registered?{' '}
              <a onClick={() => setMode('signin')}>Sign in</a>
            </>
          )}
        </div>
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
  meId: string | null
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

/* --------------------------------------------------------------- main app --- */

function Workspace({
  session,
  onSignOut,
}: {
  session: SessionInfo & { user: { id: string; name: string; email: string } }
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

  useEffect(() => {
    void loadServers()
  }, [loadServers])

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

  const connectedVoice = voiceChannelId
    ? activeServer?.channels.find((channel) => channel.id === voiceChannelId) ?? null
    : null

  return (
    <div className="app">
      <div className="rail">
        <div className="rail-logo" title="EncryDB">E</div>
        {servers.map((server) => (
          <button
            key={server.id}
            className={server.id === activeServerId ? 'rail-item active' : 'rail-item'}
            title={server.name}
            onClick={() => {
              setActiveServerId(server.id)
              setActiveChannelId(server.channels[0]?.id ?? '')
            }}
          >
            {initials(server.name)}
          </button>
        ))}
        <button
          className="rail-item add"
          title="Create a server"
          onClick={() => setCreatingServer((value) => !value)}
        >
          +
        </button>
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
                  className={channel.id === activeChannelId ? 'channel active' : 'channel'}
                  onClick={() => setActiveChannelId(channel.id)}
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
                      : channel.id === activeChannelId
                        ? 'channel current'
                        : 'channel'
                  }
                  onClick={() => void toggleVoice(channel)}
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
                    placeholder={
                      creatingChannel === 'text' ? 'new-channel' : 'New voice room'
                    }
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
              <div className="avatar">{initials(session.user.name)}</div>
              <div className="me-info">
                <div className="name">{session.user.name}</div>
                <div className="email">{session.user.email}</div>
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
          </div>
        )}
      </div>

      <div className="main">
        {notice && (
          <button className="toast" onClick={() => setNotice('')} title="Dismiss">
            {notice}
          </button>
        )}
        {activeChannel ? (
          <>
            <div className="chat-header">
              <span className="icon">{activeChannel.kind === 'voice' ? '🔊' : '#'}</span>
              <h2>{activeChannel.name}</h2>
              <span className="count">
                {activeServer?.members.length ?? 0} members
              </span>
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
                meId={session.user.id}
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
                          <div className="message-date">
                            {formatDay(message.createdAt)}
                          </div>
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

  if (!session?.user) return <AuthScreen onDone={() => void load()} />

  return (
    <Workspace
      session={{ ...session, user: session.user }}
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
