import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { EntryDto } from '../../shared/api'
import { errorMessage } from '../api'
import { CloseSheet } from '../month/CloseSheet'
import { SyncSheet } from '../month/SyncSheet'
import { EntryForm } from '../month/EntryForm'
import { MonthPickerTitle } from '../pickers'
import { SetupSheet } from '../month/SetupSheet'
import { StatementSheet } from '../month/StatementSheet'
import { currentPeriod, money, monthTitle, shortDate, signed } from '../month/format'
import { NewForm } from '../month/NewForm'
import { useEntryActions, useMonth, useMonthActions, useSettings } from '../month/queries'
import { BottomNav, Group, Icon, IconLink, Notice, Page, PageHeader, Pills, SectionLabel, Sheet } from '../ui'

type Tab = 'expense' | 'income'

export function Ana() {
  const settings = useSettings()
  const startDay = settings.data?.periodStartDay
  const [params] = useSearchParams()
  const linked = params.get('ay')
  const [selected, setSelected] = useState<string | null>(linked && /^\d{4}-\d{2}$/.test(linked) ? linked : null)
  const month = selected ?? (startDay ? currentPeriod(startDay) : null)
  if (!month) return <Page><p className="text-muted">Yükleniyor…</p><BottomNav /></Page>
  return <AyEkrani month={month} onMonth={setSelected} />
}

