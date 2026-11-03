import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { AuthUser, Env } from '../env'

export type KeyResolver = (teamDomain: string) => JWTVerifyGetKey

const remoteKeys = new Map<string, JWTVerifyGetKey>()

/** Access'in açık anahtarlarını uzaktan getirir; isolate ömrü boyunca önbelleğe alır. */
export const remoteKeyResolver: KeyResolver = (teamDomain) => {
  let keys = remoteKeys.get(teamDomain)
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
    remoteKeys.set(teamDomain, keys)
  }
  return keys
}

export function parseAllowedEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

function cleanDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

type Resolution = { ok: true; email: string } | { ok: false; status: 401 | 403 | 500; message: string }

export async function resolveUser(
  env: Env,
  headers: Headers,
  keyResolver: KeyResolver,
): Promise<Resolution> {
  const team = env.ACCESS_TEAM_DOMAIN ? cleanDomain(env.ACCESS_TEAM_DOMAIN) : ''
  const aud = env.ACCESS_AUD

  let email: string

  if ((team || aud) && !(team && aud)) {
    // Yarım yapılandırma: sahte kullanıcıya düşmeden kapalı kal.
    return { ok: false, status: 500, message: 'kimlik doğrulama yapılandırılmamış' }
  }

  if (team && aud) {
    const token = headers.get('Cf-Access-Jwt-Assertion')
    if (!token) return { ok: false, status: 401, message: 'oturum gerekli' }
    try {
      const { payload } = await jwtVerify(token, keyResolver(team), {
        issuer: `https://${team}`,
        audience: aud,
      })
      if (typeof payload.email !== 'string' || !payload.email) {
        return { ok: false, status: 401, message: 'geçersiz oturum' }
      }
      email = payload.email.toLowerCase()
    } catch {
      return { ok: false, status: 401, message: 'geçersiz oturum' }
    }
  } else if (env.DEV_USER_EMAIL) {
    // Yalnızca Access hiç yapılandırılmamışsa; canlıda DEV_USER_EMAIL tanımlanmamalı.
    email = env.DEV_USER_EMAIL.toLowerCase()
  } else {
    // Güvenli varsayılan: yapılandırma yoksa kimseyi içeri alma.
    return { ok: false, status: 500, message: 'kimlik doğrulama yapılandırılmamış' }
  }

  const allowed = parseAllowedEmails(env.ALLOWED_EMAILS)
  if (allowed.length > 0 && !allowed.includes(email)) {
    return { ok: false, status: 403, message: 'bu hesaba izin verilmiyor' }
  }
  return { ok: true, email }
}

export async function accessUser(env: Env, headers: Headers, keyResolver: KeyResolver): Promise<
  { ok: true; user: AuthUser } | { ok: false; status: 401 | 403 | 500; message: string }
> {
  const result = await resolveUser(env, headers, keyResolver)
  if (!result.ok) return result
  return { ok: true, user: { id: result.email, name: result.email, role: 'owner' } }
}
