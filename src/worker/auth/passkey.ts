import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { type Context, Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import type { AppBindings } from '../env'
import {
  clearCookie,
  cookieName,
  FRESH_MS,
  type FullSession,
  getSession,
  putCookie,
  sameOrigin,
  siteConfig,
  startSession,
} from './session'
import { base64url, fromBase64url, hashToken, randomToken, safeEqual, TOKEN_PATTERN } from './tokens'

type Ctx = Context<AppBindings>

interface KeyRow {
  id: string
  user_id: string
  public_key: string
  counter: number
  transports: string
  name: string
  device_type: string
  backed_up: number
  created_at: number
  last_used_at: number | null
}

interface ChallengeRow {
  challenge: string
  kind: 'login' | 'setup' | 'invite' | 'device'
  user_id: string | null
  user_name: string | null
  invite_hash: string | null
  session_hash: string | null
  key_name: string
}

const CHALLENGE_MS = 5 * 60 * 1000
const INVITE_MS = 24 * 60 * 60 * 1000
const MIN_SETUP_CODE = 32

function fail(status: 400 | 401 | 403 | 404 | 409 | 429 | 503, message: string): never {
  throw new HTTPException(status, { message })
}

function cleanText(value: unknown, max: number, label: string, fallback?: string): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (!text) {
    if (fallback !== undefined) return fallback
    fail(400, `${label} gerekli`)
  }
  if (text.length > max) fail(400, `${label} en fazla ${max} karakter olabilir`)
  return text
}

function config(c: Ctx) {
  const site = siteConfig(c)
  if (!site) fail(503, 'giriş güvenli bir adres için yapılandırılmadı (SITE_URL)')
  return site
}

function maxUsers(c: Ctx): number {
  const n = Number(c.env.MAX_USERS)
  return Number.isFinite(n) && n >= 1 && n <= 20 ? Math.floor(n) : 5
}

async function rateLimit(c: Ctx) {
  const now = Date.now()
  const bucket = Math.floor(now / 300_000)
  const ip = await hashToken(c.req.header('CF-Connecting-IP') ?? 'unknown')
  const upsert = 'INSERT INTO auth_limits (id, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET attempts = attempts + 1 RETURNING attempts'
  const results = await c.env.DB.batch<{ attempts: number }>([
    c.env.DB.prepare(upsert).bind(`ip:${ip}:${bucket}`, now + 600_000),
    c.env.DB.prepare(upsert).bind(`global:${bucket}`, now + 600_000),
  ])
  if (Number(results[0]?.results[0]?.attempts) > 40 || Number(results[1]?.results[0]?.attempts) > 300) {
    fail(429, 'çok fazla deneme, beş dakika sonra tekrar dene')
  }
}

async function cleanup(c: Ctx) {
  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').bind(now),
    c.env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(now),
    c.env.DB.prepare('DELETE FROM auth_limits WHERE expires_at < ?').bind(now),
    c.env.DB.prepare('DELETE FROM auth_invites WHERE expires_at < ? OR consumed = 1').bind(now - 86_400_000),
  ])
}

async function storeChallenge(
  c: Ctx,
  challenge: string,
  purpose: 'login' | 'register',
  kind: ChallengeRow['kind'],
  extra: { userId?: string; userName?: string; inviteHash?: string; sessionHash?: string; keyName?: string } = {},
) {
  await cleanup(c)
  const previous = getCookie(c, cookieName(c, 'challenge'))
  if (previous && TOKEN_PATTERN.test(previous)) {
    await c.env.DB.prepare('DELETE FROM auth_challenges WHERE token_hash = ?').bind(await hashToken(previous)).run()
  }
  const token = randomToken()
  await c.env.DB.prepare(
    'INSERT INTO auth_challenges (token_hash, challenge, purpose, kind, expires_at, user_id, user_name, invite_hash, session_hash, key_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      await hashToken(token),
      challenge,
      purpose,
      kind,
      Date.now() + CHALLENGE_MS,
      extra.userId ?? null,
      extra.userName ?? null,
      extra.inviteHash ?? null,
      extra.sessionHash ?? null,
      extra.keyName ?? 'Passkey',
    )
    .run()
  putCookie(c, 'challenge', token, CHALLENGE_MS / 1000)
}

