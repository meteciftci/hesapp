import { isDate } from '../../shared/month'
import { parseMoney } from '../../shared/money'

/** Sayfadaki bir hücrenin düz değeri (ExcelJS değer türlerinden sadeleştirilmiş). */
export type Cell = string | number | Date | null

const TR_MONTHS = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık']
const ASCII = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')

/** Sayfa adından dönem etiketi tahmini: "Ağustos" → `YYYY-08` (yıl adda yoksa verilen yıl). */
export function guessMonth(sheetName: string, fallbackYear: number): string | null {
  const name = ASCII(sheetName)
  const index = TR_MONTHS.findIndex((m) => name.includes(ASCII(m)))
  if (index < 0) return null
  const year = /(20\d{2})/.exec(sheetName)?.[1] ?? String(fallbackYear)
  return `${year}-${String(index + 1).padStart(2, '0')}`
}

export function cellText(value: Cell): string {
  if (value === null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim()
}

const words = (label: string) => label.split(/[^a-z0-9#]+/).filter(Boolean)
/** Tutar olmayan para sütunları (banka ödeme planlarında): anapara, faiz, vergi, kalan borç… */
const NOT_AMOUNT = ['anapara', 'faiz', 'kalan', 'kkdf', 'bsmv', 'vergi', 'fon', 'no', 'sira', 'sayi']

/**
 * Başlık satırından (ve varsa veri satırlarından) ad / tutar / tarih sütunu tahmini; bulunamazsa -1.
 * Ad: "Ad", "Açıklama", "Kalem"… başlıklı sütun; yoksa verisi çoğunlukla yazı olan ilk sütun.
 * Tutar: "Taksit tutarı" > "Tutar" > "Taksit"; anapara, faiz, kalan borç gibi sütunlar atlanır.
 */
export function guessColumns(headers: Cell[], rows: Cell[][] = []): { name: number; amount: number; date: number } {
  const labels = Array.from(headers, (h) => ASCII(cellText(h ?? null)))
  const has = (i: number, list: string[]) => words(labels[i] ?? '').some((w) => list.includes(w))
  const findIndex = (test: (i: number) => boolean) => labels.findIndex((_, i) => test(i))

  const date = findIndex((i) => labels[i]!.includes('tarih') || labels[i]!.includes('vade') || has(i, ['gun', 'date']))
  const amountOk = (i: number) => i !== date && !has(i, NOT_AMOUNT)
  let amount = findIndex((i) => amountOk(i) && labels[i]!.includes('taksit') && labels[i]!.includes('tutar'))
  if (amount < 0) amount = findIndex((i) => amountOk(i) && ['tutar', 'miktar', 'bedel', 'planlanan', 'tutari'].some((w) => labels[i]!.includes(w)))
  if (amount < 0) amount = findIndex((i) => amountOk(i) && has(i, ['taksit']))

  let name = findIndex((i) => has(i, ['ad', 'adi', 'aciklama', 'kalem', 'isim', 'urun', 'harcama', 'name']))
  if (name < 0 && rows.length) {
    // Verisi çoğunlukla yazı olan (sayı, tarih ya da para olmayan) ilk sütun
    const width = Math.max(headers.length, ...rows.map((r) => r.length))
    for (let i = 0; i < width && name < 0; i++) {
      if (i === amount || i === date) continue
      const cells = rows.map((r) => r[i] ?? null).filter((c) => cellText(c) !== '')
      const textual = cells.filter((c) => typeof c === 'string' && parseMoney(c) === null && parseDate(c) === null)
      if (cells.length && textual.length >= cells.length / 2) name = i
    }
  }
  return { name: name >= 0 ? name : rows.length ? -1 : 0, amount, date }
}

/** "1", 1, "1." ya da "1. taksit" → 1; değilse null. */
export function installmentNumber(value: Cell): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 600 ? value : null
  if (typeof value !== 'string') return null
  const m = /^(\d{1,3})\.?(\s*taksit)?$/i.exec(value.trim())
  return m ? Number(m[1]) : null
}

/**
 * Banka ödeme planı mı? Tutarı olan satırlarda ardışık (n, n+1, …) taksit numaraları taşıyan bir sütun
 * ve bir tarih sütunu varsa evet; taksit numarası sütununun dizini döner.
 */
export function detectSchedule(grid: Cell[][], headerRow: number, cols: { amount: number; date: number }): number | null {
  if (cols.amount < 0 || cols.date < 0) return null
  // Toplam satırı gibi tarihi olmayan satırlar hesaba katılmaz.
  const dayFirst = detectDayFirst(grid.slice(headerRow).map((r) => r?.[cols.date] ?? null))
  const rows = grid.slice(headerRow).filter((r) => parseAmount(r?.[cols.amount] ?? null) && parseDate(r?.[cols.date] ?? null, dayFirst))
  if (rows.length < 2) return null
  const width = Math.max(...rows.map((r) => r.length))
  const headers = Array.from(grid[headerRow - 1] ?? [], (h) => ASCII(cellText(h ?? null)))
  const candidates = Array.from({ length: width }, (_, i) => i)
    .filter((i) => i !== cols.amount && i !== cols.date)
    .sort((a, b) => Number(/taksit|no|sira/.test(headers[b] ?? '')) - Number(/taksit|no|sira/.test(headers[a] ?? '')))
  for (const i of candidates) {
    const numbers = rows.map((r) => installmentNumber(r[i] ?? null))
    if (numbers.some((n) => n === null)) continue
    if (numbers.every((n, k) => k === 0 || n === (numbers[k - 1] as number) + 1)) return i
  }
  return null
}

export interface ScheduleRow {
  line: number
  no: number
  amount: number
  date: string | null
}

export function extractSchedule(grid: Cell[][], headerRow: number, cols: { amount: number; date: number }, noCol: number): ScheduleRow[] {
  const dayFirst = detectDayFirst(grid.slice(headerRow).map((r) => r?.[cols.date] ?? null))
  const out: ScheduleRow[] = []
  for (let i = headerRow; i < grid.length; i++) {
    const row = grid[i] ?? []
    const amount = parseAmount(row[cols.amount] ?? null)
    const no = installmentNumber(row[noCol] ?? null)
    if (!amount || no === null) continue
    out.push({ line: i + 1, no, amount, date: parseDate(row[cols.date] ?? null, dayFirst) })
  }
  return out
}

/** Dosya adından plan adı: "Banka_50_Bin_Kredi.xlsx" → "Banka 50 Bin Kredi". */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** Tutar hücresi → kuruş (negatifler mutlak alınır); anlaşılamazsa null. */
export function parseAmount(value: Cell): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.abs(Math.round(value * 100)) : null
  if (typeof value !== 'string') return null
  const kurus = parseMoney(value)
  return kurus === null ? null : Math.abs(kurus)
}

const TR_MONTH_PREFIX = ['oca', 'şub', 'mar', 'nis', 'may', 'haz', 'tem', 'ağu', 'eyl', 'eki', 'kas', 'ara']
const EN_MONTH_PREFIX = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000
  const result = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return isDate(result) ? result : null
}

