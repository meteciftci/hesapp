import { describe, expect, it } from 'vitest'
import { addDays, addMonths, daysInMonth, dueDateFor, isDate, isMonth, monthDiff, monthRange, todayIn } from './month'

describe('ay aritmetiği', () => {
  it('yıl sınırını geçer', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-12', 12)).toBe('2027-12')
    expect(addMonths('2026-03', -15)).toBe('2024-12')
  })
  it('ay farkı ve aralık', () => {
    expect(monthDiff('2026-10', '2027-03')).toBe(5)
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(monthRange('2026-05', '2026-05')).toEqual(['2026-05'])
    expect(monthRange('2026-06', '2026-05')).toEqual([])
  })
  it('ay uzunluğu (artık yıl dahil)', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-04')).toBe(30)
    expect(daysInMonth('2026-12')).toBe(31)
  })
  it('vade günü ayın son gününe sıkışır', () => {
    expect(dueDateFor('2026-02', 31)).toBe('2026-02-28')
    expect(dueDateFor('2028-02', 31)).toBe('2028-02-29')
    expect(dueDateFor('2026-04', 31)).toBe('2026-04-30')
    expect(dueDateFor('2026-10', 15)).toBe('2026-10-15')
    expect(dueDateFor('2026-10', 0)).toBe('2026-10-01')
  })
  it('doğrulayıcılar', () => {
    expect(isMonth('2026-10')).toBe(true)
    expect(isMonth('2026-13')).toBe(false)
    expect(isMonth('2026-1')).toBe(false)
    expect(isDate('2026-02-29')).toBe(false)
    expect(isDate('2028-02-29')).toBe(true)
    expect(isDate('2026-10-15')).toBe(true)
    expect(isDate(20261015)).toBe(false)
  })
  it('gün ekleme ve saat dilimi', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    // İstanbul UTC+3: UTC'de 30 Ekim 22:30 → İstanbul'da 31 Ekim
    expect(todayIn('Europe/Istanbul', new Date('2026-10-30T22:30:00Z'))).toBe('2026-10-31')
    expect(todayIn('UTC', new Date('2026-10-30T22:30:00Z'))).toBe('2026-10-30')
    expect(todayIn('Gecersiz/Bolge', new Date('2026-10-30T22:30:00Z'))).toBe('2026-10-30')
  })
})
