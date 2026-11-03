import { useState } from 'react'
import type { EntryDto, EntryItemDto } from '../../shared/api'
import { parseMoney } from '../../shared/money'
import { errorMessage } from '../api'
import { Button, Field, Notice } from '../ui'
import { DateField } from '../pickers'
import { money, shortDate, toInput } from './format'
import { useItems } from './queries'

/**
 * Bir giderin (ör. kart ekstresi) kalemleri. Kalem girmek isteğe bağlıdır; kaydın tutarı ekstre toplamıdır,
 * kalemler yalnızca dökümü gösterir (plan, bölüm 14.2).
 */
export function ItemsSection({ entry, locked, onEntryChange }: { entry: EntryDto; locked: boolean; onEntryChange: (entry: EntryDto) => void }) {
  const [open, setOpen] = useState(entry.itemCount > 0)
  const { query, add, update, remove } = useItems(entry.id, open)
  const [editing, setEditing] = useState<EntryItemDto | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = query.data?.entry ?? entry
  const items = query.data?.items ?? []
  const other = current.amount - current.itemsTotal

  async function run(action: () => Promise<{ entry: EntryDto }>) {
    setError(null)
    try {
      const result = await action()
      onEntryChange(result.entry)
      setEditing(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 self-start text-sm font-medium text-link underline">
        Harcama kalemleri ekle (isteğe bağlı)
      </button>
    )
  }

  return (
    <section className="flex flex-col gap-2.5 rounded-2xl border border-edge p-3">
      <h3 className="text-[13px] font-semibold">Harcama kalemleri</h3>
      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex justify-between"><dt className="text-muted">Girilen kalemler</dt><dd>{money(current.itemsTotal)}</dd></div>
        {other >= 0 && <div className="flex justify-between"><dt className="text-muted">Diğer (girilmemiş)</dt><dd>{money(other)}</dd></div>}
        <div className="flex justify-between font-semibold"><dt>Ekstre toplamı{current.actualAmount === null ? ' (tahmini)' : ''}</dt><dd>{money(current.amount)}</dd></div>
      </dl>
      {other < 0 && <Notice>Kalemler ekstre toplamını {money(-other)} aşıyor. Gerçekleşen tutarı kontrol et.</Notice>}
      {error && <Notice>{error}</Notice>}
      {query.isPending && <p className="text-xs text-muted">Yükleniyor…</p>}

      {items.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((item) =>
            editing !== 'new' && editing?.id === item.id ? (
              <li key={item.id} className="py-1.5">
                <ItemForm item={item} busy={update.isPending || remove.isPending} onCancel={() => setEditing(null)} onSave={(body) => run(() => update.mutateAsync({ id: item.id, ...body }))} onDelete={() => run(() => remove.mutateAsync(item.id))} />
              </li>
            ) : (
              <li key={item.id} className="border-b border-line last:border-b-0">
                <button type="button" disabled={locked} onClick={() => setEditing(item)} className="flex min-h-11 w-full items-center justify-between gap-2 py-1.5 text-left text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{item.name}</span>
                    <span className="text-xs text-muted">{[item.date && shortDate(item.date), item.installmentNo && `${item.installmentNo}/${item.installmentCount}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="shrink-0">{money(item.amount)}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {!locked && (editing === 'new' ? (
        <ItemForm busy={add.isPending} onCancel={() => setEditing(null)} onSave={(body) => run(() => add.mutateAsync(body))} />
      ) : (
        <Button type="button" variant="secondary" className="min-h-11" onClick={() => setEditing('new')}>Kalem ekle</Button>
      ))}
      <p className="text-xs text-muted">Kalemler ay toplamına ayrıca eklenmez; yalnızca bu giderin dökümüdür.</p>
    </section>
  )
}

type ItemBody = { name: string; amount: number; date: string | null; installmentNo: number | null; installmentCount: number | null }

function ItemForm({ item, busy, onSave, onCancel, onDelete }: { item?: EntryItemDto; busy: boolean; onSave: (body: ItemBody) => void; onCancel: () => void; onDelete?: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item ? toInput(item.amount) : '')
  const [date, setDate] = useState(item?.date ?? '')
  const [no, setNo] = useState(item?.installmentNo ? String(item.installmentNo) : '')
  const [count, setCount] = useState(item?.installmentCount ? String(item.installmentCount) : '')
  const [error, setError] = useState<string | null>(null)

  function save() {
    setError(null)
    const kurus = parseMoney(amount)
    if (!name.trim()) return setError('Kalemin adını gir.')
    if (kurus === null || kurus < 0) return setError('Tutarı geçerli bir sayı olarak gir.')
    const n = no.trim() ? Number(no) : null
    const total = count.trim() ? Number(count) : null
    if ((n === null) !== (total === null)) return setError('Taksit için sıra ve sayıyı birlikte gir (ör. 3 / 6) ya da ikisini de boş bırak.')
    if (n !== null && total !== null && (!Number.isInteger(n) || !Number.isInteger(total) || n < 1 || n > total)) return setError('Taksit sırası 1 ile taksit sayısı arasında olmalı.')
    onSave({ name: name.trim(), amount: kurus, date: date || null, installmentNo: n, installmentCount: total })
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-page p-2.5">
      {error && <Notice>{error}</Notice>}
      <Field label="Kalem" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="ör. Market" />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Tutar (₺)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        <DateField label="Tarih (isteğe bağlı)" value={date} onChange={setDate} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Taksit sırası" inputMode="numeric" value={no} onChange={(e) => setNo(e.target.value)} placeholder="ör. 3" />
        <Field label="Taksit sayısı" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} placeholder="ör. 6" />
      </div>
      <div className="flex gap-2">
        {onDelete && <Button type="button" variant="danger" className="min-h-11" disabled={busy} onClick={onDelete}>Sil</Button>}
        <Button type="button" variant="secondary" className="min-h-11 grow" disabled={busy} onClick={onCancel}>Vazgeç</Button>
        <Button type="button" className="min-h-11 grow" disabled={busy} onClick={save}>Kaydet</Button>
      </div>
    </div>
  )
}
