import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Miniflare } from 'miniflare'
import { createApp } from '../src/worker/app'
import type { Env } from '../src/worker/auth'

const runtime = new Miniflare({
  workers: [
    {
      config: {
        name: 'encrydb-test',
        compatibilityDate: '2026-11-11',
        manifest: {
          mainModule: 'index.js',
          modules: {
            'index.js': {
              type: 'esm',
              contents: 'export default { fetch() { return new Response("test") } }',
            },
          },
        },
        env: { DB: { type: 'd1', name: 'encrydb-test' } },
      },
    },
  ],
  port: 0,
})

const ORIGIN = 'https://app.example.test'
let env: Env

beforeAll(async () => {
  const db = (await runtime.getD1Database('DB')) as unknown as D1Database
  env = {
    DB: db,
    APP_ORIGIN: ORIGIN,
    ASSETS: { fetch: async () => new Response('public page') } as unknown as Fetcher,
  }
}, 30_000)

afterAll(() => runtime.dispose())

const app = createApp()

type Options = {
  method?: string
  body?: unknown
  cookie?: string
  origin?: string
}

async function call(path: string, options: Options = {}) {
  return app.request(
    `${ORIGIN}${path}`,
    {
      method: options.method ?? 'GET',
      headers: {
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        Origin: options.origin ?? ORIGIN,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    },
    env,
  )
}

function cookieOf(response: Response): string {
  const header = response.headers.get('Set-Cookie') ?? ''
  return header.split(';')[0] ?? ''
}

async function signUp(email: string, name: string): Promise<string> {
  const response = await call('/api/auth/signup', {
    method: 'POST',
    body: { email, password: 'password-123', name },
  })
  expect(response.status).toBe(201)
  return cookieOf(response)
}

test('signed out requests are refused but public assets stay public', async () => {
  expect((await call('/api/servers')).status).toBe(401)
  expect((await call('/api/channels/anything/messages')).status).toBe(401)
  expect(await (await call('/')).text()).toBe('public page')
  expect((await call('/api/health')).status).toBe(200)
})

test('accounts can register, sign in, sign out and update a profile', async () => {
  const signup = await call('/api/auth/signup', {
    method: 'POST',
    body: { email: 'ada@example.com', password: 'password-123', name: 'Ada' },
  })
  expect(signup.status).toBe(201)
  const cookie = cookieOf(signup)
  expect(cookie).toContain('encrydb_session=')

  const me = await call('/api/me', { cookie })
  expect(me.status).toBe(200)
  expect(((await me.json()) as { user: { name: string } }).user.name).toBe('Ada')

  const renamed = await call('/api/me', {
    method: 'PATCH',
    cookie,
    body: { name: 'Ada L' },
  })
  expect(renamed.status).toBe(200)

  const duplicate = await call('/api/auth/signup', {
    method: 'POST',
    body: { email: 'ADA@example.com', password: 'password-123', name: 'Dup' },
  })
  expect(duplicate.status).toBe(409)

  const wrong = await call('/api/auth/signin', {
    method: 'POST',
    body: { email: 'ada@example.com', password: 'not-the-password' },
  })
  expect(wrong.status).toBe(401)

  const good = await call('/api/auth/signin', {
    method: 'POST',
    body: { email: 'ada@example.com', password: 'password-123' },
  })
  expect(good.status).toBe(200)

  const signout = await call('/api/auth/signout', { method: 'POST', cookie })
  expect(signout.status).toBe(200)
  expect((await call('/api/me', { cookie })).status).toBe(401)
})

test('rejects weak or malformed registration input', async () => {
  for (const body of [
    { email: 'not-an-email', password: 'password-123', name: 'X' },
    { email: 'a@b.co', password: 'short', name: 'X' },
    { email: 'a@b.co', password: 'password-123', name: '' },
    {},
  ]) {
    expect((await call('/api/auth/signup', { method: 'POST', body })).status).toBe(400)
  }
})

test('servers, channels, invites and messages work end to end', async () => {
  const owner = await signUp('owner@example.com', 'Owner')
  const guest = await signUp('guest@example.com', 'Guest')

  const created = await call('/api/servers', {
    method: 'POST',
    cookie: owner,
    body: { name: 'Design team' },
  })
  expect(created.status).toBe(201)
  const server = (await created.json()) as {
    server: { id: string; inviteCode: string; channels: { id: string; kind: string }[] }
  }
  expect(server.server.channels).toHaveLength(2)
  const text = server.server.channels.find((channel) => channel.kind === 'text')!
  const voice = server.server.channels.find((channel) => channel.kind === 'voice')!

  // A stranger cannot read or post.
  expect((await call(`/api/channels/${text.id}/messages`, { cookie: guest })).status).toBe(404)
  expect(
    (await call(`/api/channels/${text.id}/messages`, {
      method: 'POST',
      cookie: guest,
      body: { content: 'sneaky' },
    })).status,
  ).toBe(404)

  const joined = await call('/api/servers/join', {
    method: 'POST',
    cookie: guest,
    body: { code: server.server.inviteCode },
  })
  expect(joined.status).toBe(200)

  const posted = await call(`/api/channels/${text.id}/messages`, {
    method: 'POST',
    cookie: guest,
    body: { content: '  Hello team  ' },
  })
  expect(posted.status).toBe(201)
  const saved = (await posted.json()) as {
    message: { content: string; authorName: string; kind: string }
  }
  expect(saved.message.content).toBe('Hello team')
  expect(saved.message.authorName).toBe('Guest')

  const history = (await (
    await call(`/api/channels/${text.id}/messages`, { cookie: owner })
  ).json()) as { messages: { content: string }[] }
  expect(history.messages).toHaveLength(1)

  const empty = await call(`/api/channels/${text.id}/messages`, {
    method: 'POST',
    cookie: owner,
    body: { content: '   ' },
  })
  expect(empty.status).toBe(400)

  const tooLong = await call(`/api/channels/${text.id}/messages`, {
    method: 'POST',
    cookie: owner,
    body: { content: 'x'.repeat(2001) },
  })
  expect(tooLong.status).toBe(400)

  const extraChannel = await call(`/api/servers/${server.server.id}/channels`, {
    method: 'POST',
    cookie: owner,
    body: { name: 'Random Chat', kind: 'text' },
  })
  expect(extraChannel.status).toBe(201)
  expect(
    ((await extraChannel.json()) as { channel: { name: string } }).channel.name,
  ).toBe('random-chat')

  const servers = (await (await call('/api/servers', { cookie: guest })).json()) as {
    servers: { members: unknown[] }[]
  }
  expect(servers.servers[0].members).toHaveLength(2)

  // Voice rooms need membership too.
  expect(
    (await call(`/api/channels/${voice.id}/voice/join`, { method: 'POST', cookie: guest }))
      .status,
  ).toBe(200)
})

test('images are stored and served from the same origin', async () => {
  const cookie = await signUp('image@example.com', 'Image')
  const created = await call('/api/servers', {
    method: 'POST',
    cookie,
    body: { name: 'Art' },
  })
  const server = (await created.json()) as {
    server: { channels: { id: string; kind: string }[] }
  }
  const channel = server.server.channels.find((item) => item.kind === 'text')!

  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AGt9uGaAAAAAElFTkSuQmCC'
  const posted = await call(`/api/channels/${channel.id}/messages`, {
    method: 'POST',
    cookie,
    body: { content: 'look', image: { name: 'dot.png', mime: 'image/png', dataUrl: png } },
  })
  expect(posted.status).toBe(201)
  const message = (await posted.json()) as {
    message: { kind: string; fileId: string }
  }
  expect(message.message.kind).toBe('image')

  const file = await call(`/api/files/${message.message.fileId}`, { cookie })
  expect(file.status).toBe(200)
  expect(file.headers.get('Content-Type')).toBe('image/png')
  expect((await file.arrayBuffer()).byteLength).toBeGreaterThan(20)

  const notImage = await call(`/api/channels/${channel.id}/messages`, {
    method: 'POST',
    cookie,
    body: { image: { name: 'x.txt', mime: 'text/plain', dataUrl: 'data:text/plain;base64,aGk=' } },
  })
  expect(notImage.status).toBe(400)
})

test('voice peers exchange signals and leave cleanly', async () => {
  const owner = await signUp('voice-owner@example.com', 'Voice Owner')
  const guest = await signUp('voice-guest@example.com', 'Voice Guest')
  const created = await call('/api/servers', {
    method: 'POST',
    cookie: owner,
    body: { name: 'Call' },
  })
  const server = (await created.json()) as {
    server: { id: string; inviteCode: string; channels: { id: string; kind: string }[] }
  }
  const voice = server.server.channels.find((channel) => channel.kind === 'voice')!
  await call('/api/servers/join', {
    method: 'POST',
    cookie: guest,
    body: { code: server.server.inviteCode },
  })

  const first = (await (
    await call(`/api/channels/${voice.id}/voice/join`, {
      method: 'POST',
      cookie: owner,
      body: { muted: false },
    })
  ).json()) as { peerId: string }
  const second = (await (
    await call(`/api/channels/${voice.id}/voice/join`, {
      method: 'POST',
      cookie: guest,
      body: { muted: true },
    })
  ).json()) as { peerId: string }
  expect(first.peerId).not.toBe(second.peerId)

  const beat = (await (
    await call(`/api/channels/${voice.id}/voice/heartbeat`, {
      method: 'POST',
      cookie: owner,
      body: { peerId: first.peerId, muted: false },
    })
  ).json()) as { peers: { peerId: string; muted: boolean }[] }
  expect(beat.peers.map((peer) => peer.peerId).sort()).toEqual(
    [first.peerId, second.peerId].sort(),
  )
  expect(beat.peers.find((peer) => peer.peerId === second.peerId)?.muted).toBe(true)

  const signal = await call(`/api/channels/${voice.id}/voice/signal`, {
    method: 'POST',
    cookie: owner,
    body: {
      peerId: first.peerId,
      to: second.peerId,
      kind: 'offer',
      payload: '{"type":"offer","sdp":"v=0"}',
    },
  })
  expect(signal.status).toBe(200)

  const received = (await (
    await call(
      `/api/channels/${voice.id}/voice/signals?peerId=${second.peerId}&after=0`,
      { cookie: guest },
    )
  ).json()) as { signals: { kind: string; from: string }[] }
  expect(received.signals).toHaveLength(1)
  expect(received.signals[0].kind).toBe('offer')
  expect(received.signals[0].from).toBe(first.peerId)

  await call(`/api/channels/${voice.id}/voice/leave`, {
    method: 'POST',
    cookie: guest,
    body: { peerId: second.peerId },
  })
  const after = (await (
    await call(`/api/channels/${voice.id}/voice/heartbeat`, {
      method: 'POST',
      cookie: guest,
      body: { peerId: second.peerId, muted: false },
    })
  ).json()) as { peers: { peerId: string }[] }
  expect(after.peers.map((peer) => peer.peerId)).not.toContain(second.peerId)
})

test('cross-origin mutations are refused', async () => {
  const cookie = await signUp('csrf@example.com', 'CSRF')
  const refused = await call('/api/servers', {
    method: 'POST',
    cookie,
    origin: 'https://evil.example',
    body: { name: 'Nope' },
  })
  expect(refused.status).toBe(403)
})
