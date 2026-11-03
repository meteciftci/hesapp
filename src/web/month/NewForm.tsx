import { useState } from 'react'
import { addMonths } from '../../shared/month'
import { formatMoney, parseMoney } from '../../shared/money'
import { dueDateInPeriod, isDateInPeriod, periodRange } from '../../shared/period'
import { errorMessage } from '../api'
import { Button, Field, Notice, Segmented, SheetActions } from '../ui'
import { DateField, MonthField } from '../pickers'
import { CategorySelect } from './CategorySelect'
import { localToday, money, shortMonth, toInput } from './format'
import { useEntryActions, usePlanActions, useRecentEntries, useSettings } from './queries'

type Kind = 'once' | 'recurring' | 'installment' | 'card'

/** Yeni kayıt: tek sefer, her ay tekrarlayan, taksitli plan ya da kredi kartı tanımı. */
export function NewForm({ month, onDone }: { month: string; onDone: () => void }) {
  const startDay = useSettings().data?.periodStartDay ?? 1
  const entries = useEntryActions()
  const plans = usePlanActions()
  const [direction, setDirection] = useState<'income' | 'expense'>('expense')
  const [kind, setKind] = useState<Kind>('once')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [count, setCount] = useState('12')
  const [first, setFirst] = useState(month)
  const [day, setDay] = useState(String(startDay))
  const [dueDate, setDueDate] = useState('')
  const [autoPay, setAutoPay] = useState(false)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [variable, setVariable] = useState(false)
  const [markPast, setMarkPast] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const range = periodRange(month, startDay)
  const recent = useRecentEntries().data ?? []

  const card = kind === 'card'
  const kurus = card && amount.trim() === '' ? 0 : parseMoney(amount)
  const total = Number(count)
  const dayNo = Number(day)
  const validPlan = /^\d{4}-\d{2}$/.test(first) && Number.isInteger(dayNo) && dayNo >= 1 && dayNo <= 31
  const installments = kind === 'installment' && validPlan && Number.isInteger(total) && total >= 1 && total <= 600 ? total : null
  const pastCount = installments === null ? 0 : Array.from({ length: installments }, (_, i) => dueDateInPeriod(addMonths(first, i), dayNo, startDay)).filter((d) => d < localToday()).length
  const busy = entries.create.isPending || plans.create.isPending

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (kurus === null || kurus < 0) return setError('Tutarı geçerli bir sayı olarak gir (ör. 1.250,50).')
    try {
      if (kind === 'once') {
        if (dueDate && !isDateInPeriod(dueDate, month, startDay)) return setError(`Vade dönemin içinde olmalı (${range.start} – ${range.end}).`)
        await entries.create.mutateAsync({ month, direction, name: name.trim(), plannedAmount: kurus, dueDate: dueDate || undefined, autoPay, categoryId })
      } else {
        if (!validPlan) return setError('İlk ay ve ödeme günü (1–31) geçerli olmalı.')
        if (kind === 'installment' && installments === null) return setError('Taksit sayısı 1–600 arasında olmalı.')
        await plans.create.mutateAsync({
          direction: card ? 'expense' : direction,
          kind: card ? 'recurring' : kind,
          name: name.trim(),
          amount: kurus,
          dayOfMonth: dayNo,
          startMonth: first,
          autoPay,
          categoryId,
          markPastPaid: markPast && pastCount > 0,
          ...(kind === 'installment' ? { installmentCount: installments as number } : card ? { card: true, variable: true } : { variable }),
        })
      }
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const amountLabel = kind === 'installment' ? 'Taksit tutarı (₺)' : card ? 'Tahmini ekstre (₺)' : 'Tutar (₺)'

  function pickKind(next: Kind) {
    setKind(next)
    if (next === 'card') {
      setDirection('expense')
      setCategoryId((c) => c ?? 'cat-kart')
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5">
      {error && <Notice>{error}</Notice>}
      {!card && <Segmented label="Yön" value={direction} onChange={setDirection} options={[{ value: 'expense', label: 'Gider' }, { value: 'income', label: 'Gelir' }]} />}
      <Segmented label="Sıklık" value={kind} onChange={pickKind} options={[{ value: 'once', label: 'Tek sefer' }, { value: 'recurring', label: 'Her ay' }, { value: 'installment', label: 'Taksitli' }, { value: 'card', label: 'Kart' }]} />
      {card && <p className="text-[13px] text-muted">Kartı bir kez tanımla; her ay ekstre kaydı tahmini olarak gelir, ekstre kesilince tutarını girersin.</p>}
      {kind === 'once' && recent.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted">Son kullanılanlar</p>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((r) => (
              <button
                key={`${r.direction}-${r.name}`}
                type="button"
                onClick={() => { setName(r.name); setAmount(toInput(r.amount)); setDirection(r.direction); setCategoryId(r.categoryId) }}
                className={`min-h-9 rounded-full border px-3 text-sm ${name === r.name && direction === r.direction ? 'border-accent bg-soft font-medium' : 'border-edge'}`}
              >
                {r.name}{r.direction === 'income' ? ' ↑' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      <Field label={card ? 'Kart adı' : 'Ad'} placeholder={card ? 'ör. Bonus Kart' : undefined} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={amountLabel} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required={!card} />
        {kind === 'installment' && <Field label="Taksit sayısı" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} required />}
        {kind === 'once' && <DateField label="Vade" value={dueDate} min={range.start} max={range.end} onChange={setDueDate} />}
        {kind !== 'once' && <MonthField label={kind === 'installment' ? 'İlk taksit' : card ? 'İlk ekstre' : 'İlk ay'} value={first} current={month} onChange={setFirst} />}
        {kind !== 'once' && <Field label={card ? 'Son ödeme günü' : 'Ödeme günü'} inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} required />}
      </div>

      <CategorySelect value={categoryId} direction={direction} onChange={setCategoryId} />

      <label className="flex min-h-11 items-center justify-between text-[15px]">
        Otomatik ödeme
        <input type="checkbox" className="size-[22px] accent-accent" checked={autoPay} onChange={(e) => setAutoPay(e.target.checked)} />
      </label>
      {kind === 'recurring' && (
        <label className="flex min-h-11 items-center justify-between text-[15px]">
          Tutar her ay değişir (tahmini doğar)
          <input type="checkbox" className="size-[22px] accent-accent" checked={variable} onChange={(e) => setVariable(e.target.checked)} />
        </label>
      )}

      {kind !== 'once' && validPlan && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-soft px-3.5 py-3 text-[13px]">
          {installments !== null && kurus !== null ? (
            <p><span className="font-semibold">{installments} taksit</span> oluşturulacak: {shortMonth(first)} – {shortMonth(addMonths(first, installments - 1))} · toplam {money(kurus * installments)}</p>
          ) : (
            <p>{shortMonth(first)} döneminden başlayarak her ayın {dayNo}. günü{kurus !== null && !(card && kurus === 0) ? ` · ${card ? 'tahmini ' : ''}${formatMoney(kurus)} ₺` : ''}</p>
          )}
          {pastCount > 0 && (
            <label className="flex min-h-8 items-center gap-2">
              <input type="checkbox" className="size-[18px] accent-accent" checked={markPast} onChange={(e) => setMarkPast(e.target.checked)} />
              Geçmiş {pastCount} {kind === 'installment' ? 'taksiti' : 'kaydı'} ödendi say
            </label>
          )}
        </div>
      )}

      <SheetActions>
        <Button type="submit" disabled={busy} className="h-13 grow">Kaydet</Button>
      </SheetActions>
    </form>
  )
}
