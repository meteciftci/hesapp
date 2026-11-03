import { addMonths, monthOf } from '../../shared/month'
import { formatMoney, parseMoney } from '../../shared/money'
import { periodOf } from '../../shared/period'

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const MONTHS_LONG = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

export const money = (kurus: number) => `${formatMoney(kurus)} ₺`

export function shortDate(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`
}

export function monthTitle(label: string): string {
  return `${MONTHS_LONG[Number(label.slice(5, 7)) - 1]} ${label.slice(0, 4)}`
}

/** Cihazın yerel saatine göre bugün (YYYY-AA-GG). */
export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function currentPeriod(startDay: number): string {
  return periodOf(localToday(), startDay)
}

export { addMonths, monthOf }

/** Kuruşu form alanı için `1234,50` biçimine çevirir. */
export const toInput = (kurus: number) => formatMoney(kurus).replace(/\./g, '')

/** `2032-10` → `Eki 2032` */
export function shortMonth(label: string): string {
  return `${MONTHS[Number(label.slice(5, 7)) - 1]} ${label.slice(0, 4)}`
}

export const monthAbbr = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1]!

export const signed = (kurus: number) => `${kurus > 0 ? '+' : kurus < 0 ? '−' : ''}${money(Math.abs(kurus))}`

export const monthName = (label: string) => MONTHS_LONG[Number(label.slice(5, 7)) - 1]!

/** Kullanıcının yazdığı tutarı kuruşa çevirir; Unicode eksi işaretini de kabul eder. */
export const parseSigned = (text: string): number | null => parseMoney(text.replace(/[−–]/g, '-'))
