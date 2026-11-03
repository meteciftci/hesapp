export type Scope = 'this' | 'following' | 'all'

export interface ScopedEntry {
  id: string
  planId: string | null
  month: string
  paid: boolean
  deleted: boolean
}

/**
 * Plana bağlı bir kaydı düzenlerken hangi kayıtların etkileneceği.
 *  - this: yalnızca hedef
 *  - following: hedef ve sonraki aylardaki ödenmemiş, silinmemiş, kapanmamış aylardaki kayıtlar
 *  - all: planın tüm ödenmemiş, silinmemiş, kapanmamış aylardaki kayıtları (hedef her zaman dahil)
 * Ödenmiş kayıtlar toplu değişiklikte asla değişmez; hedefin kendisi hariç.
 */
export function scopeTargets(target: ScopedEntry, all: ScopedEntry[], scope: Scope, closedMonths: ReadonlySet<string>): string[] {
  if (scope === 'this' || !target.planId) return [target.id]
  const ids = new Set<string>([target.id])
  for (const e of all) {
    if (e.planId !== target.planId || e.deleted || e.paid || closedMonths.has(e.month)) continue
    if (scope === 'following' && e.month < target.month) continue
    ids.add(e.id)
  }
  return [...ids]
}
