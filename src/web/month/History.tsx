import { useState } from 'react'
import { useAudit } from './queries'

export const ACTIONS: Record<string, string> = {
  create: 'oluşturdu',
  update: 'düzenledi',
  delete: 'sildi',
  restore: 'geri aldı',
  pay: 'ödendi işaretledi',
  unpay: 'ödendi işaretini kaldırdı',
  close: 'kapattı',
  reopen: 'yeniden açtı',
  sync: 'bakiyeyle eşitledi',
  opening: 'başlangıç bakiyesini girdi',
  schedule: 'ödeme planını yapıştırdı',
  import: 'yedeği geri yükledi',
  item_add: 'kalem ekledi',
  item_update: 'kalemi düzenledi',
  item_delete: 'kalemi sildi',
  wipe: 'tüm verileri sildi',
  backfill: 'kapalı aylara eksik kayıtları ekledi',
}

const when = (ms: number) => new Date(ms).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Bir kaydın ya da planın değişiklik geçmişi; açılınca yüklenir. */
export function History({ entity, id }: { entity: 'plan' | 'entry' | 'month'; id: string }) {
  const [open, setOpen] = useState(false)
  const { data, isPending, error } = useAudit(entity, id, open)
  return (
    <div className="flex flex-col gap-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="min-h-11 self-start text-sm font-medium text-link underline">
        {open ? 'Geçmişi gizle' : 'Değişiklik geçmişi'}
      </button>
      {open && isPending && <p className="text-xs text-muted">Yükleniyor…</p>}
      {open && error && <p className="text-xs text-bad">Geçmiş yüklenemedi.</p>}
      {open && data && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
          {data.length === 0 && <li className="text-muted">Kayıt yok.</li>}
          {data.map((item) => (
            <li key={item.id} className="flex justify-between gap-3">
              <span>{item.by ?? 'Bilinmeyen'} {ACTIONS[item.action] ?? item.action}</span>
              <span className="shrink-0 text-xs text-muted">{when(item.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
