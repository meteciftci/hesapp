# HesApp – Teknik plan

Bu belge kodlamaya başlamadan önce üzerinde anlaşılan kararları toplar. Kod bu plana göre yazılır; plan değişirse önce bu belge güncellenir.

## 1. Amaç

Bir hanenin aylık gelir ve giderlerini, kredi ve kart taksitlerini, tekrarlayan kalemleri ve ay sonu banka bakiyesini tek yerden takip etmek. Elektronik tablo ile yapılan takibin yerini alır; tekrar eden işleri (taksit sayacı, her ay aynı kalemleri kopyalama, tarih düzeltme) ortadan kaldırır.

İlkeler:

- **Mobil öncelikli.** Ana kullanım telefondan; masaüstünde de çalışır.
- **Az kişi, tam güven.** Bir hanenin birkaç üyesi kullanır; herkes her şeyi görür ve düzenler. Kim neyi değiştirdi kaydedilir.
- **Ücretsiz altyapı.** Cloudflare'in ücretsiz planı yeter.
- **Veri kullanıcınındır.** Her an tam yedek ve okunabilir Excel olarak dışa aktarılabilir.
- **Açık kaynak, kişisel veri yok.** Depoda kimseye ait alan adı, e-posta, tutar veya isim bulunmaz. Örnek veriler uydurmadır.

## 2. Kapsam

### v1

1. Ay (dönem) ekranı: gelir/gider listesi, devir, özet (elde kalan, ödenen/kalan gider). Dönem ayın 1'inde ya da seçilen bir günde (ör. 15) başlar (bölüm 5.2).
2. Plan tanımı: tekrarlayan (her ay) ve taksitli kalemler; gelir veya gider yönünde.
3. Kayıt ekleme, düzenleme, silme; toplu düzenlemede kapsam seçimi.
4. Planlanan ve gerçekleşen tutar; "tahmini" işareti (ör. ekstresi henüz kesilmemiş kart).
5. Ödendi işareti, otomatik ödeme etiketi, vade tarihi.
6. Yaklaşan ödemeler ekranı.
7. Planlar ekranı ve kredi/taksit detayı (ödeme planı yapıştırma, erken kapatma).
8. Ay kapanışı (banka bakiyesi ile eşitleme) ve devir.
9. Yıl ekranı.
10. Açık/koyu/sistem teması, PWA (ana ekrana eklenebilir).
11. Dışa aktarma (JSON tam yedek, Excel) ve içe aktarma (JSON yedek, Excel sihirbazı).
12. Değişiklik geçmişi.

### v1.1 (bölüm 14)

1. Kişi çıkarma ve cihaz silmede onay; tüm değişikliklerin tek listede görüldüğü geçmiş ekranı.
2. Kart ekstresine (ya da herhangi bir gidere) kalem kalem harcama girişi.
3. Hızlı ekleme: son kullanılan kalemlerden tek dokunuşla.
4. Kategori ve arama; yıl ekranında kategori dağılımı.
5. Kalan borç grafiği.
6. Hane görünümü: "kim ekledi" filtresi.
7. Vade yaklaşınca bildirim (Workers zamanlanmış görev + Web Push).

### Kapsam dışı

- Birden fazla para birimi ve dil seçimi (yalnızca TRY ve Türkçe).
- Bütçe hedefi / kategori limiti.

## 3. Mimari

```
Tarayıcı (PWA, React)
   │  HTTPS, passkey ile açılan oturum çerezi
   ▼
Cloudflare Worker
   ├─ statik dosyalar (derlenmiş ön yüz)
   └─ /api/*  (Hono)  ── oturum yoksa 401
         │
         ▼
      D1 (SQLite)
```

- Tek Worker hem ön yüzü hem API'yi sunar. Ayrı bir sunucu yok.
- **Kimlik doğrulama varsayılan olarak passkey ile yapılır** (bkz. bölüm 5.1). Parola ve e-posta yoktur; her kişi kendi cihazının parmak izi/yüz tanıma/PIN doğrulamasıyla girer.
- **İsteğe bağlı Access modu** (`AUTH_MODE=access`): Worker, `Cf-Access-Jwt-Assertion` başlığını Access'in açık anahtarlarıyla doğrular. Passkey uçları bu modda kapalıdır. Kendi kimlik sağlayıcısını kullanmak isteyenler içindir.
- `workers.dev` ve önizleme adresleri kapalıdır; uygulama yalnızca bağlanan özel alan adından erişilir.
- Excel okuma/yazma tarayıcıda yapılır; Worker'ın CPU limitine yük binmez.

## 4. Teknoloji

| Katman | Seçim | Neden |
|---|---|---|
| Dil | TypeScript (her yerde) | Ön yüz ve API aynı tipleri paylaşır |
| Ön yüz | React + Vite | Yaygın, Cloudflare Vite eklentisiyle tek projede Worker ile birlikte geliştirilir |
| Arayüz | Tailwind CSS + shadcn/ui (Radix) | Erişilebilir hazır bileşenler, alttan açılan paneller, tema değişkenleri |
| Sunucu durumu | TanStack Query | Önbellek, iyimser güncelleme ("ödendi" anında işlenir) |
| Yönlendirme | React Router | |
| API | Hono | Workers için hafif, tip güvenli |
| Veritabanı | D1; elle yazılmış SQL migration dosyaları + D1 API'si | Tetikleyici, kısıt ve tek ifadelik koşullu yazma (atomik korumalar) doğrudan SQL ile; ek bağımlılık yok |
| Kimlik doğrulama | WebAuthn / passkey (`@simplewebauthn`) | Parolasız, kimlik avına dayanıklı; kütüphane doğrulamayı yapar |
| Doğrulama | Zod | Aynı şema hem API girişini hem formları doğrular |
| Tarih | date-fns (tr yerel ayarı) | |
| Grafik | Recharts | |
| Excel | ExcelJS (tarayıcıda) | MIT lisanslı, okuma ve yazma |
| PWA | vite-plugin-pwa | Ana ekrana ekleme, çevrimdışı kabuk |
| Test | Vitest, Workers için `@cloudflare/vitest-pool-workers` | Alan mantığı ve API testleri gerçek D1 benzetimiyle |
| Paket yöneticisi | pnpm | |

