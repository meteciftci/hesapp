import { Link, NavLink, useLocation } from 'react-router'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

/**
 * Sayfa çerçevesi: bütün sayfalar aynı kutuda ve sola yaslı, böylece sayfa değişince başlık yerinde kalır.
 * Telefonda tek sütun; geniş ekranda menü sola sabitlenir. `wide`: iki sütunlu sayfalar (Ay, Planlar, Yıl,
 * plan detayı) tüm genişliği kullanır; diğerleri okunabilir genişlikte (sola yaslı) kalır.
 */
export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-dvh lg:has-[[data-sidenav]]:pl-60">
      <main className="mx-auto w-full max-w-md px-4 pb-32 pt-7 md:max-w-2xl lg:max-w-6xl lg:px-8 lg:pb-12 lg:pt-8">
        <div className={`flex flex-col gap-3 ${wide ? '' : 'lg:max-w-3xl'}`}>{children}</div>
      </main>
    </div>
  )
}

/**
 * Ortak sayfa başlığı. `back`: yalnızca alt sayfalarda (Kategoriler, Geçmiş, plan detayı) üst sayfaya dönüş;
 * `backMobileOnly`: menüde yeri olan ama telefonda başka ekrandan açılan sayfalar (Ara). `inline`: başlığın
 * hemen yanındaki denetimler (dönem/yıl okları; telefonda sağa yaslanır). `actions`: sağdaki düğmeler.
 */
export function PageHeader({ title, subtitle, back, backMobileOnly = false, inline, actions }: { title: ReactNode; subtitle?: ReactNode; back?: { to: string; label: string }; backMobileOnly?: boolean; inline?: ReactNode; actions?: ReactNode }) {
  // Başlık her sayfada aynı yükseklikte başlar (alt yazı olsun olmasın); düğmeler başlık satırına ortalanır.
  return (
    <header className="flex items-start gap-1">
      {back && (
        <Link to={back.to} aria-label={back.label} className={`-mt-1.5 -ml-2 flex size-11 shrink-0 items-center justify-center ${backMobileOnly ? 'lg:hidden' : ''}`}>
          <Icon name="geri" size={20} />
        </Link>
      )}
      <div className={`min-w-0 ${inline ? 'lg:mr-2' : 'grow'}`}>
        <h1 className="flex min-w-0 items-center gap-1 truncate text-2xl leading-8 font-semibold">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
      </div>
      {inline && <div className="-mt-1.5 ml-auto flex items-center lg:ml-0">{inline}</div>}
      {inline && <div className="hidden grow lg:block" />}
      {actions && <div className="-mt-1.5 flex items-center">{actions}</div>}
    </header>
  )
}

/** Uzun panellerde kaydet/sil düğmeleri: kaydırırken panelin altında sabit kalır. */
export function SheetActions({ children }: { children: ReactNode }) {
  return <div className="sticky -bottom-6 z-10 -mx-5 -mb-6 flex gap-2.5 border-t border-line bg-surface px-5 pt-3 pb-6">{children}</div>
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`flex flex-col gap-3 rounded-2xl bg-surface p-4 ${className}`}>{children}</section>
}

/** Satırları çizgiyle ayrılan, tek yuvarlak kutu içinde liste. */
export function Group({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <ul className={`m-0 list-none overflow-hidden rounded-2xl bg-surface p-0 [&>li:last-child]:border-b-0 ${className}`}>{children}</ul>
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="px-1 pt-3 text-xs font-semibold tracking-wide text-muted uppercase">{children}</h2>
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-accent/50 font-semibold',
    secondary: 'border border-edge bg-surface hover:bg-chip font-medium',
    danger: 'border border-bad/40 bg-surface text-bad font-medium',
  }[variant]
  return <button className={`min-h-12 rounded-2xl px-4 text-base transition-colors disabled:cursor-not-allowed ${styles} ${className}`} {...props} />
}

export function Field({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <input className="min-h-12 rounded-xl border border-edge bg-transparent px-3 text-base font-normal text-ink disabled:opacity-50" {...props} />
      {hint && <span className="text-xs font-normal">{hint}</span>}
    </label>
  )
}

export function Notice({ kind = 'error', children }: { kind?: 'error' | 'info'; children: ReactNode }) {
  const tone = kind === 'error' ? 'bg-bad/10 text-bad' : 'bg-soft text-ink'
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`rounded-xl px-3 py-2 text-sm ${tone}`}>
      {children}
    </p>
  )
}

export function Warning({ children }: { children: ReactNode }) {
  return <p role="status" className="rounded-2xl border border-warn-line bg-warn-bg px-3.5 py-3 text-sm text-warn">{children}</p>
}

/** Segmentli seçici (Gider/Gelir, Tema…). */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-xl bg-chip p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={`min-h-10 rounded-lg text-sm ${value === o.value ? 'bg-chip-on font-semibold shadow-sm' : 'text-muted'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Hap şeklinde sekmeler (Giderler · 6, Gelirler · 6…). */
export function Pills<T extends string>({ label, value, options, onChange, grow = false }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; grow?: boolean }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1.5 overflow-x-auto py-1">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)} className={`min-h-10 rounded-full px-3.5 text-[13px] whitespace-nowrap ${grow ? 'flex-1' : ''} ${value === o.value ? 'bg-ink font-medium text-on-ink' : 'border border-edge bg-surface'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 md:items-center md:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface px-5 pb-6 pt-2.5 md:max-h-[88dvh] md:max-w-lg md:rounded-3xl md:pt-5 md:shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line md:hidden" />
        <div className="mb-3 flex items-start justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{title}</h1>
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
          <button className="min-h-11 rounded-lg pl-3 text-base text-link" onClick={onClose}>Vazgeç</button>
        </div>
        {children}
      </div>
    </div>
  )
}

