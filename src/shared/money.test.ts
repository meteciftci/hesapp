import { describe, expect, it } from 'vitest'
import { formatMoney, parseMoney } from './money'

describe('parseMoney', () => {
  it.each([
    ['75.354,88', 7535488],
    ['75354,88', 7535488],
    ['75354.88', 7535488],
    ['75,354.88', 7535488],
    ['1.234', 123400],
    ['12,500', 1250000],
    ['1.234.567', 123456700],
    ['1.234.567,5', 123456750],
    ['0,5', 50],
    ['0.05', 5],
    ['100', 10000],
    ['  ₺ 4.838,28 TL ', 483828],
    ['-62.608', -6260800],
    ['10.5', 1050],
  ])('%s → %i kuruş', (text, kurus) => {
    expect(parseMoney(text)).toBe(kurus)
  })

  it.each(['', 'abc', '1,2,3,4,5x', '1.2345,6', '12,345,67', '--5', ',', '.', '1,234,567,89'])('geçersiz: %j', (text) => {
    expect(parseMoney(text)).toBeNull()
  })

  it('aşırı büyük tutarı reddeder', () => {
    expect(parseMoney('99.999.999.999.999')).toBeNull()
  })
})

describe('formatMoney', () => {
  it.each([
    [7535488, '75.354,88'],
    [5, '0,05'],
    [100, '1,00'],
    [-6260800, '-62.608,00'],
    [123456700, '1.234.567,00'],
    [0, '0,00'],
  ])('%i → %s', (kurus, text) => {
    expect(formatMoney(kurus)).toBe(text)
  })

  it('biçimlendirip tekrar ayrıştırınca aynı değer çıkar', () => {
    for (const k of [1, 99, 100, 123456, 7535488, 99999999]) expect(parseMoney(formatMoney(k))).toBe(k)
  })
})