async function consumeChallenge(c: Ctx, purpose: 'login' | 'register'): Promise<ChallengeRow> {
  const token = getCookie(c, cookieName(c, 'challenge'))
  clearCookie(c, 'challenge')
  if (!token || !TOKEN_PATTERN.test(token)) fail(400, 'doğrulama isteği bulunamadı, yeniden başla')
  const row = await c.env.DB.prepare('DELETE FROM auth_challenges WHERE token_hash = ? AND purpose = ? AND expires_at > ? RETURNING *')
    .bind(await hashToken(token), purpose, Date.now())
    .first<ChallengeRow>()
  if (!row) fail(400, 'doğrulama isteğinin süresi doldu veya zaten kullanıldı')
  return row
}

async function requireSession(c: Ctx): Promise<FullSession> {
  const session = await getSession(c)
  if (!session) fail(401, 'oturum gerekli')
  return session
}

async function freshSession(c: Ctx): Promise<FullSession> {
  const session = await requireSession(c)
  if (session.createdAt < Date.now() - FRESH_MS) {
    fail(401, 'bu işlem için son 10 dakika içinde passkey ile giriş yapmış olmalısın, yeniden giriş yap')
  }
  return session
}

async function userCount(c: Ctx): Promise<number> {
  return (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n ?? 0
}

export function createAuthRoutes() {
  const auth = new Hono<AppBindings>()

  auth.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })
  auth.use('*', sameOrigin)
  auth.use('*', async (c, next) => {
    if (c.req.method === 'POST') await rateLimit(c)
    await next()
  })

  // Herkese açık: giriş ekranı hangi formu göstereceğini buradan öğrenir.
  auth.get('/state', async (c) => c.json({ mode: 'passkey' as const, hasUsers: (await userCount(c)) > 0 }))

  // ---- Giriş ----
  auth.post('/login/options', async (c) => {
    const { rpId } = config(c)
    if ((await userCount(c)) === 0) fail(403, 'henüz kurulum yapılmadı')
    // Keşfedilebilir kimlik bilgileri: cihaz hangi hesabın kullanılacağını kendisi seçtirir.
    const options = await generateAuthenticationOptions({ rpID: rpId, userVerification: 'required' })
    await storeChallenge(c, options.challenge, 'login', 'login')
    return c.json(options)
  })

  auth.post('/login/verify', async (c) => {
    const { origin, rpId } = config(c)
    const challenge = await consumeChallenge(c, 'login')
    const response = await c.req.json<AuthenticationResponseJSON>().catch(() => fail(400, 'geçersiz istek'))
    const key = await c.env.DB.prepare('SELECT * FROM passkeys WHERE id = ?')
      .bind(typeof response.id === 'string' ? response.id : '')
      .first<KeyRow>()
    if (!key) fail(401, 'passkey doğrulanamadı')
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
        credential: {
          id: key.id,
          publicKey: fromBase64url(key.public_key),
          counter: key.counter,
          transports: JSON.parse(key.transports) as AuthenticatorTransport[],
        },
      })
      if (!result.verified || !result.authenticationInfo.userVerified) throw new Error('doğrulanamadı')
      const info = result.authenticationInfo
      const update = await c.env.DB.prepare('UPDATE passkeys SET counter = ?, device_type = ?, backed_up = ?, last_used_at = ? WHERE id = ? AND counter = ?')
        .bind(info.newCounter, info.credentialDeviceType, Number(info.credentialBackedUp), Date.now(), key.id, key.counter)
        .run()
      if (!update.meta.changes) throw new Error('anahtar değişti')
    } catch {
      fail(401, 'passkey doğrulanamadı, yeniden dene')
    }
    await startSession(c, key.user_id, key.id)
    return c.json({ ok: true })
  })

  // ---- Kayıt: ilk kurulum, davet veya mevcut hesaba cihaz ekleme ----
  auth.post('/register/options', async (c) => {
    const { rpId } = config(c)
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
    const keyName = cleanText(body.keyName, 60, 'cihaz adı', 'Passkey')

    let kind: 'setup' | 'invite' | 'device'
    let userId = crypto.randomUUID()
    let userName: string
    let inviteHash: string | undefined
    let sessionHash: string | undefined
    let existing: { id: string; transports: string }[] = []

    if (body.kind === 'setup') {
      kind = 'setup'
      const expected = c.env.SETUP_CODE
      if (!expected || expected.length < MIN_SETUP_CODE) fail(503, 'kurulum kodu yapılandırılmadı (SETUP_CODE, en az 32 karakter)')
      const given = typeof body.setupCode === 'string' ? body.setupCode.trim() : ''
      if ((await userCount(c)) > 0 || !(await safeEqual(given, expected))) fail(403, 'kurulum kodu geçersiz ya da kurulum zaten yapılmış')
      userName = cleanText(body.name, 40, 'adın')
    } else if (body.kind === 'invite') {
      kind = 'invite'
      const token = typeof body.inviteToken === 'string' ? body.inviteToken : ''
      if (!TOKEN_PATTERN.test(token)) fail(403, 'davet geçersiz ya da süresi dolmuş')
      inviteHash = await hashToken(token)
      const invite = await c.env.DB.prepare('SELECT user_name FROM auth_invites WHERE token_hash = ? AND consumed = 0 AND expires_at > ?')
        .bind(inviteHash, Date.now())
        .first<{ user_name: string }>()
      if (!invite) fail(403, 'davet geçersiz ya da süresi dolmuş')
      userName = invite.user_name
    } else if (body.kind === 'device') {
      kind = 'device'
      const session = await freshSession(c)
      userId = session.userId
      userName = session.name
      sessionHash = session.tokenHash
      const { results } = await c.env.DB.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').bind(userId).all<{ id: string; transports: string }>()
      if (results.length >= 10) fail(400, 'en fazla 10 passkey kaydedilebilir')
      existing = results
    } else {
      fail(400, 'geçersiz istek')
    }

    const options = await generateRegistrationOptions({
      rpName: 'hesapp',
      rpID: rpId,
      userID: Uint8Array.from(new TextEncoder().encode(userId)),
      userName,
      userDisplayName: userName,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      supportedAlgorithmIDs: [-7, -257],
      excludeCredentials: existing.map((k) => ({ id: k.id, transports: JSON.parse(k.transports) as AuthenticatorTransport[] })),
    })
    await storeChallenge(c, options.challenge, 'register', kind, { userId, userName, inviteHash, sessionHash, keyName })
    return c.json(options)
  })

  auth.post('/register/verify', async (c) => {
    const { origin, rpId } = config(c)
    const challenge = await consumeChallenge(c, 'register')
    if (challenge.kind === 'login' || !challenge.user_id || !challenge.user_name) fail(400, 'geçersiz istek')
    const response = await c.req.json<RegistrationResponseJSON>().catch(() => fail(400, 'geçersiz istek'))

    let verified
    try {
      verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      })
      if (!verified.verified || !verified.registrationInfo?.userVerified) throw new Error('doğrulanamadı')
    } catch {
      fail(400, 'passkey kaydı doğrulanamadı, işlemi yeniden başlat')
    }
    const info = verified.registrationInfo
    const key = info.credential
    const now = Date.now()
    const userId = challenge.user_id

    const insertKey = (guard: string, ...binds: unknown[]) =>
      c.env.DB.prepare(
        `INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, device_type, backed_up, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard} RETURNING id`,
      ).bind(
        key.id,
        userId,
        base64url(key.publicKey),
        key.counter,
        JSON.stringify(key.transports ?? []),
        challenge.key_name,
        info.credentialDeviceType,
        Number(info.credentialBackedUp),
        now,
        ...binds,
      )

    let inserted: string | undefined
    if (challenge.kind === 'setup') {
      // Kullanıcı yalnızca hiç kullanıcı yokken eklenir; anahtar, o kullanıcı varsa eklenir.
      const [, keyResult] = await c.env.DB.batch<{ id: string }>([
        c.env.DB.prepare("INSERT INTO users (id, name, role, created_at) SELECT ?, ?, 'owner', ? WHERE NOT EXISTS (SELECT 1 FROM users)").bind(userId, challenge.user_name, now),
        insertKey('EXISTS (SELECT 1 FROM users WHERE id = ?)', userId),
      ])
      inserted = keyResult?.results[0]?.id
    } else if (challenge.kind === 'invite') {
      if (!challenge.invite_hash) fail(400, 'geçersiz istek')
      const [, keyResult] = await c.env.DB.batch<{ id: string }>([
        c.env.DB.prepare(
          "INSERT INTO users (id, name, role, created_at) SELECT ?, user_name, 'member', ? FROM auth_invites WHERE token_hash = ? AND consumed = 0 AND expires_at > ? AND (SELECT COUNT(*) FROM users) < ?",
        ).bind(userId, now, challenge.invite_hash, now, maxUsers(c)),
        insertKey('EXISTS (SELECT 1 FROM users WHERE id = ?)', userId),
        c.env.DB.prepare('UPDATE auth_invites SET consumed = 1 WHERE token_hash = ? AND consumed = 0 AND EXISTS (SELECT 1 FROM passkeys WHERE id = ?)').bind(
          challenge.invite_hash,
          key.id,
        ),
      ])
      inserted = keyResult?.results[0]?.id
    } else {
      // Cihaz ekleme: istek sırasında yetkilendiren oturum hâlâ geçerli ve yeterince taze olmalı.
      const row = await insertKey(
        'EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash = ? AND user_id = ? AND expires_at > ? AND created_at > ?)',
        challenge.session_hash,
        userId,
        now,
        now - FRESH_MS,
      ).first<{ id: string }>()
      inserted = row?.id
    }
    if (!inserted) fail(403, 'kayıt yetkisi sona erdi, işlemi yeniden başlat')

    await startSession(c, userId, key.id)
    return c.json({ ok: true })
  })

  auth.post('/logout', async (c) => {
    const session = await getSession(c)
    if (session) await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(session.tokenHash).run()
    clearCookie(c, 'session')
    clearCookie(c, 'challenge')
    return c.json({ ok: true })
  })

  // ---- Oturum gerektirenler: cihazlar, davet, kişiler ----
  auth.get('/passkeys', async (c) => {
    const session = await requireSession(c)
    const { results } = await c.env.DB.prepare('SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at')
      .bind(session.userId)
      .all<Omit<KeyRow, 'user_id' | 'public_key' | 'counter' | 'transports'>>()
    return c.json(results.map((k) => ({ ...k, current: k.id === session.credentialId })))
  })

  auth.delete('/passkeys/:id', async (c) => {
    const session = await freshSession(c)
    const id = c.req.param('id')
    if (id === session.credentialId) fail(400, 'şu an kullandığın anahtarı silemezsin, önce başka anahtarla giriş yap')
    const own = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind(session.userId).first<{ n: number }>()
    if ((own?.n ?? 0) <= 1) fail(409, 'son passkey silinemez')
    const result = await c.env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').bind(id, session.userId).run()
    if (!result.meta.changes) fail(404, 'anahtar bulunamadı')
    return c.json({ ok: true })
  })

  auth.get('/members', async (c) => {
    await requireSession(c)
    const { results } = await c.env.DB.prepare(
      'SELECT u.id, u.name, u.role, u.created_at, (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys FROM users u ORDER BY u.created_at',
    ).all<{ id: string; name: string; role: string; created_at: number; passkeys: number }>()
    return c.json(results)
  })

  auth.post('/invites', async (c) => {
    const session = await freshSession(c)
    if (session.role !== 'owner') fail(403, 'yalnızca hesap sahibi kişi davet edebilir')
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
    const name = cleanText(body.name, 40, 'kişinin adı')
    const now = Date.now()
    const pending = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM auth_invites WHERE consumed = 0 AND expires_at > ?').bind(now).first<{ n: number }>()
    if ((await userCount(c)) + (pending?.n ?? 0) >= maxUsers(c)) fail(409, 'kişi sınırına ulaşıldı')
    const token = randomToken()
    await c.env.DB.prepare('INSERT INTO auth_invites (token_hash, created_by, user_name, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await hashToken(token), session.userId, name, now + INVITE_MS)
      .run()
    return c.json({ token, expiresAt: now + INVITE_MS })
  })

  auth.delete('/members/:id', async (c) => {
    const session = await freshSession(c)
    if (session.role !== 'owner') fail(403, 'yalnızca hesap sahibi kişi çıkarabilir')
    const id = c.req.param('id')
    if (id === session.userId) fail(400, 'kendini çıkaramazsın')
    const result = await c.env.DB.prepare("DELETE FROM users WHERE id = ? AND role <> 'owner'").bind(id).run()
    if (!result.meta.changes) fail(404, 'kişi bulunamadı')
    return c.json({ ok: true })
  })

  return auth
}
