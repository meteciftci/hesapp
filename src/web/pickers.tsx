import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addMonths } from '../shared/month'
import { Icon } from './ui'

/**
 * Tarih ve ay seçiciler (shadcn/ui date-picker görünümünde): tetikleyici düğme + açılır pencere.
 * Tarayıcının kendi tarih kutusu yerine her yerde bunlar kullanılır. Değerler `YYYY-AA-GG` / `YYYY-AA`.
 */

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

const pad = (n: number) => String(n).padStart(2, '0')
const todayDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const formatDateLong = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
export const formatMonthLong = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

/** Tetikleyicinin altında (sığmazsa üstünde) açılan, sayfanın üstünde duran pencere. */
export function Popover({ anchor, open, onClose, label, children }: { anchor: HTMLElement | null; open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const el = panel.current
      const w = el?.offsetWidth ?? 296
      const h = el?.offsetHeight ?? 320
      const below = r.bottom + 6
      const top = below + h > window.innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : Math.min(below, Math.max(8, window.innerHeight - h - 8))
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8)
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || anchor?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        anchor?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, anchor, onClose])

  if (!open) return null
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      className="fixed z-50 w-[296px] rounded-2xl border border-edge bg-surface p-3 text-ink shadow-2xl"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      {children}
    </div>,
    document.body,
  )
}

function NavButton({ label, dir, onClick, disabled }: { label: string; dir: 'geri' | 'ileri'; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="flex size-9 items-center justify-center rounded-lg border border-edge hover:bg-chip disabled:opacity-40">
      <Icon name={dir} size={16} />
    </button>
  )
}

