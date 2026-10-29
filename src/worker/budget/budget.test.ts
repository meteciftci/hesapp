import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPlatformProxy, type PlatformProxy, unstable_splitSqlQuery } from 'wrangler'
import type { EntryDto, MonthDto, PlanDto, SettingsDto, SettingsUpdateResult, UpcomingDto, YearDto } from '../../shared/api'
import { createApp } from '../app'
import type { Env } from '../env'

const origin = 'https://hesapp.example.test'
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext
const app = createApp()

let platform: PlatformProxy<Env>
let env: Env

async function call<T = unknown>(method: string, path: string, body?: unknown, e: Env = env): Promise<{ status: number; body: T }> {
  const res = await app.fetch(
    new Request(origin + path, {
      method,
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Requested-With': 'hesapp' },
      body: body === undefined || method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body),
    }),
    e,
    ctx,
  )
  return { status: res.status, body: (await res.json()) as T }
}
const get = <T>(path: string) => call<T>('GET', path)
const post = <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {})
const patch = <T>(path: string, body: unknown) => call<T>('PATCH', path, body)

const TRY = (lira: number) => Math.round(lira * 100)

async function newPlan(body: Record<string, unknown>) {
  const res = await post<{ plan: PlanDto; createdEntries: number }>('/api/plans', body)
  expect(res.status).toBe(201)
  return res.body
}
async function monthOf(month: string) {
  const res = await get<MonthDto>(`/api/months/${month}`)
  expect(res.status).toBe(200)
  return res.body
}
async function newEntry(month: string, direction: 'income' | 'expense', name: string, lira: number, dueDate?: string) {
  const res = await post<EntryDto>('/api/entries', { month, direction, name, plannedAmount: TRY(lira), dueDate })
  expect(res.status).toBe(201)
  return res.body
}

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({ configPath: 'wrangler.jsonc', persist: false })
  env = { ...platform.env, AUTH_MODE: 'access', DEV_USER_EMAIL: 'ornek@example.com', TZ: 'Europe/Istanbul' }
  const dir = join(process.cwd(), 'migrations')
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
    for (const sql of unstable_splitSqlQuery(await readFile(join(dir, name), 'utf8'))) await env.DB.prepare(sql).run()
  }
}, 60_000)

