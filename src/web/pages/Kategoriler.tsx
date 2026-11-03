import { useState } from 'react'
import type { CategoryDto } from '../../shared/api'
import { errorMessage } from '../api'
import { useConfirm } from '../confirm'
import { useCategories, useCategoryActions } from '../month/queries'
import { BottomNav, Button, Field, Group, Notice, Page, PageHeader, SectionLabel, Segmented } from '../ui'

const DIRECTIONS: { value: CategoryDto['direction']; label: string }[] = [
  { value: 'expense', label: 'Gider' },
  { value: 'income', label: 'Gelir' },
  { value: 'both', label: 'İkisi' },
]

/** Kategorileri ekleme, adını değiştirme ve silme (plan, bölüm 14.4). */
export function Kategoriler() {
  const { data, error } = useCategories()
  const actions = useCategoryActions()
  const confirm = useConfirm()
  const [name, setName] = useState('')
  const [direction, setDirection] = useState<CategoryDto['direction']>('expense')
  const [editing, setEditing] = useState<CategoryDto | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setMessage(null)
    try {
      await action()
      return true
    } catch (e) {
      setMessage(errorMessage(e))
      return false
    }
  }

  async function remove(c: CategoryDto) {
    if (!(await confirm({ title: `“${c.name}” silinsin mi?`, message: 'Bu kategorideki kayıtlar ve planlar kategorisiz kalır. Kayıtların kendisi silinmez.', confirmLabel: 'Sil', destructive: true }))) return
    if (await run(() => actions.remove.mutateAsync(c.id))) setEditing(null)
  }

  const groups = [
    { title: 'Gider', items: (data ?? []).filter((c) => c.direction === 'expense') },
    { title: 'Gelir', items: (data ?? []).filter((c) => c.direction === 'income') },
    { title: 'Gelir ve gider', items: (data ?? []).filter((c) => c.direction === 'both') },
  ]

  return (
    <Page>
      <PageHeader title="Kategoriler" back={{ to: '/ayarlar', label: 'Ayarlara dön' }} />
      {(error || message) && <Notice>{message ?? errorMessage(error)}</Notice>}

      <form
        className="flex flex-col gap-2.5 rounded-2xl bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => actions.create.mutateAsync({ name: name.trim(), direction })).then((ok) => ok && setName(''))
        }}
      >
        <Field label="Yeni kategori" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="ör. Evcil hayvan" />
        <Segmented label="Kategori yönü" value={direction} onChange={setDirection} options={DIRECTIONS} />
        <Button type="submit" disabled={!name.trim() || actions.create.isPending}>Ekle</Button>
      </form>

      {groups.map((g) => g.items.length > 0 && (
        <section key={g.title} className="flex flex-col gap-2">
          <SectionLabel>{g.title}</SectionLabel>
          <Group>
            {g.items.map((c) => (
              <li key={c.id} className="border-b border-line">
                {editing?.id === c.id ? (
                  <EditRow category={c} busy={actions.update.isPending || actions.remove.isPending} onCancel={() => setEditing(null)} onDelete={() => void remove(c)} onSave={(body) => void run(() => actions.update.mutateAsync({ id: c.id, ...body })).then((ok) => ok && setEditing(null))} />
                ) : (
                  <button type="button" onClick={() => setEditing(c)} className="flex min-h-12 w-full items-center justify-between px-3.5 text-left text-[15px]">
                    {c.name}
                    <span className="text-xs text-muted">Düzenle</span>
                  </button>
                )}
              </li>
            ))}
          </Group>
        </section>
      ))}
      <BottomNav />
    </Page>
  )
}

function EditRow({ category, busy, onSave, onCancel, onDelete }: { category: CategoryDto; busy: boolean; onSave: (body: { name: string; direction: CategoryDto['direction'] }) => void; onCancel: () => void; onDelete: () => void }) {
  const [name, setName] = useState(category.name)
  const [direction, setDirection] = useState(category.direction)
  return (
    <div className="flex flex-col gap-2.5 p-3">
      <Field label="Ad" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      <Segmented label="Kategori yönü" value={direction} onChange={setDirection} options={DIRECTIONS} />
      <div className="flex gap-2">
        <Button type="button" variant="danger" className="min-h-11" disabled={busy} onClick={onDelete}>Sil</Button>
        <Button type="button" variant="secondary" className="min-h-11 grow" disabled={busy} onClick={onCancel}>Vazgeç</Button>
        <Button type="button" className="min-h-11 grow" disabled={busy || !name.trim()} onClick={() => onSave({ name: name.trim(), direction })}>Kaydet</Button>
      </div>
    </div>
  )
}
