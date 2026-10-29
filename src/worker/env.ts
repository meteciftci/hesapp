export interface Env {
  /** Access takım alan adı, ör. `takim.cloudflareaccess.com` */
  ACCESS_TEAM_DOMAIN?: string
  /** Access uygulamasının AUD değeri */
  ACCESS_AUD?: string
  /** İsteğe bağlı: virgülle ayrılmış izinli e-postalar (ikinci kontrol) */
  ALLOWED_EMAILS?: string
  /** Yalnızca yerel geliştirme: Access yapılandırılmamışsa kullanılan sahte kullanıcı */
  DEV_USER_EMAIL?: string
  TZ?: string
}

export interface AppVariables {
  user: { email: string }
}

export type AppBindings = { Bindings: Env; Variables: AppVariables }
