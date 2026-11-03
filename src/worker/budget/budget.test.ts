import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPlatformProxy, type PlatformProxy, unstable_splitSqlQuery } from 'wrangler'
import type { AuditRecentItem, CategoryDto, DebtPoint, EntryDto, MonthDto, PlanDetailDto, PlanDto, SearchDto, SettingsDto, SettingsUpdateResult, UpcomingDto, YearDto } from '../../shared/api'
import { createApp } from '../app'
import { broadcast, dueTomorrow, sendDueReminders } from '../push/reminders'
import { b64urlEncode } from '../push/webpush'
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
  await env.DB.batch([
    ...['audit_log', 'entry_items', 'entries', 'plans', 'months', 'settings', 'push_subscriptions'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    env.DB.prepare("DELETE FROM categories WHERE id NOT LIKE 'cat-%'"),
    env.DB.prepare('UPDATE categories SET deleted_at = NULL'),
  ])
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
    expect(plan.stats).toMatchObject({ paidAmount: TRY(29804.98), totalAmount: TRY(29804.98) * 12 })

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

describe('yedek ve geri yükleme', () => {
  type Backup = { format: string; version: number; exportedAt: string; data: { plans: unknown[]; entries: unknown[]; months: unknown[]; auditLog: unknown[]; settings: SettingsDto } }

  async function seed() {
    await call('PUT', '/api/settings', { periodStartDay: 15 })
    await call('PUT', '/api/months/2026-11/opening', { balance: TRY(1000) })
    const { plan } = await newPlan({ direction: 'expense', kind: 'installment', name: 'Örnek Konut Kredisi', amount: TRY(7500), dayOfMonth: 15, startMonth: '2026-09', installmentCount: 6, autoPay: true })
    const ents = (await get<{ plan: PlanDto; entries: EntryDto[] }>(`/api/plans/${plan.id}`)).body.entries
    await post(`/api/entries/${ents[0]!.id}/pay`)
    await newEntry('2026-11', 'income', 'Maaş A', 20000, '2026-11-20')
    const removed = await newEntry('2026-11', 'expense', 'Silinecek', 10, '2026-11-21')
    await call('DELETE', `/api/entries/${removed.id}`)
    await post('/api/months/2026-11/close', { bankBalance: TRY(9000) })
  }

  async function exportAll() {
    const res = await get<Backup>('/api/export')
    expect(res.status).toBe(200)
    return res.body
  }

  it('dışa aktar → boş veritabanına içe aktar → aynı sonuç', async () => {
    await seed()
    const before = await exportAll()
    expect(before).toMatchObject({ format: 'hesapp-backup', version: 3 })
    expect(before.data.settings.periodStartDay).toBe(15)
    const novBefore = await monthOf('2026-11')

    await env.DB.batch(['audit_log', 'entry_items', 'entries', 'plans', 'months', 'settings'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
    const restored = await post<{ ok: boolean; plans: number; entries: number }>('/api/import', before)
    expect(restored.status).toBe(201)
    expect(restored.body).toMatchObject({ ok: true, plans: 1, entries: before.data.entries.length })

    const after = await exportAll()
    expect(after.data.plans).toEqual(before.data.plans)
    expect(after.data.entries).toEqual(before.data.entries)
    expect(after.data.months).toEqual(before.data.months)
    expect(after.data.settings).toEqual(before.data.settings)
    expect(after.data.auditLog.length).toBe(before.data.auditLog.length + 1) // içe aktarma kaydı
    expect(await monthOf('2026-11')).toEqual(novBefore)
  })

  it('veri varken ya da yedek bozukken geri yüklemeyi reddeder', async () => {
    await seed()
    const backup = await exportAll()
    expect((await post('/api/import', backup)).status).toBe(409)
    // Değiştirme modu: mevcut veri silinip yedekle değiştirilir.
    await newEntry('2026-11', 'expense', 'Fazladan', 5, '2026-11-20')
    const replaced = await post<{ ok: boolean }>('/api/import?replace=1', backup)
    expect(replaced.status).toBe(201)
    expect((await exportAll()).data.entries).toEqual(backup.data.entries)

    await env.DB.batch(['audit_log', 'entry_items', 'entries', 'plans', 'months', 'settings'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
    expect((await post('/api/import', { format: 'baska', version: 1, data: {} })).status).toBe(400)
    expect((await post('/api/import', { ...backup, version: 99 })).status).toBe(400)
    const orphan = structuredClone(backup)
    ;(orphan.data.entries[0] as { plan_id: string | null }).plan_id = 'yok'
    expect((await post('/api/import', orphan)).status).toBe(400)
    const negative = structuredClone(backup)
    ;(negative.data.plans[0] as { amount: number }).amount = -5
    expect((await post('/api/import', negative)).status).toBe(400)
    expect((await get<MonthDto>('/api/months/2026-11')).body.entries).toHaveLength(0) // hiçbir şey yazılmadı
  })
})

describe('toplu kayıt (içe aktarma)', () => {
  it('birden çok tek seferlik kaydı ekler; kapalı dönemi ve dönem dışı vadeyi reddeder', async () => {
    const ok = await post<{ created: number }>('/api/entries/bulk', {
      entries: [
        { month: '2026-10', direction: 'expense', name: 'Market', plannedAmount: TRY(500), dueDate: '2026-10-12' },
        { month: '2026-10', direction: 'income', name: 'Maaş A', plannedAmount: TRY(20000) },
      ],
    })
    expect(ok.status).toBe(201)
    expect(ok.body.created).toBe(2)
    expect((await monthOf('2026-10')).entries).toHaveLength(2)

    const outside = await post('/api/entries/bulk', { entries: [{ month: '2026-10', direction: 'expense', name: 'X', plannedAmount: 100, dueDate: '2026-11-02' }] })
    expect(outside.status).toBe(400)
    expect((await post('/api/entries/bulk', { entries: [] })).status).toBe(400)

    await call('PUT', '/api/months/2026-10/opening', { balance: 0 })
    await post('/api/months/2026-10/close', { bankBalance: 0 })
    expect((await post('/api/entries/bulk', { entries: [{ month: '2026-10', direction: 'expense', name: 'Y', plannedAmount: 100 }] })).status).toBe(409)
  })
})

describe('tüm verileri silme', () => {
  it('onay olmadan reddeder; onayla bütçe verisini siler, dönem başlangıç günü kalır', async () => {
    await call('PUT', '/api/settings', { periodStartDay: 15 })
    await newPlan({ direction: 'expense', kind: 'installment', name: 'Örnek Kredi', amount: TRY(100), dayOfMonth: 20, startMonth: '2026-11', installmentCount: 3 })
    await newEntry('2026-11', 'income', 'Maaş A', 1000, '2026-11-20')
    expect((await post('/api/data/wipe', {})).status).toBe(400)
    expect((await get<MonthDto>('/api/months/2026-11')).body.entries.length).toBeGreaterThan(0)

    const res = await post<{ ok: boolean; plans: number; entries: number }>('/api/data/wipe', { confirm: true })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, plans: 1 })
    expect((await get<MonthDto>('/api/months/2026-11')).body.entries).toHaveLength(0)
    expect((await get<PlanDto[]>('/api/plans')).body).toHaveLength(0)
    expect((await get<SettingsDto>('/api/settings')).body.periodStartDay).toBe(15)
  })
})

describe('genel değişiklik geçmişi', () => {
  it('tüm değişiklikleri yeniden eskiye, adlarıyla ve sayfalı verir', async () => {
    const e1 = await newEntry('2026-11', 'expense', 'Market', 100, '2026-11-12')
    vi.setSystemTime(new Date('2026-11-05T09:01:00Z'))
    await post(`/api/entries/${e1.id}/pay`)
    vi.setSystemTime(new Date('2026-11-05T09:02:00Z'))
    const { plan } = await newPlan({ direction: 'expense', kind: 'installment', name: 'Örnek Kredi', amount: TRY(10), dayOfMonth: 20, startMonth: '2026-11', installmentCount: 2 })
    const page1 = await get<{ items: AuditRecentItem[]; next: number | null }>('/api/audit/recent?limit=2')
    expect(page1.body.items.map((i) => [i.entity, i.action, i.label])).toEqual([
      ['plan', 'create', plan.name],
      ['entry', 'pay', 'Market'],
    ])
    expect(page1.body.items[1]!.month).toBe('2026-11')
    expect(page1.body.next).not.toBeNull()
    const page2 = await get<{ items: AuditRecentItem[]; next: number | null }>(`/api/audit/recent?limit=2&before=${page1.body.next}`)
    expect(page2.body.items.map((i) => i.action)).toEqual(['create'])
    expect(page2.body.next).toBeNull()
  })
})

describe('gider kalemleri', () => {
  type ItemsBody = { entry: EntryDto; items: { id: string; name: string; amount: number; installmentNo: number | null }[] }

  it('kalemler ay toplamına eklenmez; tahmin kalem toplamının altında kalmaz; gerçekleşen tutar korunur', async () => {
    const card = await post<EntryDto>('/api/entries', { month: '2026-11', direction: 'expense', name: 'Örnek Kart', plannedAmount: TRY(1000), isEstimate: true })
    const a = await post<ItemsBody>(`/api/entries/${card.body.id}/items`, { name: 'Market', amount: TRY(400), date: '2026-10-20' })
    expect(a.status).toBe(201)
    expect(a.body.entry).toMatchObject({ amount: TRY(1000), itemCount: 1, itemsTotal: TRY(400) })
    expect((await monthOf('2026-11')).totals.expense).toBe(TRY(1000))

    const b = await post<ItemsBody>(`/api/entries/${card.body.id}/items`, { name: 'Telefon', amount: TRY(900), installmentNo: 3, installmentCount: 6 })
    expect(b.body.entry).toMatchObject({ plannedAmount: TRY(1300), amount: TRY(1300), itemsTotal: TRY(1300) }) // tahmin yükseldi
    expect(b.body.items.find((i) => i.name === 'Telefon')!.installmentNo).toBe(3)

    await patch(`/api/entries/${card.body.id}`, { actualAmount: TRY(1200) })
    const c = await post<ItemsBody>(`/api/entries/${card.body.id}/items`, { name: 'Mazot', amount: TRY(500) })
    expect(c.body.entry).toMatchObject({ actualAmount: TRY(1200), amount: TRY(1200), itemsTotal: TRY(1800) }) // gerçekleşen değişmez

    const item = c.body.items.find((i) => i.name === 'Mazot')!
    const edited = await patch<ItemsBody>(`/api/entries/${card.body.id}/items/${item.id}`, { amount: TRY(100) })
    expect(edited.body.entry.itemsTotal).toBe(TRY(1400))
    const removed = await call<ItemsBody>('DELETE', `/api/entries/${card.body.id}/items/${item.id}`)
    expect(removed.body.items).toHaveLength(2)
  })

  it('gelire ve kapalı döneme kalem eklenmez; geçersiz taksit reddedilir; yedekle taşınır', async () => {
    const income = await newEntry('2026-11', 'income', 'Maaş A', 100)
    expect((await post(`/api/entries/${income.id}/items`, { name: 'X', amount: 1 })).status).toBe(400)
    const card = await newEntry('2026-11', 'expense', 'Axess', 100)
    expect((await post(`/api/entries/${card.id}/items`, { name: 'X', amount: 1, installmentNo: 4, installmentCount: 3 })).status).toBe(400)
    expect((await post(`/api/entries/${card.id}/items`, { name: 'X', amount: 1, installmentNo: 2 })).status).toBe(400)
    await post(`/api/entries/${card.id}/items`, { name: 'Kitap', amount: TRY(50) })

    const backup = (await get<{ data: { entryItems: unknown[] } }>('/api/export')).body
    expect(backup.data.entryItems).toHaveLength(1)
    expect((await post('/api/import?replace=1', backup)).status).toBe(201)
    expect((await get<{ data: { entryItems: unknown[] } }>('/api/export')).body.data.entryItems).toHaveLength(1)

    await call('PUT', '/api/months/2026-11/opening', { balance: 0 })
    await post('/api/months/2026-11/close', { bankBalance: 0 })
    expect((await post(`/api/entries/${card.id}/items`, { name: 'Y', amount: 1 })).status).toBe(409)
  })
})

describe('hızlı ekleme önerileri', () => {
  it('son tek seferlik kalemleri en sık ve en yeni önce, son tutarıyla verir; plan kayıtlarını katmaz', async () => {
    await newEntry('2026-11', 'expense', 'Market', 100)
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'))
    await newEntry('2026-11', 'expense', 'Mazot', 300)
    vi.setSystemTime(new Date('2026-11-05T11:00:00Z'))
    await newEntry('2026-11', 'expense', 'market', 150)
    await newPlan({ direction: 'expense', kind: 'installment', name: 'Örnek Kredi', amount: TRY(10), dayOfMonth: 20, startMonth: '2026-11', installmentCount: 2 })
    const res = await get<{ name: string; amount: number }[]>('/api/entries/recent')
    expect(res.body).toEqual([
      { name: 'market', direction: 'expense', amount: TRY(150), categoryId: null },
      { name: 'Mazot', direction: 'expense', amount: TRY(300), categoryId: null },
    ])
  })
})

describe('kategoriler ve arama', () => {
  it('hazır liste gelir; eklenir, adı değişir, aynı ad reddedilir, silinince kayıtlar kategorisiz kalır', async () => {
    const list = (await get<CategoryDto[]>('/api/categories')).body
    expect(list.map((x) => x.name)).toContain('Market')
    const added = await post<CategoryDto>('/api/categories', { name: 'Evcil hayvan', direction: 'expense' })
    expect(added.status).toBe(201)
    expect((await post('/api/categories', { name: 'evcil hayvan' })).status).toBe(409)
    expect((await patch<CategoryDto>(`/api/categories/${added.body.id}`, { name: 'Kedi' })).body.name).toBe('Kedi')

    const e = await post<EntryDto>('/api/entries', { month: '2026-11', direction: 'expense', name: 'Mama', plannedAmount: TRY(300), categoryId: added.body.id })
    expect(e.body).toMatchObject({ categoryId: added.body.id, categoryName: 'Kedi' })
    expect((await post('/api/entries', { month: '2026-11', direction: 'expense', name: 'X', plannedAmount: 1, categoryId: 'yok' })).status).toBe(400)

    await call('DELETE', `/api/categories/${added.body.id}`)
    const after = (await monthOf('2026-11')).entries.find((x) => x.id === e.body.id)!
    expect(after).toMatchObject({ categoryId: null, categoryName: null })
  })

  it('plan kayıtları kategoriyi alır; kapsamlı düzenleme ödenmişleri de taşır', async () => {
    const { plan } = await newPlan({ direction: 'expense', kind: 'installment', name: 'Örnek Kredi', amount: TRY(100), dayOfMonth: 20, startMonth: '2026-10', installmentCount: 3, categoryId: 'cat-kredi', markPastPaid: true })
    const ents = (await get<{ entries: EntryDto[] }>(`/api/plans/${plan.id}`)).body.entries
    expect(ents.every((x) => x.categoryId === 'cat-kredi')).toBe(true)
    expect(ents[0]!.paid).toBe(true)
    await patch(`/api/entries/${ents[1]!.id}`, { categoryId: 'cat-ev', scope: 'all' })
    const again = (await get<{ plan: PlanDto; entries: EntryDto[] }>(`/api/plans/${plan.id}`)).body
    expect(again.entries.map((x) => x.categoryId)).toEqual(['cat-ev', 'cat-ev', 'cat-ev'])
    expect(again.plan.categoryId).toBe('cat-ev')
  })

  it('arama ad ve notta Türkçe büyük/küçük harf duyarsız; kategori ve dönem süzgeci; yıl dağılımı', async () => {
    await post('/api/entries', { month: '2026-10', direction: 'expense', name: 'MİGROS Market', plannedAmount: TRY(500), categoryId: 'cat-market' })
    await post('/api/entries', { month: '2026-11', direction: 'expense', name: 'Şok', plannedAmount: TRY(200), categoryId: 'cat-market', note: 'migros yanı' })
    await post('/api/entries', { month: '2026-11', direction: 'expense', name: 'Mazot', plannedAmount: TRY(1000) })
    await post('/api/entries', { month: '2027-01', direction: 'expense', name: 'Migros', plannedAmount: TRY(50) })

    const byText = (await get<SearchDto>(`/api/search?q=${encodeURIComponent('migros')}`)).body
    expect(byText.totals).toMatchObject({ count: 3, expense: TRY(750) })
    expect(byText.entries[0]!.month).toBe('2027-01')
    const ranged = (await get<SearchDto>(`/api/search?q=migros&from=2026-10&to=2026-12`)).body
    expect(ranged.totals.count).toBe(2)
    expect((await get<SearchDto>('/api/search?category=cat-market')).body.totals.expense).toBe(TRY(700))
    expect((await get<SearchDto>('/api/search?category=none')).body.totals.count).toBe(2)
    expect((await get('/api/search')).status).toBe(400)

    const year = (await get<YearDto>('/api/years/2026')).body
    expect(year.categories).toEqual([
      { id: null, name: 'Kategorisiz', expense: TRY(1000) },
      { id: 'cat-market', name: 'Market', expense: TRY(700) },
    ])
  })

  it('yedek kategorileri taşır; eski sürüm yedek mevcut listeyi korur', async () => {
    const custom = await post<CategoryDto>('/api/categories', { name: 'Bahçe' })
    await post('/api/entries', { month: '2026-11', direction: 'expense', name: 'Fide', plannedAmount: TRY(80), categoryId: custom.body.id })
    const backup = (await get<{ version: number; data: { categories: CategoryDto[]; entries: { category_id: string | null }[] } }>('/api/export')).body
    expect(backup.version).toBe(3)
    expect(backup.data.categories.some((x) => x.name === 'Bahçe')).toBe(true)

    await call('DELETE', `/api/categories/${custom.body.id}`) // ad değişse de yedek geri getirir
    expect((await post('/api/import?replace=1', backup)).status).toBe(201)
    expect((await get<CategoryDto[]>('/api/categories')).body.some((x) => x.name === 'Bahçe')).toBe(true)

    const v2 = structuredClone(backup) as unknown as { version: number; data: { categories?: unknown; entries: { category_id?: string | null }[] } }
    v2.version = 2
    delete v2.data.categories
    for (const e of v2.data.entries) delete e.category_id
    expect((await post('/api/import?replace=1', v2)).status).toBe(201)
    expect((await get<CategoryDto[]>('/api/categories')).body.length).toBeGreaterThan(10)
  })
})

describe('kalan borç', () => {
  it('her dönemin başındaki ödenmemiş taksit toplamını verir; tek plana daraltılır', async () => {
    // Bugün 5 Kasım 2026: Ekim taksiti vadesi geçmiş ve ödenmemiş, borca dahil.
    const a = await newPlan({ direction: 'expense', kind: 'installment', name: 'A', amount: TRY(100), dayOfMonth: 20, startMonth: '2026-10', installmentCount: 3 })
    await newPlan({ direction: 'expense', kind: 'installment', name: 'B', amount: TRY(50), dayOfMonth: 20, startMonth: '2026-11', installmentCount: 2 })
    await newPlan({ direction: 'income', kind: 'installment', name: 'Alacak', amount: TRY(999), dayOfMonth: 20, startMonth: '2026-11', installmentCount: 2 })
    const all = (await get<DebtPoint[]>('/api/plans/debt')).body
    expect(all).toEqual([
      { month: '2026-11', remaining: TRY(400) },
      { month: '2026-12', remaining: TRY(150) },
      { month: '2027-01', remaining: 0 },
    ])
    const one = (await get<DebtPoint[]>(`/api/plans/debt?plan=${a.plan.id}`)).body
    expect(one.map((p) => p.remaining)).toEqual([TRY(300), TRY(100), 0])
  })
})

describe('vade bildirimi', () => {
  async function vapidEnv(): Promise<Env> {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const publicKey = b64urlEncode(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer))
    const privateKey = ((await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey).d as string
    return { ...env, VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: 'mailto:ornek@example.com' }
  }
  async function browserKeys() {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    return { p256dh: b64urlEncode(new Uint8Array((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer)), auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))) }
  }

  it('anahtar yokken abonelik reddedilir; yalnızca bilinen push hizmetleri kabul edilir', async () => {
    expect((await get<{ publicKey: string | null }>('/api/push/key')).body.publicKey).toBeNull()
    const keys = await browserKeys()
    expect((await post('/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys })).status).toBe(409)
    const e = await vapidEnv()
    expect((await call('POST', '/api/push/subscribe', { endpoint: 'https://evil.example/x', keys }, e)).status).toBe(400)
    expect((await call('POST', '/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys }, e)).status).toBe(200)
    expect((await call<{ publicKey: string }>('GET', '/api/push/key', undefined, e)).body.publicKey).toBe(e.VAPID_PUBLIC_KEY)
  })

  it('ertesi günün ödenmemiş giderlerini özetler, abonelere gönderir, geçersiz aboneliği siler', async () => {
    await newEntry('2026-11', 'expense', 'Örnek Kredi', 7500, '2026-11-06')
    await newEntry('2026-11', 'expense', 'Elektrik', 400, '2026-11-06')
    await newEntry('2026-11', 'income', 'Maaş A', 1000, '2026-11-06')
    const paid = await newEntry('2026-11', 'expense', 'Ödenmiş', 50, '2026-11-06')
    await post(`/api/entries/${paid.id}/pay`)
    await newEntry('2026-11', 'expense', 'Sonra', 10, '2026-11-07')

    const notice = await dueTomorrow(env, '2026-11-05')
    expect(notice).toEqual({ title: 'Yarın 2 ödeme var · 7.900,00 ₺', body: 'Örnek Kredi 7.500,00 ₺, Elektrik 400,00 ₺', url: '/yaklasan' })
    expect(await dueTomorrow(env, '2026-11-10')).toBeNull()

    const e = await vapidEnv()
    const keys = await browserKeys()
    await call('POST', '/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/ok', keys }, e)
    await call('POST', '/api/push/subscribe', { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/gone', keys }, e)
    const requests: { url: string; headers: Headers; body: Uint8Array }[] = []
    const fetcher = (async (url: string, init: RequestInit) => {
      requests.push({ url, headers: new Headers(init.headers), body: init.body as Uint8Array })
      return new Response(null, { status: url.includes('gone') ? 410 : 201 })
    }) as unknown as typeof fetch
    expect(await sendDueReminders({ ...e, TZ: 'Europe/Istanbul' }, fetcher)).toBe(1)
    expect(requests).toHaveLength(2)
    expect(requests[0]!.headers.get('Content-Encoding')).toBe('aes128gcm')
    expect(requests[0]!.headers.get('Authorization')).toMatch(/^vapid t=.+, k=/)
    const left = await env.DB.prepare('SELECT endpoint FROM push_subscriptions').all<{ endpoint: string }>()
    expect(left.results.map((r) => r.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/ok'])
    expect(await broadcast(env, notice!, undefined, fetcher)).toBe(0) // anahtarsız ortamda gönderilmez
  })
})

describe('kredi kartı', () => {
  it('bir kez tanımlanır, her ay tahmini gelir; ekstre girilince kesinleşir; iptal edilen ay son ekstre kalır', async () => {
    const { plan } = await newPlan({ direction: 'expense', kind: 'recurring', name: 'Örnek Kart', amount: 0, dayOfMonth: 17, startMonth: '2026-11', card: true, categoryId: 'cat-kart' })
    expect(plan).toMatchObject({ card: true, variable: true })
    const nov = (await monthOf('2026-11')).entries.find((e) => e.planId === plan.id)!
    expect(nov).toMatchObject({ cardPlan: true, variablePlan: true, isEstimate: true, dueDate: '2026-11-17', categoryId: 'cat-kart' })

    await patch(`/api/entries/${nov.id}`, { actualAmount: TRY(57402.53) })
    expect((await monthOf('2026-11')).entries.find((e) => e.id === nov.id)).toMatchObject({ amount: TRY(57402.53), isEstimate: false })

    // Kart Ocak 2027'de iptal: Ocak son ekstre olarak kalır, Şubat'tan sonrası gelmez
    expect((await post(`/api/plans/${plan.id}/close`, { fromMonth: '2027-02' })).status).toBe(200)
    expect((await monthOf('2027-01')).entries.some((e) => e.planId === plan.id)).toBe(true)
    expect((await monthOf('2027-02')).entries.some((e) => e.planId === plan.id)).toBe(false)
    expect((await monthOf('2027-08')).entries.some((e) => e.planId === plan.id)).toBe(false) // yeniden üretilmez
    expect((await get<{ plan: PlanDto }>(`/api/plans/${plan.id}`)).body.plan).toMatchObject({ closed: true, endMonth: '2027-01' })
  })

  it('kart yalnızca her ay tekrarlayan gider olabilir; eski yedekler kart işareti olmadan yüklenir', async () => {
    expect((await post('/api/plans', { direction: 'income', kind: 'recurring', name: 'X', amount: 1, dayOfMonth: 1, startMonth: '2026-11', card: true })).status).toBe(400)
    await newPlan({ direction: 'expense', kind: 'recurring', name: 'Elektrik', amount: TRY(500), dayOfMonth: 10, startMonth: '2026-11', variable: true })
    const backup = (await get<{ data: { plans: Record<string, unknown>[] } }>('/api/export')).body
    for (const p of backup.data.plans) delete p.is_card
    expect((await post('/api/import?replace=1', backup)).status).toBe(201)
    expect((await get<PlanDto[]>('/api/plans')).body[0]).toMatchObject({ name: 'Elektrik', card: false, variable: true })
  })
})

describe('kart tahmini ekstre', () => {
  it('değiştirilince bu dönemden itibaren girilmemiş tahminler güncellenir, girilenler kalır', async () => {
    const { plan } = await newPlan({ direction: 'expense', kind: 'recurring', name: 'Bonus', amount: TRY(10000), dayOfMonth: 17, startMonth: '2026-10', card: true })
    const oct = (await monthOf('2026-10')).entries.find((e) => e.planId === plan.id)!
    const nov = (await monthOf('2026-11')).entries.find((e) => e.planId === plan.id)!
    await patch(`/api/entries/${nov.id}`, { actualAmount: TRY(12000) })
    const res = await post<{ updatedEntries: number }>(`/api/plans/${plan.id}/estimate`, { amount: TRY(15000) })
    expect(res.status).toBe(200)
    expect((await get<{ plan: PlanDto }>(`/api/plans/${plan.id}`)).body.plan.amount).toBe(TRY(15000))
    expect((await monthOf('2026-10')).entries.find((e) => e.id === oct.id)!.amount).toBe(TRY(10000)) // geçmiş dönem
    expect((await monthOf('2026-11')).entries.find((e) => e.id === nov.id)!.amount).toBe(TRY(12000)) // girilmiş ekstre
    expect((await monthOf('2026-12')).entries.find((e) => e.planId === plan.id)!).toMatchObject({ amount: TRY(15000), isEstimate: true })
  })

  it('taksitli planda kabul edilmez', async () => {
    const { plan } = await newPlan({ direction: 'expense', kind: 'installment', name: 'K', amount: TRY(100), dayOfMonth: 1, startMonth: '2026-11', installmentCount: 3 })
    expect((await post(`/api/plans/${plan.id}/estimate`, { amount: 1 })).status).toBe(400)
  })
})

describe('geriye dönük başlangıç', () => {
  it('başlangıç bakiyesi geçmiş bir aya taşınınca ilk kapanış o aydan yapılır', async () => {
    await call('PUT', '/api/months/2026-10/opening', { balance: TRY(1000) })
    expect((await post('/api/months/2025-11/close', { bankBalance: TRY(500) })).status).toBe(409)
    await call('PUT', '/api/months/2025-11/opening', { balance: TRY(400) })
    expect((await post('/api/months/2025-11/close', { bankBalance: TRY(500) })).status).toBe(200)
    expect((await monthOf('2025-12')).opening).toMatchObject({ amount: TRY(500), provisional: false })
    expect((await monthOf('2026-10')).anchor).toBeNull()
  })
})

describe('kapalı aylarda düzeltme', () => {
  async function closeThrough(months: string[], bank: number) {
    for (const m of months) expect((await post(`/api/months/${m}/close`, { bankBalance: bank })).status).toBe(200)
  }
  const recon = async (m: string) => (await monthOf(m)).entries.find((e) => e.type === 'reconciliation')

  it('yanlış plan silinir, doğru plan kapalı aylara eklenir; kapanış bakiyeleri değişmez', async () => {
    await call('PUT', '/api/months/2026-07/opening', { balance: TRY(10000) })
    const { plan: wrong } = await newPlan({ direction: 'expense', kind: 'installment', name: 'Koltuk', amount: TRY(1000), dayOfMonth: 5, startMonth: '2026-07', installmentCount: 5 })
    await closeThrough(['2026-07', '2026-08', '2026-09', '2026-10'], TRY(9000))
    expect(await recon('2026-07')).toBeUndefined() // 10000 − 1000 = 9000

    // Doğrusu Ağustos–Aralık: kapalı aylarda (Ağu–Eki) oluşmaz, plan detayında eksik görünür
    const { plan: right } = await newPlan({ direction: 'expense', kind: 'installment', name: 'Koltuk', amount: TRY(1000), dayOfMonth: 5, startMonth: '2026-08', installmentCount: 5 })
    const detail = (await get<PlanDetailDto>(`/api/plans/${right.id}`)).body
    expect(detail.entries.map((e) => e.installmentNo)).toEqual([4, 5])
    expect(detail.missingClosed).toEqual(['2026-08', '2026-09', '2026-10'])

    expect((await post<{ created: number }>(`/api/plans/${right.id}/backfill`, {})).body.created).toBe(3)
    expect((await get<PlanDetailDto>(`/api/plans/${right.id}`)).body).toMatchObject({ missingClosed: [] })
    const aug = await monthOf('2026-08')
    expect(aug.entries.filter((e) => e.planId === right.id)).toMatchObject([{ installmentNo: 1, paid: true }])
    // Ağustos: 9000 − 1000 (eski) − 1000 (yeni) = 7000 → banka 9000, fark +2000 gelir
    expect(await recon('2026-08')).toMatchObject({ direction: 'income', amount: TRY(2000) })
    expect(aug.closingBalance).toBe(TRY(9000))

    // Eski planın kapalı aydaki kaydı silinir: fark yine kapanış farkına yansır
    await call('DELETE', `/api/plans/${wrong.id}`)
    const oldJul = (await monthOf('2026-07')).entries.find((e) => e.planId === wrong.id)!
    expect((await call('DELETE', `/api/entries/${oldJul.id}`)).status).toBe(409)
    expect((await call('DELETE', `/api/entries/${oldJul.id}?closed=1`)).status).toBe(200)
    expect(await recon('2026-07')).toMatchObject({ direction: 'expense', amount: TRY(1000) })
    const oldAug = (await monthOf('2026-08')).entries.find((e) => e.planId === wrong.id)!
    await call('DELETE', `/api/entries/${oldAug.id}?closed=1`)
    expect(await recon('2026-08')).toMatchObject({ direction: 'income', amount: TRY(1000) })
    expect((await monthOf('2026-11')).opening.amount).toBe(TRY(9000))
  })
})

describe('başlangıç önerisi', () => {
  it('yalnızca hiç kapalı ay yokken ve bakiye girilmemiş aylarda önerilir', async () => {
    expect((await monthOf('2026-11')).needsOpening).toBe(true)
    await call('PUT', '/api/months/2026-09/opening', { balance: TRY(1000) })
    expect((await monthOf('2026-08')).needsOpening).toBe(true) // daha eski bir aya taşınabilir
    expect((await monthOf('2026-09')).needsOpening).toBe(false)
    expect((await monthOf('2026-11')).needsOpening).toBe(false)
    expect((await post('/api/months/2026-09/close', { bankBalance: 0 })).status).toBe(200)
    expect((await monthOf('2026-10')).needsOpening).toBe(false) // kapanış bakiyesi 0 olsa da
    expect((await monthOf('2026-08')).needsOpening).toBe(false)
    expect((await monthOf('2026-12')).needsOpening).toBe(false) // gelecek ay
  })
})

describe('ay içi bakiye eşitleme', () => {
  const recon = async (m: string) => (await monthOf(m)).entries.find((e) => e.type === 'reconciliation')
  const sync = (m: string, lira: number) => post<MonthDto>(`/api/months/${m}/sync`, { bankBalance: TRY(lira) })

  it('her eşitlemede fark kayıt dışı harcamalara eklenir; ödenmemiş kayıtlar sayılmaz', async () => {
    await call('PUT', '/api/months/2026-11/opening', { balance: TRY(58000) })
    const rent = await newEntry('2026-11', 'expense', 'Kira', 20000, '2026-11-20') // henüz ödenmedi
    expect((await monthOf('2026-11')).totals.currentBalance).toBe(TRY(58000))

    const first = await sync('2026-11', 48000)
    expect(first.status).toBe(200)
    expect(first.body.status).toBe('open')
    expect(first.body.totals.currentBalance).toBe(TRY(48000))
    expect(await recon('2026-11')).toMatchObject({ direction: 'expense', amount: TRY(10000), name: 'Kayıt dışı harcamalar', paid: true })

    expect((await sync('2026-11', 32000)).body.totals.currentBalance).toBe(TRY(32000))
    expect(await recon('2026-11')).toMatchObject({ direction: 'expense', amount: TRY(26000) })
    expect((await post(`/api/entries/${(await recon('2026-11'))!.id}/unpay`)).status).toBe(400)

    // Kira ödenince bankadan çıkar; bakiye tutuyorsa kayıt dışı değişmez
    await post(`/api/entries/${rent.id}/pay`)
    await sync('2026-11', 12000)
    expect(await recon('2026-11')).toMatchObject({ amount: TRY(26000) })
    // Banka beklenenden fazlaysa kayıt dışı azalır, sıfırlanırsa kalem kalkar
    await sync('2026-11', 38000)
    expect(await recon('2026-11')).toBeUndefined()

    expect((await sync('2026-12', 0)).status).toBe(409) // gelecek ay
  })

  it('kapanış eşitlenmiş tutarın üstüne ekler; yeniden açınca eşitlenmiş tutar geri gelir', async () => {
    await call('PUT', '/api/months/2026-11/opening', { balance: TRY(58000) })
    await sync('2026-11', 48000)
    const closed = await post<MonthDto>('/api/months/2026-11/close', { bankBalance: TRY(45000) })
    expect(closed.body.entries.filter((e) => e.type === 'reconciliation')).toMatchObject([{ direction: 'expense', amount: TRY(13000) }])
    expect((await sync('2026-11', 0)).status).toBe(409) // kapalı ay

    await post('/api/months/2026-11/reopen')
    expect(await recon('2026-11')).toMatchObject({ direction: 'expense', amount: TRY(10000) })
    expect((await monthOf('2026-12')).opening).toEqual({ amount: TRY(48000), provisional: true })
  })
})
