import type { AuditRecentItem } from '../../shared/api'
import { errorMessage } from '../api'
import { monthTitle } from '../month/format'
import { ACTIONS } from '../month/History'
import { useRecentAudit } from '../month/queries'
import { BottomNav, Button, Group, Notice, Page, PageHeader, SectionLabel } from '../ui'

const day = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })
const time = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })

const ITEM_PHRASES: Record<string, [string, string]> = {
  item_add: ['kaydına', 'kalem ekledi'],
  item_update: ['kaydında', 'kalem düzenledi'],
  item_delete: ['kaydından', 'kalem sildi'],
}

/** Kişiden sonra gelen cümle: "“Market” (Ekim 2026) kaydını ödendi işaretledi" */
function sentence(item: AuditRecentItem): string {
  const phrase = ITEM_PHRASES[item.action]
  if (phrase) return `“${item.label ?? 'bir kayıt'}”${item.month ? ` (${monthTitle(item.month)})` : ''} ${phrase[0]} ${phrase[1]}`
  return `${subject(item)} ${ACTIONS[item.action] ?? item.action}`
}

function subject(item: AuditRecentItem): string {
  if (item.entity === 'month') return `${item.month ? monthTitle(item.month) : item.entityId} dönemini`
  if (item.entity === 'settings') return item.entityId === 'period_start_day' ? 'dönem başlangıç gününü' : ''
  const name = item.label ?? (item.entity === 'plan' ? 'bir planı' : 'bir kaydı')
  return item.entity === 'plan' ? `“${name}” planını` : `“${name}”${item.month ? ` (${monthTitle(item.month)})` : ''} kaydını`
}

/** Ayarlardan açılan, tüm değişikliklerin güne göre listelendiği ekran. */
export function Gecmis() {
  const { data, error, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useRecentAudit()
  const items = data?.pages.flatMap((p) => p.items) ?? []
  const groups: { day: string; items: AuditRecentItem[] }[] = []
  for (const item of items) {
    const d = day(item.at)
    if (groups.at(-1)?.day !== d) groups.push({ day: d, items: [] })
    groups.at(-1)!.items.push(item)
  }

  return (
    <Page>
      <PageHeader title="Değişiklik geçmişi" back={{ to: '/ayarlar', label: 'Ayarlara dön' }} />
      {error && <Notice>{errorMessage(error)}</Notice>}
      {isPending && <p className="text-muted">Yükleniyor…</p>}
      {data && items.length === 0 && <p className="px-1 text-sm text-muted">Henüz değişiklik yok.</p>}
      {groups.map((g) => (
        <section key={g.day} className="flex flex-col gap-2">
          <SectionLabel>{g.day}</SectionLabel>
          <Group>
            {g.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 border-b border-line px-3.5 py-2.5 text-sm">
                <span className="w-11 shrink-0 pt-px text-xs text-muted">{time(item.at)}</span>
                <span className="min-w-0">
                  <span className="font-medium">{item.by ?? 'Bilinmeyen'}</span> {sentence(item)}
                </span>
              </li>
            ))}
          </Group>
        </section>
      ))}
      {hasNextPage && <Button variant="secondary" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? 'Yükleniyor…' : 'Daha eski değişiklikler'}</Button>}
      <BottomNav />
    </Page>
  )
}