## 5. Veri modeli

Genel kurallar:

- **Para** kuruş cinsinden tam sayı (`INTEGER`) saklanır. Ekranda `12.345,67 ₺` biçiminde gösterilir. Kayan noktalı sayı kullanılmaz.
- **Ay** `YYYY-AA` metni (`2026-11`). **Tarih** `YYYY-AA-GG`. **Zaman damgası** ISO 8601, UTC.
- Saat dilimi yapılandırmadan gelir (varsayılan `Europe/Istanbul`); "bugün" ve "yaklaşan" hesapları buna göre yapılır.
- Kimlikler ULID.
- Silme yumuşaktır (`deleted_at`); geri alma ve geçmiş için.

### 5.1 Kimlik doğrulama modeli (passkey)

- **İlk kurulum:** Worker'a gizli değişken olarak `SETUP_CODE` (en az 32 karakter) girilir. Kullanıcı yokken kurulum sayfasında bu kodla hesap sahibi ve ilk passkey oluşturulur. Kullanıcı oluştuktan sonra kurulum kalıcı olarak kapanır; kod silinebilir.
- **Davet:** Hesap sahibi Ayarlar'dan bir kişi adı için tek kullanımlık, 24 saat geçerli davet bağlantısı üretir (`/davet#<belirteç>`; belirteç adres parçasında olduğundan sunucu kaydına girmez). Davetli kendi cihazında passkey oluşturarak üye olur.
- **Cihaz ekleme:** Her kişi birden fazla cihaz (en çok 10) kaydedebilir. Cihaz ekleme/silme, davet ve kişi çıkarma işlemleri son 10 dakika içinde passkey ile girilmiş taze oturum ister.
- **Giriş:** Keşfedilebilir kimlik bilgileri (usernameless): cihaz hangi hesabın kullanılacağını kendisi seçtirir. Kullanıcı doğrulaması (UV) zorunludur.
- **Oturum:** Sunucuda saklanan rastgele belirteç (yalnızca özeti tutulur), `__Host-` önekli, `HttpOnly; Secure; SameSite=Strict` çerez; varsayılan 30 gün (`SESSION_DAYS`). Çıkışta ve kişi/cihaz silinince sunucuda geçersizleşir.
- **Koruma:** Durum değiştiren isteklerde Origin ve özel başlık denetimi (CSRF), IP ve genel hız sınırı, tarayıcıya bağlı tek kullanımlık doğrulama istekleri (challenge), sayaç denetimi. Kurulum, davet ve cihaz ekleme yarışları tek SQL ifadesinde koşullu yazmayla çözülür.
- **Kurtarma:** Bir kişinin tüm cihazını kaybetmesi: hesap sahibi kişiyi çıkarıp yeniden davet eder. Hesap sahibinin tüm cihazlarını kaybetmesi: Cloudflare hesabına erişimi olan kişi `wrangler d1 execute DB --remote --command "DELETE FROM users"` ile kimlik tablolarını sıfırlar (bütçe verisi korunur), `SETUP_CODE`'u yeniden girip kurulumu tekrarlar. Kök güven, Cloudflare hesabının kendisidir.

### 5.2 Dönem (bütçe ayı)

Bir hane için "ay" çoğu zaman takvim ayı değildir: maaş 15'inde yatıyorsa bütçe 15'inde başlar, ertesi ayın 14'ünde biter. Bu yüzden her yerde "ay" dediğimiz şey aslında **dönemdir**.

