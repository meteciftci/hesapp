import { describe, expect, it } from 'vitest'
import { closeBlocker, lastClosedMonth, type MonthState, openingFor, reconcile } from './balance'
import { parsePastedAmounts } from './paste'
import { scheduleFor } from './schedule'
import { scopeTargets, type ScopedEntry } from './scope'

const open = (month: string, anchor: number | null = null): MonthState => ({ month, status: 'open', anchorBalance: anchor, closingBalance: null })
const closed = (month: string, closing: number): MonthState => ({ month, status: 'closed', anchorBalance: null, closingBalance: closing })

describe('kayıt üretimi', () => {
  const base = { startMonth: '2026-11', dayOfMonth: 31, installmentCount: null, endMonth: null, amount: 1000, variable: false }

  it('taksitli plan tüm taksitleri üretir, yıl sınırını ve ay sonu gününü doğru işler', () => {
    const list = scheduleFor({ ...base, kind: 'installment', installmentCount: 5 }, '2030-01')
    expect(list.map((e) => [e.installmentNo, e.month, e.dueDate])).toEqual([
      [1, '2026-11', '2026-11-30'],
      [2, '2026-12', '2026-12-31'],
      [3, '2027-01', '2027-01-31'],
      [4, '2027-02', '2027-02-28'],
      [5, '2027-03', '2027-03-31'],
    ])
  })

  it('taksit sayısı kadar kayıt üretir (84 taksit)', () => {
    expect(scheduleFor({ ...base, kind: 'installment', installmentCount: 84, dayOfMonth: 15 }, '2026-11')).toHaveLength(84)
  })

  it('tekrarlayan plan başlangıçtan ufka kadar, bitiş varsa orada durur', () => {
    const rec = { ...base, kind: 'recurring' as const, dayOfMonth: 15 }
    expect(scheduleFor(rec, '2027-01').map((e) => e.month)).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(scheduleFor({ ...rec, endMonth: '2026-12' }, '2027-06').map((e) => e.month)).toEqual(['2026-11', '2026-12'])
    expect(scheduleFor({ ...rec, startMonth: '2027-05' }, '2027-01')).toEqual([])
    expect(scheduleFor(rec, '2027-01').every((e) => e.installmentNo === null)).toBe(true)
  })

  it('değişken (kart ekstresi gibi) plan kayıtları tahmini doğar', () => {
    expect(scheduleFor({ ...base, kind: 'recurring', variable: true }, '2026-12').every((e) => e.isEstimate)).toBe(true)
  })
})

describe('açılış bakiyesi (devir)', () => {
  const nets: Record<string, number> = { '2026-11': 5000, '2026-12': -2000, '2027-01': 300 }
  const netOf = (m: string) => nets[m] ?? 0

  it('geçmiş yoksa 0', () => {
    expect(openingFor('2026-11', [], netOf)).toEqual({ amount: 0, provisional: false })
  })

  it('başlangıç bakiyesi girilen ayın açılışı tam olarak o değerdir', () => {
    expect(openingFor('2026-11', [open('2026-11', 10000)], netOf)).toEqual({ amount: 10000, provisional: false })
  })

  it('başlangıç bakiyesinden sonraki aylar geçici devirle ilerler', () => {
    const months = [open('2026-11', 10000)]
    expect(openingFor('2026-12', months, netOf)).toEqual({ amount: 15000, provisional: true })
    expect(openingFor('2027-01', months, netOf)).toEqual({ amount: 13000, provisional: true })
  })

  it('başlangıçtan önceki ay için devir yoktur', () => {
    expect(openingFor('2026-10', [open('2026-11', 10000)], netOf)).toEqual({ amount: 0, provisional: false })
  })

  it('kapalı ayın banka bakiyesi bir sonraki ayın kesin devridir (eksi dahil)', () => {
    const months = [open('2026-11', 10000), closed('2026-11', -8401_95)]
    expect(openingFor('2026-12', months, netOf)).toEqual({ amount: -8401_95, provisional: false })
    expect(openingFor('2027-01', months, netOf)).toEqual({ amount: -8401_95 - 2000, provisional: true })
  })

  it('en son kapalı ay esas alınır, eski kapanışlar yok sayılır', () => {
    const months = [closed('2026-11', 111), closed('2026-12', 222)]
    expect(openingFor('2027-01', months, netOf)).toEqual({ amount: 222, provisional: false })
  })
})