type IconName = 'ay' | 'yaklasan' | 'planlar' | 'yil' | 'ekle' | 'geri' | 'ileri' | 'ayar' | 'tik' | 'ara'

const ICONS: Record<IconName, ReactNode> = {
  ay: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  yaklasan: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  planlar: <><path d="M12 4l8 4-8 4-8-4 8-4z" /><path d="M4 12l8 4 8-4M4 16l8 4 8-4" /></>,
  yil: <path d="M5 20V11M12 20V5M19 20v-7" />,
  ekle: <path d="M12 5v14M5 12h14" />,
  geri: <path d="M15 6l-6 6 6 6" />,
  ileri: <path d="M9 6l6 6-6 6" />,
  ayar: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  tik: <path d="M5 12l5 5 9-10" />,
  ara: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>,
}

export function Icon({ name, size = 22, width = 2 }: { name: IconName; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

export function IconLink({ to, label, name, className = '' }: { to: string; label: string; name: IconName; className?: string }) {
  return (
    <Link to={to} aria-label={label} className={`flex size-11 items-center justify-center rounded-full ${className}`}>
      <Icon name={name} size={21} />
    </Link>
  )
}

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Ay', icon: 'ay' },
  { to: '/yaklasan', label: 'Yaklaşan', icon: 'yaklasan' },
  { to: '/planlar', label: 'Planlar', icon: 'planlar' },
  { to: '/yil', label: 'Yıl', icon: 'yil' },
]

const SIDE_EXTRA: { to: string; label: string; icon: IconName }[] = [
  { to: '/ara', label: 'Ara', icon: 'ara' },
  { to: '/ayarlar', label: 'Ayarlar', icon: 'ayar' },
]

/** Telefonda alttaki çubuk: ana sekmeler ve Ayarlar (arama Ay ekranının başlığında). */
const MOBILE_NAV: { to: string; label: string; icon: IconName }[] = [...NAV, { to: '/ayarlar', label: 'Ayarlar', icon: 'ayar' }]

/** Ana menü: telefonda altta yüzen çubuk, geniş ekranda solda sabit yan menü. */
export function BottomNav() {
  return (
    <>
      <SideNav />
      <MobileNav />
    </>
  )
}

/** Ayarlar'ın alt sayfaları: yan menüde "Ayarlar" seçili görünür. */
const SETTINGS_PATHS = ['/ayarlar', '/kategoriler', '/gecmis']

function SideNav() {
  const { pathname } = useLocation()
  const item = ({ isActive }: { isActive: boolean }) => `flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] ${isActive ? 'bg-soft font-semibold text-link' : 'text-muted hover:bg-chip hover:text-ink'}`
  return (
    <nav data-sidenav aria-label="Ana menü" className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col gap-1 border-r border-line bg-surface px-4 py-6 lg:flex">
      <Link to="/" className="mb-5 flex items-center gap-2.5 px-2">
        <img src="/icon-192.png" alt="" className="size-9 rounded-xl" />
        <span className="text-lg font-semibold">HesApp</span>
      </Link>
      <Link to="/?ekle=1" className="mb-4 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-3 font-semibold text-white hover:bg-accent-hover">
        <Icon name="ekle" size={18} width={2.4} />
        Yeni kayıt
      </Link>
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'} className={item}>
          <Icon name={n.icon} size={20} />
          {n.label}
        </NavLink>
      ))}
      <div className="my-3 border-t border-line" />
      {SIDE_EXTRA.map((n) => (
        <NavLink key={n.to} to={n.to} className={({ isActive }) => item({ isActive: isActive || (n.to === '/ayarlar' && SETTINGS_PATHS.includes(pathname)) })}>
          <Icon name={n.icon} size={20} />
          {n.label}
        </NavLink>
      ))}
    </nav>
  )
}

function MobileNav() {
  const { pathname } = useLocation()
  return (
    <nav aria-label="Ana menü" className="fixed inset-x-4 bottom-5 z-20 mx-auto flex max-w-md items-center gap-2.5 lg:hidden">
      <div className="grid h-16 flex-1 gap-1 rounded-full border border-edge bg-surface p-1.5 shadow-xl" style={{ gridTemplateColumns: `repeat(${MOBILE_NAV.length}, minmax(0, 1fr))` }}>
        {MOBILE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 rounded-full text-[11px] ${isActive || (item.to === '/ayarlar' && SETTINGS_PATHS.includes(pathname)) ? 'bg-soft font-semibold text-link' : 'font-medium text-muted'}`
            }
          >
            <Icon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </div>
      <Link to="/?ekle=1" aria-label="Yeni kayıt ekle" className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-xl">
        <Icon name="ekle" size={26} width={2.4} />
      </Link>
    </nav>
  )
}
