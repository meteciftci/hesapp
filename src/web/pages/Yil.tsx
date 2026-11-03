import { useState } from 'react'
import { errorMessage } from '../api'
import { YearPickerTitle } from '../pickers'
import { currentPeriod, money, monthName, signed } from '../month/format'
import { useSettings, useYear } from '../month/queries'
import { BottomNav, Notice, Page, PageHeader, SectionLabel } from '../ui'

/** Tutarı bar etiketinde kuruşsuz gösterir: +3.598 / −8.402 */
const whole = (kurus: number) => `${kurus < 0 ? '−' : '+'}${Math.abs(Math.round(kurus / 100)).toLocaleString('tr-TR')}`

export function Yil() {
  const startDay = useSettings().data?.periodStartDay ?? 1
  const [selected, setSelected] = useState<number | null>(null)
  const year = selected ?? Number(currentPeriod(startDay).slice(0, 4))
  const { data, error } = useYear(year)
  const thisPeriod = currentPeriod(startDay)
  const max = Math.max(1, ...(data?.months.map((m) => Math.abs(m.closing)) ?? []))

  return (
    <Page wide>
      <PageHeader title={<>Yıl özeti · <YearPickerTitle year={year} current={Number(currentPeriod(startDay).slice(0, 4))} onChange={setSelected} /></>} />
      {error && <Notice>{errorMessage(error)}</Notice>}
      {data && (
        <>
          <section className="grid grid-cols-3 gap-2 rounded-2xl bg-surface px-4 py-3.5">
            <div><p className="text-xs text-muted">Gelir</p><p className="text-[15px] font-semibold">{Math.round(data.totals.income / 100).toLocaleString('tr-TR')}</p></div>
            <div><p className="text-xs text-muted">Gider</p><p className="text-[15px] font-semibold">{Math.round(data.totals.expense / 100).toLocaleString('tr-TR')}</p></div>
            <div><p className="text-xs text-muted">Net</p><p className={`text-[15px] font-semibold ${data.totals.net < 0 ? 'text-bad' : 'text-good'}`}>{whole(data.totals.net)}</p></div>
          </section>

          <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
            <div className="flex flex-col gap-2">
                <SectionLabel>Ay sonu kalan</SectionLabel>
                <div className="rounded-2xl bg-surface px-3.5 py-1.5">
                  {data.months.map((m) => {
                    const width = `${Math.max(2, Math.round((Math.abs(m.closing) / max) * 100))}%`
                    const future = m.month > thisPeriod
                    return (
                      <div key={m.month} className={`grid h-10 grid-cols-[52px_minmax(0,1fr)_84px] items-center gap-2 ${future ? 'opacity-75' : ''}`} aria-label={`${monthName(m.month)} ay sonu ${signed(m.closing)}`}>
                        <div className="flex flex-col text-[13px] leading-tight font-medium">
                          <span>{monthName(m.month).slice(0, 3)}</span>
                          {m.closing < 0 && <span className="text-[10px] font-semibold text-warn">KMH</span>}
                          {m.status === 'closed' && m.closing >= 0 && <span className="text-[10px] text-muted">kapalı</span>}
                        </div>
                        <div className="grid h-3.5 grid-cols-2" aria-hidden="true">
                          <div className="flex justify-end border-r border-line"><div className="h-3.5 rounded-l-[3px] bg-bar-bad" style={{ width: m.closing < 0 ? width : '0%' }} /></div>
                          <div className="flex"><div className="h-3.5 rounded-r-[3px] bg-accent" style={{ width: m.closing >= 0 ? width : '0%' }} /></div>
                        </div>
                        <div className={`text-right text-[13px] font-medium ${m.closing < 0 ? 'text-bad' : ''}`}>{whole(m.closing)}</div>
                      </div>
                    )
                  })}
            </div>
            </div>
            <div className="flex flex-col gap-2">
                {data.categories.length > 0 && (
                  <>
                    <SectionLabel>Gider dağılımı</SectionLabel>
                    <div className="flex flex-col gap-2.5 rounded-2xl bg-surface px-4 py-3.5">
                      {data.categories.map((cat) => {
                        const share = data.totals.expense > 0 ? cat.expense / data.totals.expense : 0
                        return (
                          <div key={cat.id ?? 'none'} className="flex flex-col gap-1">
                            <div className="flex justify-between gap-2 text-sm">
                              <span className={`truncate ${cat.id ? '' : 'text-muted'}`}>{cat.name}</span>
                              <span className="shrink-0 font-medium">{money(cat.expense)} <span className="text-xs font-normal text-muted">%{Math.round(share * 100)}</span></span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-chip" aria-hidden="true"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(1, share * 100)}%` }} /></div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
            </div>
          </div>
          <p className="px-1 text-xs text-muted">Kapanmamış dönemler plana göre tahmindir; net toplam {money(data.totals.net)}.</p>
        </>
      )}
      <BottomNav />
    </Page>
  )
}
