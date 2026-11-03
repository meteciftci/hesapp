import { addDays, addMonths, dueDateFor, monthOf } from './month'

/**
 * Bütçe dönemi: ay yerine, her ayın `startDay`. gününde başlayan dönem (ör. maaş günü 15).
 * Dönem, başladığı ayın etiketiyle anılır: başlangıç günü 15 iken `2026-10` = 15 Eki – 14 Kas 2026.
 * Başlangıç günü 1 ise dönem takvim ayıyla aynıdır.
 */

export const MIN_START_DAY = 1
/** 28'e kadar: her ayda var olan bir gün olsun diye. */
export const MAX_START_DAY = 28

export function isStartDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_START_DAY && value <= MAX_START_DAY
}

const pad = (n: number) => String(n).padStart(2, '0')

export interface PeriodRange {
  /** Dönemin ilk günü (dahil) */
  start: string
  /** Dönemin son günü (dahil) */
  end: string
}

export function periodRange(label: string, startDay: number): PeriodRange {
  const start = `${label}-${pad(startDay)}`
  const nextStart = `${addMonths(label, 1)}-${pad(startDay)}`
  return { start, end: addDays(nextStart, -1) }
}

/** Bir tarihin ait olduğu dönemin etiketi. */
export function periodOf(date: string, startDay: number): string {
  const day = Number(date.slice(8, 10))
  const month = monthOf(date)
  return day >= startDay ? month : addMonths(month, -1)
}

export function isDateInPeriod(date: string, label: string, startDay: number): boolean {
  return periodOf(date, startDay) === label
}

/**
 * Plandaki gün-numarasının (1–31) o dönemdeki vade tarihi.
 * Gün başlangıç gününden küçükse vade bir sonraki takvim ayına düşer. Ayın uzunluğuna sıkıştırılır.
 */
export function dueDateInPeriod(label: string, dayOfMonth: number, startDay: number): string {
  return dayOfMonth >= startDay ? dueDateFor(label, dayOfMonth) : dueDateFor(addMonths(label, 1), dayOfMonth)
}
