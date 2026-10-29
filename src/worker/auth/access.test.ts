import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Env } from './env'

const TEAM = 'ornek.cloudflareaccess.com'
const AUD = 'aud-ornek'

let privateKey: CryptoKey
let otherKey: CryptoKey
let app: ReturnType<typeof createApp>

async function token(opts: { key?: CryptoKey; aud?: string; iss?: string; email?: string | null; exp?: string } = {}) {
  const claims: Record<string, unknown> = {}
  if (opts.email !== null) claims.email = opts.email ?? 'a@example.com'
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? privateKey)
}

const accessEnv: Env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }

function call(path: string, env: Env, jwt?: string) {
  return app.request(path, { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} }, env)
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  otherKey = (await generateKeyPair('RS256')).privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  const keys = createLocalJWKSet({ keys: [jwk] })
  app = createApp(() => keys)
})

describe('/api/health', () => {
  it('kimlik istemeden yanıt verir', async () => {
    const res = await call('/api/health', {})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('access jwt doğrulaması', () => {
  it('geçerli belgeyle kullanıcıyı döndürür (e-posta küçük harfe çevrilir)', async () => {
    const res = await call('/api/me', accessEnv, await token({ email: 'Kisi@Example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'kisi@example.com' })
  })

  it('belge yoksa 401', async () => {
    expect((await call('/api/me', accessEnv)).status).toBe(401)
  })

  it('yanlış anahtarla imzalanmışsa 401', async () => {
    const res = await call('/api/me', accessEnv, await token({ key: otherKey }))
    expect(res.status).toBe(401)
  })

  it('yanlış audience ise 401', async () => {
    expect((await call('/api/me', accessEnv, await token({ aud: 'baska' }))).status).toBe(401)
  })

  it('yanlış issuer ise 401', async () => {
    expect((await call('/api/me', accessEnv, await token({ iss: 'https://baska.example.com' }))).status).toBe(401)
  })

  it('süresi dolmuşsa 401', async () => {
    expect((await call('/api/me', accessEnv, await token({ exp: '-1m' }))).status).toBe(401)
  })

  it('e-posta alanı yoksa 401', async () => {
    expect((await call('/api/me', accessEnv, await token({ email: null }))).status).toBe(401)
  })

  it('bozuk belgede 401', async () => {
    expect((await call('/api/me', accessEnv, 'bozuk.belge.degeri')).status).toBe(401)
  })

  it('takım alan adındaki https:// ve sondaki / yok sayılır', async () => {
    const env: Env = { ACCESS_TEAM_DOMAIN: `https://${TEAM}/`, ACCESS_AUD: AUD }
    expect((await call('/api/me', env, await token())).status).toBe(200)
  })

  it('access yapılandırılmışken sahte geliştirme kullanıcısı geçerli olmaz', async () => {
    const env: Env = { ...accessEnv, DEV_USER_EMAIL: 'dev@example.com' }
    expect((await call('/api/me', env)).status).toBe(401)
  })
})

describe('izinli e-posta listesi', () => {
  const env: Env = { ...accessEnv, ALLOWED_EMAILS: ' a@example.com , B@example.com ' }

  it('listedeki e-postaya izin verir', async () => {
    expect((await call('/api/me', env, await token({ email: 'b@example.com' }))).status).toBe(200)
  })

  it('listede olmayan e-postayı 403 ile reddeder', async () => {
    expect((await call('/api/me', env, await token({ email: 'c@example.com' }))).status).toBe(403)
  })
})

describe('yerel geliştirme kullanıcısı', () => {
  it('access yapılandırılmamışsa geliştirme kullanıcısını kullanır', async () => {
    const res = await call('/api/me', { DEV_USER_EMAIL: 'dev@example.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'dev@example.com' })
  })

  it('hiçbir yapılandırma yoksa kimseyi içeri almaz', async () => {
    expect((await call('/api/me', {})).status).toBe(500)
  })

  it('access yarım yapılandırılmışsa (aud eksik) geliştirme kullanıcısı olsa bile 500', async () => {
    expect((await call('/api/me', { ACCESS_TEAM_DOMAIN: TEAM })).status).toBe(500)
    expect((await call('/api/me', { ACCESS_TEAM_DOMAIN: TEAM, DEV_USER_EMAIL: 'dev@example.com' })).status).toBe(500)
    expect((await call('/api/me', { ACCESS_AUD: AUD, DEV_USER_EMAIL: 'dev@example.com' })).status).toBe(500)
  })
})

describe('bilinmeyen yol', () => {
  it('404 döndürür', async () => {
    const res = await call('/api/yok', { DEV_USER_EMAIL: 'dev@example.com' })
    expect(res.status).toBe(404)
  })
})
