# hesapp

Hane için basit, mobil öncelikli bir gelir–gider ve taksit takip uygulaması.
Cloudflare'in ücretsiz planında (Workers + D1) kendi alan adınızda çalışacak şekilde tasarlanmıştır.
Giriş **passkey** ile yapılır: parola yok, e-posta yok; her kişi kendi cihazının parmak izi, yüz tanıma ya da PIN doğrulamasını kullanır.

> Durum: geliştirme aşamasında. Bütçe API'si hazır (M2); arayüz sırada. Plan ve yol haritası için [`docs/PLAN.md`](docs/PLAN.md).
>
> Planlanan: bütçe dönemi ayın 1'i yerine seçtiğiniz bir günde (ör. maaş günü olan 15'inde) başlayabilecek ([plan, bölüm 5.2](docs/PLAN.md)).

## Geliştirme

Gereksinimler: Node.js 22+, [pnpm](https://pnpm.io).

```sh
pnpm install
cp .dev.vars.example .dev.vars   # yerel ayarlar (depoya girmez)
pnpm dev                         # http://localhost:5173
```

İlk açılışta kurulum formu çıkar; kurulum kodu `.dev.vars` içindeki `SETUP_CODE` değeridir.

| Komut | İş |
|---|---|
| `pnpm dev` | yerel D1 migration'ı + Vite + yerel Worker |
| `pnpm test` | birim ve API testleri (sanal passkey cihazı, gerçek D1 benzetimi) |
| `pnpm typecheck` | tip denetimi |
| `pnpm build` | üretim derlemesi |

## Kurulum (kendi Cloudflare hesabınızda)

Önkoşul: alan adınızın DNS'i Cloudflare'de olmalı.

### 1. D1 veritabanını oluşturun

Cloudflare paneli → **Storage & databases → D1 → Create database**. Adı `hesapp` olsun. Oluşan veritabanının **ID** değerini not edin.

### 2. Worker'ı GitHub'a bağlayın (Workers Builds)

1. Depoyu çatallayın (fork) ya da kendi hesabınıza kopyalayın.
2. **Workers & Pages** → **Create** → **Import a repository**; GitHub hesabınızı bağlayıp depoyu seçin. Proje adı `wrangler.jsonc` içindeki `name` ile aynı olmalıdır (`hesapp`).
3. Proje → **Settings → Build**:
   - **Build command:** `pnpm build`
   - **Deploy command:** `pnpm run deploy:cf`
   - **Build variables** (derleme sırasında okunan değişkenler): `D1_DATABASE_ID` = 1. adımdaki ID. Bu değer depoya yazılmaz; derlemede `wrangler.jsonc`'ye eklenir.

> **Dikkat: iki ayrı değişken bölümü var.** *Build variables*, yalnızca derleme sırasında görünür. Çalışan uygulamanın okuduğu değişkenler (`SITE_URL`, `SETUP_CODE` gibi, 4. adım) Worker'ın **Settings → Variables and Secrets** bölümündeki **Production** değişkenleridir. Birini diğerine girmek "değişken tanımlı değil" hatası verir.

> İki komutu karıştırmayın: *Build command* alanına `pnpm run deploy:cf` yazılırsa `pnpm build` hiç çalışmaz, veritabanı kimliği yazılmaz ve migration yer tutucu kimlikle başarısız olur.

`deploy:cf` komutu önce veritabanı şemasını günceller (`wrangler d1 migrations apply`), sonra yayınlar.
Sonraki her `main` güncellemesi otomatik derlenip yayına çıkar.

### 3. Alan adı bağlayın

Worker → **Settings → Domains & Routes → Add → Custom domain** ile bir alt alan adı ekleyin (ör. `butce.ornek.com`).
`workers.dev` ve önizleme adresleri bilerek kapalıdır.

### 4. Worker değişkenlerini girin

Worker → **Settings → Variables and Secrets** → **Production** (Build bölümü değil; tür: **Secret**):

| Ad | Değer |
|---|---|
| `SITE_URL` | `https://butce.ornek.com` (3. adımdaki adres, sonunda `/` olmadan) |
| `SETUP_CODE` | parola yöneticinizle ürettiğiniz en az 32 karakterlik rastgele değer |

İsteğe bağlı: `SESSION_DAYS` (varsayılan 30), `MAX_USERS` (varsayılan 5), `RP_ID` (varsayılan: `SITE_URL` alan adı).

### 5. İlk kurulum

1. Adresi telefonunuzda açın. Kurulum formu çıkar.
2. Adınızı, `SETUP_CODE` değerini ve cihaz adını girip **Passkey oluştur**'a dokunun; cihazınızın doğrulamasını (parmak izi/yüz/PIN) tamamlayın.
3. Kurulum bittikten sonra `SETUP_CODE` değişkenini silebilirsiniz; ilk kullanıcıdan sonra kurulum zaten kapanır.
4. En az ikinci bir cihazınızı **Ayarlar → Bu cihazı ekle** ile kaydedin (telefon kaybına karşı).

### 6. Başka kişileri ekleyin

**Ayarlar → Yeni kişi davet et**: kişinin adını yazın, üretilen bağlantıyı yalnızca o kişiyle paylaşın (24 saat geçerli, tek kullanımlık). Kişi bağlantıyı kendi telefonunda açıp kendi passkey'ini oluşturur.

### Cihaz kaybı ve kurtarma

- **Bir üye cihazını kaybederse:** hesap sahibi Ayarlar'dan kişiyi çıkarıp yeniden davet eder. Kişi birden fazla cihaz kaydettiyse kaybolan cihazın anahtarını Ayarlar'dan silmesi yeterli.
- **Hesap sahibi tüm cihazlarını kaybederse:** Cloudflare hesabına erişen kişi kimlik tablolarını sıfırlayıp kurulumu yeniden yapar (bütçe verisi korunur):

  ```sh
  pnpm wrangler d1 execute DB --remote --command "DELETE FROM users"
  ```

  Ardından `SETUP_CODE` değişkenini yeniden girip adres 5. adımdaki gibi kurulur.

## Lisans

[MIT](LICENSE)
