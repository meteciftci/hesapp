import { useState } from 'react'
import type { EntryDto } from '../../shared/api'
import { parseMoney } from '../../shared/money'
import { errorMessage } from '../api'
import { Button, Field, Notice, Sheet, SheetActions } from '../ui'
import { money, monthTitle } from './format'
import { useEntryActions } from './queries'

/** Kart ekstresi ya da değişken tutarlı kaydın gerçek tutarını tek alanla girme. */
export function StatementSheet({ entry, onClose }: { entry: EntryDto; onClose: () => void }) {
  const actions = useEntryActions()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const kurus = parseMoney(amount)
    if (kurus === null || kurus < 0) return setError('Tutarı geçerli bir sayı olarak gir (ör. 12.450,75).')
    try {
      await actions.update.mutateAsync({ id: entry.id, actualAmount: kurus, isEstimate: false, scope: 'this' })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Sheet title={entry.cardPlan ? 'Ekstre gir' : 'Tutarı gir'} subtitle={`${entry.name} · ${monthTitle(entry.month)}`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5">
        {error && <Notice>{error}</Notice>}
        <Field label={entry.cardPlan ? 'Ekstre tutarı (₺)' : 'Tutar (₺)'} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoFocus required hint={entry.amount > 0 ? `Tahmini: ${money(entry.amount)}` : undefined} />
        <SheetActions>
          <Button type="submit" disabled={actions.update.isPending} className="h-13 grow">Kaydet</Button>
        </SheetActions>
      </form>
    </Sheet>
  )
}
