import { describe, expect, it } from 'vitest'
import { dueDateInPeriod, isDateInPeriod, isStartDay, periodOf, periodRange } from './period'

describe('dönem aralığı', () => {
  it('başlangıç 15: 15 Eki – 14 Kas', () => {
    expect(periodRange('2026-10', 15)).toEqual({ start: '2026-10-15', end: '2026-11-14' })
  })
  it('başlangıç 1: takvim ayı (artık yıl dahil)', () => {
    expect(periodRange('2026-10', 1)).toEqual({ start: '2026-10-01', end: '2026-10-31' })
    expect(periodRange('2028-02', 1)).toEqual({ start: '2028-02-01', end: '2028-02-29' })
  })
  it('yıl sınırını geçer', () => {
    expect(periodRange('2026-12', 15)).toEqual({ start: '2026-12-15', end: '2027-01-14' })
  })
  it('başlangıç 28: şubat sınırı', () => {
    expect(periodRange('2027-01', 28)).toEqual({ start: '2027-01-28', end: '2027-02-27' })
    expect(periodRange('2027-02', 28)).toEqual({ start: '2027-02-28', end: '2027-03-27' })
  })
})

describe('tarihin dönemi', () => {
  it.each([
    ['2026-11-05', 15, '2026-10'],
    ['2026-11-14', 15, '2026-10'],
    ['2026-11-15', 15, '2026-11'],
    ['2026-12-31', 15, '2026-12'],
    ['2027-01-03', 15, '2026-12'],
    ['2026-11-05', 1, '2026-11'],
    ['2026-03-01', 15, '2026-02'],
  ])('%s (başlangıç %i) → %s', (date, start, label) => {
    expect(periodOf(date, start)).toBe(label)
  })

  it('dönem aralığındaki her gün aynı etikete döner, aralık dışı dönmez', () => {
    for (const start of [1, 10, 15, 28]) {
      const { start: s, end: e } = periodRange('2026-11', start)
      expect(isDateInPeriod(s, '2026-11', start)).toBe(true)
      expect(isDateInPeriod(e, '2026-11', start)).toBe(true)
      expect(isDateInPeriod(s, '2026-10', start)).toBe(false)
    }
    expect(isDateInPeriod('2026-12-14', '2026-11', 15)).toBe(true)
    expect(isDateInPeriod('2026-12-15', '2026-11', 15)).toBe(false)
  })
})

describe('plan gününden vade', () => {
  it('başlangıç 15: büyük günler dönemin ilk ayında, küçükler sonraki ayda', () => {
    expect(dueDateInPeriod('2026-10', 24, 15)).toBe('2026-10-24')
    expect(dueDateInPeriod('2026-10', 15, 15)).toBe('2026-10-15')
    expect(dueDateInPeriod('2026-10', 1, 15)).toBe('2026-11-01')
    expect(dueDateInPeriod('2026-10', 14, 15)).toBe('2026-11-14')
    expect(dueDateInPeriod('2026-12', 5, 15)).toBe('2027-01-05')
  })
  it('ay uzunluğuna sıkışır', () => {
    expect(dueDateInPeriod('2027-02', 31, 15)).toBe('2027-02-28')
    expect(dueDateInPeriod('2026-04', 31, 15)).toBe('2026-04-30')
  })
  it('başlangıç 1: eski davranışla aynı', () => {
    expect(dueDateInPeriod('2026-10', 24, 1)).toBe('2026-10-24')
    expect(dueDateInPeriod('2026-10', 1, 1)).toBe('2026-10-01')
    expect(dueDateInPeriod('2027-02', 31, 1)).toBe('2027-02-28')
  })
  it('üretilen her vade kendi döneminin içindedir', () => {
    for (const start of [1, 5, 15, 28]) {
      for (let day = 1; day <= 31; day++) {
        for (const label of ['2026-01', '2026-02', '2026-10', '2028-02']) {
          expect(isDateInPeriod(dueDateInPeriod(label, day, start), label, start)).toBe(true)
        }
      }
    }
  })
})

describe('başlangıç günü doğrulama', () => {
  it('1–28 arası tam sayı', () => {
    expect(isStartDay(1)).toBe(true)
    expect(isStartDay(28)).toBe(true)
    expect(isStartDay(0)).toBe(false)
    expect(isStartDay(29)).toBe(false)
    expect(isStartDay(15.5)).toBe(false)
    expect(isStartDay('15')).toBe(false)
  })
})
