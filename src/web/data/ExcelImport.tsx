import { useMemo, useState } from 'react'
import { formatMoney } from '../../shared/money'
import { addMonths } from '../../shared/month'
import { periodOf, periodRange } from '../../shared/period'
import { api, errorMessage } from '../api'
import { money, monthTitle, shortDate, shortMonth } from '../month/format'
import { useSettings } from '../month/queries'
import { MonthField } from '../pickers'
import { Button, Field, Notice, Pills, Segmented, Sheet } from '../ui'
import { type Cell, detectSchedule, extractRows, extractSchedule, guessColumns, guessMonth, nameFromFile } from './excel-import'
import { useQueryClient } from '@tanstack/react-query'

type Direction = 'income' | 'expense'

interface SheetState {
  name: string
  grid: Cell[][]
  include: boolean
  month: string
  headerRow: number
  cols: { name: number; amount: number; date: number }
  direction: Direction
  /** satır numarası → elle verilen yön ya da null (atla) */
  overrides: Record<number, Direction | 'skip'>
  /** `plan`: banka ödeme planı → tek bir taksitli plan; `entries`: her satır tek seferlik kayıt */
  mode: 'entries' | 'plan'
  /** Taksit numarası sütunu (plan kipinde) */
  noCol: number
  planName: string
  autoPay: boolean
  markPast: boolean
}

/** ExcelJS hücre değerlerini düz değere çevirir (formül sonucu, zengin metin, bağlantı). */
function plain(value: unknown): Cell {
  if (value === null || value === undefined) return null
  if (value instanceof Date || typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'evet' : 'hayır'
  if (typeof value === 'object') {
    const v = value as { result?: unknown; richText?: { text: string }[]; text?: unknown }
    if (v.richText) return v.richText.map((t) => t.text).join('')
    if ('result' in v) return plain(v.result)
    if ('text' in v) return plain(v.text)
  }
  return null
}

async function readWorkbook(file: File, fallbackYear: number): Promise<SheetState[]> {
  const fileName = nameFromFile(file.name)
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await file.arrayBuffer())
  return book.worksheets.map((ws) => {
    const grid: Cell[][] = []
    ws.eachRow({ includeEmpty: true }, (row, index) => {
      // Boş hücreler ExcelJS'te dizide delik olarak gelir; Array.from onları null yapar.
      grid[index - 1] = Array.from((row.values as unknown[]).slice(1), plain)
    })
    for (let i = 0; i < grid.length; i++) grid[i] ??= []
    const month = guessMonth(ws.name, fallbackYear)
    const cols = guessColumns(grid[0] ?? [], grid.slice(1, 40))
    // Banka ödeme planı (sıralı taksit numarası + tarih + tutar) varsayılan olarak taksitli plan olur.
    const noCol = detectSchedule(grid, 1, cols)
    const generic = /^(sayfa|sheet|tablo)\s*\d*$/i.test(ws.name.trim()) || ws.name.length < 3
    const planName = book.worksheets.length === 1 || generic ? fileName : `${fileName} – ${ws.name}`
    return {
      name: ws.name,
      grid,
      include: month !== null || noCol !== null,
      month: month ?? `${fallbackYear}-01`,
      headerRow: 1,
      cols,
      direction: 'expense' as Direction,
      overrides: {},
      mode: noCol !== null ? 'plan' : 'entries',
      noCol: noCol ?? -1,
      planName,
      autoPay: false,
      markPast: true,
    } satisfies SheetState
  })
}

const colLabel = (grid: Cell[][], headerRow: number, index: number) => {
  const head = grid[headerRow - 1]?.[index]
  const letter = String.fromCharCode(65 + (index % 26))
  return `${letter}${head ? ` · ${String(head).slice(0, 18)}` : ''}`
}