/** Excel'in sayı olarak sakladığı tarih (1900 sistemi): 45000 ≈ 2023. Makul aralık dışındaysa tarih sayılmaz. */
function fromSerial(n: number): string | null {
  if (!Number.isFinite(n) || n < 20_000 || n > 80_000) return null
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Sayısal tarihlerde gün mü önce (15.10.2026) ay mı önce (10/15/2026) geldiğini bir sütunun değerlerinden çıkarır:
 * ilk parçası 12'den büyük olan varsa gün önce, ikinci parçası 12'den büyük olan varsa ay önce. Karar verilemezse
 * Türkçe alışkanlık gereği gün önce.
 */
export function detectDayFirst(values: Cell[]): boolean {
  for (const v of values) {
    if (typeof v !== 'string') continue
    const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(v.trim())
    if (!m) continue
    if (Number(m[1]) > 12) return true
    if (Number(m[2]) > 12) return false
  }
  return true
}

/**
 * Tarih hücresi → `YYYY-AA-GG`. Tanınanlar: gerçek tarih hücresi; Excel tarih sayısı; `15.10.2026`, `15/10/2026`,
 * `15-10-26` (gün/ay sırası `dayFirst` ile); `2026-10-15`, `2026.10.15`, `2026/10/15`; saat eki (`15.10.2026 09:30`);
 * ay adıyla `15 Ekim 2026`, `15 Eki 26`, `15 Oct 2026`.
 */
export function parseDate(value: Cell, dayFirst = true): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  if (typeof value === 'number') return fromSerial(value)
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*$/, '').replace(/T\d{2}:\d{2}.*$/, '')
  if (/^\d{5}(\.\d+)?$/.test(text)) return fromSerial(Number(text))

  const ymdFirst = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(text)
  if (ymdFirst) return ymd(Number(ymdFirst[1]), Number(ymdFirst[2]), Number(ymdFirst[3]))

  const parts = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text)
  if (parts) {
    const [a, b, y] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
    return dayFirst ? ymd(y, b, a) ?? ymd(y, a, b) : ymd(y, a, b) ?? ymd(y, b, a)
  }

  const named = /^(\d{1,2})\s+([a-zçğıöşü]+)\.?\s+(\d{2}|\d{4})$/i.exec(text)
  if (named) {
    const word = named[2]!.toLocaleLowerCase('tr').slice(0, 3)
    const month = TR_MONTH_PREFIX.indexOf(word) >= 0 ? TR_MONTH_PREFIX.indexOf(word) : EN_MONTH_PREFIX.indexOf(word.toLowerCase())
    if (month >= 0) return ymd(Number(named[3]), month + 1, Number(named[1]))
  }
  return null
}

export interface ParsedRow {
  /** Sayfadaki satır numarası (1'den) */
  line: number
  name: string
  amount: number
  date: string | null
  /** Tarih sütunu doluysa hücrenin metni (okunamayan tarihi göstermek için) */
  dateText: string | null
}

export function extractRows(grid: Cell[][], headerRow: number, cols: { name: number; amount: number; date: number }): ParsedRow[] {
  const rows: ParsedRow[] = []
  const dayFirst = cols.date >= 0 ? detectDayFirst(grid.slice(headerRow).map((r) => r?.[cols.date] ?? null)) : true
  for (let i = headerRow; i < grid.length; i++) {
    const row = grid[i] ?? []
    const name = cellText(row[cols.name] ?? null)
    const amount = cols.amount >= 0 ? parseAmount(row[cols.amount] ?? null) : null
    if (!name || amount === null || amount === 0) continue
    const raw = cols.date >= 0 ? (row[cols.date] ?? null) : null
    rows.push({ line: i + 1, name: name.slice(0, 80), amount, date: raw === null ? null : parseDate(raw, dayFirst), dateText: cellText(raw) || null })
  }
  return rows
}
