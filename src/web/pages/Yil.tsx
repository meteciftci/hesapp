import { useLayoutEffect, useRef, useState } from 'react'
import type { YearMonthDto } from '../../shared/api'
import { errorMessage } from '../api'
import { YearPickerTitle } from '../pickers'
import { currentPeriod, money, monthName, signed } from '../month/format'
import { useSettings, useYear } from '../month/queries'
import { BottomNav, Notice, Page, PageHeader, SectionLabel } from '../ui'

/** Tutarı bar etiketinde kuruşsuz gösterir: +3.598 / −8.402 */
const whole = (kurus: number) => `${kurus < 0 ? '−' : '+'}${Math.abs(Math.round(kurus / 100)).toLocaleString('tr-TR')}`
const plain = (kurus: number) => Math.round(kurus / 100).toLocaleString('tr-TR')

const CHART = { h: 220, left: 58, bottom: 24, top: 10 }

/** 1, 2, 2,5, 5 × 10ⁿ biçiminde, en çok `count` aralığa bölen yuvarlak adım (TL). */
function niceStep(max: number, count: number) {
  const raw = max / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  return ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow
}

/** Kapsayıcının genişliğini piksel olarak izler; grafik bu genişlikte çizilir, ekranla büyümez. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** Aylık gelir/gider: gruplu çubuk grafik ve altında tablo. Kapanmamış (gelecek) dönemler soluktur. */
function MonthlyIncomeExpense({ months, totals, thisPeriod }: { months: YearMonthDto[]; totals: { income: number; expense: number; net: number }; thisPeriod: string }) {
  const [ref, width] = useWidth()
  const [active, setActive] = useState<number | null>(null)
  const maxTl = Math.max(1, ...months.flatMap((m) => [m.income, m.expense])) / 100
  const stepTl = niceStep(maxTl, 4)
  const ticks = Array.from({ length: Math.ceil(maxTl / stepTl) + 1 }, (_, i) => i * stepTl)
  const top = ticks[ticks.length - 1]!
  const plotH = CHART.h - CHART.top - CHART.bottom
  const plotW = Math.max(0, width - CHART.left)
  const step = plotW / Math.max(1, months.length)
  const bar = Math.max(4, Math.min(18, step * 0.32))
  const y = (tl: number) => CHART.top + plotH * (1 - tl / top)
  const hovered = active === null ? null : months[active]
  return (
    <>
      <SectionLabel>Aylık gelir / gider</SectionLabel>
      <div className="flex flex-col gap-3 rounded-2xl bg-surface px-3.5 py-3.5">
        <div className="flex gap-3 text-xs text-muted">
          <span className="flex items-center gap-1"><i className="size-2.5 rounded-xs bg-good" />Gelir</span>
          <span className="flex items-center gap-1"><i className="size-2.5 rounded-xs bg-bar-bad" />Gider</span>
        </div>
        <div ref={ref} className="relative" style={{ height: CHART.h }} onPointerLeave={() => setActive(null)}>
          {width > 0 && (
            <svg width={width} height={CHART.h} role="img" aria-label="Aylık gelir ve gider çubuk grafiği">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={CHART.left} x2={width} y1={y(t)} y2={y(t)} className="stroke-line" />
                  <text x={CHART.left - 8} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px]">{Math.round(t).toLocaleString('tr-TR')}</text>
                </g>
              ))}
              {months.map((m, i) => {
                const cx = CHART.left + i * step + step / 2
                const inc = y(m.income / 100)
                const exp = y(m.expense / 100)
                return (
                  <g key={m.month} opacity={m.month > thisPeriod ? 0.55 : 1}>
                    {active === i && <rect x={CHART.left + i * step} y={CHART.top} width={step} height={plotH} className="fill-chip" />}
                    <rect x={cx - bar - 1} y={inc} width={bar} height={CHART.top + plotH - inc} rx={2} className="fill-good" />
                    <rect x={cx + 1} y={exp} width={bar} height={CHART.top + plotH - exp} rx={2} className="fill-bar-bad" />
                    <text x={cx} y={CHART.h - 7} textAnchor="middle" className="fill-muted text-[11px]">{monthName(m.month).slice(0, 3)}</text>
                    <rect x={CHART.left + i * step} y={0} width={step} height={CHART.h} fill="transparent" onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)}>
                      <title>{`${monthName(m.month)}: gelir ${plain(m.income)}, gider ${plain(m.expense)}, net ${whole(m.net)}`}</title>
                    </rect>
                  </g>
                )
              })}
            </svg>
          )}
          {hovered && (
            <div
              className="pointer-events-none absolute z-10 flex flex-col gap-0.5 rounded-xl bg-ink px-3 py-2 text-xs text-on-ink shadow-lg"
              style={{ top: 4, left: Math.min(Math.max(CHART.left + (active ?? 0) * step + step / 2, 70), Math.max(70, width - 70)), transform: 'translateX(-50%)' }}
            >
              <span className="font-semibold">{monthName(hovered.month)}</span>
              <span>Gelir {plain(hovered.income)}</span>
              <span>Gider {plain(hovered.expense)}</span>
              <span className="font-semibold">Net {whole(hovered.net)}</span>
            </div>
          )}
        </div>
        <table className="w-full text-right text-[13px] tabular-nums">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="py-1 text-left font-normal">Ay</th>
              <th scope="col" className="py-1 font-normal">Gelir</th>
              <th scope="col" className="py-1 font-normal">Gider</th>
              <th scope="col" className="py-1 font-normal">Net</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className={`border-t border-line ${m.month > thisPeriod ? 'opacity-60' : ''}`}>
                <th scope="row" className="py-1.5 text-left font-normal">{monthName(m.month).slice(0, 3)}</th>
                <td className="py-1.5">{plain(m.income)}</td>
                <td className="py-1.5">{plain(m.expense)}</td>
                <td className={`py-1.5 ${m.net < 0 ? 'text-bad' : 'text-good'}`}>{whole(m.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-semibold">
              <th scope="row" className="py-1.5 text-left">Toplam</th>
              <td className="py-1.5">{plain(totals.income)}</td>
              <td className="py-1.5">{plain(totals.expense)}</td>
              <td className={`py-1.5 ${totals.net < 0 ? 'text-bad' : 'text-good'}`}>{whole(totals.net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  )
}

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

          <MonthlyIncomeExpense months={data.months} totals={data.totals} thisPeriod={thisPeriod} />

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
