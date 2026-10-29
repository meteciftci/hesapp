# hesapp

Hane için basit, mobil öncelikli bir gelir–gider ve taksit takip uygulaması.
Cloudflare'in ücretsiz planında (Workers + D1 + Access) kendi alan adınızda çalışacak şekilde tasarlanmıştır.

> Durum: geliştirme aşamasında (M0: iskelet). Plan ve yol haritası için [`docs/PLAN.md`](docs/PLAN.md).

## Geliştirme

Gereksinimler: Node.js 22+, [pnpm](https://pnpm.io).

```sh
pnpm install
cp .dev.vars.example .dev.vars   # yerel sahte kullanıcı (depoya girmez)
pnpm dev                         # http://localhost:5173
```

| Komut | İş |
|---|---|
| `pnpm dev` | Vite + yerel Worker |
| `pnpm test` | birim ve API testleri |
| `pnpm typecheck` | tip denetimi |
| `pnpm build` | üretim derlemesi |

### Commit kuralı

`<tür>: <kısa açıklama>` biçimi, tamamen küçük harf (ayrıntı için [plan, bölüm 13](docs/PLAN.md)).
Kural `pnpm install` ile kurulan bir git hook'u ile denetlenir.

```
feat: ay kapanışı ekranını ekle
fix: şubat ayında vade gününü düzelt
```

## Kurulum (kendi Cloudflare hesabınızda)

Önkoşul: alan adınızın DNS'i Cloudflare'de olmalı.

### 1. Worker'ı GitHub'a bağlayın (Workers Builds)

1. Depoyu çatallayın (fork) ya da kendi hesabınıza kopyalayın.
2. Cloudflare paneli → **Workers & Pages** → **Create** → **Import a repository**; GitHub hesabınızı bağlayıp depoyu seçin.
3. Proje adı `wrangler.jsonc` içindeki `name` ile aynı olmalıdır (`hesapp`).
4. Build ayarları:
   - **Build command:** `pnpm build`
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** `/`

Sonraki her `main` güncellemesi otomatik derlenip yayına çıkar.

### 2. Alan adı bağlayın

Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain** ile bir alt alan adı (ör. `butce.ornek.com`) ekleyin.
`workers.dev` ve önizleme adresleri Access'i atlatmamak için bilerek kapalıdır.

### 3. Access ile girişi koruyun

1. Cloudflare **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Uygulama alan adı olarak 2. adımdaki alt alan adını girin.
3. Bir **Allow** politikası ekleyin; yalnızca izin vereceğiniz e-postaları yazın. Giriş yöntemi olarak **One-time PIN** yeterlidir.
4. Uygulamayı kaydedin; **Application Audience (AUD) Tag** değerini kopyalayın.
5. Takım alan adınızı not edin (`<takım>.cloudflareaccess.com`; Zero Trust → Settings → Custom Pages altında görünür).

### 4. Worker değişkenlerini girin

Worker → **Settings** → **Variables and Secrets**:

| Ad | Değer |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `<takım>.cloudflareaccess.com` |
| `ACCESS_AUD` | 3. adımda kopyalanan AUD (gizli değişken olarak ekleyin) |
| `ALLOWED_EMAILS` | isteğe bağlı, virgülle ayrılmış e-postalar (ikinci kontrol) |

> `DEV_USER_EMAIL` değişkenini canlı ortamda **asla** tanımlamayın; yalnızca yerel geliştirme içindir.

Uygulama, Access'in her isteğe eklediği imzalı belgeyi (JWT) kendisi de doğrular. Bu iki değişken eksikse tüm API kapalı kalır.

## Lisans

[MIT](LICENSE)
