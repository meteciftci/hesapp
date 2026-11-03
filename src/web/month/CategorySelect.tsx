import { useCategories } from './queries'

/** Kayıt/plan yönüne uyan kategorileri listeleyen seçim kutusu; boş değer "Kategorisiz". */
export function CategorySelect({ value, direction, onChange, disabled }: { value: string | null; direction: 'income' | 'expense'; onChange: (id: string | null) => void; disabled?: boolean }) {
  const { data } = useCategories()
  const options = (data ?? []).filter((c) => c.direction === 'both' || c.direction === direction || c.id === value)
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      Kategori
      <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className="min-h-12 rounded-xl border border-edge bg-surface px-2 text-base font-normal text-ink disabled:opacity-50">
        <option value="">Kategorisiz</option>
        {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  )
}
