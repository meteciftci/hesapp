import { useState } from 'react'
import type { MonthDto } from '../../shared/api'
import { addMonths } from '../../shared/month'
import { errorMessage } from '../api'
import { Button, Field, Notice, Sheet, SheetActions } from '../ui'
import { money, monthName, monthTitle, parseSigned, signed } from './format'
import { useMonthActions } from './queries'

/** Ay kapanışı: banka bakiyesi ile kayıtları eşitler, farkı tek kalem olarak ekler. */
export function CloseSheet({ data, onClose }: { data: MonthDto; onClose: (message?: string) => void }) {
  const { close } = useMonthActions(data.month)
  const [balance, setBalance] = useState('')
  const [name, setName] = useState('Kayıt dışı harcamalar')
  const [error, setError] = useState<string | null>(null)
  const expected = data.totals.expectedClosing
  const bank = balance.trim() ? parseSigned(balance) : null
  const diff = bank === null ? null : expected - bank
  const next = monthName(addMonths(data.month, 1))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (bank === null) return setError('Banka bakiyesini geçerli bir sayı olarak gir (KMH kullanıldıysa eksi).')
    try {
      await close.mutateAsync({ bankBalance: bank, ...(diff !== 0 && name.trim() && { name: name.trim() }) })
      onClose(`${monthTitle(data.month)} kapatıldı.`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Sheet title={`${monthTitle(data.month)}’ı kapat`} onClose={() => onClose()}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5">
        {error && <Notice>{error}</Notice>}
        <dl className="rounded-2xl bg-page px-3.5 py-1 text-sm">
          <Line label={`${monthName(addMonths(data.month, -1))}’den devir${data.opening.provisional ? ' (geçici)' : ''}`} value={money(data.opening.amount)} />
          <Line label="Gelirler" value={signed(data.totals.income)} />
          <Line label="Kayıtlı giderler" value={`−${money(data.totals.expense)}`} />
          <div className="flex justify-between py-2.5 text-[15px] font-semibold"><dt>Kayıtlara göre olması gereken</dt><dd>{signed(expected)}</dd></div>
        </dl>

        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Bankadaki toplam bakiye
          <span className="text-xs font-normal text-muted">Tüm hesaplar toplamı. KMH kullanıldıysa eksi gir.</span>
          <input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="0,00" autoFocus className="min-h-[52px] rounded-xl border-2 border-accent bg-transparent px-3 text-xl font-semibold" />
        </label>

        {diff !== null && (
          <div className="flex flex-col gap-2 rounded-2xl border border-warn-line bg-warn-bg px-3.5 py-3 text-sm text-warn">
            {diff === 0 ? (
              <p className="font-semibold">Fark yok; kayıtlar bankayla tutuyor.</p>
            ) : (
              <>
                <p className="flex justify-between font-semibold"><span>Fark ({diff > 0 ? 'kayıt dışı harcamalar' : 'kayıt dışı gelir'})</span><span>{money(Math.abs(diff))}</span></p>
                <p className="text-[13px]">Bu tutar {monthName(data.month)} dönemine tek bir {diff > 0 ? 'gider' : 'gelir'} kalemi olarak eklenir. {next} <strong>{signed(bank as number)}</strong> devirle başlar.</p>
              </>
            )}
          </div>
        )}
        {diff !== null && diff !== 0 && <Field label="Kalem adı" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}

        <p className="text-xs text-muted">Kapanan dönem kilitlenir. Sonradan düzeltmek için ay ekranından “Ayı yeniden aç” seçilir, devir yeniden hesaplanır.</p>
        <SheetActions>
          <Button type="submit" className="h-13 grow" disabled={close.isPending || bank === null}>Ayı kapat</Button>
        </SheetActions>
      </form>
    </Sheet>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between border-b border-line py-2"><dt className="text-muted">{label}</dt><dd>{value}</dd></div>
}