describe('ay kapanışı', () => {
  it('ilk kapanış başlangıç bakiyesinin ayında olmalı', () => {
    const months = [open('2026-11', 100)]
    expect(closeBlocker('2026-11', months, '2026-12')).toBeNull()
    expect(closeBlocker('2026-12', months, '2026-12')).toMatch(/2026-11/)
  })

  it('başlangıç bakiyesi yoksa herhangi bir geçmiş/güncel ay kapatılabilir', () => {
    expect(closeBlocker('2026-10', [], '2026-10')).toBeNull()
  })

  it('sıra zorunlu: yalnızca son kapalı ayın ardındaki ay kapatılır', () => {
    const months = [closed('2026-10', 0)]
    expect(closeBlocker('2026-11', months, '2026-12')).toBeNull()
    expect(closeBlocker('2026-12', months, '2026-12')).toMatch(/önce 2026-11/)
    expect(closeBlocker('2026-09', months, '2026-12')).toMatch(/sonraki bir ay/)
    expect(closeBlocker('2026-10', months, '2026-12')).toMatch(/zaten kapalı/)
  })

  it('gelecek ay kapatılamaz', () => {
    expect(closeBlocker('2027-01', [closed('2026-12', 0)], '2026-12')).toMatch(/gelecek/)
  })

  it('yeniden açılabilen tek ay en son kapalı aydır', () => {
    expect(lastClosedMonth([closed('2026-09', 1), closed('2026-10', 2), open('2026-11')])).toBe('2026-10')
    expect(lastClosedMonth([open('2026-11')])).toBeNull()
  })

  it('fark: bankada beklenenden az para varsa gider, fazlaysa gelir, eşitse kayıt yok', () => {
    expect(reconcile(10000, 7000)).toEqual({ direction: 'expense', amount: 3000 })
    expect(reconcile(10000, 12500)).toEqual({ direction: 'income', amount: 2500 })
    expect(reconcile(10000, 10000)).toBeNull()
    expect(reconcile(-5000, -8000)).toEqual({ direction: 'expense', amount: 3000 })
  })
})

describe('düzenleme kapsamı', () => {
  const e = (id: string, month: string, o: Partial<ScopedEntry> = {}): ScopedEntry => ({ id, planId: 'p1', month, paid: false, deleted: false, ...o })
  const all = [
    e('a', '2026-09', { paid: true }),
    e('b', '2026-10', { paid: true }),
    e('c', '2026-11'),
    e('d', '2026-12'),
    e('x', '2026-12', { planId: 'p2' }),
    e('f', '2027-01', { deleted: true }),
    e('g', '2027-02'),
  ]
  const target = all[2]!

  it('this: yalnızca hedef', () => {
    expect(scopeTargets(target, all, 'this', new Set())).toEqual(['c'])
  })

  it('following: hedef ve sonraki ödenmemiş kayıtlar; silinmiş ve başka plan hariç', () => {
    expect(scopeTargets(target, all, 'following', new Set()).sort()).toEqual(['c', 'd', 'g'])
  })

  it('all: ödenmiş kayıtlar asla değişmez', () => {
    expect(scopeTargets(target, all, 'all', new Set()).sort()).toEqual(['c', 'd', 'g'])
  })

  it('kapalı aylardaki kayıtlar atlanır', () => {
    expect(scopeTargets(target, all, 'all', new Set(['2026-12'])).sort()).toEqual(['c', 'g'])
  })

  it('ödenmiş hedefin kendisi her zaman dahildir', () => {
    expect(scopeTargets(all[1]!, all, 'following', new Set()).sort()).toEqual(['b', 'c', 'd', 'g'])
  })

  it('plana bağlı olmayan kayıtta kapsam yok sayılır', () => {
    const single = e('s', '2026-11', { planId: null })
    expect(scopeTargets(single, all, 'all', new Set())).toEqual(['s'])
  })
})

describe('ödeme planı yapıştırma', () => {
  it('her satırdaki tutarı kuruşa çevirir, boş satırları atlar', () => {
    const r = parsePastedAmounts('29.804,98\n\n29.804,98\r\n  30.100,00 TL \n')
    expect(r.amounts).toEqual([2980498, 2980498, 3010000])
    expect(r.invalid).toEqual([])
  })

  it('anlaşılamayan satırları numarasıyla bildirir', () => {
    const r = parsePastedAmounts('1.000,00\nabc\n-5\n2.000,00')
    expect(r.amounts).toEqual([100000, 200000])
    expect(r.invalid).toEqual([{ line: 2, text: 'abc' }, { line: 3, text: '-5' }])
  })
})
