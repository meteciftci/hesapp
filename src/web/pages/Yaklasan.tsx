import { addDays } from '../../shared/month'
import type { EntryDto } from '../../shared/api'
import { errorMessage } from '../api'
import { money, monthAbbr, shortDate } from '../month/format'
import { useUpcoming } from '../month/queries'
import { BottomNav, Group, Notice, Page, PageHeader, SectionLabel, Warning } from '../ui'

export function Yaklasan() {
  const { data, error, isPending } = useUpcoming(30)
  const week = data ? addDays(data.today, 7) : ''
  const thisWeek = data?.upcoming.filter((e) => (e.dueDate as string) <= week) ?? []
  const later = data?.upcoming.filter((e) => (e.dueDate as string) > week) ?? []
  const expenseTotal = (data?.upcoming ?? []).filter((e) => e.direction === 'expense').reduce((sum, e) => sum + e.amount, 0)
  const estimates = (data?.upcoming ?? []).filter((e) => e.isEstimate).length

  return (
    <Page>
      <PageHeader title="Yaklaşan" subtitle={data ? `Önümüzdeki 30 gün · ${data.upcoming.length} ödeme · ${money(expenseTotal)}` : undefined} />
      {error && <Notice>{errorMessage(error)}</Notice>}
      {isPending && <p className="text-muted">Yükleniyor…</p>}
      {data && (
        <>
          {estimates > 0 && <Warning>{estimates} tutar hâlâ tahmini. Ekstre gelince gerçek tutarı gir.</Warning>}
          {data.overdue.length > 0 && (
            <>
              <SectionLabel>Vadesi geçenler</SectionLabel>
              <Rows entries={data.overdue} />
            </>
          )}
          <SectionLabel>Bu hafta</SectionLabel>
          {thisWeek.length ? <Rows entries={thisWeek} /> : <p className="rounded-2xl bg-surface p-3.5 text-sm text-muted">Ödeme yok.</p>}
          {later.length > 0 && (
            <>
              <SectionLabel>{shortDate(later[0]!.dueDate as string)} – {shortDate(later[later.length - 1]!.dueDate as string)}</SectionLabel>
              <Rows entries={later} />
            </>
          )}
        </>
      )}
      <BottomNav />
    </Page>
  )
}

function Rows({ entries }: { entries: EntryDto[] }) {
  return (
    <Group>
      {entries.map((e) => {
        const date = e.dueDate as string
        const income = e.direction === 'income'
        const meta = [income ? 'Gelir' : null, e.installmentNo && `${e.installmentNo}/${e.installmentCount}`, e.autoPay && 'Otomatik'].filter(Boolean).join(' · ')
        return (
          <li key={e.id} className="flex min-h-13 items-center gap-3 border-b border-line px-3.5 py-2.5">
            <div className="w-10 shrink-0 text-center">
              <div className="text-[17px] leading-tight font-semibold">{Number(date.slice(8, 10))}</div>
              <div className="text-[11px] text-muted">{monthAbbr(date)}</div>
            </div>
            <div className="min-w-0 grow">
              <p className="truncate text-[15px] font-medium">{e.name}</p>
              {meta && <p className="text-xs text-muted">{meta}</p>}
            </div>
            <div className="text-right">
              <p className={`text-[15px] font-medium ${income ? 'text-good' : ''}`}>{income ? '+' : ''}{money(e.amount)}</p>
              {e.isEstimate && <p className="text-[11px] font-semibold text-warn">TAHMİNİ</p>}
            </div>
          </li>
        )
      })}
    </Group>
  )
}
