import { describe, expect, it } from 'vitest'
import { b64urlDecode, b64urlEncode, encryptPayload, isPushEndpoint, vapidAuthorization } from './webpush'

const utf8 = (s: string) => new TextEncoder().encode(s)

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** Tarayıcı tarafı: RFC 8291'e göre çözme (şifreleyiciden bağımsız yazıldı). */
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, uaPublic: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16)
  const idlen = body[20]!
  const asPublic = body.slice(21, 21 + idlen)
  const ciphertext = body.slice(21 + idlen)
  expect(rs).toBe(4096)
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, ua.privateKey, 256))
  const info = new Uint8Array([...utf8('WebPush: info\0'), ...uaPublic, ...asPublic])
  const ikm = await hkdf(auth, secret, info, 32)
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext))
  expect(plain[plain.length - 1]).toBe(2) // son kayıt ayracı
  return new TextDecoder().decode(plain.slice(0, -1))
}

describe('web push', () => {
  it('iletiyi tarayıcının çözebileceği biçimde şifreler (RFC 8291)', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const uaPublic = new Uint8Array((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer)
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const payload = JSON.stringify({ title: 'Yarın 2 ödeme', body: 'Örnek Konut Kredisi 12.345,67 ₺' })
    const body = await encryptPayload(payload, b64urlEncode(uaPublic), b64urlEncode(auth))
    expect(await decrypt(body, ua, uaPublic, auth)).toBe(payload)
  })

  it('VAPID imzası genel anahtarla doğrulanır ve hizmetin kökenini hedefler (RFC 8292)', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const publicKey = b64urlEncode(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer))
    const privateKey = ((await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey).d as string
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { publicKey, privateKey, subject: 'mailto:ornek@example.com' }, 1_000)
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!
    expect(k).toBe(publicKey)
    const [h, c, sig] = jwt!.split('.') as [string, string, string]
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_000 + 12 * 3600, sub: 'mailto:ornek@example.com' })
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64urlDecode(sig), utf8(`${h}.${c}`))
    expect(ok).toBe(true)
  })

  it('yalnızca bilinen push hizmetlerine izin verir', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true)
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
    expect(isPushEndpoint('https://web.push.apple.com/x')).toBe(true)
    expect(isPushEndpoint('http://fcm.googleapis.com/x')).toBe(false)
    expect(isPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false)
    expect(isPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false)
  })
})
