/** Ay: `YYYY-AA`. Tarih: `YYYY-AA-GG`. Saat dilimi sorunu olmaması için yalnızca düz metin/sayı aritmetiği kullanılır. */

export const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/
export const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_PATTERN.test(value)
}

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = DATE_PATTERN.exec(value)
  if (!m) return false
  return Number(m[3]) <= daysInMonth(`${m[1]}-${m[2]}`)
}

function parts(month: string): [number, number] {
  const m = MONTH_PATTERN.exec(month)
  if (!m) throw new Error(`geçersiz ay: ${month}`)
  return [Number(m[1]), Number(m[2])]
}

export function addMonths(month: string, count: number): string {
  const [year, mon] = parts(month)
  const index = year * 12 + (mon - 1) + count
  const y = Math.floor(index / 12)
  const mo = (index % 12) + 1
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}`
}

/** `a` ile `b` arasındaki ay sayısı (b − a). */
export function monthDiff(a: string, b: string): number {
  const [ya, ma] = parts(a)
  const [yb, mb] = parts(b)
  return (yb - ya) * 12 + (mb - ma)
}

export function compareMonth(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function daysInMonth(month: string): number {
  const [year, mon] = parts(month)
  return new Date(Date.UTC(year, mon, 0)).getUTCDate()
}

/** Günü ayın uzunluğuna sıkıştırır: 31 Şubat → 28/29 Şubat. */
export function dueDateFor(month: string, day: number): string {
  const d = Math.min(Math.max(1, Math.floor(day)), daysInMonth(month))
  return `${month}-${String(d).padStart(2, '0')}`
}

/** `from`'dan `to`'ya (ikisi de dahil) aylar. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let n = 0; n <= monthDiff(from, to); n++) out.push(addMonths(from, n))
  return out
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** Verilen saat diliminde bugünün tarihi (`YYYY-AA-GG`). */
export function todayIn(timeZone: string | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
