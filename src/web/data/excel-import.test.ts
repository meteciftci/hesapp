import { describe, expect, it } from 'vitest'
import { detectDayFirst, detectSchedule, extractRows, extractSchedule, guessColumns, guessMonth, nameFromFile, parseAmount, parseDate } from './excel-import'

describe('excel içe aktarma yardımcıları', () => {
  it('sayfa adından dönemi tahmin eder', () => {
    expect(guessMonth('Ağustos', 2026)).toBe('2026-08')
    expect(guessMonth('EKİM 2025', 2026)).toBe('2025-10')
    expect(guessMonth('Planlar', 2026)).toBeNull()
  })

  it('başlıklardan sütunları tahmin eder', () => {
    expect(guessColumns(['Açıklama', 'Tutar', 'Vade Tarihi'])).toEqual({ name: 0, amount: 1, date: 2 })
    expect(guessColumns(['Kalem', null, null])).toEqual({ name: 0, amount: -1, date: -1 })
  })

  it('tutar ve tarih hücrelerini çözer', () => {
    expect(parseAmount(12345.67)).toBe(1234567)
    expect(parseAmount('12.345,67 ₺')).toBe(1234567)
    expect(parseAmount(-12.5)).toBe(1250)
    expect(parseAmount('abc')).toBeNull()
    expect(parseDate('15.10.2026')).toBe('2026-10-15')
    expect(parseDate('2026-10-15')).toBe('2026-10-15')
    expect(parseDate('31.02.2026')).toBeNull()
    expect(parseDate(new Date('2026-10-15T00:00:00Z'))).toBe('2026-10-15')
  })

  it('satırları ayıklar; boş ad ya da tutarsız satırları atlar', () => {
    const grid = [['Ad', 'Tutar', 'Tarih'], ['Market', '1.250,00', '12.10.2026'], ['', 100, null], ['Not', 'yok', null], ['Kira', 8000, null]]
    expect(extractRows(grid, 1, { name: 0, amount: 1, date: 2 })).toEqual([
      { line: 2, name: 'Market', amount: 125000, date: '2026-10-12', dateText: '12.10.2026' },
      { line: 5, name: 'Kira', amount: 800000, date: null, dateText: null },
    ])
  })
})

describe('tarih biçimleri', () => {
  it('farklı Excel tarih biçimlerini okur', () => {
    expect(parseDate('05.10.2026')).toBe('2026-10-05')
    expect(parseDate(' 5.10.2026 ')).toBe('2026-10-05')
    expect(parseDate('05/10/2026')).toBe('2026-10-05')
    expect(parseDate('05-10-26')).toBe('2026-10-05')
    expect(parseDate('15.10.2026 09:30')).toBe('2026-10-15')
    expect(parseDate('15.10.2026 09:30:00')).toBe('2026-10-15')
    expect(parseDate('2026.10.05')).toBe('2026-10-05')
    expect(parseDate('2026/10/05')).toBe('2026-10-05')
    expect(parseDate('2026-10-05T00:00:00.000Z')).toBe('2026-10-05')
    expect(parseDate('15 Ekim 2026')).toBe('2026-10-15')
    expect(parseDate('15 Eki 26')).toBe('2026-10-15')
    expect(parseDate('3 Şubat 2026')).toBe('2026-02-03')
    expect(parseDate('15 Oct 2026')).toBe('2026-10-15')
    expect(parseDate(46310)).toBe('2026-10-15') // Excel tarih sayısı (46023 = 1 Oca 2026)
    expect(parseDate('46310')).toBe('2026-10-15')
    expect(parseDate(150)).toBeNull() // tutar gibi küçük sayılar tarih değildir
    expect(parseDate('yarın')).toBeNull()
  })

  it('gün/ay sırasını sütundan çıkarır; belirsizse gün önce', () => {
    expect(detectDayFirst(['01.02.2026', '13.02.2026'])).toBe(true)
    expect(detectDayFirst(['02/01/2026', '02/13/2026'])).toBe(false)
    expect(detectDayFirst(['01.02.2026'])).toBe(true)
    expect(parseDate('02/01/2026', false)).toBe('2026-02-01')
    expect(parseDate('02/01/2026', true)).toBe('2026-01-02')
    // Sıra yanlış seçilse bile geçersiz tarih yerine diğer sıra denenir
    expect(parseDate('05/13/2026', true)).toBe('2026-05-13')
  })

  it('ABD biçimli sütunda satırlar doğru okunur', () => {
    const grid = [['Ad', 'Tutar', 'Tarih'], ['A', 10, '10/02/2026'], ['B', 20, '10/25/2026']]
    expect(extractRows(grid, 1, { name: 0, amount: 1, date: 2 }).map((r) => r.date)).toEqual(['2026-10-02', '2026-10-25'])
  })
})

