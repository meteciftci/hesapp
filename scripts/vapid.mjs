// Vade bildirimi için VAPID anahtar çifti üretir. Çıktıyı Cloudflare'de Worker → Settings →
// Variables and Secrets bölümüne girin (özel anahtar Secret türünde). Depoya yazmayın.
const { subtle } = globalThis.crypto
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const b64url = (buf) => Buffer.from(buf).toString('base64url')
const publicKey = b64url(await subtle.exportKey('raw', pair.publicKey))
const privateKey = (await subtle.exportKey('jwk', pair.privateKey)).d

console.log('VAPID_PUBLIC_KEY=' + publicKey)
console.log('VAPID_PRIVATE_KEY=' + privateKey)
console.log('\nİsteğe bağlı: VAPID_SUBJECT=mailto:sizin-adresiniz (verilmezse SITE_URL kullanılır)')
