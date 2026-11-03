import { useState } from 'react'
import type { EntryDto } from '../../shared/api'
import { parseMoney } from '../../shared/money'
import { errorMessage } from '../api'
import { Button, Field, Icon, Notice, SheetActions } from '../ui'
import { money, toInput } from './format'
import { DateField } from '../pickers'
import { CategorySelect } from './CategorySelect'
import { History } from './History'
import { ItemsSection } from './Items'
import { useConfirm } from '../confirm'
import { useEntryActions, usePlan } from './queries'

interface Props {
  month: string
  range: { start: string; end: string }
  entry: EntryDto
  /** Kapalı dönem: kalemler yalnızca görüntülenir */
  locked?: boolean
  onDone: (message?: string) => void
}

type Scope = 'this' | 'following' | 'all'

/** Kaydı düzenleme: tutar, vade, ödendi ve (plana bağlıysa) değişiklik kapsamı. */
export function EntryForm({ range, entry, locked = false, onDone }: Props) {
  const actions = useEntryActions()
  const confirm = useConfirm()
  const plan = usePlan(entry.planId ?? '')
  const [planned, setPlanned] = useState(toInput(entry.plannedAmount))
  const [actual, setActual] = useState(entry.actualAmount != null ? toInput(entry.actualAmount) : '')
  const [dueDate, setDueDate] = useState(entry.dueDate ?? '')
  const [paid, setPaid] = useState(entry.paid)
  const [name, setName] = useState(entry.name)
  const [categoryId, setCategoryId] = useState<string | null>(entry.categoryId)
  const [scope, setScope] = useState<Scope>('this')
  const [error, setError] = useState<string | null>(null)
  const linked = entry.planId != null
  const busy = actions.update.isPending || actions.remove.isPending || actions.removeClosed.isPending || actions.togglePaid.isPending
  // Sunucu adı gönderir; kişi çıkarılmışsa kimliği gelir, içe aktarılan kayıtlarda boştur.
  const who = (name: string | null) => name ?? '—'

  const siblings = plan.data?.entries ?? []
  const here = siblings.find((s) => s.id === entry.id)
  const following = siblings.filter((s) => !s.paid && (here ? s.month >= here.month : true))
  const everything = siblings.filter((s) => !s.paid)
  const paidCount = siblings.filter((s) => s.paid).length
  const unit = entry.installmentNo ? 'taksit' : 'kayıt'

  const scopes: { value: Scope; title: string; detail?: string }[] = [
    { value: 'this', title: `Sadece bu ${unit}` },
    { value: 'following', title: `Bu ve sonraki ${unit}ler`, detail: plan.data ? `${following.length} ${unit} güncellenir. Ödenmiş ${paidCount} ${unit} aynı kalır.` : undefined },
    { value: 'all', title: `Tüm ${unit}ler`, detail: plan.data ? `${everything.length} ödenmemiş ${unit} güncellenir.` : undefined },
  ]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const plannedAmount = parseMoney(planned)
    if (plannedAmount === null || plannedAmount < 0) return setError('Planlanan tutar geçerli bir sayı olmalı (ör. 1.250,50).')
    const actualAmount = actual.trim() === '' ? null : parseMoney(actual)
    if (actual.trim() !== '' && (actualAmount === null || actualAmount < 0)) return setError('Gerçekleşen tutar geçerli bir sayı olmalı.')
    try {
      await actions.update.mutateAsync({
        id: entry.id,
        name: name.trim(),
        plannedAmount,
        dueDate: dueDate || null,
        ...(categoryId !== entry.categoryId && { categoryId }),
        scope,
        ...(scope === 'this' && { actualAmount, isEstimate: actualAmount !== null ? false : entry.isEstimate }),
      })
      if (paid !== entry.paid) await actions.togglePaid.mutateAsync({ id: entry.id, paid })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function remove() {
    try {
      await actions.remove.mutateAsync(entry.id)
      onDone(`“${entry.name}” silindi.`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  // Kapalı ay: kayıt yanlışsa silinebilir; kapanış bakiyesi aynı kalır, fark kapanış farkı kaydına geçer
  async function removeClosed() {
    if (!(await confirm({
      title: 'Kapalı aydan silinsin mi?',
      message: `“${entry.name}” silinir. Ayın kapanış bakiyesi değişmez; ${money(entry.amount)} fark “Kayıt dışı” kapanış farkı kaydına yansır.`,
      confirmLabel: 'Sil',
      destructive: true,
    }))) return
    try {
      await actions.removeClosed.mutateAsync(entry.id)
      onDone(`“${entry.name}” kapalı aydan silindi.`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5">
      {error && <Notice>{error}</Notice>}
      <Field label="Ad" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      <CategorySelect value={categoryId} direction={entry.direction} onChange={setCategoryId} />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Planlanan (₺)" inputMode="decimal" value={planned} onChange={(e) => setPlanned(e.target.value)} required />
        <Field label={entry.cardPlan ? 'Ekstre tutarı (₺)' : 'Gerçekleşen (₺)'} inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="Ödenince gir" disabled={scope !== 'this'} />
        <DateField label="Vade" value={dueDate} min={range.start} max={range.end} onChange={setDueDate} />
        <label className="mt-5 flex h-12 items-center justify-between rounded-xl border border-edge px-3 text-[15px]">
          Ödendi
          <input type="checkbox" className="size-[22px] accent-good" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
        </label>
      </div>

      {linked && !locked && (
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-[13px] font-semibold">Değişiklik nereye uygulansın?</legend>
          {scopes.map((s) => (
            <label key={s.value} className={`flex items-start gap-3 rounded-xl p-3 text-[15px] ${scope === s.value ? 'border-2 border-accent bg-soft p-[11px]' : 'border border-edge'}`}>
              <input type="radio" name="kapsam" className="mt-0.5 size-5 accent-accent" checked={scope === s.value} onChange={() => setScope(s.value)} />
              <span className="flex flex-col gap-0.5">
                <span className={scope === s.value ? 'font-semibold' : ''}>{s.title}</span>
                {scope === s.value && s.detail && <span className="text-xs text-muted">{s.detail}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Icon name="yaklasan" size={14} />
        Ekleyen: {who(entry.createdBy)} · Son düzenleyen: {who(entry.updatedBy)}
      </p>

      {entry.direction === 'expense' && entry.type === 'normal' && (
        <ItemsSection entry={entry} locked={locked} onEntryChange={(next) => setPlanned(toInput(next.plannedAmount))} />
      )}

      <History entity="entry" id={entry.id} />

      {locked ? (
        <SheetActions>
          <Button type="button" variant="danger" className="h-13 grow" disabled={busy || entry.type === 'reconciliation'} onClick={() => void removeClosed()}>Kapalı aydan sil</Button>
        </SheetActions>
      ) : (
        <SheetActions>
          <Button type="button" variant="danger" className="h-13" disabled={busy} onClick={() => void remove()}>Sil</Button>
          <Button type="submit" className="h-13 grow" disabled={busy}>Kaydet</Button>
        </SheetActions>
      )}
    </form>
  )
}
