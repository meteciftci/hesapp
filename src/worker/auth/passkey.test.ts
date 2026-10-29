import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import { getPlatformProxy, type PlatformProxy, unstable_splitSqlQuery } from 'wrangler'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import type { Env } from '../env'
import { base64url, fromBase64url, hashToken, randomToken } from './tokens'

const origin = 'https://hesapp.example.test'
const rpId = 'hesapp.example.test'
const setupCode = 'test-kurulum-kodu-0123456789-abcdefghijkl'
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext

let platform: PlatformProxy<Env>
let env: Env
const app = createApp()

// ---- Sanal authenticator ----
const enc = (v: string) => new TextEncoder().encode(v)
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
const sha256 = async (v: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', v as Uint8Array<ArrayBuffer>))

class Device {
  credentialId = crypto.getRandomValues(new Uint8Array(32))
  id = base64url(this.credentialId)
  counter = 0
  pair!: CryptoKeyPair
  static async create() {
    const d = new Device()
    d.pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    return d
  }
  async register(challenge: string, o: { verified?: boolean } = {}): Promise<RegistrationResponseJSON> {
    const jwk = (await crypto.subtle.exportKey('jwk', this.pair.publicKey)) as JsonWebKey
    const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, fromBase64url(jwk.x!)], [-3, fromBase64url(jwk.y!)]]))
    const authData = concat(await sha256(enc(rpId)), new Uint8Array([o.verified === false ? 0x41 : 0x45]), new Uint8Array(4), new Uint8Array(16), new Uint8Array([0, 32]), this.credentialId, cose)
    const attestationObject = isoCBOR.encode(new Map<string, string | Map<string, never> | Uint8Array>([['fmt', 'none'], ['attStmt', new Map<string, never>()], ['authData', authData]]))
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: base64url(enc(JSON.stringify({ type: 'webauthn.create', origin, challenge, crossOrigin: false }))),
        attestationObject: base64url(attestationObject),
        transports: ['internal'],
      },
    }
  }
  async assert(challenge: string, o: { verified?: boolean; origin?: string; badSignature?: boolean } = {}): Promise<AuthenticationResponseJSON> {
    this.counter += 1
    const counter = new Uint8Array(4)
    new DataView(counter.buffer).setUint32(0, this.counter)
    const authenticatorData = concat(await sha256(enc(rpId)), new Uint8Array([o.verified === false ? 1 : 5]), counter)
    const clientData = enc(JSON.stringify({ type: 'webauthn.get', origin: o.origin ?? origin, challenge, crossOrigin: false }))
    const signed = concat(authenticatorData, await sha256(clientData))
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.pair.privateKey, signed))
    if (o.badSignature) raw[0] ^= 0xff
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: base64url(clientData), authenticatorData: base64url(authenticatorData), signature: base64url(der(raw)) },
    }
  }
}
function der(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let start = 0
    while (start < b.length - 1 && b[start] === 0) start++
    let v = b.slice(start)
    if (v[0]! & 0x80) v = concat(new Uint8Array([0]), v)
    return concat(new Uint8Array([2, v.length]), v)
  }
  const v = concat(int(raw.slice(0, 32)), int(raw.slice(32)))
  return concat(new Uint8Array([0x30, v.length]), v)
}

// ---- İstek yardımcıları ----
const cookieOf = (res: Response, kind: 'session' | 'challenge') => res.headers.getSetCookie().find((c) => c.startsWith(`__Host-hesapp_${kind}=`))?.split(';')[0] ?? ''

async function call(path: string, o: { body?: unknown; cookies?: string; method?: string; headers?: Record<string, string> } = {}, e: Env = env) {
  const method = o.method ?? (o.body === undefined ? 'GET' : 'POST')
  return app.fetch(
    new Request(origin + path, {
      method,
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Requested-With': 'hesapp', Cookie: o.cookies ?? '', ...o.headers },
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(o.body ?? {}),
    }),
    e,
    ctx,
  )
}

