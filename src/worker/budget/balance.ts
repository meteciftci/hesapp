import { addMonths, compareMonth, monthDiff } from '../../shared/month'

export interface MonthState {
  month: string
  status: 'open' | 'closed'
  anchorBalance: number | null
  closingBalance: number | null
}

export interface Opening {
  amount: number
  /** Önceki ay(lar) henüz banka bakiyesiyle kapatılmadıysa kayıtlara göre hesaplanmış geçici değerdir. */
  provisional: boolean
}

/**
 * Bir ayın açılış bakiyesi (önceki aydan devir):
 *  1. hedeften önceki en son kapalı ayın banka bakiyesi + aradaki ayların net toplamı
 *  2. kapalı ay yoksa, hedefte ya da öncesinde girilmiş en son başlangıç bakiyesi + aradaki net toplam
 *  3. ikisi de yoksa 0
 * `netOf`: bir ayın (gelir − gider) kayıt toplamı.
 */
export function openingFor(target: string, months: MonthState[], netOf: (month: string) => number): Opening {
  const closed = months.filter((m) => m.status === 'closed' && m.closingBalance !== null && compareMonth(m.month, target) < 0)
  const lastClosed = closed.sort((a, b) => compareMonth(b.month, a.month))[0]

  let base: number
  let from: string
  if (lastClosed) {
    base = lastClosed.closingBalance as number
    from = addMonths(lastClosed.month, 1)
  } else {
    const anchors = months.filter((m) => m.anchorBalance !== null && compareMonth(m.month, target) <= 0)
    const anchor = anchors.sort((a, b) => compareMonth(b.month, a.month))[0]
    if (!anchor) return { amount: 0, provisional: false }
    base = anchor.anchorBalance as number
    from = anchor.month
  }

  let amount = base
  const gap = monthDiff(from, target)
  for (let i = 0; i < gap; i++) amount += netOf(addMonths(from, i))
  return { amount, provisional: gap > 0 }
}

/** Bir ayı kapatmanın önündeki engel (Türkçe mesaj) ya da null. */
export function closeBlocker(month: string, months: MonthState[], currentMonth: string): string | null {
  const self = months.find((m) => m.month === month)
  if (self?.status === 'closed') return 'bu ay zaten kapalı'
  if (compareMonth(month, currentMonth) > 0) return 'gelecek bir ay kapatılamaz'

  const closed = months.filter((m) => m.status === 'closed').sort((a, b) => compareMonth(b.month, a.month))
  const last = closed[0]
  if (last) {
    const expected = addMonths(last.month, 1)
    if (month !== expected) {
      return compareMonth(month, last.month) < 0 ? 'bu aydan sonraki bir ay zaten kapalı' : `önce ${expected} ayını kapatmalısın`
    }
    return null
  }
  const anchors = months.filter((m) => m.anchorBalance !== null).sort((a, b) => compareMonth(a.month, b.month))
  if (anchors[0] && month !== anchors[0].month) return `ilk kapanış, başlangıç bakiyesini girdiğin ay (${anchors[0].month}) olmalı; daha eski bir aydan başlamak için Ayarlar → Başlangıç ayarlarından başlangıç ayını değiştir`
  return null
}

/** Kapatılabilen en son ay (yeniden açılabilen tek ay). */
export function lastClosedMonth(months: MonthState[]): string | null {
  const closed = months.filter((m) => m.status === 'closed').sort((a, b) => compareMonth(b.month, a.month))
  return closed[0]?.month ?? null
}

export interface Reconciliation {
  direction: 'income' | 'expense'
  amount: number
}

/** Kayıtlara göre olması gereken ile bankadaki bakiye arasındaki farkı tek bir kayda çevirir. */
export function reconcile(expectedClosing: number, bankBalance: number): Reconciliation | null {
  const diff = expectedClosing - bankBalance
  if (diff === 0) return null
  return diff > 0 ? { direction: 'expense', amount: diff } : { direction: 'income', amount: -diff }
}
