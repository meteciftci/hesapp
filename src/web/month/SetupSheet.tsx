import { useState } from 'react'
import { errorMessage } from '../api'
import { Button, Field, Notice, Sheet, SheetActions } from '../ui'
import { MonthField } from '../pickers'
import { currentPeriod, parseSigned, toInput } from './format'
import { useSetupActions, useSettings } from './queries'

/**
 * İlk kurulum: dönem başlangıç günü ve başlangıç bakiyesi. Bakiye geçmiş bir aya da girilebilir;
 * geriye dönük veri girerken ilk kapanış o aydan başlar.
 */
export function SetupSheet({ month, onClose }: { month?: string; onClose: (message?: string) => void }) {
  const current = useSettings().data?.periodStartDay ?? 1
  const setup = useSetupActions()
  const [day, setDay] = useState(String(current))
  const [balance, setBalance] = useState('')
  // Seçilmezse kaydederken yeni başlangıç gününe göre bu dönem kullanılır
  const [start, setStart] = useState<string | null>(month ?? null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const periodStartDay = Number(day)
    if (!Number.isInteger(periodStartDay) || periodStartDay < 1 || periodStartDay > 28) return setError('Başlangıç günü 1–28 arasında olmalı.')
    const amount = balance.trim() ? parseSigned(balance) : 0
    if (amount === null) return setError('Bakiyeyi geçerli bir sayı olarak gir (eksi olabilir).')
    try {
      await setup.mutateAsync({ periodStartDay, current, balance: amount, month: start ?? currentPeriod })
      onClose('Başlangıç bilgileri kaydedildi.')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Sheet title="Başlangıç ayarları" onClose={() => onClose()}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5">
        {error && <Notice>{error}</Notice>}
        <Field label="Dönem başlangıç günü (1–28)" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} hint="Maaş ayın 15’inde yatıyorsa 15 yaz; dönem 15’inde başlayıp ertesi ayın 14’ünde biter. 1 yazarsan takvim ayı kullanılır." required />
        <MonthField label="Başlangıç ayı" value={start ?? currentPeriod(current)} current={currentPeriod(current)} max={currentPeriod(current)} onChange={setStart} hint="Geçmiş ayları da girip kapatacaksan en eski ayı seç; ilk kapanış bu aydan başlar." />
        <Field label="Bu ayın başındaki bakiye (₺)" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder={toInput(0)} hint="Bankadaki toplam bakiye (KMH kullanılıyorsa eksi). Sonraki devirler bundan hesaplanır." />
        <p className="text-xs text-muted">İlk dönem kapatıldıktan sonra başlangıç günü ve bakiye değiştirilemez.</p>
        <SheetActions>
          <Button type="submit" className="h-13 grow" disabled={setup.isPending}>Kaydet</Button>
        </SheetActions>
      </form>
    </Sheet>
  )
}
