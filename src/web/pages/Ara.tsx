import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '../api'
import { currentPeriod, money, monthTitle, shortDate } from '../month/format'
import { useCategories, useSearch, useSettings } from '../month/queries'
import { BottomNav, Group, Icon, Notice, Page, PageHeader, Pills } from '../ui'

type Range = 'all' | 'year' | 'last12'

/** Kayıtlarda ad/not ve kategoriye göre arama (plan, bölüm 14.4). */
export function Ara() {
  const navigate = useNavigate()
  const startDay = useSettings().data?.periodStartDay ?? 1
  const categories = useCategories().data ?? []
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [range, setRange] = useState<Range>('all')
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(t)
  }, [text])

  const now = currentPeriod(startDay)
  const from = range === 'year' ? `${now.slice(0, 4)}-01` : range === 'last12' ? addMonthsLabel(now, -11) : ''
  const to = range === 'all' ? '' : now
  const { data, error, isFetching } = useSearch({ q, category, from, to })
  const active = !!(q || category)

  return (
    <Page>
      <PageHeader title="Ara" back={{ to: '/', label: 'Ay ekranına dön' }} backMobileOnly />
      <label className="flex min-h-12 items-center gap-2 rounded-xl border border-edge bg-surface px-3">
        <Icon name="ara" size={18} />
        <input type="search" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Kalem adı ya da not" aria-label="Aranacak metin" className="min-h-11 grow bg-transparent text-base outline-none" />
      </label>
      <select aria-label="Kategori" value={category} onChange={(e) => setCategory(e.target.value)} className="min-h-12 rounded-xl border border-edge bg-surface px-2 text-base">
        <option value="">Tüm kategoriler</option>
        <option value="none">Kategorisiz</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <Pills label="Dönem aralığı" value={range} onChange={setRange} grow options={[{ value: 'all', label: 'Tümü' }, { value: 'year', label: 'Bu yıl' }, { value: 'last12', label: 'Son 12 ay' }]} />

      {error && <Notice>{errorMessage(error)}</Notice>}
      {!active && <p className="px-1 text-sm text-muted">Aramak için bir metin yaz ya da kategori seç.</p>}
      {active && data && (
        <>
          <section className="grid grid-cols-3 gap-2 rounded-2xl bg-surface px-4 py-3 text-sm">
            <div><p className="text-xs text-muted">Kayıt</p><p className="font-semibold">{data.totals.count}</p></div>
            <div><p className="text-xs text-muted">Gider</p><p className="font-semibold">{money(data.totals.expense)}</p></div>
            <div><p className="text-xs text-muted">Gelir</p><p className="font-semibold text-good">{money(data.totals.income)}</p></div>
          </section>
          {data.entries.length === 0 && <p className="px-1 text-sm text-muted">Sonuç yok.</p>}
          {data.entries.length > 0 && (
            <Group className={isFetching ? 'opacity-70' : ''}>
              {data.entries.map((e) => (
                <li key={e.id} className="border-b border-line">
                  <button type="button" onClick={() => navigate(`/?ay=${e.month}`)} className="flex min-h-13 w-full items-center gap-3 px-3.5 py-2.5 text-left">
                    <span className="min-w-0 grow">
                      <span className="block truncate text-[15px] font-medium">{e.name}</span>
                      <span className="text-xs text-muted">{[monthTitle(e.month), e.dueDate && shortDate(e.dueDate), e.categoryName].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className={`text-[15px] font-medium ${e.direction === 'income' ? 'text-good' : ''}`}>{e.direction === 'income' ? '+' : ''}{money(e.amount)}</span>
                  </button>
                </li>
              ))}
            </Group>
          )}
          {data.truncated && <p className="px-1 text-xs text-muted">İlk 200 sonuç gösteriliyor; toplamlar tüm eşleşmeleri kapsar.</p>}
        </>
      )}
      <BottomNav />
    </Page>
  )
}

function addMonthsLabel(label: string, n: number): string {
  const [y, m] = label.split('-').map(Number) as [number, number]
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
