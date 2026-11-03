import { useState } from 'react'
import type { MonthDto } from '../../shared/api'
import { addMonths } from '../../shared/month'
import { errorMessage } from '../api'
import { Button, Notice, Sheet, SheetActions } from '../ui'
import { money, monthName, monthTitle, parseSigned, signed } from './format'
import { useMonthActions } from './queries'

/** Ay içi bakiye eşitleme: ay kapanmadan bankadaki güncel bakiyeye göre "Kayıt dışı harcamalar" güncellenir. */
export function SyncSheet({ data, onClose }: { data: MonthDto; onClose: (message?: string) => void }) {
  const { sync } = useMonthActions(data.month)
  const [balance, setBalance] = useState('')
  const [error, setError] = useState<string | null>(null)
  const current = data.totals.currentBalance
  const bank = balance.trim() ? parseSigned(balance) : null
  const diff = bank === null ? null : current - bank
  const recon = data.entries.find((e) => e.type === 'reconciliation')
  const reconValue = recon ? (recon.direction === 'income' ? recon.amount : -recon.amount) : 0
  const after = diff === null ? null : reconValue - diff

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (bank === null) return setError('Güncel bakiyeyi geçerli bir sayı olarak gir (KMH kullanıldıysa eksi).')
    try {
      await sync.mutateAsync({ bankBalance: bank })
      onClose(diff === 0 ? 'Kayıtlar bankayla tutuyor; değişiklik yok.' : after === 0 ? 'Bakiye eşitlendi; kayıt dışı kalemi kaldırıldı.' : `Bakiye eşitlendi; kayıt dışı ${reconLabel(after as number)}.`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Sheet title="Bakiyeyi eşitle" subtitle={monthTitle(data.month)} onClose={() => onClose()}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5">
        {error && <Notice>{error}</Notice>}
        <dl className="rounded-2xl bg-page px-3.5 py-1 text-sm">
          <Line label={`${monthName(addMonths(data.month, -1))}’den devir${data.opening.provisional ? ' (geçici)' : ''}`} value={money(data.opening.amount)} />
          <Line label="Alınan gelirler" value={signed(data.totals.incomeReceived)} />
          <Line label="Ödenen giderler" value={`−${money(data.totals.expensePaid)}`} />
          {recon && <Line label={`İçinde: ${recon.name}`} value={signed(reconValue)} />}
          <div className="flex justify-between py-2.5 text-[15px] font-semibold"><dt>Şu an bankada olması gereken</dt><dd>{signed(current)}</dd></div>
        </dl>

        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Bankadaki güncel bakiye
          <span className="text-xs font-normal text-muted">Tüm hesaplar toplamı. KMH kullanıldıysa eksi gir.</span>
          <input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="0,00" autoFocus className="min-h-[52px] rounded-xl border-2 border-accent bg-transparent px-3 text-xl font-semibold" />
        </label>

        {diff !== null && (
          <div className="flex flex-col gap-2 rounded-2xl border border-warn-line bg-warn-bg px-3.5 py-3 text-sm text-warn">
            {diff === 0 ? (
              <p className="font-semibold">Fark yok; kayıtlar bankayla tutuyor.</p>
            ) : (
              <>
                <p className="flex justify-between font-semibold"><span>{diff > 0 ? 'Kayıt dışı harcama' : 'Kayıt dışı gelir'}</span><span>{diff > 0 ? '+' : ''}{money(Math.abs(diff))}</span></p>
                <p className="text-[13px]">
                  “{recon?.name ?? 'Kayıt dışı harcamalar'}” {after === 0 ? 'kalemi kaldırılır' : <>{recon ? `${reconLabel(reconValue)} → ` : ''}<strong>{reconLabel(after as number)}</strong> olur</>}. Ay açık kalır; istediğin zaman tekrar eşitleyebilirsin.
                </p>
              </>
            )}
          </div>
        )}

        <p className="text-xs text-muted">Henüz ödenmedi işaretli kayıtlar hesaba katılmaz; onlar bankadan çıkmamış sayılır.</p>
        <SheetActions>
          <Button type="submit" className="h-13 grow" disabled={sync.isPending || bank === null}>Eşitle</Button>
        </SheetActions>
      </form>
    </Sheet>
  )
}

const reconLabel = (value: number) => (value < 0 ? `${money(-value)} gider` : `${money(value)} gelir`)

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between border-b border-line py-2"><dt className="text-muted">{label}</dt><dd>{value}</dd></div>
}
