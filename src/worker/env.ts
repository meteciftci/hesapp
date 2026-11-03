export type AuthMode = 'passkey' | 'access'

export interface Env {
  DB: D1Database
  /** `passkey` (varsayılan) ya da `access` (Cloudflare Access) */
  AUTH_MODE?: string
  /** Uygulamanın tam adresi, ör. `https://alan-adi.example`. Passkey modunda zorunlu. */
  SITE_URL?: string
  /** WebAuthn RP kimliği; verilmezse SITE_URL'deki alan adı kullanılır */
  RP_ID?: string
  /** İlk kullanıcıyı kurmak için tek seferlik gizli kod (en az 32 karakter) */
  SETUP_CODE?: string
  /** `local` yalnızca yerel geliştirmede */
  APP_ENV?: string
  /** Oturum süresi (gün), varsayılan 30 */
  SESSION_DAYS?: string
  /** Toplam kullanıcı sınırı, varsayılan 5 */
  MAX_USERS?: string

  // Access modu
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  ALLOWED_EMAILS?: string
  DEV_USER_EMAIL?: string

  TZ?: string

  // Vade bildirimi (Web Push, VAPID). `pnpm vapid` ile üretilir.
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  /** `mailto:` ya da `https:` iletişim adresi; verilmezse SITE_URL */
  VAPID_SUBJECT?: string
}

export interface AuthUser {
  id: string
  name: string
  role: 'owner' | 'member'
}

export interface SessionInfo {
  tokenHash: string
  credentialId: string
  createdAt: number
}

export interface AppVariables {
  user: AuthUser
  session?: SessionInfo
}

export type AppBindings = { Bindings: Env; Variables: AppVariables }

export function authMode(env: Env): AuthMode {
  return env.AUTH_MODE === 'access' ? 'access' : 'passkey'
}