/** Gün takvimi (haftanın ilk günü pazartesi). */
export function Calendar({ value, onSelect, min, max }: { value: string | null; onSelect: (date: string) => void; min?: string; max?: string }) {
  const today = todayDate()
  const [view, setView] = useState((value ?? (min && today < min ? min : max && today > max ? max : today)).slice(0, 7))
  const [y, m] = view.split('-').map(Number) as [number, number]
  const days = new Date(y, m, 0).getDate()
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const cells: (string | null)[] = [...Array<null>(offset).fill(null), ...Array.from({ length: days }, (_, i) => `${view}-${pad(i + 1)}`)]
  const disabled = (d: string) => (min !== undefined && d < min) || (max !== undefined && d > max)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <NavButton label="Önceki ay" dir="geri" onClick={() => setView(addMonths(view, -1))} disabled={min !== undefined && addMonths(view, -1) < min.slice(0, 7)} />
        <span className="text-sm font-semibold">{formatMonthLong(view)}</span>
        <NavButton label="Sonraki ay" dir="ileri" onClick={() => setView(addMonths(view, 1))} disabled={max !== undefined && addMonths(view, 1) > max.slice(0, 7)} />
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center" role="grid" aria-label={formatMonthLong(view)}>
        {WEEKDAYS.map((w) => <span key={w} className="py-1 text-[11px] font-medium text-muted">{w}</span>)}
        {cells.map((d, i) =>
          d ? (
            <button
              key={d}
              type="button"
              disabled={disabled(d)}
              aria-pressed={d === value}
              aria-label={formatDateLong(d)}
              onClick={() => onSelect(d)}
              className={`flex size-9 items-center justify-center justify-self-center rounded-lg text-sm disabled:opacity-30 ${d === value ? 'bg-accent font-semibold text-white' : d === today ? 'ring-1 ring-accent ring-inset hover:bg-chip' : 'hover:bg-chip'}`}
            >
              {Number(d.slice(8, 10))}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
    </div>
  )
}

/** Ay ızgarası: üstte yıl, altında 12 ay. `current`: bugünün dönemi (çerçeveyle işaretlenir). */
export function MonthGrid({ value, onSelect, current, min, max }: { value: string | null; onSelect: (month: string) => void; current?: string; min?: string; max?: string }) {
  const [year, setYear] = useState(Number((value ?? current ?? todayDate()).slice(0, 4)))
  const out = (m: string) => (min !== undefined && m < min) || (max !== undefined && m > max)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <NavButton label="Önceki yıl" dir="geri" onClick={() => setYear(year - 1)} disabled={min !== undefined && `${year - 1}-12` < min} />
        <span className="text-sm font-semibold">{year}</span>
        <NavButton label="Sonraki yıl" dir="ileri" onClick={() => setYear(year + 1)} disabled={max !== undefined && `${year + 1}-01` > max} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {MONTHS_SHORT.map((label, i) => {
          const m = `${year}-${pad(i + 1)}`
          return (
            <button
              key={m}
              type="button"
              disabled={out(m)}
              aria-pressed={m === value}
              aria-label={formatMonthLong(m)}
              onClick={() => onSelect(m)}
              className={`min-h-10 rounded-lg text-sm disabled:opacity-30 ${m === value ? 'bg-accent font-semibold text-white' : m === current ? 'ring-1 ring-accent ring-inset hover:bg-chip' : 'hover:bg-chip'}`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Yıl ızgarası (12 yıllık sayfalar). */
export function YearGrid({ value, onSelect, current }: { value: number; onSelect: (year: number) => void; current: number }) {
  const [start, setStart] = useState(value - (((value % 12) + 12) % 12))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <NavButton label="Önceki yıllar" dir="geri" onClick={() => setStart(start - 12)} />
        <span className="text-sm font-semibold">{start} – {start + 11}</span>
        <NavButton label="Sonraki yıllar" dir="ileri" onClick={() => setStart(start + 12)} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 12 }, (_, i) => start + i).map((y) => (
          <button key={y} type="button" aria-pressed={y === value} onClick={() => onSelect(y)} className={`min-h-10 rounded-lg text-sm ${y === value ? 'bg-accent font-semibold text-white' : y === current ? 'ring-1 ring-accent ring-inset hover:bg-chip' : 'hover:bg-chip'}`}>
            {y}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Açılır seçici: tetikleyici + pencere; `children(close)` pencerenin içeriği. */
function usePicker() {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  return { open, setOpen, anchor, close: () => setOpen(false) }
}

const triggerClass = 'flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border border-edge bg-transparent px-3 text-left text-base font-normal text-ink disabled:opacity-50'

/** Form alanı: tarih seçici (shadcn date-picker). Boş bırakılabilir. */
export function DateField({ label, value, onChange, min, max, hint, placeholder = 'Tarih seç', clearable = true, disabled }: { label: string; value: string; onChange: (date: string) => void; min?: string; max?: string; hint?: string; placeholder?: string; clearable?: boolean; disabled?: boolean }) {
  const p = usePicker()
  const id = useId()
  return (
    <div className="flex flex-col gap-1 text-xs font-medium text-muted">
      <span id={id}>{label}</span>
      <button ref={p.anchor} type="button" disabled={disabled} aria-labelledby={id} aria-haspopup="dialog" aria-expanded={p.open} onClick={() => p.setOpen(!p.open)} className={triggerClass}>
        <span className={value ? '' : 'text-muted'}>{value ? formatDateLong(value) : placeholder}</span>
        <Icon name="ay" size={18} />
      </button>
      {hint && <span className="text-xs font-normal">{hint}</span>}
      <Popover anchor={p.anchor.current} open={p.open} onClose={p.close} label={label}>
        <Calendar value={value || null} min={min} max={max} onSelect={(d) => { onChange(d); p.close() }} />
        <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm">
          {clearable ? <button type="button" className="min-h-9 rounded-lg px-2 text-muted hover:bg-chip" onClick={() => { onChange(''); p.close() }}>Temizle</button> : <span />}
          {(!min || todayDate() >= min) && (!max || todayDate() <= max) && <button type="button" className="min-h-9 rounded-lg px-2 font-medium text-link hover:bg-chip" onClick={() => { onChange(todayDate()); p.close() }}>Bugün</button>}
        </div>
      </Popover>
    </div>
  )
}

/** Form alanı: ay seçici. */
export function MonthField({ label, value, onChange, hint, current, min, max }: { label: string; value: string; onChange: (month: string) => void; hint?: string; current?: string; min?: string; max?: string }) {
  const p = usePicker()
  const id = useId()
  return (
    <div className="flex flex-col gap-1 text-xs font-medium text-muted">
      <span id={id}>{label}</span>
      <button ref={p.anchor} type="button" aria-labelledby={id} aria-haspopup="dialog" aria-expanded={p.open} onClick={() => p.setOpen(!p.open)} className={triggerClass}>
        <span className={value ? '' : 'text-muted'}>{value ? formatMonthLong(value) : 'Ay seç'}</span>
        <Icon name="ay" size={18} />
      </button>
      {hint && <span className="text-xs font-normal">{hint}</span>}
      <Popover anchor={p.anchor.current} open={p.open} onClose={p.close} label={label}>
        <MonthGrid value={value || null} current={current} min={min} max={max} onSelect={(m) => { onChange(m); p.close() }} />
      </Popover>
    </div>
  )
}

/** Başlıkta ay seçici: "Ekim 2026 ▾" düğmesi, ay ızgarası ve "Bu döneme dön". */
export function MonthPickerTitle({ month, current, onChange, subtitleId }: { month: string; current: string; onChange: (month: string) => void; subtitleId?: string }) {
  const p = usePicker()
  return (
    <>
      <button ref={p.anchor} type="button" aria-haspopup="dialog" aria-expanded={p.open} aria-describedby={subtitleId} onClick={() => p.setOpen(!p.open)} className="-ml-1.5 flex items-center gap-1.5 rounded-lg px-1.5 hover:bg-chip">
        <span className="truncate">{formatMonthLong(month)}</span>
        <span className={`transition-transform ${p.open ? 'rotate-90' : ''}`}><Icon name="ileri" size={18} /></span>
      </button>
      <Popover anchor={p.anchor.current} open={p.open} onClose={p.close} label="Dönem seç">
        <MonthGrid value={month} current={current} onSelect={(m) => { onChange(m); p.close() }} />
        {month !== current && (
          <div className="mt-2 border-t border-line pt-2 text-right">
            <button type="button" className="min-h-9 rounded-lg px-2 text-sm font-medium text-link hover:bg-chip" onClick={() => { onChange(current); p.close() }}>Bu döneme dön</button>
          </div>
        )}
      </Popover>
    </>
  )
}

/** Başlıkta yıl seçici. */
export function YearPickerTitle({ year, current, onChange, prefix }: { year: number; current: number; onChange: (year: number) => void; prefix?: string }) {
  const p = usePicker()
  return (
    <>
      <button ref={p.anchor} type="button" aria-haspopup="dialog" aria-expanded={p.open} onClick={() => p.setOpen(!p.open)} className="-ml-1.5 flex items-center gap-1.5 rounded-lg px-1.5 hover:bg-chip">
        <span className="truncate">{prefix}{year}</span>
        <span className={`transition-transform ${p.open ? 'rotate-90' : ''}`}><Icon name="ileri" size={18} /></span>
      </button>
      <Popover anchor={p.anchor.current} open={p.open} onClose={p.close} label="Yıl seç">
        <YearGrid value={year} current={current} onSelect={(y) => { onChange(y); p.close() }} />
      </Popover>
    </>
  )
}