describe('banka ödeme planı', () => {
  // A bankası biçimi: taksit no sayı, tarih gerçek tarih, tutarlar "10.000,00 TL"; başlıkta bozuk karakter olabilir
  const bankA = [
    ['Taksit No', 'Tarih', 'Taksit Tutar˝', 'Taksit Anapara Tutar˝', 'Faiz Tutar˝', 'Kalan Anapara Tutar˝'],
    [1, new Date(Date.UTC(2026, 8, 18)), '10.000,00 TL', '7.000,00 TL', '3.000,00 TL', '23.000,00 TL'],
    [2, new Date(Date.UTC(2026, 9, 18)), '10.000,00 TL', '7.500,00 TL', '2.500,00 TL', '15.500,00 TL'],
    [3, new Date(Date.UTC(2026, 10, 18)), '10.000,03 TL', '8.000,03 TL', '2.000,00 TL', '0,00 TL'],
  ]

  it('tutar olarak taksit tutarını seçer; anapara, faiz ve kalan sütunlarını atlar', () => {
    expect(guessColumns(bankA[0]!, bankA.slice(1))).toEqual({ name: -1, amount: 2, date: 1 })
  })

  it('sıralı taksit numaralarını tanır ve planı çıkarır', () => {
    const cols = guessColumns(bankA[0]!, bankA.slice(1))
    const noCol = detectSchedule(bankA, 1, cols)
    expect(noCol).toBe(0)
    expect(extractSchedule(bankA, 1, cols, noCol!)).toEqual([
      { line: 2, no: 1, amount: 1000000, date: '2026-09-18' },
      { line: 3, no: 2, amount: 1000000, date: '2026-10-18' },
      { line: 4, no: 3, amount: 1000003, date: '2026-11-18' },
    ])
  })

  it('B bankası biçimi: "1." numaralar, tutar sütunu "Taksit", gün.ay.yıl tarihler', () => {
    const bankB = [
      [null, 'Taksit', 'Tarih', 'Anapara', 'Faiz', 'Kalan Anapara'],
      ['1.', 5000, '01.10.2025', 0, 4000, 50000],
      ['2.', 5000, '09.11.2025', 3000, 2000, 47000],
      ['Toplam:', 10000, '-', 3000, 6000, '-'],
    ]
    const cols = guessColumns(bankB[0]!, bankB.slice(1))
    expect(cols).toMatchObject({ amount: 1, date: 2 })
    const noCol = detectSchedule(bankB, 1, cols)
    expect(noCol).toBe(0)
    expect(extractSchedule(bankB, 1, cols, noCol!).map((r) => [r.no, r.date])).toEqual([[1, '2025-10-01'], [2, '2025-11-09']])
  })

  it('boş hücreli (delikli) başlık satırını da işler', () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [, 'Taksit', 'Tarih'] as unknown as (string | null)[]
    expect(guessColumns(sparse, [['1.', 100, '01.10.2025']])).toMatchObject({ amount: 1, date: 2 })
  })

  it('sıralı numara yoksa ödeme planı sayılmaz; dosya adından plan adı', () => {
    const budget = [['Ad', 'Tutar', 'Tarih'], ['Market', 100, '01.10.2026'], ['Kira', 200, '05.10.2026']]
    expect(detectSchedule(budget, 1, guessColumns(budget[0]!, budget.slice(1)))).toBeNull()
    expect(nameFromFile('Banka_50_Bin_Kredi.xlsx')).toBe('Banka 50 Bin Kredi')
  })
})