- **Ayar:** hane düzeyinde `periodStartDay` (1–28, varsayılan 1). `settings` tablosunda tutulur (`0003_settings.sql`); `GET/PUT /settings`. Her ay yanıtı (`/months/:ay`, `/years/:yıl`) dönemin `start` ve `end` tarihlerini taşır.
- **Adlandırma:** dönem, başladığı ayın etiketiyle anılır. `2026-10` ve başlangıç günü 15 ise dönem **15 Eki 2026 – 14 Kas 2026**'dır. (Mevcut Excel dosyasındaki sayfalar da böyle: "Ağustos" sayfası 15 Ağustos–1 Eylül arasını kapsar.) Başlangıç günü 1 ise dönem takvim ayıyla aynıdır.
- **Plan günü → vade:** plandaki gün `d` ise `d ≥ periodStartDay` olduğunda vade dönemin ilk ayında, `d < periodStartDay` olduğunda ertesi ayda olur. Ayın uzunluğuna sıkıştırma aynen geçerlidir. Örnek (başlangıç 15): gün 24 → 24 Eki; gün 1 → 1 Kas; gün 31 → 31 Eki; gün 5 → 5 Kas.
- **Dönemin aralığı:** kayıt vadesi, kaydın döneminin başlangıç ve bitiş tarihleri arasında olmalıdır (şu anki "aynı ay içinde olmalı" denetiminin yerine geçer).
- **Bugün hangi dönemde:** bugünün günü `periodStartDay` ve sonrasıysa o ayın etiketi, öncesiyse bir önceki ayın etiketidir. "Gelecek dönem kapatılamaz", "ufuk" ve "yaklaşan" hesapları buna göre çalışır; "yaklaşan" zaten vade tarihine bakar.
- **Devir, kapanış, plan kayıtları** dönem etiketlerinin düz bir ay dizisi olarak ilerlemesiyle aynen çalışır; bölüm 6'daki kurallar değişmez.
- **Değiştirme:** kapalı dönem yokken değiştirilebilir (varsa 409); geçmiş kapanışların tutarlılığı için. Değişince plana bağlı kayıtlar yeniden yerleştirilir: elle düzenlenmemişler plan gününe göre hesaplanır; elle düzenlenmişlerde (tutarı vb. değişmiş) kullanıcının seçtiği gün korunur, yalnızca yeni dönemin dışında kalıyorsa dönemin içine alınır. Plansız (tek seferlik) kayıtların tarihine dokunulmaz; yeni dönemin dışında kalanların sayısı yanıtta `outsidePeriod` olarak döner ve arayüz bunları uyarı olarak gösterir. Değişiklik `audit_log`'a (`settings`) yazılır.
- **Arayüz:** dönem gezgini başlıkta tarih aralığını gösterir ("15 Eki – 14 Kas"), yıl ekranı dönem sırasıyla listeler, ilk kurulumda başlangıç günü sorulur. Dönem seçimi hem ileri/geri oklarla hem de listeden yapılır.
- **Yedek/içe aktarma:** yedek dosyası `periodStartDay`'i taşır. Excel sihirbazında her sayfa bir dönem etiketine eşlenir.

### Temel ayrım: plan ve kayıt

- **Plan**, tekrar eden bir şeyin tanımıdır: "her ay 15'inde, 84 taksit, şu tutar".
- **Kayıt** (entry), belirli bir aydaki tek satırdır: "Kasım, 13. taksit, şu tutar, ödendi".
- Plan oluşturulunca kayıtları üretilir. Her kayıt sonradan tek başına düzenlenebilir.
- Plana bağlı olmayan kayıtlar tek seferliktir.

### Tablolar

**users** (migration `0001_auth.sql`)

| alan | tip | not |
|---|---|---|
| id | text PK | rastgele UUID; WebAuthn kullanıcı tanıtıcısı |
| name | text | görünen ad |
| role | `owner` \| `member` | tek hesap sahibi, diğerleri üye |
| created_at | integer | ms |

Diğer kimlik tabloları: `passkeys`, `auth_sessions`, `auth_invites`, `auth_challenges`, `auth_limits` (bkz. 5.1). Bütçe tablolarındaki `created_by`/`updated_by`/`user_id` alanları kullanıcı kimliğini düz metin olarak taşır (bilerek yabancı anahtar yok); kişi çıkarılsa da kayıtlar ve geçmiş kalır, ad bulunamazsa kimlik gösterilir. Şema: `migrations/0002_budget.sql`.

**plans**

| alan | tip | not |
|---|---|---|
| id | text PK | |
| direction | `income` \| `expense` | |
| kind | `recurring` \| `installment` | tekrarlayan / taksitli |
| name | text | |
| amount | integer | varsayılan tutar (kuruş) |
| day_of_month | integer 1–31 | ay kısaysa ayın son günü |
| start_month | text | |
| installment_count | integer null | yalnızca taksitlide |
| end_month | text null | tekrarlayan için isteğe bağlı bitiş |
| variable | boolean | tutar her ay değişir (ör. kart ekstresi); kayıtlar "tahmini" doğar |
| auto_pay | boolean | |
| note | text null | |
| closed_at | integer null | erken kapatma / sonlandırma |
| created_by, updated_by | text | kullanıcı kimliği |
| created_at, updated_at, deleted_at | integer | ms |

**entries**

| alan | tip | not |
|---|---|---|
| id | text PK | |
| month | text | hangi aya ait |
| plan_id | text null FK | |
| installment_no | integer null | taksitlide sıra no |
| type | `normal` \| `reconciliation` | kapanış farkı özel kayıttır; devir kayıt değil, hesaplanan değerdir (6.5) |
| direction | `income` \| `expense` | |
| name | text | |
| planned_amount | integer | |
| actual_amount | integer null | gerçekleşen; boşsa planlanan geçerli |
| is_estimate | boolean | |
| due_date | text null | |
| paid_at | text null | ödendi / tahsil edildi |
| auto_pay | boolean | |
| overridden | boolean | plandan farklı elle düzenlendi |
| note | text null | |
| created_by, updated_by | text | kullanıcı kimliği |
| created_at, updated_at, deleted_at | text | |

Bir ayın toplamlarında `actual_amount ?? planned_amount` kullanılır.

**months**

| alan | tip | not |
|---|---|---|
| month | text PK | |
| status | `open` \| `closed` | |
| opening_balance | integer | devir; ilk ay için kurulumda girilir |
| anchor_balance | integer null | uygulamaya başlanan ayda elle girilen başlangıç bakiyesi (aynı anda tek ay) |
| opening_balance | integer null | kapanış anındaki devir (anlık görüntü) |
| closing_balance | integer null | kapanışta girilen banka bakiyesi |
| closed_at, closed_by | | |

