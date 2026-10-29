// Derleme öncesi: D1 veritabanı kimliğini Cloudflare build değişkeninden (D1_DATABASE_ID)
// wrangler.jsonc içine yazar. Depoda hesaba özgü hiçbir değer tutulmaz.
import { readFile, writeFile } from 'node:fs/promises'

const PLACEHOLDER = '00000000-0000-0000-0000-000000000000'
const path = new URL('../wrangler.jsonc', import.meta.url)
const id = process.env.D1_DATABASE_ID?.trim()

if (!id) {
  if (process.env.WORKERS_CI) {
    console.error(
      'D1_DATABASE_ID tanımlı değil. Cloudflare → Workers & Pages → hesapp → Settings → Build → ' +
        'Variables and secrets bölümüne D1_DATABASE_ID ekleyin (README: kurulum).',
    )
    process.exit(1)
  }
  process.exit(0) // yerel geliştirme: yer tutucu kalır, yerel D1 kimliğe bakmaz
}

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
  console.error('D1_DATABASE_ID geçerli bir UUID değil.')
  process.exit(1)
}

const text = await readFile(path, 'utf8')
if (!text.includes(PLACEHOLDER)) {
  console.log('wrangler.jsonc zaten yapılandırılmış, atlanıyor.')
  process.exit(0)
}
await writeFile(path, text.replace(PLACEHOLDER, id))
console.log('D1 veritabanı kimliği wrangler.jsonc dosyasına yazıldı.')
