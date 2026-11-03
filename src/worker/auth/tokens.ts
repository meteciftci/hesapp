export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64url(new Uint8Array(digest))
}

/** Süre sızıntısı olmadan eşitlik: iki değerin özetlerini karşılaştırır. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([hashToken(a), hashToken(b)])
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}