**audit_log**

| alan | tip | not |
|---|---|---|
| id | text PK | |
| entity | `plan` \| `entry` \| `month` \| `settings` | |
| entity_id | text | |
| action | `create` · `update` · `delete` · `restore` · `pay` · `unpay` · `close` · `reopen` · `opening` · `schedule` | |
| before, after | text (JSON) | |
| user_id | text | |
| at | integer | ms |

## 6. Kurallar (alan mantığı)

Bu bölüm testlerin de kaynağıdır.

### 6.1 Kayıt üretimi

- **Taksitli plan:** oluşturulunca `installment_count` kadar kaydın tamamı üretilir.
- **Tekrarlayan plan:** bugünden itibaren 12 ay ileriye kadar üretilir. Daha ileri bir ay açıldığında eksik kayıtlar o anda tamamlanır.
- Geçmiş tarihli plan girilirse "geçmiş taksitleri ödendi say" seçeneği sunulur.
- `day_of_month` o ayda yoksa (31 Şubat gibi) ayın son günü kullanılır.

### 6.2 Düzenleme kapsamı

Plana bağlı bir kaydın tutarı, günü veya adı değiştirildiğinde sorulur:

- **Sadece bu:** yalnız bu kayıt değişir, `overridden = true`.
- **Bu ve sonrakiler:** bu ve sonraki aylardaki ödenmemiş kayıtlar ile planın varsayılanı değişir.
- **Tümü:** plandaki tüm ödenmemiş kayıtlar ve planın varsayılanı değişir.

Ödenmiş kayıtlar toplu değişiklikte asla değişmez. Kapalı aylardaki kayıtlar değişmez (önce ay yeniden açılır).

### 6.3 Ödeme planı yapıştırma

Bankanın ödeme tablosundan kopyalanan tutarlar (her satıra bir tutar, Türkçe veya İngilizce sayı biçimi) sırayla taksitlere yazılır. Satır sayısı taksit sayısıyla uyuşmazsa uyarılır, onay istenir.

### 6.4 Erken kapatma

Seçilen aydan sonraki ödenmemiş kayıtlar silinir, plan `closed_at` alır. İsteğe bağlı olarak o aya tek seferlik "kapatma tutarı" kaydı eklenir.

### 6.5 Ay bakiyesi ve devir

```
olması gereken kapanış = açılış (devir) + gelirler − giderler
```

- Devir bir kayıt değildir, hesaplanır; API ay yanıtında `opening: { amount, provisional }` olarak verir, arayüz listenin başında satır olarak gösterir (artı veya eksi).
- Hesap: hedeften önceki **en son kapalı ayın banka bakiyesi** + aradaki ayların net toplamı. Kapalı ay yoksa **başlangıç bakiyesi (anchor)** + aradaki aylar. İkisi de yoksa 0.
- Aradaki ay varsa (önceki ay henüz kapatılmamışsa) devir "geçici"dir; önceki ay kapanınca banka bakiyesiyle kesinleşir.
- Uygulamaya başlanan ayın açılışı `PUT /months/:ay/opening` ile bir kez girilir (kapanmış ay varken değiştirilemez). İçe aktarılan geçmiş aylar için devir 0 alınır.
- Bir aylık toplam, her kaydın geçerli tutarından (`actual ?? planned`) hesaplanır; silinmiş kayıtlar sayılmaz.

### 6.6 Ay kapanışı (eşitleme)

1. Kullanıcı ay sonunda bankadaki toplam bakiyeyi girer (KMH kullanıldıysa eksi).
2. `fark = olması gereken − banka bakiyesi`
   - fark > 0 ise "Kayıt dışı harcamalar" adında bir **gider** (`reconciliation`) eklenir.
   - fark < 0 ise aynı adla bir **gelir** (`reconciliation`) eklenir.
   - fark = 0 ise kayıt eklenmez.
3. Ay `closed` olur, sonraki ayın açılışı = banka bakiyesi.
   - Kapanış sırası zorunludur: yalnızca son kapalı ayın ardındaki (ya da ilk kapanışta başlangıç bakiyesinin girildiği) ay, ve en geç içinde bulunulan ay kapatılabilir. Başlangıç bakiyesi geçmiş bir aya da girilebilir (Başlangıç ayarları → Başlangıç ayı); geriye dönük veri girerken ilk kapanış o aydan başlar.
   - Kapalı aydaki kayıtlar değiştirilemez; toplu düzenlemelerde atlanır.
4. **Yeniden açma:** yalnızca en son kapatılan ay yeniden açılabilir. Eşitleme kaydı silinir, sonraki ayın devri yeniden geçici olur.

### 6.7 Geri alma

Silme sonrası birkaç saniye "Geri al" sunulur (yumuşak silme sayesinde). Her değişiklik `audit_log`'a yazılır.

## 7. API

Tümü `/api` altında, JSON, Zod ile doğrulanır.