export function ExcelImportSheet({ onClose }: { onClose: (message?: string) => void }) {
  const startDay = useSettings().data?.periodStartDay ?? 1
  const client = useQueryClient()
  const [sheets, setSheets] = useState<SheetState[] | null>(null)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const update = (index: number, patch: Partial<SheetState>) => setSheets((all) => all && all.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  const prepared = useMemo(
    () =>
      (sheets ?? []).map((s) => {
        const range = periodRange(s.month, startDay)
        const rows = extractRows(s.grid, s.headerRow, s.cols).map((r) => {
          const override = s.overrides[r.line]
          // Tarihli satır, tarihinin düştüğü döneme yazılır; tarihsiz satır sayfanın dönemine.
          const month = r.date ? periodOf(r.date, startDay) : s.month
          return { ...r, month, direction: (override === 'income' || override === 'expense' ? override : s.direction) as Direction, skipped: override === 'skip' }
        })
        // Ödeme planı: taksit numarası ≥ 1 olan satırlar plan olur; 0. taksit (ör. ara dönem faizi) tek seferlik kayıt.
        const schedule = s.mode === 'plan' && s.noCol >= 0 ? extractSchedule(s.grid, s.headerRow, s.cols, s.noCol) : []
        const installments = schedule.filter((r) => r.no >= 1)
        const first = installments[0]
        const plan =
          first && first.date
            ? {
                startMonth: addMonths(periodOf(first.date, startDay), -(first.no - 1)),
                dayOfMonth: Number(first.date.slice(8, 10)),
                count: installments[installments.length - 1]!.no,
                firstNo: first.no,
                amounts: installments.map((r) => r.amount),
                extras: schedule.filter((r) => r.no < 1),
                total: installments.reduce((sum, r) => sum + r.amount, 0),
              }
            : null
        return { range, rows, schedule, plan }
      }),
    [sheets, startDay],
  )

  async function open(file: File | undefined) {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const loaded = await readWorkbook(file, new Date().getFullYear())
      if (loaded.length === 0) throw new Error('dosyada sayfa bulunamadı')
      setSheets(loaded)
      setActive(0)
    } catch (e) {
      setError(`Dosya okunamadı: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const planSheets = (sheets ?? []).map((s, i) => ({ s, view: prepared[i]! })).filter(({ s, view }) => s.include && s.mode === 'plan' && view.plan)
  const toImport = (sheets ?? []).flatMap((s, i) => (s.include && s.mode === 'entries' ? prepared[i]!.rows.filter((r) => !r.skipped).map((r) => ({ month: r.month, direction: r.direction, name: r.name, plannedAmount: r.amount, ...(r.date && { dueDate: r.date }) })) : []))

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      const done: string[] = []
      for (const { s, view } of planSheets) {
        const p = view.plan!
        const name = s.planName.trim() || s.name
        const { plan } = await api<{ plan: { id: string } }>('/plans', {
          body: { direction: s.direction, kind: 'installment', name, amount: p.amounts[0], dayOfMonth: p.dayOfMonth, startMonth: p.startMonth, installmentCount: p.count, autoPay: s.autoPay, markPastPaid: s.markPast },
        })
        // Taksit tutarları farklıysa (son taksit, değişken faiz) bankanın planı aynen yazılır.
        if (p.firstNo > 1 || p.amounts.some((a) => a !== p.amounts[0])) {
          await api(`/plans/${plan.id}/schedule`, { body: { amounts: p.amounts, startNo: p.firstNo, force: true } })
        }
        // 0. taksit gibi numarasız satırlar tek seferlik kayıt olur.
        const extras = p.extras.filter((r) => r.date).map((r) => ({ month: periodOf(r.date!, startDay), direction: s.direction, name: `${name} ${r.no}. taksit`, plannedAmount: r.amount, dueDate: r.date! }))
        if (extras.length) await api('/entries/bulk', { body: { entries: extras } })
        done.push(`“${name}” (${p.count} taksit)`)
      }
      for (let i = 0; i < toImport.length; i += 400) await api('/entries/bulk', { body: { entries: toImport.slice(i, i + 400) } })
      await client.invalidateQueries()
      onClose([done.length ? `Plan olarak aktarıldı: ${done.join(', ')}.` : '', toImport.length ? `${toImport.length} kayıt içe aktarıldı.` : ''].filter(Boolean).join(' '))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const sheet = sheets?.[active]
  const view = prepared[active]
  const width = sheet ? Math.max(1, ...sheet.grid.map((r) => r.length)) : 0

  return (
    <Sheet title="Excel’den içe aktar" onClose={() => onClose()}>
      <div className="flex flex-col gap-3.5">
        {error && <Notice>{error}</Notice>}
        {!sheets && (
          <>
            <p className="text-sm text-muted">Bütçe ya da kredi ödeme planı dosyanı seç (.xlsx). Bankanın ödeme planı tanınırsa tek bir taksitli plan olarak, diğer sayfalar tek seferlik gelir/gider kayıtları olarak eklenir. Sütunları sen seçersin, her şey önizlenir.</p>
            <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-2xl bg-accent px-4 font-semibold text-white">
              {busy ? 'Okunuyor…' : 'Dosya seç'}
              <input type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { void open(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          </>
        )}

        {sheets && sheet && view && (
          <>
            <Pills label="Sayfa" value={String(active)} onChange={(v) => setActive(Number(v))} options={sheets.map((s, i) => ({ value: String(i), label: `${s.include ? '✓ ' : ''}${s.name}` }))} />
            <label className="flex min-h-11 items-center justify-between text-[15px]">
              Bu sayfayı içe aktar
              <input type="checkbox" className="size-[22px] accent-accent" checked={sheet.include} onChange={(e) => update(active, { include: e.target.checked })} />
            </label>
            {sheet.include && (
              <Segmented<SheetState['mode']>
                label="Aktarım türü"
                value={sheet.mode}
                onChange={(mode) => update(active, { mode, noCol: mode === 'plan' && sheet.noCol < 0 ? (detectSchedule(sheet.grid, sheet.headerRow, sheet.cols) ?? 0) : sheet.noCol })}
                options={[{ value: 'plan', label: 'Kredi ödeme planı' }, { value: 'entries', label: 'Tek tek kayıtlar' }]}
              />
            )}
            {sheet.include && sheet.mode === 'plan' && (
              <>
                <Field label="Plan adı" value={sheet.planName} onChange={(e) => update(active, { planName: e.target.value })} maxLength={80} hint="Taksitler bu adla ve sırasıyla (ör. 3/9) görünür." />
                <div className="grid grid-cols-2 gap-2.5">
                  <Select label="Taksit no sütunu" value={sheet.noCol} width={width} sheet={sheet} onChange={(noCol) => update(active, { noCol })} />
                  <Select label="Tutar sütunu" value={sheet.cols.amount} width={width} sheet={sheet} onChange={(amount) => update(active, { cols: { ...sheet.cols, amount } })} />
                  <Select label="Tarih sütunu" value={sheet.cols.date} width={width} sheet={sheet} onChange={(date) => update(active, { cols: { ...sheet.cols, date } })} />
                  <Field label="Başlık satırı no" inputMode="numeric" value={String(sheet.headerRow)} onChange={(e) => update(active, { headerRow: Math.max(0, Number(e.target.value) || 0) })} hint="0: başlık yok" />
                </div>
                <Segmented<Direction> label="Yön" value={sheet.direction} onChange={(direction) => update(active, { direction })} options={[{ value: 'expense', label: 'Gider (kredi)' }, { value: 'income', label: 'Gelir (alacak)' }]} />
                <label className="flex min-h-11 items-center justify-between text-[15px]">
                  Otomatik ödeme
                  <input type="checkbox" className="size-[22px] accent-accent" checked={sheet.autoPay} onChange={(e) => update(active, { autoPay: e.target.checked })} />
                </label>
                <label className="flex min-h-11 items-center justify-between text-[15px]">
                  Vadesi geçmiş taksitleri ödendi say
                  <input type="checkbox" className="size-[22px] accent-accent" checked={sheet.markPast} onChange={(e) => update(active, { markPast: e.target.checked })} />
                </label>
                {view.plan ? (
                  <>
                    <p className="rounded-xl bg-soft px-3.5 py-3 text-[13px]">
                      <span className="font-semibold">{view.plan.count} taksit</span> · {shortMonth(addMonths(view.plan.startMonth, view.plan.firstNo - 1))} – {shortMonth(addMonths(view.plan.startMonth, view.plan.count - 1))} · her ayın {view.plan.dayOfMonth}’i · toplam {money(view.plan.total)}
                      {view.plan.extras.length > 0 && <> · ayrıca {view.plan.extras.map((r) => `${r.no}. taksit`).join(', ')} tek seferlik kayıt olarak eklenir</>}
                    </p>
                    <ul className="m-0 flex max-h-64 list-none flex-col overflow-y-auto rounded-xl border border-edge p-0 text-sm">
                      {view.schedule.map((r) => (
                        <li key={r.line} className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-1.5 last:border-b-0">
                          <span className="w-12 shrink-0 text-muted">{r.no >= 1 ? `${r.no}/${view.plan!.count}` : `${r.no}.`}</span>
                          <span className="grow text-xs text-muted">{r.date ? `${shortDate(r.date)} ${r.date.slice(0, 4)}` : 'tarih okunamadı'}</span>
                          <span className="tabular-nums">{formatMoney(r.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <Notice>Ödeme planı okunamadı. Taksit no, tutar ve tarih sütunlarını kontrol et; ilk taksitin tarihi okunabilmeli.</Notice>
                )}
              </>
            )}
            {sheet.include && sheet.mode === 'entries' && (
              <>
                <MonthField label="Dönem" value={sheet.month} onChange={(month) => update(active, { month })} hint={`Tarihsiz satırlar ${monthTitle(sheet.month)} dönemine (${view.range.start} – ${view.range.end}) yazılır; tarihli satırlar kendi tarihlerinin dönemine.`} />
                <div className="grid grid-cols-2 gap-2.5">
                  <Select label="Ad sütunu" value={sheet.cols.name} width={width} sheet={sheet} onChange={(name) => update(active, { cols: { ...sheet.cols, name } })} />
                  <Select label="Tutar sütunu" value={sheet.cols.amount} width={width} sheet={sheet} onChange={(amount) => update(active, { cols: { ...sheet.cols, amount } })} />
                  <Select label="Tarih sütunu" value={sheet.cols.date} width={width} sheet={sheet} optional onChange={(date) => update(active, { cols: { ...sheet.cols, date } })} />
                  <Field label="Başlık satırı no" inputMode="numeric" value={String(sheet.headerRow)} onChange={(e) => update(active, { headerRow: Math.max(0, Number(e.target.value) || 0) })} hint="0: başlık yok" />
                </div>
                <Segmented<Direction> label="Varsayılan yön" value={sheet.direction} onChange={(direction) => update(active, { direction, overrides: {} })} options={[{ value: 'expense', label: 'Gider' }, { value: 'income', label: 'Gelir' }]} />

                <ul className="m-0 flex max-h-64 list-none flex-col overflow-y-auto rounded-xl border border-edge p-0 text-sm">
                  {view.rows.length === 0 && <li className="p-3 text-muted">Satır bulunamadı. Sütunları ve başlık satırını kontrol et.</li>}
                  {view.rows.map((r) => (
                    <li key={r.line} className={`flex items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-b-0 ${r.skipped ? 'opacity-45' : ''}`}>
                      <input type="checkbox" aria-label={`${r.name} dahil`} className="size-5 accent-accent" checked={!r.skipped} onChange={(e) => update(active, { overrides: { ...sheet.overrides, [r.line]: e.target.checked ? r.direction : 'skip' } })} />
                      <span className="min-w-0 grow">
                        <span className="block truncate">{r.name}</span>
                        <span className="text-xs text-muted">
                          {r.date ? shortDate(r.date) : r.dateText ? <span className="text-bad">tarih okunamadı: “{r.dateText}”</span> : 'tarihsiz'} · {monthTitle(r.month)}
                        </span>
                      </span>
                      <span className="tabular-nums">{formatMoney(r.amount)}</span>
                      <button type="button" disabled={r.skipped} onClick={() => update(active, { overrides: { ...sheet.overrides, [r.line]: r.direction === 'income' ? 'expense' : 'income' } })} className={`min-h-9 w-14 rounded-lg border border-edge text-xs font-medium ${r.direction === 'income' ? 'text-good' : ''}`}>
                        {r.direction === 'income' ? 'Gelir' : 'Gider'}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Button disabled={busy || (toImport.length === 0 && planSheets.length === 0)} onClick={() => void submit()}>
              {[planSheets.length ? `${planSheets.length} planı` : '', toImport.length ? `${toImport.length} kaydı` : ''].filter(Boolean).join(' ve ') || 'Hiçbir şeyi'} içe aktar
            </Button>
          </>
        )}
      </div>
    </Sheet>
  )
}

function Select({ label, value, width, sheet, optional = false, onChange }: { label: string; value: number; width: number; sheet: SheetState; optional?: boolean; onChange: (index: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-h-12 rounded-xl border border-edge bg-surface px-2 text-base font-normal text-ink">
        {optional && <option value={-1}>Yok</option>}
        {!optional && value < 0 && <option value={-1}>Seç…</option>}
        {Array.from({ length: width }, (_, i) => <option key={i} value={i}>{colLabel(sheet.grid, sheet.headerRow || 1, i)}</option>)}
      </select>
    </label>
  )
}
