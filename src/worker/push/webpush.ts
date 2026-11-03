/**
 * Web Push: ileti şifreleme (RFC 8291, aes128gcm) ve VAPID kimliği (RFC 8292), yalnızca WebCrypto ile.
 * Anahtarlar base64url: genel anahtar sıkıştırılmamış P-256 noktası (65 bayt), özel anahtar `d` (32 bayt).
 */

export interface PushSubscriptionKeys {
  endpoint: string
  p256dh: string
  auth: string
}

export interface VapidKeys {
  publicKey: string
  privateKey: string
  /** `mailto:` ya da `https:` adresi */
  subject: string
}

const encoder = new TextEncoder()
const utf8 = (text: string) => new Uint8Array(encoder.encode(text))

export function b64urlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function concat(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) (out.set(p, offset), (offset += p.length))
  return out
}

/** HKDF (çıkar + genişlet) tek adımda. */
async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** RFC 8291: ileti gövdesini alıcının anahtarlarıyla şifreler (tek kayıt, dolgusuz). */
export async function encryptPayload(payload: string, p256dh: string, auth: string, salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16))): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(p256dh)
  const authSecret = b64urlDecode(auth)
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('geçersiz abonelik anahtarı')

  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer)
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, local.privateKey, 256))

  const ikm = await hkdf(authSecret, ecdhSecret, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  const plaintext = concat(utf8(payload), new Uint8Array([2])) // son kayıt ayracı
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext))

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, ciphertext)
}

/** RFC 8292: push hizmetine kimliğimizi kanıtlayan `Authorization` başlığı. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const publicRaw = b64urlDecode(vapid.publicKey)
  if (publicRaw.length !== 65) throw new Error('VAPID_PUBLIC_KEY geçersiz')
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64urlEncode(publicRaw.slice(1, 33)), y: b64urlEncode(publicRaw.slice(33, 65)), ext: true }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const header = b64urlEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64urlEncode(utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: vapid.subject })))
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${claims}`)))
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${vapid.publicKey}`
}

/** Bilinen push hizmetleri; başka adrese istek atılmaz (sunucunun keyfi adrese istek atmasını önler). */
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'push.apple.com', 'notify.windows.com']

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

/** İletiyi gönderir; HTTP durum kodunu döner (404/410: abonelik artık geçersiz). */
export async function sendPush(sub: PushSubscriptionKeys, payload: unknown, vapid: VapidKeys, fetcher: typeof fetch = fetch): Promise<number> {
  if (!isPushEndpoint(sub.endpoint)) return 400
  const body = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth)
  const res = await fetcher(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(24 * 3600),
      Urgency: 'normal',
    },
    body,
  })
  return res.status
}
