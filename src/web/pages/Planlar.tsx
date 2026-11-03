import { useState } from 'react'
import { Link } from 'react-router'
import type { PlanDto } from '../../shared/api'
import { addMonths } from '../../shared/month'
import { errorMessage } from '../api'
import { money, shortMonth } from '../month/format'
import { DebtChart } from '../month/DebtChart'
import { useDebt, usePlans } from '../month/queries'
import { BottomNav, Notice, Page, PageHeader, Pills, SectionLabel } from '../ui'

type Tab = 'loans' | 'cards' | 'recurring' | 'receivables'

const TABS: { value: Tab; label: string }[] = [
  { value: 'loans', label: 'Krediler' },
  { value: 'cards', label: 'Kartlar' },
  { value: 'recurring', label: 'Tekrarlayan' },
  { value: 'receivables', label: 'Alacaklar' },
]

/** Taksitli gider = kredi, kart tanımı (ya da tutarı değişen aylık gider) = kart, taksitli gelir = alacak. */
function tabOf(plan: PlanDto): Tab {
  if (plan.kind === 'installment') return plan.direction === 'income' ? 'receivables' : 'loans'
  return plan.card || (plan.direction === 'expense' && plan.variable) ? 'cards' : 'recurring'
}

export function Planlar() {
  const { data, error, isPending } = usePlans()
  const debt = useDebt().data
  const [tab, setTab] = useState<Tab>('loans')
  const open = (data ?? []).filter((p) => !p.closed)
  const list = open.filter((p) => tabOf(p) === tab)
  // İptal edilen kartlar geçmişleriyle birlikte Kartlar sekmesinde soluk görünür
  const cancelled = tab === 'cards' ? (data ?? []).filter((p) => p.closed && p.card) : []
  const hidden = (data ?? []).filter((p) => p.closed && !p.card).length
  // Krediler ve alacaklar için özet: aylık yük, toplam, ödenen, kalan
  const installments = tab === 'loans' || tab === 'receivables' ? list : []
  const sum = (pick: (p: PlanDto) => number) => installments.reduce((total, p) => total + pick(p), 0)
  const income = tab === 'receivables'

  return (
    <Page wide>
      <PageHeader title="Planlar" />
      {error && <Notice>{errorMessage(error)}</Notice>}
      {isPending && <p className="text-muted">Yükleniyor…</p>}
      {data && (
        <>
          <Pills label="Plan türü" value={tab} onChange={setTab} options={TABS} />
          {installments.length > 0 && (
            <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <SummaryTile label={income ? 'Aylık tahsilat' : 'Aylık kredi yükü'} value={sum((p) => p.amount)} />
              <SummaryTile label={income ? 'Toplam alacak' : 'Toplam borç'} value={sum((p) => p.stats.totalAmount)} />
              <SummaryTile label={income ? 'Tahsil edilen' : 'Ödenen'} value={sum((p) => p.stats.paidAmount)} tone="good" />
              <SummaryTile label="Kalan" value={sum((p) => p.stats.remainingAmount)} />
            </section>
          )}
          {tab === 'loans' && debt && <DebtChart points={debt} />}
          <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 lg:grid-cols-2">
            {list.map((p) => <PlanRow key={p.id} plan={p} />)}
            {list.length === 0 && <li className="py-6 text-center text-sm text-muted">Bu sekmede plan yok. “+” ile ekleyebilirsin.</li>}
          </ul>
          {cancelled.length > 0 && (
            <>
              <SectionLabel>İptal edilmiş kartlar</SectionLabel>
              <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 opacity-60 lg:grid-cols-2">
                {cancelled.map((p) => <PlanRow key={p.id} plan={p} />)}
              </ul>
            </>
          )}
          {hidden > 0 && <p className="px-1 text-xs text-muted">{hidden} kapatılmış plan gizlendi.</p>}
        </>
      )}
      <BottomNav />
    </Page>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone?: 'good' }) {
  return (
    <div className="rounded-2xl bg-surface px-3.5 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-[17px] font-semibold ${tone === 'good' ? 'text-good' : ''}`}>{money(value)}</p>
    </div>
  )
}

function PlanRow({ plan }: { plan: PlanDto }) {
  const { total, paid } = plan.stats
  const installment = plan.kind === 'installment'
  const pct = installment && total > 0 ? Math.round((paid / total) * 100) : null
  const income = plan.direction === 'income'
  const end = installment && plan.installmentCount ? shortMonth(addMonths(plan.startMonth, plan.installmentCount - 1)) : plan.endMonth ? shortMonth(plan.endMonth) : null
  return (
    <li>
      <Link to={`/planlar/${plan.id}`} className="flex flex-col gap-2.5 rounded-2xl bg-surface px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-base font-semibold">{plan.name}</span>
          <span className={`shrink-0 text-[15px] font-medium ${income ? 'text-good' : ''}`}>{plan.card ? (plan.amount > 0 ? `~${money(plan.amount)} /ay` : 'Kredi kartı') : `${income ? '+' : ''}${money(plan.amount)} /ay`}</span>
        </div>
        {pct !== null && (
          <div className="h-2 overflow-hidden rounded-full bg-chip" role="progressbar" aria-label="Ödeme ilerlemesi" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="flex justify-between gap-2 text-xs text-muted">
          <span>{installment ? `${paid}/${total} ${income ? 'tahsil edildi' : 'ödendi'}` : plan.card ? `Son ödeme her ayın ${plan.dayOfMonth}’i${plan.autoPay ? ' · Otomatik' : ''}` : `Her ayın ${plan.dayOfMonth}. günü${plan.variable ? ' · tutar değişken' : ''}`}</span>
          {end && <span className="shrink-0">{plan.card && plan.closed ? `İptal · son ${end}` : end}</span>}
        </div>
        {installment && (
          <dl className="m-0 grid grid-cols-3 gap-2 border-t border-line pt-2.5">
            <Amount label={income ? 'Tahsil edilen' : 'Ödenen'} value={plan.stats.paidAmount} tone="good" />
            <Amount label="Kalan" value={plan.stats.remainingAmount} />
            <Amount label="Toplam" value={plan.stats.totalAmount} />
          </dl>
        )}
      </Link>
    </li>
  )
}

function Amount({ label, value, tone }: { label: string; value: number; tone?: 'good' }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`m-0 truncate text-[13px] font-semibold ${tone === 'good' ? 'text-good' : ''}`}>{money(value)}</dd>
    </div>
  )
}