| Yöntem | Yol | İş |
|---|---|---|
| GET | `/me` | oturumdaki kullanıcı (`id`, `name`, `role`) |
| GET | `/auth/state` | herkese açık: kip ve kurulum yapılmış mı |
| POST | `/auth/login/options` · `/auth/login/verify` | passkey ile giriş |
| POST | `/auth/register/options` · `/auth/register/verify` | `kind`: `setup`, `invite` ya da `device` |
| POST | `/auth/logout` | |
| GET/DELETE | `/auth/passkeys` · `/auth/passkeys/:id` | kendi cihazların |
| GET/DELETE | `/auth/members` · `/auth/members/:id` | kişiler; çıkarma yalnızca hesap sahibine |
| POST | `/auth/invites` | davet bağlantısı belirteci üretir (hesap sahibi) |
| GET | `/months/:month` | ayın kayıtları, devir, toplamlar, durum (eksik tekrarlayan kayıtları tamamlar) |
| PUT | `/months/:month/opening` | `{ balance }` başlangıç bakiyesi |
| GET/PUT | `/settings` | `{ periodStartDay }`; PUT kapalı dönem varken 409, yanıt `recalculated` ve `outsidePeriod` sayılarını verir |
| POST | `/months/:month/close` | `{ bankBalance }` ile kapanış |
| POST | `/months/:month/sync` | `{ bankBalance }` ile ay içi bakiye eşitleme; ay açık kalır (bkz. 14.10) |
| POST | `/months/:month/reopen` | |
| GET | `/upcoming?days=30` | yaklaşan ödemeler |
| GET | `/years/:year` | aylık özetler |
| GET/POST | `/plans` | listele / oluştur |
| GET | `/plans/debt?plan=` | kalan borç zaman çizelgesi (14.5) |
| GET/DELETE | `/plans/:id` | detay (kayıtlarıyla) / sil. Plan alanları kayıt düzenlemesinde `following`/`all` kapsamıyla güncellenir |
| POST | `/plans/:id/schedule` | ödeme planı yapıştırma: `{ text \| amounts, startNo?, force?, dryRun? }` |
| POST | `/plans/:id/close` | erken kapatma: `{ fromMonth, payoffAmount? }` |
| POST | `/plans/:id/estimate` | değişken tutarlı planın (kart) tahmini: `{ amount }`; bu dönemden itibaren girilmemiş tahminler güncellenir |
| POST | `/plans/:id/backfill` | kapalı aylarda oluşmamış plan kayıtlarını ödenmiş olarak ekler (bkz. 14.9) |
| POST | `/entries` | tek seferlik kayıt |
| PATCH | `/entries/:id` | `{ ..., scope: "this" \| "following" \| "all" }` |
| POST | `/entries/:id/pay` · `/unpay` | |
| DELETE | `/entries/:id` · POST `/entries/:id/restore` | |
| GET | `/audit?entity=&id=` | değişiklik geçmişi |
| GET | `/audit/recent?before=&limit=` | tüm değişiklikler, sayfalı (14.1) |
| GET | `/entries/recent` | hızlı ekleme önerileri (14.3) |
| GET/POST | `/categories` | kategoriler (14.4) |
| PATCH/DELETE | `/categories/:id` | silme yumuşaktır; kayıtlar kategorisiz kalır |
| GET | `/search?q=&category=&from=&to=` | arama (14.4) |
| GET/POST | `/entries/:id/items` | gider kalemleri (14.2) |
| PATCH/DELETE | `/entries/:id/items/:itemId` | |
| POST | `/data/wipe` | `{ confirm: true }` ile tüm bütçe verisini siler (hesap sahibi) |
| GET | `/push/key` | bildirim için genel VAPID anahtarı (yoksa `null`) |
| POST | `/push/subscribe` · `/push/unsubscribe` · `/push/test` | cihaz aboneliği ve deneme bildirimi (14.7) |
| GET | `/export` | JSON tam yedek |
| POST | `/import?replace=1` | JSON yedeği geri yükleme; `replace=1` ile mevcut veri yedekle değiştirilir |

## 8. Ekranlar

Mobilde alt kısımda yüzen menü (Ay, Yaklaşan, Planlar, Yıl) ve yanında yuvarlak "+" butonu.