async function register(device: Device, start: Record<string, unknown>, cookies = '', opts: { verified?: boolean } = {}) {
  const res = await call('/api/auth/register/options', { body: start, cookies })
  if (res.status !== 200) return { options: res, verify: res }
  const options = (await res.json()) as PublicKeyCredentialCreationOptionsJSON
  const challenge = cookieOf(res, 'challenge')
  const verify = await call('/api/auth/register/verify', { body: await device.register(options.challenge, opts), cookies: `${cookies}; ${challenge}` })
  return { options: res, verify, optionsJSON: options, challengeCookie: challenge }
}

async function setupOwner(device: Device, name = 'Ayşe') {
  const r = await register(device, { kind: 'setup', setupCode, name, keyName: 'Telefon' })
  expect(r.verify.status).toBe(200)
  return cookieOf(r.verify, 'session')
}

async function login(device: Device, o: Parameters<Device['assert']>[1] = {}) {
  const start = await call('/api/auth/login/options', { body: {} })
  expect(start.status).toBe(200)
  const options = (await start.json()) as PublicKeyCredentialRequestOptionsJSON
  const res = await call('/api/auth/login/verify', { body: await device.assert(options.challenge, o), cookies: cookieOf(start, 'challenge') })
  return { res, start, options }
}

async function invite(ownerSession: string, name = 'Mehmet') {
  const res = await call('/api/auth/invites', { body: { name }, cookies: ownerSession })
  expect(res.status).toBe(200)
  return ((await res.json()) as { token: string }).token
}

async function count(table: string) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n
}

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({ configPath: 'wrangler.jsonc', persist: false })
  env = { ...platform.env, AUTH_MODE: 'passkey', SITE_URL: origin, SETUP_CODE: setupCode }
  const dir = join(process.cwd(), 'migrations')
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
    for (const sql of unstable_splitSqlQuery(await readFile(join(dir, name), 'utf8'))) await env.DB.prepare(sql).run()
  }
}, 60_000)

