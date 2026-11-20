# EncryDB

A Discord-style chat app for the browser: servers, text channels, image sharing
and real group voice calls over WebRTC. Runs as a single Cloudflare Worker plus
a React SPA, backed by D1.

## What works

- **Accounts** — email + password registration and sign-in. Passwords are hashed
  with PBKDF2-SHA256 (150k rounds, per-user salt); sessions are HTTP-only cookies
  stored in the database, so signing out really revokes them.
- **Servers and channels** — create servers (each starts with `#general` and a
  `Voice` room), add text or voice channels, invite people with an 8-character
  code, leave servers you do not own.
- **Text chat** — message history (last 200, polled every 2.5s for new messages),
  Enter to send, Shift+Enter for a newline, day separators, per-server member list.
- **Images** — attach an image up to ~600 KB; it is stored in D1 and served from
  the same origin through `GET /api/files/:id`.
- **Group voice** — join a voice channel and everyone in it is connected peer to
  peer (WebRTC with DTLS-SRTP encryption). The Worker only relays SDP/ICE
  signalling and presence; audio never passes through the server. Mute, deafen
  and leave are in the call bar.

## Run it

```sh
bun install
bun run dev        # http://localhost:3000 — local D1 via the Cloudflare Vite plugin
bun test           # API tests against a real local D1 (Miniflare)
bun run typecheck
bun run build
```

On `localhost` with no Freebuff auth configuration the app uses a single local
preview identity, so `bun run dev` is usable immediately. Register an account to
get a real per-user session.

## Layout

| Path | What it holds |
| --- | --- |
| `src/worker/app.ts` | Hono API: accounts, servers, messages, files, voice signalling |
| `src/worker/auth.ts` | session cookies, PBKDF2 hashing, Freebuff sign-in wrapper, local preview identity |
| `src/worker/db.ts` | D1 schema and row mappers |
| `src/client/main.tsx` | the whole interface: rail, channel list, chat, voice room, members |
| `src/client/voice.ts` | WebRTC mesh + HTTP signalling loop |
| `src/client/api.ts` | fetch helpers, formatting |
| `src/shared/types.ts` | types shared by client and worker |
| `tests/app.test.ts` | end-to-end API tests |

## Deploy

Provisioned as a Freebuff Sites project with a D1 database bound as `DB`.
`bun run build` emits the Worker bundle and assets; deploy that output. Sites
injects `FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER` and `APP_ORIGIN` when Sign in with
Freebuff is enabled; email/password accounts work without them.

## Limits and next steps

- **Not end-to-end encrypted yet.** The original EncryDB design was zero
  knowledge; this build stores message text in D1 so history and search work
  across devices. Transport is TLS and voice is DTLS-SRTP encrypted, but the
  server can read text messages. Adding per-server AES-GCM keys held only by
  members (shared through invite links) is the next step, and the message model
  is already shaped for it: only `content` would need encrypting.
- Voice uses a peer-to-peer mesh, which is comfortable up to ~6 people; larger
  rooms need an SFU.
- Signalling and history are polled over HTTP (1.2s for voice, 2.5s for chat).
  Sites realtime (Durable Objects) would make both push-based.
- Images are capped at ~600 KB and stored in D1; R2 is the right home once volume
  grows.
- No TURN server is configured, so voice between strict NATs may fail; add TURN
  credentials to `ICE` in `src/client/voice.ts` for production reliability.