function AyEkrani({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  const { data, error, isPending } = useMonth(month)
  const settingsDay = useSettings().data?.periodStartDay ?? 1
  const actions = useEntryActions()
  const [params, setParams] = useSearchParams()
  // Giderler ve Gelirler ayrı ayrı açılıp kapanır; ikisi birden açıkken iki liste alt alta görünür.
  const [shown, setShown] = useState<Record<Tab, boolean>>({ expense: true, income: true })
  const [person, setPerson] = useState<string>('all')
  const [editing, setEditing] = useState<EntryDto | null>(null)
  const [statement, setStatement] = useState<EntryDto | null>(null)
  const [panel, setPanel] = useState<'close' | 'sync' | 'setup' | null>(null)
  const monthActions = useMonthActions(month)
  const [undo, setUndo] = useState<{ id: string | null; text: string } | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const closed = data?.status === 'closed'
  const adding = params.get('ekle') === '1' && !closed
  const all = data?.entries ?? []
  const expenses = all.filter((e) => e.direction === 'expense')
  const incomes = all.filter((e) => e.direction === 'income')
  const unpaid = expenses.filter((e) => !e.paid)
  // Hane görünümü: dönemde birden fazla kişi kayıt eklediyse "kim ekledi" süzgeci çıkar.
  const people = [...new Map(all.map((e) => [e.createdById ?? 'none', e.createdById ? (e.createdBy ?? 'Bilinmeyen') : 'İçe aktarılan'])).entries()]
  const showPeople = people.length > 1
  const byPerson = (e: EntryDto) => !showPeople || person === 'all' || (e.createdById ?? 'none') === person
  const sortList = (items: EntryDto[]) => items.filter(byPerson).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.name.localeCompare(b.name, 'tr'))
  const lists: Record<Tab, EntryDto[]> = { expense: sortList(expenses), income: sortList(incomes) }
  const toggle = (t: Tab) => setShown((s) => (s[t] && !s[t === 'expense' ? 'income' : 'expense'] ? s : { ...s, [t]: !s[t] }))
  const progress = expenses.length ? Math.round(((expenses.length - unpaid.length) / expenses.length) * 100) : 100

  const needsSetup = !!data && !closed && data.needsOpening
  // Gelecek ay kapatılamaz ve eşitlenemez; yalnızca ne durumda olunacağını görmek için açılır
  const future = month > currentPeriod(settingsDay)
  async function reopen() {
    setFlash(null)
    try {
      await monthActions.reopen.mutateAsync()
    } catch (e) {
      setFlash(errorMessage(e))
    }
  }

  function closeAdd() {
    setParams((p) => { p.delete('ekle'); return p }, { replace: true })
  }

  function done(entry: EntryDto, message?: string) {
    setEditing(null)
    if (message) {
      // Kapalı aydan silme geri alınamaz (ay kapalı); yalnızca bilgi gösterilir
      setUndo({ id: closed ? null : entry.id, text: message })
      clearTimeout(undoTimer.current)
      undoTimer.current = setTimeout(() => setUndo(null), 8000)
    }
  }

  async function togglePaid(entry: EntryDto) {
    setFlash(null)
    try {
      await actions.togglePaid.mutateAsync({ id: entry.id, paid: !entry.paid })
    } catch (e) {
      setFlash(errorMessage(e))
    }
  }

  return (
    <Page wide>
      <PageHeader
        title={<MonthPickerTitle month={month} current={currentPeriod(settingsDay)} onChange={onMonth} />}
        subtitle={data ? (unpaid.length === 0 ? 'Tüm ödemeler yapıldı' : `${unpaid.length} ödeme kaldı`) : ' '}
        actions={<IconLink to="/ara" label="Ara" name="ara" className="lg:hidden" />}
      />

      {error && !data && <Notice>{errorMessage(error)}</Notice>}
      {flash && <Notice>{flash}</Notice>}
      {isPending && <p className="text-muted">Yükleniyor…</p>}

      {data && (
        <>
          <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start lg:gap-6">
            <div className="flex flex-col gap-3 lg:sticky lg:top-6">
              <section className="flex flex-col gap-4 rounded-[20px] bg-hero p-5 text-white">
                <div>
                  <p className="text-[13px] text-white/75">{closed ? 'Elde kalan' : 'Ay sonunda elde kalan'}{data.opening.provisional ? ' · devir geçici' : ''}</p>
                  <p className="text-[34px] leading-tight font-semibold tracking-tight">{signed(data.totals.expectedClosing)}</p>
                  <p className="text-xs text-white/60">{shortDate(data.start)} – {shortDate(data.end)}</p>
                </div>
                {/* Gerçekleşen: ödenen/alınan kayıtlar; bekleyen: henüz ödenmemiş ya da alınmamış (tahmini) */}
                <table className="w-full text-right text-sm tabular-nums">
                  <thead>
                    <tr className="text-xs text-white/75">
                      <th scope="col" className="w-[34%] pb-1 text-left font-normal"><span className="sr-only">Durum</span></th>
                      <th scope="col" className="pb-1 font-normal">Gelir</th>
                      <th scope="col" className="pb-1 font-normal">Gider</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row" className="py-0.5 text-left text-xs font-normal text-white/75">Gerçekleşen</th>
                      <td className="py-0.5 font-medium">{money(data.totals.incomeReceived)}</td>
                      <td className="py-0.5 font-medium">{money(data.totals.expensePaid)}</td>
                    </tr>
                    <tr className="text-white/75">
                      <th scope="row" className="py-0.5 text-left text-xs font-normal">Bekleyen</th>
                      <td className="py-0.5">{money(data.totals.incomePending)}</td>
                      <td className="py-0.5">{money(data.totals.expenseUnpaid)}</td>
                    </tr>
                    <tr className="border-t border-white/20">
                      <th scope="row" className="pt-1.5 text-left text-xs font-normal text-white/75">Toplam</th>
                      <td className="pt-1.5 font-semibold">{money(data.totals.income)}</td>
                      <td className="pt-1.5 font-semibold">{money(data.totals.expense)}</td>
                    </tr>
                  </tbody>
                </table>
                {!closed && <p className="-mt-1 text-xs text-white/75">Şu an bankada olması gereken <strong className="font-semibold text-white">{signed(data.totals.currentBalance)}</strong></p>}
                <div className="flex flex-col gap-1.5">
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-label="Ödenen gider" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-[#8fd3b4]" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-xs text-white/75">{expenses.length - unpaid.length} / {expenses.length} gider ödendi</p>
                </div>
                {closed && <p className="text-xs text-white/75">Bu dönem kapalı; kayıtlar değiştirilemez.</p>}
              </section>

              {needsSetup && (
                <button onClick={() => setPanel('setup')} className="flex min-h-11 items-center justify-between rounded-2xl bg-soft px-4 text-left text-sm font-semibold text-link">
                  {month === currentPeriod(settingsDay) ? 'Başlangıç bakiyesini ve dönem gününü ayarla' : 'Başlangıç bakiyesini bu aydan başlat'}<Icon name="ileri" size={18} />
                </button>
              )}
              {!closed && !needsSetup && !future && (
                <button onClick={() => setPanel('sync')} className="flex min-h-11 items-center justify-between rounded-2xl bg-soft px-4 text-left text-sm font-semibold text-link">
                  Bakiyeyi eşitle: güncel bakiyeyi gir<Icon name="ileri" size={18} />
                </button>
              )}
              {!closed && !future && (
                <button onClick={() => setPanel('close')} className="flex min-h-11 items-center justify-between rounded-2xl bg-soft px-4 text-left text-sm font-semibold text-link">
                  Ayı kapat: bankadaki bakiyeyi gir<Icon name="ileri" size={18} />
                </button>
              )}
              {closed && (
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-2.5 text-sm">
                  <span>Kapanış bakiyesi <strong>{money(data.closingBalance ?? 0)}</strong></span>
                  <button disabled={monthActions.reopen.isPending} onClick={() => void reopen()} className="min-h-11 font-semibold text-link underline">Ayı yeniden aç</button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <div role="group" aria-label="Gösterilecek kayıtlar" className="flex gap-2 py-1">
                {(['expense', 'income'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={shown[t]}
                    onClick={() => toggle(t)}
                    className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] whitespace-nowrap ${shown[t] ? 'bg-ink font-medium text-on-ink' : 'border border-edge bg-surface'}`}
                  >
                    {shown[t] && <Icon name="tik" size={14} width={2.6} />}
                    {t === 'expense' ? `Giderler · ${expenses.length}` : `Gelirler · ${incomes.length}`}
                  </button>
                ))}
              </div>

              {showPeople && (
                <Pills label="Ekleyen" value={people.some(([id]) => id === person) ? person : 'all'} onChange={setPerson} options={[{ value: 'all', label: 'Herkes' }, ...people.map(([id, name]) => ({ value: id, label: name }))]} />
              )}
              {showPeople && person !== 'all' && (
                <p className="px-1 text-xs text-muted">
                  {people.find(([id]) => id === person)?.[1]} bu dönem {all.filter(byPerson).length} kayıt ekledi · gider {money(expenses.filter(byPerson).reduce((s, e) => s + e.amount, 0))} · gelir {money(incomes.filter(byPerson).reduce((s, e) => s + e.amount, 0))}
                </p>
              )}

              {(['expense', 'income'] as const).filter((t) => shown[t]).map((t) => (
                <section key={t} className="flex flex-col gap-2">
                  {shown.expense && shown.income && (
                    <SectionLabel>
                      {t === 'expense' ? 'Giderler' : 'Gelirler'} · {money(lists[t].reduce((sum, e) => sum + e.amount, 0))}
                    </SectionLabel>
                  )}
                  <Group>
                    {t === 'income' && person === 'all' && <OpeningRow amount={data.opening.amount} provisional={data.opening.provisional} />}
                    {lists[t].map((entry) => (
                      <EntryRow key={entry.id} entry={entry} showAuthor={showPeople} locked={closed} onToggle={() => void togglePaid(entry)} onEdit={() => setEditing(entry)} onStatement={() => setStatement(entry)} />
                    ))}
                    {lists[t].length === 0 && <li className="py-6 text-center text-sm text-muted">Bu dönemde {t === 'expense' ? 'gider' : 'gelir'} kaydı yok.</li>}
                  </Group>
                </section>
              ))}
            </div>
          </div>

          {panel === 'close' && <CloseSheet data={data} onClose={(m) => { setPanel(null); if (m) setFlash(null) }} />}
          {panel === 'sync' && <SyncSheet data={data} onClose={(m) => { setPanel(null); setFlash(m ?? null) }} />}
          {panel === 'setup' && <SetupSheet month={month} onClose={() => setPanel(null)} />}
          {adding && (
            <Sheet title="Yeni ekle" onClose={closeAdd}>
              <NewForm month={month} onDone={closeAdd} />
            </Sheet>
          )}
          {statement && <StatementSheet entry={statement} onClose={() => setStatement(null)} />}
          {editing && (
            <Sheet title={editing.name} subtitle={[editing.installmentNo && `${editing.installmentNo}/${editing.installmentCount}`, monthTitle(editing.month)].filter(Boolean).join(' · ')} onClose={() => setEditing(null)}>
              <EntryForm month={month} range={data} entry={editing} locked={closed} onDone={(m) => done(editing, m)} />
            </Sheet>
          )}
        </>
      )}

      {undo && (
        <div role="status" className="fixed inset-x-4 bottom-28 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-on-ink">
          <span>{undo.text}</span>
          {undo.id && <button className="min-h-11 font-semibold underline" onClick={() => { void actions.restore.mutateAsync(undo.id as string); setUndo(null) }}>Geri al</button>}
        </div>
      )}
      <BottomNav />
    </Page>
  )
}

function OpeningRow({ amount, provisional }: { amount: number; provisional: boolean }) {
  return (
    <li className="flex min-h-13 items-center justify-between border-b border-line px-3.5">
      <span className="text-[15px]">Devir{provisional && <span className="ml-2 text-xs text-muted">geçici</span>}</span>
      <span className={`text-[15px] font-medium ${amount < 0 ? 'text-bad' : ''}`}>{signed(amount)}</span>
    </li>
  )
}

function EntryRow({ entry, locked, showAuthor, onToggle, onEdit, onStatement }: { entry: EntryDto; locked: boolean; showAuthor: boolean; onToggle: () => void; onEdit: () => void; onStatement: () => void }) {
  const tag = entry.installmentNo ? `${entry.installmentNo}/${entry.installmentCount}` : entry.cardPlan ? 'Kart' : entry.planId ? 'Plan' : null
  // Kart ekstresi / değişken tutar henüz girilmediyse satırdan tek dokunuşla girilir
  const awaiting = entry.variablePlan && entry.actualAmount === null && !entry.paid && !locked
  const income = entry.direction === 'income'
  const fixed = entry.type === 'reconciliation'
  return (
    <li className="flex min-h-13 items-center gap-3 border-b border-line px-3.5 py-2.5">
      <button aria-pressed={entry.paid} aria-label={entry.paid ? 'Ödenmedi olarak işaretle' : 'Ödendi olarak işaretle'} disabled={locked || fixed} onClick={onToggle} className={`-m-2.5 flex size-11 shrink-0 items-center justify-center`}>
        <span className={`flex size-[26px] items-center justify-center rounded-full ${entry.paid ? 'bg-good text-page' : 'border-2 border-line'}`}>{entry.paid && <Icon name="tik" size={14} width={3} />}</span>
      </button>
      <button onClick={onEdit} disabled={fixed} className="flex min-w-0 grow items-center gap-3 text-left">
        <span className="min-w-0 grow">
          <span className="block truncate text-[15px] font-medium">{entry.name}</span>
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap text-muted">
            {entry.dueDate && <span>{shortDate(entry.dueDate)}</span>}
            {tag && <span className="rounded-md bg-soft px-1.5 py-px font-medium text-link">{tag}</span>}
            {/* Dar ekranda sondaki bilgiler kesilir: önemliden önemsize sıralı */}
            {entry.isEstimate && !entry.paid && <span className="font-semibold text-warn">· tahmini</span>}
            {entry.autoPay && <span>· Otomatik</span>}
            {entry.itemCount > 0 && <span>· {entry.itemCount} kalem</span>}
            {entry.categoryName && <span className="truncate">· {entry.categoryName}</span>}
          </span>
        </span>
        {!awaiting && <span className={`shrink-0 text-[15px] font-medium whitespace-nowrap ${income ? 'text-good' : ''}`}>{income ? '+' : ''}{money(entry.amount)}</span>}
        {showAuthor && (
          <span title={`Ekleyen: ${entry.createdBy ?? 'içe aktarılan'}`} aria-label={`Ekleyen: ${entry.createdBy ?? 'içe aktarılan'}`} className="flex size-6 shrink-0 items-center justify-center rounded-full bg-chip text-[11px] font-semibold text-muted">
            {(entry.createdById ? (entry.createdBy ?? '?') : '·').slice(0, 1).toLocaleUpperCase('tr')}
          </span>
        )}
      </button>
      {awaiting && (
        <button onClick={onStatement} className="flex shrink-0 flex-col items-end leading-tight">
          <span className="rounded-full bg-soft px-2.5 py-1 text-[13px] font-semibold text-link">{entry.cardPlan ? 'Ekstre gir' : 'Tutarı gir'}</span>
          {entry.amount > 0 && <span className="mt-0.5 text-[11px] text-muted">~{money(entry.amount)}</span>}
        </button>
      )}
    </li>
  )
}
