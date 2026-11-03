import type { DebtPoint } from '../../shared/api'
import { money, shortMonth } from './format'

const W = 320
const H = 120
const PAD = { top: 6, bottom: 2, left: 0, right: 0 }

/** Kalan borcun dönemlere göre azalışı (alan grafiği). Plan, bölüm 14.5. */
export function DebtChart({ points, title = 'Kalan borç' }: { points: DebtPoint[]; title?: string }) {
  if (points.length < 2) return null
  const max = Math.max(...points.map((p) => p.remaining), 1)
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.remaining).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  const end = points.find((p) => p.remaining === 0) ?? points[points.length - 1]!
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1]
  const label = `${title}: şu an ${money(points[0]!.remaining)}, ${shortMonth(end.month)} itibarıyla ${money(end.remaining)}`

  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-surface px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-xs text-muted">{title}</p>
          <p className="text-[17px] font-semibold">{money(points[0]!.remaining)}</p>
        </div>
        {end.remaining === 0 && <p className="text-xs text-muted">{shortMonth(end.month)} itibarıyla biter</p>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-32 w-full lg:h-44" role="img" aria-label={label}>
        <path d={area} className="fill-accent/15" />
        <path d={line} className="stroke-accent" fill="none" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="stroke-line" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Etiketler SVG dışında: grafik genişlese de yazı boyutu sabit kalır */}
      <div className="flex justify-between text-[11px] text-muted" aria-hidden="true">
        {ticks.map((i) => <span key={i}>{shortMonth(points[i]!.month)}</span>)}
      </div>
    </section>
  )
}
