# hesapp – Teknik plan

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

1. Ay ekranı: gelir/gider listesi, devir, özet (elde kalan, ödenen/kalan gider).
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

### Sonraya kalanlar

- Vade yaklaşınca bildirim (Workers zamanlanmış görev + Web Push).
- Kart ekstresine kalem kalem harcama girişi.
- Kategori, etiket, arama.
- Birden fazla para birimi (v1 yalnızca TRY).

## 3. Mimari

```
Tarayıcı (PWA, React)
   │  HTTPS, Cloudflare Access oturumu
   ▼
Cloudflare Access  ── izinli e-postalar dışında kimse geçemez
   │
   ▼
Cloudflare Worker
   ├─ statik dosyalar (derlenmiş ön yüz)
   └─ /api/*  (Hono)
         │
         ▼
      D1 (SQLite)
```

- Tek Worker hem ön yüzü hem API'yi sunar. Ayrı bir sunucu yok.
- **Kimlik doğrulama Access ile yapılır.** Worker, isteklerdeki `Cf-Access-Jwt-Assertion` başlığını Access'in açık anahtarlarıyla doğrular (takım alan adı ve uygulama AUD değeri ortam değişkeninden gelir). Yalnızca başlığa güvenilmez; doğrulanmayan istek 401 alır. `workers.dev` adresi kapatılır.
- Kullanıcı kaydı doğrulanmış e-postadan otomatik oluşturulur. İsteğe bağlı `ALLOWED_EMAILS` listesi ikinci bir kontrol sağlar.
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
| Veritabanı | D1 + Drizzle ORM + drizzle-kit | Tip güvenli sorgular, sürümlü şema değişiklikleri (migration) |
| Doğrulama | Zod | Aynı şema hem API girişini hem formları doğrular |
| Tarih | date-fns (tr yerel ayarı) | |
| Grafik | Recharts | |
| Excel | ExcelJS (tarayıcıda) | MIT lisanslı, okuma ve yazma |
| PWA | vite-plugin-pwa | Ana ekrana ekleme, çevrimdışı kabuk |
| Test | Vitest, Workers için `@cloudflare/vitest-pool-workers` | Alan mantığı ve API testleri gerçek D1 benzetimiyle |
| Paket yöneticisi | pnpm | |

## 5. Veri modeli

Genel kurallar:

- **Para** kuruş cinsinden tam sayı (`INTEGER`) saklanır. Ekranda `75.354,88 ₺` biçiminde gösterilir. Kayan noktalı sayı kullanılmaz.
- **Ay** `YYYY-AA` metni (`2026-11`). **Tarih** `YYYY-AA-GG`. **Zaman damgası** ISO 8601, UTC.
- Saat dilimi yapılandırmadan gelir (varsayılan `Europe/Istanbul`); "bugün" ve "yaklaşan" hesapları buna göre yapılır.
- Kimlikler ULID.
- Silme yumuşaktır (`deleted_at`); geri alma ve geçmiş için.

### Temel ayrım: plan ve kayıt

- **Plan**, tekrar eden bir şeyin tanımıdır: "her ay 15'inde, 84 taksit, şu tutar".
- **Kayıt** (entry), belirli bir aydaki tek satırdır: "Kasım, 13. taksit, şu tutar, ödendi".
- Plan oluşturulunca kayıtları üretilir. Her kayıt sonradan tek başına düzenlenebilir.
- Plana bağlı olmayan kayıtlar tek seferliktir.

### Tablolar

**users**

| alan | tip | not |
|---|---|---|
| id | text PK | |
| email | text unique | Access'ten |
| display_name | text | Ayarlar'dan değiştirilebilir |
| created_at | text | |

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
| closed_at | text null | erken kapatma / sonlandırma |
| created_by, updated_by | text FK users | |
| created_at, updated_at, deleted_at | text | |

**entries**

| alan | tip | not |
|---|---|---|
| id | text PK | |
| month | text | hangi aya ait |
| plan_id | text null FK | |
| installment_no | integer null | taksitlide sıra no |
| type | `normal` \| `carryover` \| `reconciliation` | devir ve kapanış farkı özel kayıtlardır |
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
| created_by, updated_by | text FK users | |
| created_at, updated_at, deleted_at | text | |