beforeEach(async () => {
  await env.DB.batch(['audit_log', 'entries', 'plans', 'months', 'settings'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
  // Sabit "bugün": 5 Kasım 2026 (İstanbul)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-05T09:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

afterAll(async () => {
  await platform?.dispose()
})

describe('taksitli plan', () => {
  it('tüm taksitleri üretir, geçmiş taksitleri ödendi sayar ve özet verir', async () => {
    const { plan, createdEntries } = await newPlan({ direction: 'expense', kind: 'installment', name: 'Örnek Araç Kredisi', amount: TRY(29804.98), dayOfMonth: 24, startMonth: '2026-10', installmentCount: 12, autoPay: true, markPastPaid: true })
    expect(createdEntries).toBe(12)
    expect(plan).toMatchObject({ kind: 'installment', endMonth: '2027-09', installmentCount: 12, closed: false })
    expect(plan.stats).toMatchObject({ total: 12, paid: 1, nextDue: '2026-11-24' })
    expect(plan.stats.remainingAmount).toBe(TRY(29804.98) * 11)

    const detail = await get<{ plan: PlanDto; entries: EntryDto[] }>(`/api/plans/${plan.id}`)
    expect(detail.body.entries.map((e) => [e.installmentNo, e.month, e.dueDate, e.paid])).toEqual([
      [1, '2026-10', '2026-10-24', true],
      ...Array.from({ length: 11 }, (_, i) => [i + 2, expect.any(String), expect.any(String), false]),
    ])
    expect(detail.body.entries[11]).toMatchObject({ month: '2027-09', installmentCount: 12 })
  })

  it('ayın günü kısa aylarda ayın son gününe sıkışır', async () => {
    const { plan } = await newPlan({ direction: 'expense', kind: 'installment', name: 'Örnek Taksit', amount: 100, dayOfMonth: 31, startMonth: '2027-01', installmentCount: 3 })
    const detail = await get<{ entries: EntryDto[] }>(`/api/plans/${plan.id}`)
    expect(detail.body.entries.map((e) => e.dueDate)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
  })

  it('geçerli olmayan plan isteklerini reddeder', async () => {
    const base = { direction: 'expense', name: 'X', amount: 100, dayOfMonth: 5, startMonth: '2026-11' }
    expect((await post('/api/plans', { ...base, kind: 'installment' })).status).toBe(400) // taksit sayısı yok
    expect((await post('/api/plans', { ...base, kind: 'recurring', installmentCount: 3 })).status).toBe(400)
    expect((await post('/api/plans', { ...base, kind: 'recurring', amount: -5 })).status).toBe(400)
    expect((await post('/api/plans', { ...base, kind: 'recurring', amount: 10.5 })).status).toBe(400)
    expect((await post('/api/plans', { ...base, kind: 'recurring', startMonth: '2026-13' })).status).toBe(400)
    expect((await post('/api/plans', { ...base, kind: 'recurring', bilinmeyen: 1 })).status).toBe(400)
    expect((await post('/api/plans', { ...base, kind: 'recurring', endMonth: '2026-01' })).status).toBe(400)
  })
})

describe('tekrarlayan plan', () => {
  it('bugünden 12 ay ileriye üretir, uzak ay istenince tamamlar, silinen kaydı geri üretmez', async () => {
    const { plan, createdEntries } = await newPlan({ direction: 'income', kind: 'recurring', name: 'Örnek Maaş', amount: TRY(100000), dayOfMonth: 15, startMonth: '2026-11' })
    expect(createdEntries).toBe(13) // 2026-11 … 2027-11

    const far = await monthOf('2028-03') // eksik aylar tamamlanır
    expect(far.entries.map((e) => e.name)).toEqual(['Örnek Maaş'])
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries WHERE plan_id = ?').bind(plan.id).first<{ n: number }>()
    expect(count?.n).toBe(17) // 2026-11 … 2028-03

    const dec = (await monthOf('2026-12')).entries[0]!
    expect((await call('DELETE', `/api/entries/${dec.id}`)).status).toBe(200)
    expect((await monthOf('2026-12')).entries).toEqual([])
    expect((await monthOf('2026-12')).entries).toEqual([]) // yeniden üretilmedi
    expect((await post<EntryDto>(`/api/entries/${dec.id}/restore`)).status).toBe(200)
    expect((await monthOf('2026-12')).entries).toHaveLength(1)
  })

  it('değişken plan kayıtları tahmini işaretle doğar; gerçek tutar girilince tahmin kalkar', async () => {
    await newPlan({ direction: 'expense', kind: 'recurring', name: 'Örnek Kart', amount: TRY(15000), dayOfMonth: 22, startMonth: '2026-11', variable: true, autoPay: true })
    const entry = (await monthOf('2026-11')).entries[0]!
    expect(entry).toMatchObject({ isEstimate: true, autoPay: true })
    const done = await post<EntryDto>(`/api/entries/${entry.id}/pay`, { actualAmount: TRY(17014.38) })
    expect(done.body).toMatchObject({ paid: true, isEstimate: false, actualAmount: TRY(17014.38), amount: TRY(17014.38), plannedAmount: TRY(15000) })
  })
})

describe('düzenleme kapsamı', () => {
  async function recurring() {
    const { plan } = await newPlan({ direction: 'expense', kind: 'recurring', name: 'Örnek Kira', amount: TRY(1000), dayOfMonth: 10, startMonth: '2026-11' })
    const byMonth = async (m: string) => (await monthOf(m)).entries[0]!
    return { plan, byMonth }
  }

  it('sadece bu: yalnızca o kayıt değişir ve "elle düzenlendi" işaretlenir', async () => {
    const { plan, byMonth } = await recurring()
    const dec = await byMonth('2026-12')
    const res = await patch<{ entry: EntryDto; affected: number }>(`/api/entries/${dec.id}`, { plannedAmount: TRY(1500), scope: 'this' })
    expect(res.body.affected).toBe(1)
    expect(res.body.entry).toMatchObject({ plannedAmount: TRY(1500), overridden: true })
    expect((await byMonth('2027-01')).plannedAmount).toBe(TRY(1000))
    expect((await get<{ plan: PlanDto }>(`/api/plans/${plan.id}`)).body.plan.amount).toBe(TRY(1000))
  })

  it('bu ve sonrakiler: önceki aylar, ödenmiş kayıtlar değişmez; plan varsayılanı ve yeni aylar güncellenir', async () => {
    const { plan, byMonth } = await recurring()
    const nov = await byMonth('2026-11')
    await post(`/api/entries/${nov.id}/pay`)
    const dec = await byMonth('2026-12')
    const jan = await byMonth('2027-01')
    await post(`/api/entries/${jan.id}/pay`) // ödenmiş: değişmemeli

    const res = await patch<{ entry: EntryDto; affected: number }>(`/api/entries/${dec.id}`, { plannedAmount: TRY(1200), dueDate: '2026-12-20', scope: 'following' })
    expect(res.status).toBe(200)
    expect(await byMonth('2026-11')).toMatchObject({ plannedAmount: TRY(1000), dueDate: '2026-11-10' })
    expect(await byMonth('2026-12')).toMatchObject({ plannedAmount: TRY(1200), dueDate: '2026-12-20', overridden: false })
    expect(await byMonth('2027-01')).toMatchObject({ plannedAmount: TRY(1000), paid: true }) // ödenmiş korunur
    expect(await byMonth('2027-02')).toMatchObject({ plannedAmount: TRY(1200), dueDate: '2027-02-20' })
    expect((await get<{ plan: PlanDto }>(`/api/plans/${plan.id}`)).body.plan).toMatchObject({ amount: TRY(1200), dayOfMonth: 20 })
    // ufuktan sonra üretilen aylar da yeni varsayılanla gelir
    expect((await monthOf('2028-06')).entries[0]).toMatchObject({ plannedAmount: TRY(1200), dueDate: '2028-06-20' })
  })

  it('tümü: ödenmemiş tüm kayıtlar değişir', async () => {
    const { byMonth } = await recurring()
    const nov = await byMonth('2026-11')
    await post(`/api/entries/${nov.id}/pay`)
    const dec = await byMonth('2026-12')
    await patch(`/api/entries/${dec.id}`, { name: 'Yeni ad', scope: 'all' })
    expect((await byMonth('2026-11')).name).toBe('Örnek Kira') // ödenmiş
    expect((await byMonth('2027-05')).name).toBe('Yeni ad')
  })

  it('gerçekleşen tutar yalnızca "sadece bu" kapsamında değişir; plansız kayıtta kapsam kullanılamaz', async () => {
    const { byMonth } = await recurring()
    const dec = await byMonth('2026-12')
    expect((await patch(`/api/entries/${dec.id}`, { actualAmount: 5, scope: 'following' })).status).toBe(400)
    const single = await newEntry('2026-11', 'expense', 'Tek seferlik', 50)
    expect((await patch(`/api/entries/${single.id}`, { plannedAmount: 60, scope: 'all' })).status).toBe(400)
    expect((await patch(`/api/entries/${single.id}`, {})).status).toBe(400)
    expect((await patch(`/api/entries/${single.id}`, { dueDate: '2026-12-01' })).status).toBe(400) // başka ay
  })

  it('kapalı aylardaki kayıtlar toplu değişiklikte atlanır', async () => {
    const { byMonth } = await recurring()
    await call('PUT', '/api/months/2026-11/opening', { balance: 0 })
    const nov = await byMonth('2026-11')
    const dec = await byMonth('2026-12')
    expect((await post('/api/months/2026-11/close', { bankBalance: -TRY(1000) })).status).toBe(200)
    expect((await patch(`/api/entries/${nov.id}`, { plannedAmount: 1, scope: 'this' })).status).toBe(409)
    await patch(`/api/entries/${dec.id}`, { plannedAmount: TRY(900), scope: 'all' })
    expect((await monthOf('2026-11')).entries[0]!.plannedAmount).toBe(TRY(1000)) // kapalı ay değişmedi
    expect((await byMonth('2027-02')).plannedAmount).toBe(TRY(900))
  })
})

describe('ödendi, silme ve geri alma', () => {
  it('öde / ödemeyi geri al; kapalı ayda reddedilir; kapanış farkı silinemez', async () => {
    const e = await newEntry('2026-11', 'expense', 'Örnek', 100, '2026-11-20')
    expect((await post<EntryDto>(`/api/entries/${e.id}/pay`)).body.paid).toBe(true)
    expect((await post<EntryDto>(`/api/entries/${e.id}/unpay`)).body.paid).toBe(false)

    await call('PUT', '/api/months/2026-11/opening', { balance: 0 })
    await post('/api/months/2026-11/close', { bankBalance: 0 })
    expect((await post(`/api/entries/${e.id}/pay`)).status).toBe(409)
    expect((await call('DELETE', `/api/entries/${e.id}`)).status).toBe(409)
    const recon = (await monthOf('2026-11')).entries.find((x) => x.type === 'reconciliation')!
    expect(recon).toBeDefined()
    expect((await call('DELETE', `/api/entries/${recon.id}`)).status).toBe(400) // kapanış farkı elle silinemez
    expect((await post('/api/entries', { month: '2026-11', direction: 'expense', name: 'Geç', plannedAmount: 1 })).status).toBe(409)
  })

  it('olmayan kayıt 404 verir, tek seferlik kaydın vadesi ay içinde olmalı', async () => {
    expect((await post('/api/entries/yok/pay')).status).toBe(404)
    expect((await post('/api/entries', { month: '2026-11', direction: 'expense', name: 'X', plannedAmount: 1, dueDate: '2026-12-01' })).status).toBe(400)
  })
})

describe('devir ve ay kapanışı', () => {
  async function seedNovember() {
    await call('PUT', '/api/months/2026-11/opening', { balance: TRY(10000) })
    await newEntry('2026-11', 'income', 'Gelir', 50000, '2026-11-15')
    await newEntry('2026-11', 'expense', 'Gider', 30000, '2026-11-20')
  }

  it('başlangıç bakiyesi o ayın açılışıdır; sonraki aylar geçici devirle ilerler', async () => {
    await seedNovember()
    const nov = await monthOf('2026-11')
    expect(nov.opening).toEqual({ amount: TRY(10000), provisional: false })
    expect(nov.totals).toMatchObject({ income: TRY(50000), expense: TRY(30000), net: TRY(20000), expectedClosing: TRY(30000) })
    expect((await monthOf('2026-12')).opening).toEqual({ amount: TRY(30000), provisional: true })
    expect((await monthOf('2026-10')).opening).toEqual({ amount: 0, provisional: false })
  })

  it('kapanışta fark "kayıt dışı harcama" olur, banka bakiyesi bir sonraki ayın kesin devridir', async () => {
    await seedNovember()
    const closed = await post<MonthDto>('/api/months/2026-11/close', { bankBalance: TRY(25000) })
    expect(closed.status).toBe(200)
    expect(closed.body).toMatchObject({ status: 'closed', closingBalance: TRY(25000) })
    const recon = closed.body.entries.find((e) => e.type === 'reconciliation')!
    expect(recon).toMatchObject({ direction: 'expense', amount: TRY(5000), name: 'Kayıt dışı harcamalar', paid: true })
    expect(closed.body.totals.expectedClosing).toBe(TRY(25000)) // fark eklendikten sonra tutarlı

    expect((await monthOf('2026-12')).opening).toEqual({ amount: TRY(25000), provisional: false })
  })

  it('banka bakiyesi beklenenden fazlaysa fark gelir olarak eklenir; eksi bakiye (KMH) devredilir', async () => {
    await seedNovember()
    const more = await post<MonthDto>('/api/months/2026-11/close', { bankBalance: TRY(32000), name: 'Beklenmeyen gelir' })
    expect(more.body.entries.find((e) => e.type === 'reconciliation')).toMatchObject({ direction: 'income', amount: TRY(2000), name: 'Beklenmeyen gelir' })

    await post('/api/months/2026-11/reopen')
    const negative = await post<MonthDto>('/api/months/2026-11/close', { bankBalance: -TRY(8401.95) })
    expect(negative.body.entries.find((e) => e.type === 'reconciliation')).toMatchObject({ direction: 'expense', amount: TRY(30000) + TRY(8401.95) })
    expect((await monthOf('2026-12')).opening).toEqual({ amount: -TRY(8401.95), provisional: false })
  })

  it('fark yoksa kayıt eklenmez', async () => {
    await seedNovember()
    const res = await post<MonthDto>('/api/months/2026-11/close', { bankBalance: TRY(30000) })
    expect(res.body.entries.some((e) => e.type === 'reconciliation')).toBe(false)
  })

  it('kapanış sırası ve zamanı denetlenir', async () => {
    await seedNovember()
    expect((await post('/api/months/2026-12/close', { bankBalance: 0 })).status).toBe(409) // gelecek ay
    expect((await post('/api/months/2026-10/close', { bankBalance: 0 })).status).toBe(409) // başlangıçtan önce
    await post('/api/months/2026-11/close', { bankBalance: TRY(30000) })
    expect((await post('/api/months/2026-11/close', { bankBalance: TRY(30000) })).status).toBe(409) // zaten kapalı
    expect((await call('PUT', '/api/months/2026-12/opening', { balance: 0 })).status).toBe(409) // kapalı ay varken
  })

  it('yalnızca en son kapatılan ay yeniden açılır; kapanış farkı silinir, devir geçici olur', async () => {
    await seedNovember()
    await post('/api/months/2026-11/close', { bankBalance: TRY(25000) })
    expect((await post('/api/months/2026-12/reopen')).status).toBe(409)
    const reopened = await post<MonthDto>('/api/months/2026-11/reopen')
    expect(reopened.body.status).toBe('open')
    expect(reopened.body.entries.some((e) => e.type === 'reconciliation')).toBe(false)
    expect((await monthOf('2026-12')).opening).toEqual({ amount: TRY(30000), provisional: true })
  })
})

describe('yaklaşan ve yıl', () => {
  it('gecikenleri ve önümüzdeki günleri ayırır; ödenenleri ve kapalı ayları saymaz', async () => {
    await newEntry('2026-11', 'expense', 'Geçmiş', 10, '2026-11-01')
    const paid = await newEntry('2026-11', 'expense', 'Ödenmiş', 10, '2026-11-02')
    await post(`/api/entries/${paid.id}/pay`)
    await newEntry('2026-11', 'expense', 'Bugün', 10, '2026-11-05')
    await newEntry('2026-11', 'expense', 'Yakın', 10, '2026-11-20')
    await newEntry('2026-12', 'expense', 'Uzak', 10, '2026-12-28')
    await newEntry('2026-12', 'expense', 'Çok uzak', 10, '2027-01-02').catch(() => undefined)

    const res = await get<UpcomingDto>('/api/upcoming?days=30')
    expect(res.body.today).toBe('2026-11-05')
    expect(res.body.overdue.map((e) => e.name)).toEqual(['Geçmiş'])
    expect(res.body.upcoming.map((e) => e.name)).toEqual(['Bugün', 'Yakın'])
    expect((await get<UpcomingDto>('/api/upcoming?days=60')).body.upcoming.map((e) => e.name)).toContain('Uzak')
  })

  it('yıl özeti: aylık toplamlar, devir zinciri ve kapalı ay bakiyesi', async () => {
    await call('PUT', '/api/months/2026-11/opening', { balance: TRY(1000) })
    await newEntry('2026-11', 'income', 'Gelir', 500, '2026-11-15')
    await newEntry('2026-11', 'expense', 'Gider', 200, '2026-11-20')
    await post('/api/months/2026-11/close', { bankBalance: TRY(1300) })
    await newEntry('2026-12', 'expense', 'Aralık gideri', 100, '2026-12-05')

    const { body } = await get<YearDto>('/api/years/2026')
    expect(body.months).toHaveLength(12)
    const nov = body.months[10]!
    expect(nov).toMatchObject({ status: 'closed', income: TRY(500), expense: TRY(200), closing: TRY(1300) })
    const dec = body.months[11]!
    expect(dec).toMatchObject({ status: 'open', expense: TRY(100), opening: { amount: TRY(1300), provisional: false }, closing: TRY(1200) })
    expect(body.totals).toMatchObject({ income: TRY(500), expense: TRY(300) })
  })
})

describe('plan kapatma, silme ve ödeme planı', () => {
  it('erken kapatma: sonraki ödenmemiş taksitler kalkar, kapatma tutarı tek kayıt olur', async () => {
    const { plan } = await newPlan({ direction: 'expense', kind: 'installment', name: 'Örnek Kredi', amount: TRY(1000), dayOfMonth: 15, startMonth: '2026-11', installmentCount: 6 })
    const res = await post<{ ok: boolean; removedEntries: number }>(`/api/plans/${plan.id}/close`, { fromMonth: '2027-01', payoffAmount: TRY(3500) })
    expect(res.body.removedEntries).toBe(4)
    expect((await post(`/api/plans/${plan.id}/close`, { fromMonth: '2027-01' })).status).toBe(409)

    const detail = await get<{ plan: PlanDto; entries: EntryDto[] }>(`/api/plans/${plan.id}`)
    expect(detail.body.plan).toMatchObject({ closed: true })
    expect(detail.body.entries.map((e) => e.month)).toEqual(['2026-11', '2026-12'])
    expect((await monthOf('2027-01')).entries).toMatchObject([{ name: 'Örnek Kredi (erken kapatma)', plannedAmount: TRY(3500), planId: null }])

    expect((await get<PlanDto[]>('/api/plans')).body).toHaveLength(0)
    expect((await get<PlanDto[]>('/api/plans?status=closed')).body).toHaveLength(1)
  })

  it('plan silme: ödenmemiş kayıtlar kalkar, ödenmiş kayıtlar korunur', async () => {
    const { plan } = await newPlan({ direction: 'expense', kind: 'installment', name: 'Örnek', amount: 100, dayOfMonth: 5, startMonth: '2026-11', installmentCount: 3 })
    const first = (await monthOf('2026-11')).entries[0]!
    await post(`/api/entries/${first.id}/pay`)
    const res = await call<{ removedEntries: number }>('DELETE', `/api/plans/${plan.id}`)
    expect(res.body.removedEntries).toBe(2)
    expect((await monthOf('2026-11')).entries).toHaveLength(1)
    expect((await monthOf('2026-12')).entries).toHaveLength(0)
    expect((await get('/api/plans/' + plan.id)).status).toBe(404)
  })

  it('ödeme planı yapıştırma: önizleme, uyuşmazlık, zorla uygulama, geçersiz satır', async () => {
    const { plan } = await newPlan({ direction: 'expense', kind: 'installment', name: 'Örnek', amount: TRY(100), dayOfMonth: 5, startMonth: '2026-11', installmentCount: 4 })
    const first = (await monthOf('2026-11')).entries[0]!
    await post(`/api/entries/${first.id}/pay`) // ödenmiş taksit atlanır

    const text = '110,00\n120,00\n130,00\n140,00'
    const dry = await post<{ willUpdate: number; skipped: number; mismatch: boolean; expected: number }>(`/api/plans/${plan.id}/schedule`, { text, dryRun: true })
    expect(dry.body).toMatchObject({ dryRun: true, mismatch: false, expected: 4, willUpdate: 3, skipped: 1 })

    expect((await post(`/api/plans/${plan.id}/schedule`, { text: '110,00\n120,00' })).status).toBe(409) // sayı uyuşmuyor
    expect((await post(`/api/plans/${plan.id}/schedule`, { text: '110,00\nabc' })).status).toBe(400)
    expect((await post(`/api/plans/${plan.id}/schedule`, { text, amounts: [1] })).status).toBe(400) // yalnızca biri

    const applied = await post(`/api/plans/${plan.id}/schedule`, { text })
    expect(applied.status).toBe(200)
    const detail = await get<{ entries: EntryDto[] }>(`/api/plans/${plan.id}`)
    expect(detail.body.entries.map((e) => e.plannedAmount)).toEqual([TRY(100), TRY(120), TRY(130), TRY(140)]) // ilki ödenmiş, değişmedi
    expect(detail.body.entries[1]!.overridden).toBe(true)

    const forced = await post(`/api/plans/${plan.id}/schedule`, { text: '200,00\n210,00', startNo: 3, force: true })
    expect(forced.status).toBe(200)
    expect((await get<{ entries: EntryDto[] }>(`/api/plans/${plan.id}`)).body.entries.map((e) => e.plannedAmount)).toEqual([TRY(100), TRY(120), TRY(200), TRY(210)])
  })

  it('ödeme planı yalnızca taksitli planlara uygulanır', async () => {
    const { plan } = await newPlan({ direction: 'expense', kind: 'recurring', name: 'Örnek', amount: 100, dayOfMonth: 5, startMonth: '2026-11' })
    expect((await post(`/api/plans/${plan.id}/schedule`, { amounts: [1] })).status).toBe(400)
  })
})

describe('değişiklik geçmişi ve doğrulama', () => {
  it('her değişiklik kimin ne zaman yaptığıyla kaydedilir', async () => {
    const e = await newEntry('2026-11', 'expense', 'Örnek', 100, '2026-11-20')
    await patch(`/api/entries/${e.id}`, { plannedAmount: 250 })
    await post(`/api/entries/${e.id}/pay`)
    const audit = await get<{ action: string; by: string; before: unknown; after: unknown }[]>(`/api/audit?entity=entry&id=${e.id}`)
    expect(audit.status).toBe(200)
    expect(audit.body.map((a) => a.action).sort()).toEqual(['create', 'pay', 'update'])
    expect(audit.body.every((a) => a.by === 'ornek@example.com')).toBe(true)
    expect(audit.body.find((a) => a.action === 'update')).toMatchObject({ before: { plannedAmount: TRY(100) }, after: { plannedAmount: 250 } })
    expect((await get('/api/audit?entity=bilinmeyen&id=1')).status).toBe(400)
  })

  it('geçersiz ay, bozuk gövde ve fazla uzak ay reddedilir', async () => {
    expect((await get('/api/months/2026-13')).status).toBe(400)
    expect((await get('/api/months/abc')).status).toBe(400)
    expect((await post('/api/entries', { month: '2026-11' })).status).toBe(400)
    expect((await get('/api/years/1999')).status).toBe(400)
    const res = await app.fetch(new Request(origin + '/api/entries', { method: 'POST', headers: { Origin: origin, 'X-Requested-With': 'hesapp' }, body: '{bozuk' }), env, ctx)
    expect(res.status).toBe(400)
  })

  it('oturum olmadan (passkey modu) bütçe uçları 401 verir', async () => {
    const passkeyEnv = { ...env, AUTH_MODE: 'passkey', SITE_URL: origin, DEV_USER_EMAIL: undefined }
    expect((await call('GET', '/api/months/2026-11', undefined, passkeyEnv)).status).toBe(401)
    expect((await call('GET', '/api/plans', undefined, passkeyEnv)).status).toBe(401)
  })
})

describe('dönem başlangıç günü', () => {
  const put = (day: number) => call<SettingsUpdateResult>('PUT', '/api/settings', { periodStartDay: day })

  it('varsayılan 1 (takvim ayı); geçersiz değerler reddedilir', async () => {
    expect((await get<SettingsDto>('/api/settings')).body).toEqual({ periodStartDay: 1 })
    expect(await monthOf('2026-10')).toMatchObject({ start: '2026-10-01', end: '2026-10-31' })
    for (const bad of [0, 29, 15.5, '15', null]) expect((await call('PUT', '/api/settings', { periodStartDay: bad })).status).toBe(400)
    expect((await call('PUT', '/api/settings', { periodStartDay: 15, baska: 1 })).status).toBe(400)
  })

  it('başlangıç 15: dönem aralığı ve plan vadeleri döneme göre üretilir', async () => {
    expect((await put(15)).body).toMatchObject({ periodStartDay: 15, recalculated: 0 })
    expect(await monthOf('2026-10')).toMatchObject({ start: '2026-10-15', end: '2026-11-14' })

    const big = await newPlan({ direction: 'expense', kind: 'installment', name: 'Gün 24', amount: 100, dayOfMonth: 24, startMonth: '2026-10', installmentCount: 3 })
    const small = await newPlan({ direction: 'income', kind: 'installment', name: 'Gün 5', amount: 100, dayOfMonth: 5, startMonth: '2026-10', installmentCount: 3 })
    const dues = async (id: string) => (await get<{ entries: EntryDto[] }>(`/api/plans/${id}`)).body.entries.map((e) => [e.month, e.dueDate])
    expect(await dues(big.plan.id)).toEqual([['2026-10', '2026-10-24'], ['2026-11', '2026-11-24'], ['2026-12', '2026-12-24']])
    expect(await dues(small.plan.id)).toEqual([['2026-10', '2026-11-05'], ['2026-11', '2026-12-05'], ['2026-12', '2027-01-05']])
    // dönem içindeki kayıtlar vade sırasıyla gelir
    expect((await monthOf('2026-10')).entries.map((e) => e.name)).toEqual(['Gün 24', 'Gün 5'])
  })

  it('"bugün" döneme göre bulunur: 5 Kasım, başlangıç 15 iken hâlâ Ekim dönemindedir', async () => {
    await put(15)
    await call('PUT', '/api/months/2026-10/opening', { balance: 0 })
    expect((await post('/api/months/2026-11/close', { bankBalance: 0 })).status).toBe(409) // gelecek dönem
    expect((await post('/api/months/2026-10/close', { bankBalance: 0 })).status).toBe(200)
  })

  it('kapanış farkı kaydının vadesi dönemin son günüdür', async () => {
    await put(15)
    await call('PUT', '/api/months/2026-10/opening', { balance: 0 })
    await newEntry('2026-10', 'expense', 'Gider', 100, '2026-10-20')
    const closed = await post<MonthDto>('/api/months/2026-10/close', { bankBalance: -TRY(150) })
    expect(closed.body.entries.find((e) => e.type === 'reconciliation')).toMatchObject({ dueDate: '2026-11-14', amount: TRY(50) })
  })

  it('kayıt vadesi dönemin içinde olmalı', async () => {
    await put(15)
    expect((await post('/api/entries', { month: '2026-10', direction: 'expense', name: 'İçeride', plannedAmount: 1, dueDate: '2026-11-14' })).status).toBe(201)
    expect((await post('/api/entries', { month: '2026-10', direction: 'expense', name: 'Dışarıda', plannedAmount: 1, dueDate: '2026-11-15' })).status).toBe(400)
    expect((await post('/api/entries', { month: '2026-10', direction: 'expense', name: 'Dışarıda', plannedAmount: 1, dueDate: '2026-10-14' })).status).toBe(400)
    const e = await newEntry('2026-10', 'expense', 'Düzenlenecek', 10, '2026-10-20')
    const bad = await patch<{ error: string }>(`/api/entries/${e.id}`, { dueDate: '2026-11-20' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toContain('2026-10-15')
    expect((await patch(`/api/entries/${e.id}`, { dueDate: '2026-11-10' })).status).toBe(200)
  })

  it('bu ve sonraki kayıtlarda vade günü değişince vadeler dönem kuralına göre kayar', async () => {
    await put(15)
    await newPlan({ direction: 'expense', kind: 'recurring', name: 'Kira', amount: 100, dayOfMonth: 24, startMonth: '2026-10' })
    const nov = (await monthOf('2026-11')).entries[0]!
    expect(nov.dueDate).toBe('2026-11-24')
    await patch(`/api/entries/${nov.id}`, { dueDate: '2026-12-03', scope: 'following' }) // gün 3 < 15 → ertesi ay
    expect((await monthOf('2026-11')).entries[0]!.dueDate).toBe('2026-12-03')
    expect((await monthOf('2026-12')).entries[0]!.dueDate).toBe('2027-01-03')
    expect((await monthOf('2026-10')).entries[0]!.dueDate).toBe('2026-10-24') // öncesi değişmedi
  })

  it('yaklaşan ekranı vade tarihine göre çalışır', async () => {
    await put(15)
    await newPlan({ direction: 'income', kind: 'recurring', name: 'Maaş', amount: 100, dayOfMonth: 5, startMonth: '2026-10' }) // vade 2026-11-05 (bugün)
    await newPlan({ direction: 'expense', kind: 'recurring', name: 'Kira', amount: 100, dayOfMonth: 24, startMonth: '2026-10' })
    const res = await get<UpcomingDto>('/api/upcoming?days=30')
    expect(res.body.upcoming.map((e) => [e.name, e.dueDate])).toEqual([['Maaş', '2026-11-05'], ['Kira', '2026-11-24'], ['Maaş', '2026-12-05']])
    expect(res.body.overdue.map((e) => [e.name, e.dueDate])).toEqual([['Kira', '2026-10-24']]) // Ekim dönemi kirası vadesi geçti
  })

  it('başlangıç günü değişince elle düzenlenmemiş plan vadeleri yeniden hesaplanır; elle girilenler korunur ve bildirilir', async () => {
    const { plan } = await newPlan({ direction: 'expense', kind: 'installment', name: 'Taksit', amount: 100, dayOfMonth: 5, startMonth: '2026-11', installmentCount: 2 })
    const manual = await newEntry('2026-11', 'expense', 'Elle', 10, '2026-11-08')
    const edited = (await monthOf('2026-12')).entries[0]!
    await patch(`/api/entries/${edited.id}`, { plannedAmount: 5 }) // elle düzenlendi: günü korunur, yalnızca döneme yerleştirilir

    const res = await put(15)
    expect(res.body.recalculated).toBe(2) // Kasım taksiti (plan günü) ve elle düzenlenen Aralık taksiti (günü korundu)
    expect(res.body.outsidePeriod).toBe(1) // tek seferlik 8 Kasım, artık Kasım döneminin (15 Kas–14 Ara) dışında
    const detail = await get<{ entries: EntryDto[] }>(`/api/plans/${plan.id}`)
    expect(detail.body.entries.map((e) => [e.month, e.dueDate])).toEqual([['2026-11', '2026-12-05'], ['2026-12', '2027-01-05']])
    expect((await monthOf('2026-11')).entries.find((e) => e.id === manual.id)!.dueDate).toBe('2026-11-08')

    const same = await put(15) // değişiklik yoksa hiçbir şey yeniden hesaplanmaz
    expect(same.body).toMatchObject({ recalculated: 0, outsidePeriod: 1 })
    const audit = await get<{ action: string; by: string; after: unknown }[]>('/api/audit?entity=settings&id=period_start_day')
    expect(audit.body).toHaveLength(1)
    expect(audit.body[0]).toMatchObject({ action: 'update', by: 'ornek@example.com', after: { periodStartDay: 15, recalculated: 2 } })
  })

  it('kapalı dönem varken başlangıç günü değiştirilemez', async () => {
    await call('PUT', '/api/months/2026-11/opening', { balance: 0 })
    await post('/api/months/2026-11/close', { bankBalance: 0 })
    const res = await put(15)
    expect(res.status).toBe(409)
    expect((await get<SettingsDto>('/api/settings')).body.periodStartDay).toBe(1)
  })

  it('yıl özeti dönem aralıklarını taşır', async () => {
    await put(15)
    const { body } = await get<YearDto>('/api/years/2026')
    expect(body.months[0]).toMatchObject({ month: '2026-01', start: '2026-01-15', end: '2026-02-14' })
    expect(body.months[11]).toMatchObject({ month: '2026-12', start: '2026-12-15', end: '2027-01-14' })
  })
})
