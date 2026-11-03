import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { formatMoney, parseMoney } from '../../shared/money'
import { errorMessage } from '../api'
import { addMonths } from '../../shared/month'
import { useConfirm } from '../confirm'
import { MonthField } from '../pickers'
import { History } from '../month/History'
import { currentPeriod, money, shortMonth, toInput } from '../month/format'
import { DebtChart } from '../month/DebtChart'
import { StatementSheet } from '../month/StatementSheet'
import type { EntryDto, PlanDto } from '../../shared/api'
import { useDebt, usePlan, usePlanActions, useSettings } from '../month/queries'
import { BottomNav, Button, Field, Icon, Notice, Page, PageHeader, Sheet, SheetActions } from '../ui'

export function PlanDetay() {
  const { id = '' } = useParams()
  const { data, error } = usePlan(id)
  const debt = useDebt(id).data
  const actions = usePlanActions()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [panel, setPanel] = useState<'schedule' | 'close' | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  if (error) return <Page><Notice>{errorMessage(error)}</Notice><Link to="/planlar" className="underline">Planlara dön</Link><BottomNav /></Page>
  if (!data) return <Page><p className="text-muted">Yükleniyor…</p><BottomNav /></Page>
  const { plan, entries } = data
  const installment = plan.kind === 'installment'
  if (plan.card) return <CardDetail plan={plan} entries={entries} />

  async function backfill() {
    const months = data?.missingClosed ?? []
    if (!(await confirm({
      title: 'Kapalı aylara eklensin mi?',
      message: `${months.length} ${installment ? 'taksit' : 'kayıt'} ödenmiş olarak eklenir (${shortMonth(months[0])}${months.length > 1 ? ` – ${shortMonth(months[months.length - 1])}` : ''}). Ayların kapanış bakiyeleri değişmez; fark “Kayıt dışı” kapanış farkı kaydından düşülür.`,
      confirmLabel: 'Ekle',
    }))) return
    try {
      const result = await actions.backfill.mutateAsync(plan.id)
      setMessage({ kind: 'info', text: `${result.created} ${installment ? 'taksit' : 'kayıt'} kapalı aylara eklendi.` })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  async function remove() {
    if (!(await confirm({ title: 'Plan silinsin mi?', message: 'Planın ödenmemiş kayıtları da silinir. Ödenmiş kayıtlar kalır.', confirmLabel: 'Planı sil', destructive: true }))) return
    try {
      await actions.remove.mutateAsync(plan.id)
      navigate('/planlar', { replace: true })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  const nextNo = entries.find((e) => !e.paid)?.id
  const period = installment && plan.installmentCount ? `${shortMonth(plan.startMonth)} – ${shortMonth(addMonths(plan.startMonth, plan.installmentCount - 1))}` : `${shortMonth(plan.startMonth)}’den beri`

  return (
    <Page wide>
      <PageHeader title={plan.name} subtitle={`${plan.direction === 'income' ? 'Gelir' : 'Gider'} · ${installment ? 'taksitli' : 'her ay'}${plan.closed ? ' · kapatıldı' : ''}`} back={{ to: '/planlar', label: 'Planlara dön' }} />
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {data.missingClosed.length > 0 && (
        <button onClick={() => void backfill()} disabled={actions.backfill.isPending} className="flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-soft px-4 py-2.5 text-left text-sm">
          <span>
            <span className="block font-semibold text-link">{data.missingClosed.length} {installment ? 'taksit' : 'kayıt'} kapalı aylarda oluşmadı</span>
            <span className="text-xs text-muted">{data.missingClosed.map(shortMonth).join(', ')} · kapalı aylara ekle</span>
          </span>
          <Icon name="ileri" size={18} />
        </button>
      )}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-3 lg:sticky lg:top-6">
          <section className="grid grid-cols-2 gap-3 rounded-2xl bg-surface p-4">
            <Stat label={installment ? 'Taksit' : 'Tutar'} value={`${money(plan.amount)}`} strong />
            {installment && <Stat label={plan.direction === 'income' ? 'Toplam alacak' : 'Toplam'} value={money(plan.stats.totalAmount)} strong />}
            {installment && <Stat label={plan.direction === 'income' ? 'Tahsil edilen' : 'Ödenen'} value={`${money(plan.stats.paidAmount)} · ${plan.stats.paid}/${plan.stats.total}`} />}
            <Stat label="Kalan" value={money(plan.stats.remainingAmount)} strong={!installment} />
            <Stat label="Dönem" value={period} />
            <Stat label="Ödeme günü" value={`Her ayın ${plan.dayOfMonth}’i${plan.autoPay ? ' · Otomatik' : ''}`} />
          </section>

          {installment && plan.direction === 'expense' && debt && <DebtChart points={debt} title="Kalan taksitler" />}

          {/* Plan işlemleri tek yerde */}
          <div className="flex flex-wrap gap-2">
            {!plan.closed && installment && <Button variant="secondary" className="h-11 min-h-11 grow rounded-xl text-[13px]" onClick={() => setPanel('schedule')}>Ödeme planı yapıştır</Button>}
            {!plan.closed && <Button variant="secondary" className="h-11 min-h-11 grow rounded-xl text-[13px]" onClick={() => setPanel('close')}>{installment ? 'Erken kapat' : 'Sonlandır'}</Button>}
            <Button variant="danger" className="h-11 min-h-11 grow rounded-xl text-[13px]" disabled={actions.remove.isPending} onClick={() => void remove()}>Planı sil</Button>
          </div>

        </div>
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-2xl bg-surface">
            <div className="grid grid-cols-[40px_minmax(0,1fr)_110px_70px] border-b border-line px-3.5 py-2.5 text-[11px] font-semibold tracking-wide text-muted">
              <span>NO</span><span>AY</span><span className="text-right">TUTAR</span><span className="text-right">DURUM</span>
            </div>
            {entries.map((e, i) => {
              const next = e.id === nextNo
              return (
                <div key={e.id} className={`grid h-[37px] grid-cols-[40px_minmax(0,1fr)_110px_70px] items-center border-b border-line px-3.5 text-sm last:border-b-0 ${next ? 'bg-soft' : ''}`}>
                  <span className="text-muted">{e.installmentNo ?? i + 1}</span>
                  <span className={next ? 'font-semibold' : ''}>{shortMonth(e.month)}</span>
                  <span className={`text-right ${e.paid ? 'text-muted' : ''}`}>{e.isEstimate && !e.paid ? '~' : ''}{formatMoney(e.amount)}</span>
                  <span className={`text-right text-xs font-semibold ${e.paid ? 'text-good' : next ? 'text-link' : 'text-muted'}`}>{e.paid ? 'Ödendi' : next ? 'Sıradaki' : 'Bekliyor'}</span>
                </div>
              )
            })}
        </div>

        <History entity="plan" id={plan.id} />


        </div>
      </div>

      {panel === 'schedule' && <SchedulePanel planId={plan.id} onClose={(m) => { setPanel(null); if (m) setMessage({ kind: 'info', text: m }) }} />}
      {panel === 'close' && <ClosePanel planId={plan.id} installment={installment} onClose={(m) => { setPanel(null); if (m) setMessage({ kind: 'info', text: m }) }} />}
      <BottomNav />
    </Page>
  )
}

/** Kredi kartı: son ekstreler, ortalama ve iptal. */
function CardDetail({ plan, entries }: { plan: PlanDto; entries: EntryDto[] }) {
  const actions = usePlanActions()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const startDay = useSettings().data?.periodStartDay ?? 1
  const now = currentPeriod(startDay)
  const [panel, setPanel] = useState<'cancel' | 'estimate' | null>(null)
  const [statement, setStatement] = useState<EntryDto | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  // Gelecek aylar yalnızca tahmin: listede bu döneme kadar olanlar, yeniden eskiye
  const statements = entries.filter((e) => e.month <= now).reverse()
  const entered = entries.filter((e) => !e.isEstimate)
  const average = entered.length ? Math.round(entered.reduce((sum, e) => sum + e.amount, 0) / entered.length) : null
  const last = entered.at(-1)

  async function remove() {
    if (!(await confirm({ title: 'Kart silinsin mi?', message: 'Kartın tüm ödenmemiş ekstre kayıtları silinir. Kartı kapattıysan geçmişi korumak için “Kartı iptal et”i kullan.', confirmLabel: 'Kartı sil', destructive: true }))) return
    try {
      await actions.remove.mutateAsync(plan.id)
      navigate('/planlar', { replace: true })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  return (
    <Page wide>
      <PageHeader title={plan.name} subtitle={plan.closed ? `Kredi kartı · iptal edildi${plan.endMonth ? ` · son ekstre ${shortMonth(plan.endMonth)}` : ''}` : 'Kredi kartı'} back={{ to: '/planlar', label: 'Planlara dön' }} />
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-3 lg:sticky lg:top-6">
          <section className="grid grid-cols-2 gap-3 rounded-2xl bg-surface p-4">
            <Stat label="Son ekstre" value={last ? `${money(last.amount)}` : '—'} strong />
            <Stat label="Ortalama ekstre" value={average !== null ? money(average) : '—'} strong />
            <Stat label="Son ödeme günü" value={`Her ayın ${plan.dayOfMonth}’i${plan.autoPay ? ' · Otomatik' : ''}`} />
            <Stat label="Tanımlı" value={plan.closed && plan.endMonth ? `${shortMonth(plan.startMonth)} – ${shortMonth(plan.endMonth)}` : `${shortMonth(plan.startMonth)}’den beri`} />
            {!plan.closed && (
              <div className="col-span-2 flex items-center justify-between gap-3 border-t border-line pt-3">
                <div>
                  <p className="text-xs text-muted">Gelecek aylar için tahmin</p>
                  <p className="text-sm font-medium">{plan.amount > 0 ? money(plan.amount) : 'Girilmedi'}</p>
                </div>
                <button className="min-h-9 rounded-full bg-soft px-3.5 text-[13px] font-semibold text-link" onClick={() => setPanel('estimate')}>Değiştir</button>
              </div>
            )}
          </section>
          <div className="flex flex-wrap gap-2">
            {!plan.closed && <Button variant="secondary" className="h-11 min-h-11 grow rounded-xl text-[13px]" onClick={() => setPanel('cancel')}>Kartı iptal et</Button>}
            <Button variant="danger" className="h-11 min-h-11 grow rounded-xl text-[13px]" disabled={actions.remove.isPending} onClick={() => void remove()}>Kartı sil</Button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-2xl bg-surface">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_84px] border-b border-line px-3.5 py-2.5 text-[11px] font-semibold tracking-wide text-muted">
              <span>AY</span><span className="text-right">EKSTRE</span><span className="text-right">DURUM</span>
            </div>
            {statements.map((e) => {
              const awaiting = e.isEstimate && !e.paid
              return (
                <div key={e.id} className="grid min-h-[41px] grid-cols-[minmax(0,1fr)_120px_84px] items-center border-b border-line px-3.5 text-sm last:border-b-0">
                  <span>{shortMonth(e.month)}</span>
                  <span className={`text-right ${awaiting ? 'text-muted' : ''}`}>{awaiting ? '~' : ''}{formatMoney(e.amount)}</span>
                  <span className="text-right text-xs font-semibold">
                    {e.paid ? <span className="text-good">Ödendi</span> : awaiting ? (
                      plan.closed ? <span className="text-muted">Tahmini</span> : <button className="-my-1 min-h-8 rounded-full bg-soft px-2.5 text-link" onClick={() => setStatement(e)}>Ekstre gir</button>
                    ) : <span className="text-link">Girildi</span>}
                  </span>
                </div>
              )
            })}
            {statements.length === 0 && <p className="px-3.5 py-6 text-center text-sm text-muted">İlk ekstre {shortMonth(plan.startMonth)} döneminde gelir.</p>}
          </div>
          <History entity="plan" id={plan.id} />
        </div>
      </div>

      {statement && <StatementSheet entry={statement} onClose={() => setStatement(null)} />}
      {panel === 'estimate' && <EstimatePanel plan={plan} average={average} onClose={(m) => { setPanel(null); if (m) setMessage({ kind: 'info', text: m }) }} />}
      {panel === 'cancel' && <CardCancelPanel plan={plan} onClose={(m) => { setPanel(null); if (m) setMessage({ kind: 'info', text: m }) }} />}
      <BottomNav />
    </Page>
  )
}

/** Tahmini ekstre: bu dönemden itibaren henüz girilmemiş ekstreler yeni tahmini alır. */
function EstimatePanel({ plan, average, onClose }: { plan: PlanDto; average: number | null; onClose: (message?: string) => void }) {
  const { estimate } = usePlanActions()
  const [amount, setAmount] = useState(plan.amount > 0 ? toInput(plan.amount) : '')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const kurus = amount.trim() === '' ? 0 : parseMoney(amount)
    if (kurus === null || kurus < 0) return setError('Tutarı geçerli bir sayı olarak gir (ör. 45.000,00).')
    try {
      const result = await estimate.mutateAsync({ id: plan.id, amount: kurus })
      onClose(`Tahmin güncellendi; ${result.updatedEntries} aylık ekstre ${money(kurus)} oldu.`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Sheet title="Tahmini ekstre" subtitle={plan.name} onClose={() => onClose()}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        {error && <Notice>{error}</Notice>}
        <Field label="Aylık tahmin (₺)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoFocus hint="Bu dönemden itibaren ekstresi girilmemiş aylar bu tutarla görünür. Girilmiş ve ödenmiş ekstreler değişmez." />
        {average !== null && (
          <button type="button" className="self-start rounded-full border border-edge px-3 py-1.5 text-[13px]" onClick={() => setAmount(toInput(average))}>
            Ortalamayı kullan · {money(average)}
          </button>
        )}
        <SheetActions>
          <Button type="submit" className="grow" disabled={estimate.isPending}>Kaydet</Button>
        </SheetActions>
      </form>
    </Sheet>
  )
}

/** İptal: seçilen ay son ekstre olarak kalır, sonraki ayların ödenmemiş kayıtları silinir. */
function CardCancelPanel({ plan, onClose }: { plan: PlanDto; onClose: (message?: string) => void }) {
  const { close } = usePlanActions()
  const startDay = useSettings().data?.periodStartDay ?? 1
  const [lastMonth, setLastMonth] = useState(() => currentPeriod(startDay))
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (lastMonth < plan.startMonth) return setError(`Son ekstre ${shortMonth(plan.startMonth)} öncesi olamaz; kartı silmeyi düşünebilirsin.`)
    try {
      await close.mutateAsync({ id: plan.id, fromMonth: addMonths(lastMonth, 1) })
      onClose(`Kart iptal edildi. Son ekstre: ${shortMonth(lastMonth)}.`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Sheet title="Kartı iptal et" subtitle={plan.name} onClose={() => onClose()}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        {error && <Notice>{error}</Notice>}
        <MonthField label="Son ekstre ayı" value={lastMonth} current={currentPeriod(startDay)} onChange={setLastMonth} hint="Bu ayın ekstresi kalır; sonraki aylarda kart ekstresi gelmez. Geçmiş ekstreler korunur." />
        <SheetActions>
          <Button type="submit" variant="danger" className="grow" disabled={close.isPending}>Kartı iptal et</Button>
        </SheetActions>
      </form>
    </Sheet>
  )
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={strong ? 'text-base font-semibold' : 'text-sm font-medium'}>{value}</p>
    </div>
  )
}

function SchedulePanel({ planId, onClose }: { planId: string; onClose: (message?: string) => void }) {
  const { schedule } = usePlanActions()
  const [text, setText] = useState('')
  const [startNo, setStartNo] = useState('1')
  const [preview, setPreview] = useState<{ count: number; expected: number; mismatch: boolean; willUpdate: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const start = Number(startNo)
  const body = { id: planId, text, startNo: Number.isInteger(start) && start > 0 ? start : 1 }

  async function check() {
    setError(null)
    try {
      setPreview(await schedule.mutateAsync({ ...body, dryRun: true }))
    } catch (e) {
      setPreview(null)
      setError(errorMessage(e))
    }
  }

  async function apply() {
    setError(null)
    try {
      const result = await schedule.mutateAsync({ ...body, force: preview?.mismatch })
      onClose(`${result.willUpdate} taksit güncellendi${result.skipped ? `, ${result.skipped} ödenmiş/kapalı taksit atlandı` : ''}.`)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Sheet title="Ödeme planı yapıştır" onClose={() => onClose()}>
      <div className="flex flex-col gap-3">
        {error && <Notice>{error}</Notice>}
        <label className="flex flex-col gap-1 text-sm font-medium">
          Tutarlar (her satıra bir tane)
          <textarea rows={8} value={text} onChange={(e) => { setText(e.target.value); setPreview(null) }} className="rounded-xl border border-edge bg-transparent p-3 text-base font-normal" placeholder={'1.250,00\n1.250,00\n…'} />
        </label>
        <Field label="İlk tutar hangi taksit?" inputMode="numeric" value={startNo} onChange={(e) => { setStartNo(e.target.value); setPreview(null) }} />
        {preview && <Notice kind="info">{preview.count} tutar bulundu, {preview.expected} taksit bekleniyordu. {preview.willUpdate} taksit güncellenecek{preview.skipped ? `, ${preview.skipped} atlanacak` : ''}.{preview.mismatch ? ' Sayılar uyuşmuyor; yine de uygulayabilirsin.' : ''}</Notice>}
        <SheetActions>
          <Button variant="secondary" className="grow" disabled={!text.trim() || schedule.isPending} onClick={() => void check()}>Önizle</Button>
          <Button className="grow" disabled={!preview || schedule.isPending} onClick={() => void apply()}>{preview?.mismatch ? 'Yine de uygula' : 'Uygula'}</Button>
        </SheetActions>
      </div>
    </Sheet>
  )
}

function ClosePanel({ planId, installment, onClose }: { planId: string; installment: boolean; onClose: (message?: string) => void }) {
  const { close } = usePlanActions()
  const startDay = useSettings().data?.periodStartDay ?? 1
  const [fromMonth, setFromMonth] = useState(() => currentPeriod(startDay))
  const [payoff, setPayoff] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const payoffAmount = payoff.trim() ? parseMoney(payoff) : undefined
    if (payoffAmount === null) return setError('Kapatma tutarı geçerli bir sayı olmalı.')
    try {
      await close.mutateAsync({ id: planId, fromMonth, payoffAmount })
      onClose('Plan kapatıldı.')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Sheet title={installment ? 'Erken kapat' : 'Planı sonlandır'} onClose={() => onClose()}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        {error && <Notice>{error}</Notice>}
        <MonthField label="Bu dönemden itibaren sil" value={fromMonth} current={currentPeriod(startDay)} onChange={setFromMonth} hint="Seçilen dönem ve sonrasındaki ödenmemiş kayıtlar silinir." />
        {installment && <Field label="Kapatma tutarı (₺, isteğe bağlı)" inputMode="decimal" value={payoff} onChange={(e) => setPayoff(e.target.value)} hint="Girilirse o döneme tek seferlik kayıt eklenir." />}
        <SheetActions>
          <Button type="submit" variant="danger" className="grow" disabled={close.isPending}>Kapat</Button>
        </SheetActions>
      </form>
    </Sheet>
  )
}
