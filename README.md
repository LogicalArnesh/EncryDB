# EncryDB

A Discord-style workspace for teams: servers, text and voice channels, image
sharing, direct messages from `Server`, and email-verified accounts with
generated user ids.

Runs as a single Cloudflare Worker (Hono + React) with D1 for storage, so there
is one deployable unit and one database.

## Accounts

1. **Request a code** with your email. A six-digit code is generated and stored
   hashed for ten minutes.
2. **Verify** the code with a display name and password. The account is created
   and a user id is generated, e.g. `EDB-7K4M-9QX2`.
3. **Sign in** with either that user id or the email address, plus the password.

The first account created on an empty database becomes the workspace **admin**.
Admins get an Admin screen where they can issue ids for other people: enter a
name (email optional) and the app returns a fresh user id and a one-time
temporary password to hand over.

### Email delivery

Codes are sent by SMTP straight from the Worker, so a normal mailbox app
password works — no email API needed. Workers cannot reach port 25, but they can
open a TLS connection to a submission server on 465/587, which is all SMTP needs
(`src/worker/smtp.ts` is a small dependency-free client for exactly that).

Set these as secrets in the hosting environment:

```
MAIL_USER=you@gmail.com          # mailbox that sends the codes
MAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx   # 16-character app password
SMTP_HOST=smtp.gmail.com         # optional, this is the default
SMTP_PORT=465                    # optional: 465 implicit TLS (default), 587 STARTTLS
MAIL_FROM="EncryDB <you@gmail.com>"  # optional From header; defaults to MAIL_USER
```

For Gmail/Workspace: turn on 2-Step Verification, then create an app password at
<https://myaccount.google.com/apppasswords> and use that 16-character value
(spaces are fine). Google rejects normal account passwords over SMTP.

`RESEND_API_KEY` (plus `MAIL_FROM`) still works as an HTTP fallback when
`MAIL_USER`/`MAIL_APP_PASSWORD` are unset. Only when **no** transport is
configured does the app return the code to the client, which keeps a preview
build usable; a configured transport that fails returns a 502 and never leaks
the code.

## Servers and privacy

Servers are only ever returned to their own members: `/api/servers` joins
through `server_members`, and every channel, message, file and voice endpoint
checks membership first. A new account sees an empty sidebar until it joins with
an invite code.

## Direct messages from Server

`Server` is a bot identity. It writes to each member's direct messages when:

- they are added to a server, and
- a meeting starts in one of their servers (once per channel per 15 minutes).

The bell in the rail shows an unread badge; opening the inbox marks it read.
Meeting notices carry an **Open channel** button that jumps straight to the
voice room.

## Voice

WebRTC mesh over DTLS-SRTP, audio peer-to-peer. Signalling and presence are
relayed through the Worker using `voice_peers` and `voice_signals` in D1, so no
Durable Object or separate server is needed. The offerer is chosen
deterministically (lower peer id) to avoid glare. There is no TURN server yet,
so restrictive NATs can fail to connect.

## Layout

- **Laptop / desktop** — server rail, channel sidebar, chat, member list.
- **Phone / tablet** — the rail and sidebar become a slide-in drawer behind the
  hamburger button; the member list is hidden; the composer stays pinned.

## Develop

```bash
bun install
bun run dev      # http://localhost:3000
bun test         # API tests against a real local D1
bun run typecheck
bun run build
```

`bun run dev` uses a local D1 database in `.wrangler/state`. Delete that folder
to start from an empty workspace (the next account created becomes admin).

## Deploy

The Worker is deployed with `deploy.json` → `dist/encrydb/index.js` plus
`dist/client`. Add the `DB` D1 binding and the mail secrets (`MAIL_USER`,
`MAIL_APP_PASSWORD`, optionally `SMTP_HOST`/`SMTP_PORT`/`MAIL_FROM`) in the
hosting environment.

## Security notes

- Passwords: PBKDF2-SHA256, 150k rounds, per-user salt.
- Sessions: random 128-bit ids in the `sessions` table, HTTP-only `SameSite=Lax`
  cookies, revoked on sign-out.
- Verification codes: stored as SHA-256 hashes, ten-minute expiry, six attempts.
- All mutations check `Origin` against the request origin (CSRF).
- **Message contents are not end-to-end encrypted yet.** They are stored in D1
  as plain text and the server can read them; transport is TLS. Per-server
  AES-GCM keys shared over invite links is the next step.
- Images are capped at ~600 KB and stored in D1; R2 is the better home long term.
