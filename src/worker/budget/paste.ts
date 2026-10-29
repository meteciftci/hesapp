import { parseMoney } from '../../shared/money'

export interface ParsedAmounts {
  amounts: number[]
  /** Anlaşılamayan satırlar (1 tabanlı satır numarası ve metin) */
  invalid: { line: number; text: string }[]
}

/** Banka ödeme tablosundan yapıştırılan, her satırda bir tutar olan metni kuruşa çevirir. */
export function parsePastedAmounts(text: string): ParsedAmounts {
  const amounts: number[] = []
  const invalid: ParsedAmounts['invalid'] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    if (!line) return
    const value = parseMoney(line)
    if (value === null || value < 0) invalid.push({ line: index + 1, text: line.slice(0, 40) })
    else amounts.push(value)
  })
  return { amounts, invalid }
}
