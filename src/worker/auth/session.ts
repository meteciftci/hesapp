import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { AppBindings, Env, SessionInfo } from '../env'
import { hashToken, randomToken, TOKEN_PATTERN } from './tokens'

type Ctx = Context<AppBindings>
export type CookieKind = 'session' | 'challenge'

/** Son bu süre içinde passkey ile doğrulanmış oturum gerektiren işlemler için pencere. */
export const FRESH_MS = 10 * 60 * 1000

export function isLocal(env: Env, request: Request): boolean {
  return env.APP_ENV === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)
}

/** Beklenen kaynak ve RP kimliği; geçerli bir https SITE_URL yoksa (yerel hariç) null. */
export function siteConfig(c: Ctx): { origin: string; rpId: string } | null {
  const local = isLocal(c.env, c.req.raw)
  const requestOrigin = new URL(c.req.url).origin
  if (local) {
    const origin = c.env.SITE_URL ? new URL(c.env.SITE_URL).origin : requestOrigin
    return { origin, rpId: c.env.RP_ID ?? new URL(origin).hostname }
  }
  try {
    const url = new URL(c.env.SITE_URL ?? '')
    const rpId = c.env.RP_ID ?? url.hostname
    if (url.protocol !== 'https:' || url.origin !== requestOrigin) return null
    if (url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`)) return null
    return { origin: url.origin, rpId }
  } catch {
    return null
  }
}

export function cookieName(c: Ctx, kind: CookieKind): string {
  return `${isLocal(c.env, c.req.raw) ? '' : '__Host-'}hesapp_${kind}`
}

export function putCookie(c: Ctx, kind: CookieKind, value: string, maxAge: number) {
  setCookie(c, cookieName(c, kind), value, {
    path: '/',
    httpOnly: true,
    secure: !isLocal(c.env, c.req.raw),
    sameSite: 'Strict',
    maxAge,
  })
}

export function clearCookie(c: Ctx, kind: CookieKind) {
  deleteCookie(c, cookieName(c, kind), {
    path: '/',
    secure: !isLocal(c.env, c.req.raw),
    httpOnly: true,
    sameSite: 'Strict',
  })
}

export function sessionDays(env: Env): number {
  const n = Number(env.SESSION_DAYS)
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : 30
}

export interface FullSession extends SessionInfo {
  userId: string
  name: string
  role: 'owner' | 'member'
}

export async function getSession(c: Ctx): Promise<FullSession | null> {
  const token = getCookie(c, cookieName(c, 'session'))
  if (!token || !TOKEN_PATTERN.test(token)) return null
  const row = await c.env.DB.prepare(
    `SELECT s.token_hash, s.user_id, s.credential_id, s.created_at, u.name, u.role
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN passkeys p ON p.id = s.credential_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await hashToken(token), Date.now())
    .first<{ token_hash: string; user_id: string; credential_id: string; created_at: number; name: string; role: 'owner' | 'member' }>()
  if (!row) return null
  return {
    tokenHash: row.token_hash,
    credentialId: row.credential_id,
    createdAt: row.created_at,
    userId: row.user_id,
    name: row.name,
    role: row.role,
  }
}

export async function startSession(c: Ctx, userId: string, credentialId: string) {
  const token = randomToken()
  const now = Date.now()
  const days = sessionDays(c.env)
  const previous = getCookie(c, cookieName(c, 'session'))
  const statements = [
    c.env.DB.prepare('INSERT INTO auth_sessions (token_hash, user_id, credential_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(
      await hashToken(token),
      userId,
      credentialId,
      now,
      now + days * 86_400_000,
    ),
  ]
  if (previous && TOKEN_PATTERN.test(previous)) {
    statements.unshift(c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await hashToken(previous)))
  }
  await c.env.DB.batch(statements)
  putCookie(c, 'session', token, days * 86_400)
}

/**
 * Durum değiştiren isteklerde CSRF savunması: Origin beklenen kaynakla aynı olmalı,
 * özel başlık bulunmalı, çapraz site isteği olmamalı.
 */
export const sameOrigin = createMiddleware<AppBindings>(async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const expected = c.env.SITE_URL && !isLocal(c.env, c.req.raw) ? new URL(c.env.SITE_URL).origin : new URL(c.req.url).origin
    const ok =
      c.req.header('Origin') === expected &&
      c.req.header('Sec-Fetch-Site') !== 'cross-site' &&
      c.req.header('X-Requested-With') === 'hesapp'
    if (!ok) return c.json({ error: 'istek kaynağı doğrulanamadı' }, 403)
  }
  await next()
})
