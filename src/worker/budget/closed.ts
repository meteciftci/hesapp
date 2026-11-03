import { periodRange } from '../../shared/period'
import type { Ctx } from './http'
import { closedMonths, currentPeriodOf, getStartDay, type PlanRow } from './repo'
import { type PlannedEntry, RECURRING_HORIZON_MONTHS, scheduleFor } from './schedule'
import { addMonths } from '../../shared/month'

type Recon = { id: string; direction: 'income' | 'expense'; planned_amount: number }

/** Ayın "Kayıt dışı …" (kapanış farkı) kaydı ve işaretli değeri (gelir +, gider −; kayıt yoksa 0). */
export async function reconOf(c: Ctx, month: string): Promise<{ recon: Recon | null; value: number }> {
  const recon = await c.env.DB.prepare("SELECT id, direction, planned_amount FROM entries WHERE month = ? AND type = 'reconciliation' AND deleted_at IS NULL")
    .bind(month)
    .first<Recon>()
  return { recon, value: recon ? (recon.direction === 'income' ? recon.planned_amount : -recon.planned_amount) : 0 }
}

/** Kayıt dışı kaydını işaretli `value` değerine getirir: günceller, ekler ya da 0 ise siler. */
export async function setReconciliation(c: Ctx, month: string, value: number, by: string, now: number, name?: string): Promise<D1PreparedStatement[]> {
  const { recon } = await reconOf(c, month)
  if (value === 0) {
    return recon
      ? [c.env.DB.prepare('DELETE FROM entry_items WHERE entry_id = ?').bind(recon.id), c.env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(recon.id)]
      : []
  }
  const direction = value > 0 ? 'income' : 'expense'
  if (recon) {
    return [
      c.env.DB.prepare('UPDATE entries SET direction = ?, planned_amount = ?, actual_amount = NULL, name = COALESCE(?, name), updated_by = ?, updated_at = ? WHERE id = ?').bind(
        direction,
        Math.abs(value),
        name ?? null,
        by,
        now,
        recon.id,
      ),
    ]
  }
  const end = periodRange(month, await getStartDay(c)).end
  return [
    c.env.DB.prepare(
      `INSERT INTO entries (id, month, plan_id, installment_no, type, direction, name, planned_amount, is_estimate, due_date, paid_at, auto_pay, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, 'reconciliation', ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), month, direction, name ?? 'Kayıt dışı harcamalar', Math.abs(value), end, now, by, by, now, now),
  ]
}

/**
 * Kayıtların neti `delta` kadar değişince (gelir +, gider −) bakiye aynı kalsın diye fark kayıt dışı kaydına
 * yansıtılır. Kapalı ayda düzeltmede (kapanış bakiyesi değişmez), ay içi eşitlemede ve kapanışta kullanılır.
 */
export async function shiftReconciliation(c: Ctx, month: string, delta: number, by: string, now: number, name?: string): Promise<D1PreparedStatement[]> {
  if (delta === 0 && !name) return []
  return setReconciliation(c, month, (await reconOf(c, month)).value - delta, by, now, name)
}

/** Plan oluşturulurken ya da sonradan, ay kapalı olduğu için hiç üretilmemiş plan kayıtları. */
export async function missingInClosed(c: Ctx, plan: PlanRow): Promise<PlannedEntry[]> {
  const closed = await closedMonths(c)
  if (closed.size === 0) return []
  const startDay = await getStartDay(c)
  const items = scheduleFor(
    {
      kind: plan.kind,
      startMonth: plan.start_month,
      dayOfMonth: plan.day_of_month,
      installmentCount: plan.installment_count,
      endMonth: plan.end_month,
      amount: plan.amount,
      variable: !!plan.variable,
    },
    addMonths(await currentPeriodOf(c, startDay), RECURRING_HORIZON_MONTHS),
    startDay,
  ).filter((i) => closed.has(i.month))
  if (items.length === 0) return []
  // Silinmiş olanlar da sayılır: kullanıcının bilerek sildiği kayıt geri gelmez
  const { results } = await c.env.DB.prepare('SELECT month, installment_no FROM entries WHERE plan_id = ?').bind(plan.id).all<{ month: string; installment_no: number | null }>()
  const have = new Set(results.map((r) => (plan.kind === 'installment' ? `n${r.installment_no}` : r.month)))
  return items.filter((i) => !have.has(plan.kind === 'installment' ? `n${i.installmentNo}` : i.month))
}
