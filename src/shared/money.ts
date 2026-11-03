/** Para tutarları kuruş cinsinden tam sayı olarak taşınır; kayan noktalı sayı kullanılmaz. */

const MAX_KURUS = 9_000_000_000_00 // 9 milyar ₺, güvenli tam sayı sınırının çok altında

/**
 * Metni kuruşa çevirir. Türkçe (`12.345,67`) ve İngilizce (`12,345.67`, `12345.67`) biçimlerini,
 * ₺/TL işaretlerini ve boşlukları kabul eder. Anlaşılamazsa null döner.
 *
 * Tek ayraç varsa: ardından tam 3 hane geliyorsa binlik, 1–2 hane geliyorsa ondalık sayılır.
 * İki türlü ayraç varsa sondaki ondalıktır.
 */
export function parseMoney(input: string): number | null {
  let text = input.replace(/[₺\s]|TL/gi, '').trim()
  if (!text) return null
  let negative = false
  if (text.startsWith('-')) {
    negative = true
    text = text.slice(1)
  }
  if (!/^[0-9.,]+$/.test(text) || !/[0-9]/.test(text)) return null

  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')
  let decimalSep: '.' | ',' | null = null
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? '.' : ','
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ','
    const parts = text.split(sep)
    const tail = parts[parts.length - 1]!
    if (parts.length > 2) decimalSep = null // 1.234.567 → binlik
    else decimalSep = tail.length === 3 ? null : sep
  }

  let integerPart = text
  let fraction = ''
  if (decimalSep) {
    const at = text.lastIndexOf(decimalSep)
    integerPart = text.slice(0, at)
    fraction = text.slice(at + 1)
    if (fraction.length > 2 || /[.,]/.test(fraction)) return null
  }
  // Binlik ayraç varsa gruplar tam 3 haneli ve ayraç tek türde olmalı: 1.234.567 ya da 1,234,567
  if (/[.,]/.test(integerPart)) {
    if (!/^\d{1,3}([.,]\d{3})+$/.test(integerPart) || new Set(integerPart.match(/[.,]/g)).size > 1) return null
  }
  integerPart = integerPart.replace(/[.,]/g, '')
  if (!integerPart && !fraction) return null
  const kurus = Number(integerPart || '0') * 100 + Number(fraction.padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(kurus) || kurus > MAX_KURUS) return null
  return negative ? -kurus : kurus
}

/** `1234567` → `12.345,67` (₺ işareti olmadan). */
export function formatMoney(kurus: number): string {
  const sign = kurus < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(kurus))
  const whole = Math.floor(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  return `${sign}${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents}`
}

export function isKurus(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
