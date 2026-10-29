import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { api } from './api'

export const passkeysSupported = () => browserSupportsWebAuthn()

export type RegisterStart =
  | { kind: 'setup'; setupCode: string; name: string; keyName: string }
  | { kind: 'invite'; inviteToken: string; keyName: string }
  | { kind: 'device'; keyName: string }

export async function loginWithPasskey() {
  const optionsJSON = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/auth/login/options', { body: {} })
  const response = await startAuthentication({ optionsJSON })
  await api('/auth/login/verify', { body: response })
}

export async function registerPasskey(start: RegisterStart) {
  const optionsJSON = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/auth/register/options', { body: start })
  const response = await startRegistration({ optionsJSON })
  await api('/auth/register/verify', { body: response })
}

/** Cihaz türüne göre öntanımlı bir ad önerir. */
export function suggestDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android telefon'
  if (/Mac/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows bilgisayar'
  return 'Cihazım'
}