Bir ayın toplamlarında `actual_amount ?? planned_amount` kullanılır.

**months**

| alan | tip | not |
|---|---|---|
| month | text PK | |
| status | `open` \| `closed` | |
| opening_balance | integer | devir; ilk ay için kurulumda girilir |
| closing_balance | integer null | kapanışta girilen banka bakiyesi |
| closed_at, closed_by | | |

**audit_log**

| alan | tip | not |
|---|---|---|
| id | text PK | |
| entity | `plan` \| `entry` \| `month` | |
| entity_id | text | |
| action | `create` \| `update` \| `delete` \| `restore` \| `close` \| `reopen` | |
| before, after | text (JSON) | |
| user_id | text | |
| at | text | |

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

- Her ay listesinin başında, önceki ayın kapanış bakiyesi `carryover` kaydı olarak görünür (artı veya eksi).
- Önceki ay henüz kapatılmamışsa devir, o ayın "olması gereken kapanış" değeridir ve "geçici" olarak işaretlenir. Önceki ay kapanınca banka bakiyesiyle kesinleşir.
- Uygulamaya başlanan ilk ayın açılışı kurulumda bir kez girilir. İçe aktarılan geçmiş aylar kapalı ve devirsiz kabul edilir.

### 6.6 Ay kapanışı (eşitleme)

1. Kullanıcı ay sonunda bankadaki toplam bakiyeyi girer (KMH kullanıldıysa eksi).
2. `fark = olması gereken − banka bakiyesi`
   - fark > 0 ise "Kayıt dışı harcamalar" adında bir **gider** (`reconciliation`) eklenir.
   - fark < 0 ise aynı adla bir **gelir** (`reconciliation`) eklenir.
   - fark = 0 ise kayıt eklenmez.
3. Ay `closed` olur, sonraki ayın açılışı = banka bakiyesi.
4. **Yeniden açma:** yalnızca en son kapatılan ay yeniden açılabilir. Eşitleme kaydı silinir, sonraki ayın devri yeniden geçici olur.

### 6.7 Geri alma

Silme sonrası birkaç saniye "Geri al" sunulur (yumuşak silme sayesinde). Her değişiklik `audit_log`'a yazılır.

## 7. API

Tümü `/api` altında, JSON, Zod ile doğrulanır.

| Yöntem | Yol | İş |
|---|---|---|
| GET | `/me` | oturumdaki kullanıcı |
| GET | `/months/:month` | ayın kayıtları, açılış, toplamlar, durum |
| POST | `/months/:month/close` | `{ bankBalance }` ile kapanış |
| POST | `/months/:month/reopen` | |
| GET | `/upcoming?days=30` | yaklaşan ödemeler |
| GET | `/years/:year` | aylık özetler |
| GET/POST | `/plans` | listele / oluştur |
| GET/PATCH/DELETE | `/plans/:id` | detay (kayıtlarıyla) / güncelle / sil |
| POST | `/plans/:id/schedule` | ödeme planı yapıştırma |
| POST | `/plans/:id/close` | erken kapatma |
| POST | `/entries` | tek seferlik kayıt |
| PATCH | `/entries/:id` | `{ ..., scope: "this" \| "following" \| "all" }` |
| POST | `/entries/:id/pay` · `/unpay` | |
| DELETE | `/entries/:id` · POST `/entries/:id/restore` | |
| GET | `/audit?entity=&id=` | değişiklik geçmişi |
| GET | `/export` | JSON tam yedek |
| POST | `/import` | JSON yedeği geri yükleme (boş veritabanına) |
| POST | `/setup` | ilk kurulum: başlangıç ayı ve açılış bakiyesi |

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
10. **İlk kurulum:** başlangıç ayı, açılış bakiyesi, isteğe bağlı içe aktarma.

Tema: açık, koyu, sistem; seçim cihazda saklanır.

## 9. Dışa ve içe aktarma (çıkış planı)

