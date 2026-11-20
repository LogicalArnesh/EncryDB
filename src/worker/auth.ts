import { createFreebuffAuth } from '@freebuff/auth'
import type { FreebuffAuth, FreebuffUser } from '@freebuff/auth'

export type Env = {
  ASSETS: Fetcher
  DB?: D1Database
  FREEBUFF_CLIENT_ID?: string
  FREEBUFF_ISSUER?: string
  APP_ORIGIN?: string
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
export const SESSION_COOKIE = 'encrydb_session'

export function isLocalPreview(request: Request, env: Env): boolean {
  return (
    !env.FREEBUFF_CLIENT_ID &&
    !env.APP_ORIGIN &&
    LOOPBACK.has(new URL(request.url).hostname)
  )
}

let cached: { key: string; auth: FreebuffAuth } | undefined

export function getAuth(env: Env): FreebuffAuth | null {
  if (!env.FREEBUFF_CLIENT_ID || !env.APP_ORIGIN) return null
  const origin = new URL(env.APP_ORIGIN)
  const key = JSON.stringify([
    env.FREEBUFF_CLIENT_ID,
    env.FREEBUFF_ISSUER,
    env.APP_ORIGIN,
  ])
  if (cached?.key !== key) {
    cached = {
      key,
      auth: createFreebuffAuth({
        clientId: env.FREEBUFF_CLIENT_ID,
        issuer: env.FREEBUFF_ISSUER || undefined,
        baseUrl: env.APP_ORIGIN,
        allowInsecureLocalhost:
          origin.protocol === 'http:' && LOOPBACK.has(origin.hostname),
      }),
    }
  }
  return cached.auth
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=') || null
  }
  return null
}

/**
 * The signed-in identity for this request.
 * 1. our own HTTP-only session cookie (email + password accounts)
 * 2. Freebuff sign-in, when configured
 * 3. a dev-only identity on loopback, so `bun run dev` is usable immediately
 */
export async function currentUser(
  request: Request,
  env: Env,
): Promise<FreebuffUser | null> {
  const sessionId = readCookie(request, SESSION_COOKIE)
  if (sessionId && env.DB) {
    const row = await env.DB.prepare(
      'SELECT user_id, expires_at FROM sessions WHERE id = ?',
    )
      .bind(sessionId)
      .first<{ user_id: string; expires_at: number }>()
    if (row && row.expires_at > Date.now()) return { sub: row.user_id }
  }
  const auth = getAuth(env)
  if (auth) {
    const user = await auth.getUser(request)
    if (user) return user
  }
  if (isLocalPreview(request, env)) {
    return { sub: 'local-preview', name: 'Local preview' }
  }
  return null
}

export function appOrigin(request: Request, env: Env): string {
  // Sites injects the canonical origin in production. Without it (local dev and
  // the Cloud preview host) the request's own origin is the comparison point:
  // a cross-site POST still carries a different Origin header and is refused.
  return env.APP_ORIGIN || new URL(request.url).origin
}

/* ---------- password hashing (PBKDF2-SHA256, 150k rounds) ---------- */

const ROUNDS = 150_000

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function derive(password: string, salt: Uint8Array, rounds: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: rounds, hash: 'SHA-256' },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, ROUNDS)
  return `pbkdf2$${ROUNDS}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, rounds, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2' || !rounds || !salt || !hash) return false
  const expected = fromBase64(hash)
  const actual = await derive(password, fromBase64(salt), Number(rounds))
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i]
  return diff === 0
}

export function sessionCookie(id: string, origin: string | null, maxAge: number) {
  const secure = origin && origin.startsWith('https:') ? '; Secure' : ''
  return `${SESSION_COOKIE}=${id}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
}