1. **Ay:** başlık ve ay geçişi, ayarlar; özet kartı; "Ayı kapat" bağlantısı; Giderler/Gelirler sekmeleri; vade sırasına göre liste. Satıra dokunma: ödendi; uzun basma veya kaydırma: düzenle.
2. **Yaklaşan:** önümüzdeki 30 gün; tahmini tutarlar için uyarı.
3. **Planlar:** Krediler, Kartlar, Tekrarlayan, Alacaklar sekmeleri; aylık kredi yükü ve kalan taksit toplamı.
4. **Plan detayı:** özet, ödeme planı yapıştır, erken kapat, taksit tablosu.
5. **Yeni ekle (alt panel):** gelir/gider, tek sefer/her ay/taksitli, ad, tutar, sayı, ilk ay, gün, otomatik ödeme, önizleme.
6. **Düzenle (alt panel):** planlanan/gerçekleşen, vade, ödendi, kapsam seçimi, kim ekledi/düzenledi, sil.
7. **Yıl:** toplamlar, ay sonu kalan çubukları.
8. **Ayı kapat (alt panel):** hesap dökümü, banka bakiyesi, fark ve devir önizlemesi.
9. **Ayarlar:** tema, dışa/içe aktarma, kullanıcı adı.
10. **Giriş, ilk kurulum ve davet:** passkey ile giriş; kullanıcı yoksa kurulum formu (ad, kurulum kodu, cihaz adı); davet bağlantısıyla katılım. (M1'de yapıldı.) Başlangıç ayı ve açılış bakiyesi sihirbazı M5'te eklenir.

Tema: açık, koyu, sistem; seçim cihazda saklanır.

## 9. Dışa ve içe aktarma (çıkış planı)

- **JSON tam yedek:** `{ "format": "hesapp-backup", "version": 3, "exportedAt", "data": { settings, users, categories, plans, entries, entryItems, months, auditLog } }`. Biçim sürümlüdür; geri yükleme eski sürümleri dönüştürür.
- **Excel (.xlsx):** her ay bir sayfa (açılış, gelirler, giderler, kapanış) ve bir "Planlar" sayfası. Uygulama kapansa bile okunabilir kalır.
- **Veritabanı dökümü:** `wrangler d1 export` ile SQL dosyası (README'de anlatılır).
- **Excel içe aktarma sihirbazı:** dosya seçilir, her sayfa bir aya eşlenir, ad/tutar/tarih sütunları seçilir, satırlar gelir veya gider olarak işaretlenir, önizlenir, içe aktarılır. Belirli bir dosya düzenine bağlı kod yazılmaz.

## 10. Yapılandırma ve dağıtım

Depoda kişisel değer yoktur. Gerekenler:

| Ad | Nerede | İş |
|---|---|---|
| `SITE_URL` | Worker gizli değişkeni | uygulamanın tam adresi (`https://…`); passkey için zorunlu |
| `SETUP_CODE` | Worker gizli değişkeni | ilk kurulum kodu (≥32 karakter); kurulumdan sonra silinebilir |
| `RP_ID` | Worker değişkeni (isteğe bağlı) | varsayılan: `SITE_URL` alan adı |
| `SESSION_DAYS`, `MAX_USERS` | Worker değişkeni (isteğe bağlı) | varsayılan 30 gün, 5 kişi |
| `D1_DATABASE_ID` | **Build** değişkeni | derlemede `wrangler.jsonc`'ye yazılır; depoda yoktur |
| `AUTH_MODE=access`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_EMAILS` | Worker (isteğe bağlı) | yalnızca Access modunda |
| `TZ` | Worker değişkeni | varsayılan `Europe/Istanbul` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Worker gizli değişkeni (isteğe bağlı) | vade bildirimi; `pnpm vapid` üretir |
| `VAPID_SUBJECT` | Worker değişkeni (isteğe bağlı) | `mailto:` ya da `https:` iletişim adresi; varsayılan `SITE_URL` |

- Depodaki `wrangler.jsonc` yalnızca yer tutucu içerir. Alan adına özgü değerler (Access takım alanı, AUD, izinli e-postalar) Cloudflare panelinde Worker'ın "Variables and Secrets" bölümüne girilir.
- `wrangler.jsonc`'de `keep_vars: true` vardır; panelden girilen değişkenler dağıtımda silinmez. Yine de hassas olanlar Secret türüyle girilir.
- Özel alan adı Cloudflare panelinden bağlanır, kodda yer almaz.
- **Dağıtım:** GitHub Actions kullanılmaz. Cloudflare'in Git bağlantısı (Workers Builds) depoyu izler; `main`'e her birleştirmede derler (`pnpm build`) ve yayınlar (`npx wrangler deploy`). Testler geliştirme sırasında yerelde/oturumda çalıştırılır, birleştirmeden önce geçmesi şarttır.
- **D1 şema güncellemeleri:** Workers Builds'te dağıtım komutu `pnpm run deploy:cf` olur (`wrangler d1 migrations apply DB --remote && wrangler deploy`). Build komutu `pnpm build` (D1 kimliğini `D1_DATABASE_ID` build değişkeninden yazar).
- Yerel geliştirme: `pnpm dev` (yerel D1 migration'ı + Vite). `.dev.vars` ile `APP_ENV=local`, `localhost` adresi ve örnek kurulum kodu kullanılır.
- `pnpm seed`: uydurma örnek veri (ör. "Örnek Konut Kredisi", "Maaş A").

README'de adım adım: depoyu çatallama, D1 oluşturma, build/deploy komutları, özel alan adı, gizli değişkenler, ilk kurulum.

## 11. Test

- **Birim:** kayıt üretimi, ay sonu günü düzeltmesi, kapsamlı düzenleme, ödeme planı ayrıştırma, kapanış/yeniden açma, devir zinciri, para biçimlendirme ve ayrıştırma.
- **API:** Workers test havuzunda gerçek D1 benzetimiyle uç noktalar ve JWT doğrulama.
- **Yedek döngüsü:** dışa aktar → boş veritabanına içe aktar → aynı sonuç.
- Her pull request'ten önce çalıştırılır (`pnpm test`, `pnpm typecheck`, `pnpm build`).

## 12. Geliştirme sırası

| Adım | İçerik | Bitti sayılması için |
|---|---|---|
| M0 | Proje iskeleti, commit denetimi, dağıtım yapılandırması, Access doğrulama | Boş uygulama alan adında açılıyor ✔ |
| M1 | D1 bağlantısı, migration altyapısı, passkey girişi (kurulum, davet, cihaz yönetimi), giriş/ayarlar ekranları | Kurulum → davet → giriş akışı gerçek tarayıcıda ve testlerle çalışıyor ✔ |
| M2 | Bütçe şeması, alan mantığı (bölüm 6), API | Bölüm 6'nın testleri geçiyor ✔ |
| M2.1 | Dönem başlangıç günü: `settings`, vade/dönem hesapları, API'de dönem aralığı (bölüm 5.2) | Başlangıç 15 iken planlar, kapanış ve yaklaşan doğru dönemlerde ✔ |
| M3 | Dönem ekranı, ekle/düzenle/sil, ödendi, tema | Telefonda bir ay baştan sona yönetilebiliyor ✔ |
| M4 | Planlar, plan detayı, yaklaşan | Kredi tanımlanıp taksitleri izlenebiliyor ✔ |
| M5 | Ay kapanışı, devir, ilk kurulum (başlangıç bakiyesi) | Bir ay kapatılıp sonraki doğru devirle açılıyor ✔ |
| M6 | Yıl ekranı, PWA, değişiklik geçmişi | Yıl ekranı, ana ekrana eklenebilir kabuk ve kayıt/plan geçmişi çalışıyor ✔ |
| M7 | JSON yedek/geri yükleme, Excel dışa aktarma, Excel içe aktarma sihirbazı | Yedek döngüsü testi geçiyor ✔ |
| M8 | README kurulum rehberi son hâli, sürüm 1.0 | Başka biri depodan kendi kurulumunu yapabiliyor ✔ |

| M9 | Onaylar ve genel değişiklik geçmişi (14.1) | ✔ |
| M10 | Gider kalemleri (14.2) | ✔ |
| M11 | Hızlı ekleme (14.3) | ✔ |
| M12 | Kategori ve arama (14.4) | ✔ |
| M13 | Kalan borç grafiği (14.5) | ✔ |
| M14 | Hane görünümü (14.6) | ✔ |
| M15 | Vade bildirimi (14.7) | ✔ |

Her adım ayrı bir commit (ya da pull request) olarak gelir.

## 13. Commit ve dal kuralları

[Conventional Commits](https://www.conventionalcommits.org/) biçimi kullanılır:

```
<tür>: <kısa açıklama>

<isteğe bağlı ayrıntılı açıklama>
```

- Başlık tamamen **küçük harf**, en fazla 72 karakter, sonunda nokta yok.
- Türkçe yazılır, emir kipiyle: `feat: ay kapanışı ekranını ekle`.
- Ayrıntı gerekiyorsa bir boş satırdan sonra gövdeye yazılır; gövde serbest biçimlidir.

| Tür | Kullanım |
|---|---|
| `feat` | yeni özellik |
| `fix` | hata düzeltme |
| `docs` | yalnızca belge |
| `refactor` | davranışı değiştirmeyen kod düzenlemesi |
| `test` | test ekleme veya düzeltme |
| `style` | biçim, boşluk (davranış değişmez) |
| `perf` | performans |
| `ci` | derleme ve dağıtım yapılandırması |
| `chore` | bağımlılık, yapılandırma, diğer |

Geriye uyumsuz değişiklikte tür sonrasına `!` eklenir: `feat!: yedek biçimini 2. sürüme geçir`.

- Dal adları: `<tür>/<kısa-ad>`, ör. `feat/ay-kapanisi`.
- Pull request başlıkları da aynı biçimdedir; birleştirme "squash" ile yapılır, böylece `main`'de her PR tek bir kurala uygun commit olur.
- Commit mesajları yerel bir git hook'u (husky + commitlint) ile denetlenir; kurala uymayan commit oluşmaz. Pull request başlıkları aynı kuralla elle yazılır.

## 14. v1.1 ayrıntıları

### 14.1 Onaylar ve genel geçmiş

- Kişi çıkarma ve cihaz silme uygulama içi onay penceresi ister (tarayıcının `confirm` penceresi kullanılmaz).
- `GET /audit/recent?before=&limit=`: tüm değişiklikler, yeniden eskiye; her satır kaydın/planın adını ve dönemini taşır. Ayarlar'dan açılan "Değişiklik geçmişi" ekranı güne göre gruplar.

### 14.2 Gider kalemleri (kart ekstresi)

- Tablo `entry_items` (migration `0004`): `id`, `entry_id`, `name`, `amount` (kuruş), `date` (isteğe bağlı), `installment_no` / `installment_count` (isteğe bağlı, ör. 3/6), `created_by`, `created_at`, `updated_at`.
- Yalnızca giderlere kalem eklenir. Kaydın tutarı her zaman **ekstre toplamıdır** (`gerçekleşen ?? planlanan`); kalemler ay toplamına ayrıca eklenmez.
- Kalem girmek isteğe bağlıdır. Arayüz "girilen kalemler", "diğer (girilmemiş)" ve "ekstre toplamı"nı gösterir.
- Gerçekleşen tutar boşken kalemlerin toplamı planlanan (tahmini) tutarı aşarsa planlanan tutar kalem toplamına yükseltilir; tahmin hiçbir zaman kalemlerin altında kalmaz. Gerçekleşen tutar girilmişken kalemler aşarsa yalnızca uyarı verilir.
- Kapalı dönemde kalem değişmez. Yedek biçimi 2. sürüme geçer (`entryItems`); 1. sürüm yedekler aynen yüklenir.
- API: `GET/POST /entries/:id/items`, `PATCH/DELETE /entries/:id/items/:itemId`.

### 14.3 Hızlı ekleme

- `GET /entries/recent`: son 120 günde tek seferlik eklenen kalemlerin adları (en sık ve en yeni önce), son tutar, yön ve kategorisiyle. "+" panelinde çip olarak görünür; dokununca form dolar.

### 14.4 Kategori ve arama

- Tablo `categories` (`id`, `name`, `direction`: `income`/`expense`/`both`, `sort`, `deleted_at`); hazır liste migration ile gelir, Ayarlar'dan eklenir, adı değiştirilir, silinir (silinen kategorideki kayıtlar kategorisiz kalır).
- `entries.category_id`, `plans.category_id`. Plandan üretilen kayıtlar planın kategorisini alır; kapsamlı düzenleme kategoriyi de taşır.
- `GET /search?q=&category=&from=&to=`: ad ve notta arama, en çok 200 sonuç ve toplamı. Arama ekranı Ay başlığından açılır.
- Yıl yanıtı `categories: [{ id, name, expense }]` taşır; yıl ekranı gider dağılımını gösterir.

### 14.5 Kalan borç grafiği

- `GET /plans/debt`: ödenmemiş taksitli gider planlarının dönem dönem kalan toplamı. Planlar ekranında toplam, plan detayında o planın grafiği.

### 14.6 Hane görünümü

- Ay ekranında "Herkes / kişi" filtresi (`created_by`); satırlarda ekleyenin baş harfi.

### 14.7 Vade bildirimi

- Tablo `push_subscriptions` (`endpoint`, anahtarlar, `user_id`, `created_at`). Ayarlar'dan cihaz başına açılır/kapanır.
- Worker zamanlanmış görevi her gün 09:00'da (İstanbul) çalışır, ertesi gün vadesi gelen ödenmemiş kayıtları her aboneye tek bildirimde gönderir.
- Web Push şifreleme (RFC 8291) ve VAPID (RFC 8292) WebCrypto ile yazılır; ek bağımlılık yok. Gerekenler: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (Secret), isteğe bağlı `VAPID_SUBJECT`. `pnpm vapid` anahtar üretir.

### 14.8 Kredi kartı tanımı

- `plans.is_card` (migration `0007_cards.sql`): kart, her ay tekrarlayan ve tutarı değişen bir gider planıdır (`card: true` yalnızca `recurring` + `expense` ile kabul edilir, `variable` kendiliğinden açılır). Yeni kayıt panelinde "Kart" seçeneği: kart adı, isteğe bağlı tahmini ekstre, son ödeme günü, ilk ekstre ayı, otomatik ödeme; kategori varsayılanı "Kredi kartı".
- Her dönem kartın ekstre kaydı tahmini doğar. Ay ekranında ekstresi girilmemiş kart satırında "Ekstre gir" (kart olmayan değişken kayıtlarda "Tutarı gir") kısayolu tek alanlı bir panel açar; tutar `actualAmount` olarak yazılır, kayıt kesinleşir.
- Kart detayı: bu döneme kadarki ekstreler (Girildi / Tahmini / Ödendi), son ve ortalama ekstre, "Kartı iptal et". İptalde seçilen ay son ekstre olarak kalır; `POST /plans/:id/close` sonraki aydan itibaren ödenmemiş kayıtları siler, `end_month` son ekstre ayı olur ve yeni kayıt üretilmez.
- Tahmini ekstre kart detayından değiştirilir ("Ortalamayı kullan" kısayolu var): `POST /plans/:id/estimate { amount }` planın tutarını günceller; bu dönemden itibaren girilmemiş, ödenmemiş ve elle değiştirilmemiş tahmini kayıtlar yeni tutarı alır.
- Planlar → Kartlar sekmesi açık kartları, altında "İptal edilmiş kartlar"ı soluk gösterir. Yedek biçimi değişmez (sürüm 3); `is_card` olmayan eski yedekler 0 ile yüklenir.

### 14.9 Kapalı aylarda düzeltme

- Kapalı ayın kapanış bakiyesi bankadaki bakiyedir ve değişmez. Kapalı ayda kayıt eklenir ya da silinirse net değişim, ayın kapanış farkı kaydına ("Kayıt dışı harcamalar") yansıtılır; kayıt yoksa oluşturulur, sıfırlanırsa silinir. Sonraki ayların devri etkilenmez.
- `GET /plans/:id` → `missingClosed`: ay kapalı olduğu için hiç oluşmamış plan kayıtlarının ayları (silinmiş kayıtlar sayılmaz, yani bilerek silinen geri gelmez). Plan detayında "N taksit kapalı aylarda oluşmadı" satırı `POST /plans/:id/backfill` ile bunları ödenmiş olarak ekler.
- `DELETE /entries/:id?closed=1`: kapalı aydan kayıt silme (ör. yanlış girilip silinen planın kapalı aylarda kalan kayıtları). Kayıt düzenleme panelinde kapalı ayda yalnızca "Kapalı aydan sil" görünür; geri alma yoktur.

### 14.10 Ay içi bakiye eşitleme

- Ay ekranında "Bakiyeyi eşitle": ay kapanmadan, istenildiği kadar. Şu an bankada olması gereken = devir + alınan gelirler − ödenen giderler (`totals.currentBalance`; ödenmedi işaretli kayıtlar sayılmaz).
- Fark, ayın tek "Kayıt dışı harcamalar" kaydına eklenir (gelir +, gider −; sıfırlanırsa kayıt silinir). Örn. 58.000 → 48.000 girilince 10.000; sonra 32.000 girilince 26.000 olur.
- Kapanış aynı kaydı günceller (ikinci kayıt oluşmaz); kapanıştan önceki değer `months.recon_before`'da saklanır ve ay yeniden açılınca geri yüklenir. Gelecek ay ve kapalı ay eşitlenemez.