- **JSON tam yedek:** `{ "format": "hesapp-backup", "version": 1, "exportedAt", "data": { users, plans, entries, months, auditLog } }`. Biçim sürümlüdür; geri yükleme eski sürümleri dönüştürür.
- **Excel (.xlsx):** her ay bir sayfa (açılış, gelirler, giderler, kapanış) ve bir "Planlar" sayfası. Uygulama kapansa bile okunabilir kalır.
- **Veritabanı dökümü:** `wrangler d1 export` ile SQL dosyası (README'de anlatılır).
- **Excel içe aktarma sihirbazı:** dosya seçilir, her sayfa bir aya eşlenir, ad/tutar/tarih sütunları seçilir, satırlar gelir veya gider olarak işaretlenir, önizlenir, içe aktarılır. Belirli bir dosya düzenine bağlı kod yazılmaz.

## 10. Yapılandırma ve dağıtım

Depoda kişisel değer yoktur. Gerekenler:

| Ad | Nerede | İş |
|---|---|---|
| `ACCESS_TEAM_DOMAIN` | Worker değişkeni | JWT doğrulama |
| `ACCESS_AUD` | Worker gizli değişkeni | JWT doğrulama |
| `ALLOWED_EMAILS` | Worker gizli değişkeni (isteğe bağlı) | ikinci kontrol |
| `TZ` | Worker değişkeni | varsayılan `Europe/Istanbul` |

- Depodaki `wrangler.jsonc` yalnızca yer tutucu içerir. Alan adına özgü değerler (Access takım alanı, AUD, izinli e-postalar) Cloudflare panelinde Worker'ın "Variables and Secrets" bölümüne girilir.
- Özel alan adı ve Access uygulaması Cloudflare panelinden tanımlanır, kodda yer almaz.
- **Dağıtım:** GitHub Actions kullanılmaz. Cloudflare'in Git bağlantısı (Workers Builds) depoyu izler; `main`'e her birleştirmede derler (`pnpm build`) ve yayınlar (`npx wrangler deploy`). Testler geliştirme sırasında yerelde/oturumda çalıştırılır, birleştirmeden önce geçmesi şarttır.
- **D1 şema güncellemeleri (M1'den sonra):** `wrangler d1 migrations apply` Workers Builds'te dağıtım komutunun parçası olur.
- Yerel geliştirme: `pnpm dev` (Vite + yerel D1), Access yerine `.dev.vars` ile sahte kullanıcı.
- `pnpm seed`: uydurma örnek veri (ör. "Örnek Konut Kredisi", "Maaş A").

README'de adım adım: depoyu çatallama, D1 oluşturma, Access uygulaması ve izinli e-postalar, özel alan adı, gizli değişkenler.

## 11. Test

- **Birim:** kayıt üretimi, ay sonu günü düzeltmesi, kapsamlı düzenleme, ödeme planı ayrıştırma, kapanış/yeniden açma, devir zinciri, para biçimlendirme ve ayrıştırma.
- **API:** Workers test havuzunda gerçek D1 benzetimiyle uç noktalar ve JWT doğrulama.
- **Yedek döngüsü:** dışa aktar → boş veritabanına içe aktar → aynı sonuç.
- Her pull request'ten önce çalıştırılır (`pnpm test`, `pnpm typecheck`, `pnpm build`).

## 12. Geliştirme sırası

| Adım | İçerik | Bitti sayılması için |
|---|---|---|
| M0 | Proje iskeleti, commit denetimi, dağıtım yapılandırması, Access doğrulama | Boş uygulama alan adında, Access girişiyle açılıyor (Cloudflare kurulumu sonrası) |
| M1 | Şema, migration, alan mantığı, API | Bölüm 6'nın testleri geçiyor |
| M2 | Ay ekranı, ekle/düzenle/sil, ödendi, tema | Telefonda bir ay baştan sona yönetilebiliyor |
| M3 | Planlar, plan detayı, yaklaşan | Kredi tanımlanıp taksitleri izlenebiliyor |
| M4 | Ay kapanışı, devir, ilk kurulum | Bir ay kapatılıp sonraki doğru devirle açılıyor |
| M5 | Yıl ekranı, PWA, değişiklik geçmişi | |
| M6 | JSON yedek/geri yükleme, Excel dışa aktarma, Excel içe aktarma sihirbazı | Yedek döngüsü testi geçiyor |
| M7 | README kurulum rehberi, sürüm 1.0 | Başka biri depodan kendi kurulumunu yapabiliyor |

Her adım ayrı bir pull request olarak gelir.

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