beforeEach(async () => {
  await env.DB.batch(['auth_sessions', 'auth_challenges', 'auth_limits', 'auth_invites', 'users'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
})

afterAll(async () => {
  await platform?.dispose()
})

describe('ilk kurulum', () => {
  it('durum: kurulumdan önce kullanıcı yok, sonra var', async () => {
    expect(await (await call('/api/auth/state')).json()).toEqual({ mode: 'passkey', hasUsers: false })
    await setupOwner(await Device.create())
    expect(await (await call('/api/auth/state')).json()).toEqual({ mode: 'passkey', hasUsers: true })
  })

  it('yanlış kodu reddeder, doğru kodla hesap sahibini ve oturumu oluşturur', async () => {
    const device = await Device.create()
    expect((await call('/api/auth/register/options', { body: { kind: 'setup', setupCode: 'yanlis', name: 'Ayşe' } })).status).toBe(403)

    const r = await register(device, { kind: 'setup', setupCode, name: 'Ayşe', keyName: 'Telefon' })
    expect((r.optionsJSON as PublicKeyCredentialCreationOptionsJSON).authenticatorSelection?.userVerification).toBe('required')
    expect((r.optionsJSON as PublicKeyCredentialCreationOptionsJSON).rp.id).toBe(rpId)
    expect(r.verify.status).toBe(200)
    const setCookie = r.verify.headers.getSetCookie().find((c) => c.startsWith('__Host-hesapp_session='))!
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Strict')

    const me = await call('/api/me', { cookies: cookieOf(r.verify, 'session') })
    expect(await me.json()).toMatchObject({ name: 'Ayşe', role: 'owner' })
  })

  it('kurulum kodu yapılandırılmamışsa ya da kısaysa 503 verir', async () => {
    expect((await call('/api/auth/register/options', { body: { kind: 'setup', setupCode, name: 'A' } }, { ...env, SETUP_CODE: undefined })).status).toBe(503)
    expect((await call('/api/auth/register/options', { body: { kind: 'setup', setupCode: 'kisa', name: 'A' } }, { ...env, SETUP_CODE: 'kisa' })).status).toBe(503)
  })

  it('kurulum bir kez yapılır: ikinci deneme (kod doğru olsa da) reddedilir', async () => {
    await setupOwner(await Device.create())
    const res = await call('/api/auth/register/options', { body: { kind: 'setup', setupCode, name: 'Mallory' } })
    expect(res.status).toBe(403)
  })

  it('seçenek aşamasını atlayıp elle kurulum doğrulaması gönderse bile ikinci sahip oluşmaz', async () => {
    await setupOwner(await Device.create())
    const mallory = await Device.create()
    const challenge = randomToken()
    const token = randomToken()
    await env.DB.prepare("INSERT INTO auth_challenges (token_hash, challenge, purpose, kind, expires_at, user_id, user_name, key_name) VALUES (?, ?, 'register', 'setup', ?, ?, 'Mallory', 'x')")
      .bind(await hashToken(token), challenge, Date.now() + 60_000, crypto.randomUUID())
      .run()
    const res = await call('/api/auth/register/verify', { body: await mallory.register(challenge), cookies: `__Host-hesapp_challenge=${token}` })
    expect(res.status).toBe(403)
    expect(await count('users')).toBe(1)
    expect(await count('passkeys')).toBe(1)
  })

  it('kullanıcı doğrulaması (UV) olmayan kaydı reddeder', async () => {
    const r = await register(await Device.create(), { kind: 'setup', setupCode, name: 'Ayşe' }, '', { verified: false })
    expect(r.verify.status).toBe(400)
    expect(await count('users')).toBe(0)
  })

  it('doğrulama isteği tarayıcıya bağlıdır ve yeniden kullanılamaz', async () => {
    const device = await Device.create()
    const res = await call('/api/auth/register/options', { body: { kind: 'setup', setupCode, name: 'Ayşe' } })
    const options = (await res.json()) as PublicKeyCredentialCreationOptionsJSON
    const body = await device.register(options.challenge)
    expect((await call('/api/auth/register/verify', { body })).status).toBe(400) // çerez yok
    expect((await call('/api/auth/register/verify', { body, cookies: cookieOf(res, 'challenge') })).status).toBe(200)
    expect((await call('/api/auth/register/verify', { body, cookies: cookieOf(res, 'challenge') })).status).toBe(400) // tekrar
  })
})

describe('giriş ve oturum', () => {
  it('geçerli imzayla giriş yapar, oturum alır, çıkışla geçersiz kılar', async () => {
    const device = await Device.create()
    await setupOwner(device)
    const { res, start, options } = await login(device)
    expect(options.allowCredentials ?? []).toEqual([]) // cihaz hesabı kendisi seçer
    expect(res.status).toBe(200)
    const session = cookieOf(res, 'session')
    expect((await call('/api/me', { cookies: session })).status).toBe(200)

    // aynı doğrulama isteği tekrar kullanılamaz
    expect((await call('/api/auth/login/verify', { body: await device.assert(options.challenge), cookies: cookieOf(start, 'challenge') })).status).toBe(400)

    expect((await call('/api/auth/logout', { body: {}, cookies: session })).status).toBe(200)
    expect((await call('/api/me', { cookies: session })).status).toBe(401)
  })

  it('oturum olmadan korumalı uçlar 401 verir, sağlık ucu açık kalır', async () => {
    expect((await call('/api/me')).status).toBe(401)
    expect((await call('/api/auth/members')).status).toBe(401)
    expect((await call('/api/health')).status).toBe(200)
  })

  it('yanlış kaynak, bozuk imza ve kullanıcı doğrulaması olmayan girişi reddeder', async () => {
    const device = await Device.create()
    await setupOwner(device)
    for (const o of [{ origin: 'https://attacker.test' }, { badSignature: true }, { verified: false }]) {
      expect((await login(device, o)).res.status).toBe(401)
    }
  })

  it('bilinmeyen passkey ile giriş yapılamaz', async () => {
    await setupOwner(await Device.create())
    expect((await login(await Device.create())).res.status).toBe(401)
  })

  it('süresi dolan oturumu ve doğrulama isteğini kabul etmez', async () => {
    const device = await Device.create()
    const session = await setupOwner(device)
    await env.DB.prepare('UPDATE auth_sessions SET expires_at = ?').bind(Date.now() - 1).run()
    expect((await call('/api/me', { cookies: session })).status).toBe(401)

    const start = await call('/api/auth/login/options', { body: {} })
    const options = (await start.json()) as PublicKeyCredentialRequestOptionsJSON
    await env.DB.prepare('UPDATE auth_challenges SET expires_at = ?').bind(Date.now() - 1).run()
    expect((await call('/api/auth/login/verify', { body: await device.assert(options.challenge), cookies: cookieOf(start, 'challenge') })).status).toBe(400)
  })

  it('kimlik doğrulama uçlarında hız sınırı uygular', async () => {
    const bucket = Math.floor(Date.now() / 300_000)
    await env.DB.prepare('INSERT INTO auth_limits (id, attempts, expires_at) VALUES (?, 40, ?)').bind(`ip:${await hashToken('unknown')}:${bucket}`, Date.now() + 600_000).run()
    expect((await call('/api/auth/login/options', { body: {} })).status).toBe(429)
  })
})

describe('istek kaynağı denetimi (CSRF)', () => {
  it('Origin ya da özel başlık eksik/yanlışsa durum değiştiren istekleri reddeder', async () => {
    const session = await setupOwner(await Device.create())
    expect((await call('/api/auth/logout', { body: {}, cookies: session, headers: { Origin: 'https://attacker.test' } })).status).toBe(403)
    expect((await call('/api/auth/logout', { body: {}, cookies: session, headers: { 'X-Requested-With': '' } })).status).toBe(403)
    expect((await call('/api/auth/logout', { body: {}, cookies: session, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403)
    expect((await call('/api/me', { cookies: session })).status).toBe(200) // oturum bozulmadı
  })
})

describe('davet ile ikinci kişi', () => {
  it('hesap sahibi davet üretir, davetli kendi cihazında kayıt olur, davet bir kez kullanılır', async () => {
    const ownerSession = await setupOwner(await Device.create())
    const token = await invite(ownerSession, 'Mehmet')

    const member = await Device.create()
    const r = await register(member, { kind: 'invite', inviteToken: token, keyName: 'Telefon' })
    expect(r.verify.status).toBe(200)
    const memberSession = cookieOf(r.verify, 'session')
    expect(await (await call('/api/me', { cookies: memberSession })).json()).toMatchObject({ name: 'Mehmet', role: 'member' })

    // aynı davet tekrar kullanılamaz
    expect((await call('/api/auth/register/options', { body: { kind: 'invite', inviteToken: token } })).status).toBe(403)

    // üyeler listesi
    const members = (await (await call('/api/auth/members', { cookies: ownerSession })).json()) as { name: string; role: string; passkeys: number }[]
    expect(members.map((m) => [m.name, m.role, m.passkeys])).toEqual([['Ayşe', 'owner', 1], ['Mehmet', 'member', 1]])
  })

  it('üye davet üretemez, geçersiz ya da süresi dolmuş davet çalışmaz', async () => {
    const ownerSession = await setupOwner(await Device.create())
    const token = await invite(ownerSession)
    const r = await register(await Device.create(), { kind: 'invite', inviteToken: token })
    const memberSession = cookieOf(r.verify, 'session')
    expect((await call('/api/auth/invites', { body: { name: 'X' }, cookies: memberSession })).status).toBe(403)

    expect((await call('/api/auth/register/options', { body: { kind: 'invite', inviteToken: randomToken() } })).status).toBe(403)
    expect((await call('/api/auth/register/options', { body: { kind: 'invite', inviteToken: 'bozuk' } })).status).toBe(403)

    const second = await invite(ownerSession, 'Zeynep')
    await env.DB.prepare('UPDATE auth_invites SET expires_at = ? WHERE token_hash = ?').bind(Date.now() - 1, await hashToken(second)).run()
    expect((await call('/api/auth/register/options', { body: { kind: 'invite', inviteToken: second } })).status).toBe(403)
  })

  it('davet üretmek için taze oturum gerekir ve kişi sınırına uyar', async () => {
    const ownerSession = await setupOwner(await Device.create())
    await env.DB.prepare('UPDATE auth_sessions SET created_at = ?').bind(Date.now() - 11 * 60_000).run()
    expect((await call('/api/auth/invites', { body: { name: 'Mehmet' }, cookies: ownerSession })).status).toBe(401)

    await env.DB.prepare('UPDATE auth_sessions SET created_at = ?').bind(Date.now()).run()
    const limited = { ...env, MAX_USERS: '2' }
    expect((await call('/api/auth/invites', { body: { name: 'Mehmet' }, cookies: ownerSession }, limited)).status).toBe(200)
    expect((await call('/api/auth/invites', { body: { name: 'Zeynep' }, cookies: ownerSession }, limited)).status).toBe(409)
  })

  it('kişi sınırı kayıt anında da zorlanır', async () => {
    const ownerSession = await setupOwner(await Device.create())
    const token = await invite(ownerSession)
    const full = { ...env, MAX_USERS: '1' }
    const device = await Device.create()
    const res = await call('/api/auth/register/options', { body: { kind: 'invite', inviteToken: token } }, full)
    const options = (await res.json()) as PublicKeyCredentialCreationOptionsJSON
    const verify = await call('/api/auth/register/verify', { body: await device.register(options.challenge), cookies: cookieOf(res, 'challenge') }, full)
    expect(verify.status).toBe(403)
    expect(await count('users')).toBe(1)
  })

  it('hesap sahibi bir kişiyi çıkarabilir; kişinin anahtarları ve oturumları da silinir', async () => {
    const ownerSession = await setupOwner(await Device.create())
    const r = await register(await Device.create(), { kind: 'invite', inviteToken: await invite(ownerSession) })
    const memberSession = cookieOf(r.verify, 'session')
    const members = (await (await call('/api/auth/members', { cookies: ownerSession })).json()) as { id: string; role: string }[]
    const member = members.find((m) => m.role === 'member')!
    const owner = members.find((m) => m.role === 'owner')!

    expect((await call(`/api/auth/members/${member.id}`, { method: 'DELETE', cookies: memberSession })).status).toBe(403)
    expect((await call(`/api/auth/members/${owner.id}`, { method: 'DELETE', cookies: ownerSession })).status).toBe(400)
    expect((await call(`/api/auth/members/${member.id}`, { method: 'DELETE', cookies: ownerSession })).status).toBe(200)
    expect((await call('/api/me', { cookies: memberSession })).status).toBe(401)
    expect(await count('users')).toBe(1)
    expect(await count('passkeys')).toBe(1)
  })
})

describe('cihaz (passkey) yönetimi', () => {
  it('taze oturumla yeni cihaz eklenir, eski oturumla eklenmez', async () => {
    const first = await Device.create()
    const session = await setupOwner(first)
    const second = await Device.create()

    await env.DB.prepare('UPDATE auth_sessions SET created_at = ?').bind(Date.now() - 11 * 60_000).run()
    expect((await call('/api/auth/register/options', { body: { kind: 'device' }, cookies: session })).status).toBe(401)
    expect((await call('/api/auth/register/options', { body: { kind: 'device' } })).status).toBe(401)

    await env.DB.prepare('UPDATE auth_sessions SET created_at = ?').bind(Date.now()).run()
    const r = await register(second, { kind: 'device', keyName: 'Bilgisayar' }, session)
    expect(r.verify.status).toBe(200)
    const list = (await (await call('/api/auth/passkeys', { cookies: cookieOf(r.verify, 'session') })).json()) as { name: string; current: boolean }[]
    expect(list.map((k) => [k.name, k.current])).toEqual([['Telefon', false], ['Bilgisayar', true]])
    expect(JSON.stringify(list)).not.toContain('public_key')
  })

  it('cihaz eklerken yetkilendiren oturum doğrulama sırasında iptal edilirse kayıt reddedilir', async () => {
    const session = await setupOwner(await Device.create())
    const second = await Device.create()
    const res = await call('/api/auth/register/options', { body: { kind: 'device' }, cookies: session })
    const options = (await res.json()) as PublicKeyCredentialCreationOptionsJSON
    await env.DB.prepare('DELETE FROM auth_sessions').run()
    const verify = await call('/api/auth/register/verify', { body: await second.register(options.challenge), cookies: `${session}; ${cookieOf(res, 'challenge')}` })
    expect(verify.status).toBe(403)
    expect(await count('passkeys')).toBe(1)
  })

  it('kullanılan ve son passkey silinemez, diğeri silinebilir', async () => {
    const first = await Device.create()
    const session = await setupOwner(first)
    const list0 = (await (await call('/api/auth/passkeys', { cookies: session })).json()) as { id: string }[]
    expect((await call(`/api/auth/passkeys/${list0[0]!.id}`, { method: 'DELETE', cookies: session })).status).toBe(400) // şu anki

    const second = await Device.create()
    const r = await register(second, { kind: 'device' }, session)
    const secondSession = cookieOf(r.verify, 'session')
    const all = (await (await call('/api/auth/passkeys', { cookies: secondSession })).json()) as { id: string; current: boolean }[]
    const other = all.find((k) => !k.current)!
    expect((await call(`/api/auth/passkeys/${other.id}`, { method: 'DELETE', cookies: secondSession })).status).toBe(200)
    expect(await count('passkeys')).toBe(1)

    // veritabanı düzeyinde de son anahtar korunur
    await expect(env.DB.prepare('DELETE FROM passkeys').run()).rejects.toThrow()
  })

  it('başkasının cihazını silemez', async () => {
    const ownerSession = await setupOwner(await Device.create())
    const r = await register(await Device.create(), { kind: 'invite', inviteToken: await invite(ownerSession) })
    const memberSession = cookieOf(r.verify, 'session')
    const second = await register(await Device.create(), { kind: 'device' }, memberSession)
    expect(second.verify.status).toBe(200)
    const ownerKeys = (await (await call('/api/auth/passkeys', { cookies: ownerSession })).json()) as { id: string }[]
    expect((await call(`/api/auth/passkeys/${ownerKeys[0]!.id}`, { method: 'DELETE', cookies: cookieOf(second.verify, 'session') })).status).toBe(404)
  })
})

describe('yapılandırma', () => {
  it('SITE_URL yoksa giriş 503 verir, https değilse reddedilir', async () => {
    expect((await call('/api/auth/login/options', { body: {} }, { ...env, SITE_URL: undefined })).status).toBe(503)
    // adres https değilse istek kaynağı denetimi zaten reddeder
    expect((await call('/api/auth/login/options', { body: {} }, { ...env, SITE_URL: 'http://hesapp.example.test' })).status).toBe(403)
  })

  it('Access modunda passkey uçları kapalıdır', async () => {
    const accessEnv = { ...env, AUTH_MODE: 'access' }
    expect(await (await call('/api/auth/state', {}, accessEnv)).json()).toEqual({ mode: 'access', hasUsers: true })
    expect((await call('/api/auth/login/options', { body: {} }, accessEnv)).status).toBe(404)
  })
})
