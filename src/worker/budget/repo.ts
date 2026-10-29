import { addMonths, todayIn } from '../../shared/month'
import { isStartDay, periodOf } from '../../shared/period'
import type { EntryDto, PlanDto } from '../../shared/api'
import type { Ctx } from './http'
import { fail } from './http'
import type { MonthState } from './balance'
import { scheduleFor } from './schedule'

export interface PlanRow {
  id: string
  direction: 'income' | 'expense'
  kind: 'recurring' | 'installment'
  name: string
  amount: number
  day_of_month: number
  start_month: string
  installment_count: number | null
  end_month: string | null
  variable: number
  auto_pay: number
  note: string | null
  closed_at: number | null
  created_by: string | null
  updated_by: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface EntryRow {
  id: string
  month: string
  plan_id: string | null
  installment_no: number | null
  type: 'normal' | 'reconciliation'
  direction: 'income' | 'expense'
  name: string
  planned_amount: number
  actual_amount: number | null
  is_estimate: number
  due_date: string | null
  paid_at: number | null
  auto_pay: number
  overridden: number
  note: string | null
  created_by: string | null
  updated_by: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface MonthRow {
  month: string
  status: 'open' | 'closed'
  anchor_balance: number | null
  opening_balance: number | null
  closing_balance: number | null
  closed_at: number | null
  closed_by: string | null
}

interface EntryJoinRow extends EntryRow {
  plan_installments: number | null
  created_name: string | null
  updated_name: string | null
}

/** Bir sonraki kaç aya kadar tekrarlayan kayıt üretmeye izin verilir. */
const MAX_MONTHS_AHEAD = 60

export const userId = (c: Ctx) => c.get('user').id
export const todayOf = (c: Ctx) => todayIn(c.env.TZ)

/** Hane ayarı: bütçe döneminin başladığı gün (varsayılan 1 = takvim ayı). */
export async function getStartDay(c: Ctx): Promise<number> {
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'period_start_day'").first<{ value: string }>()
  const n = Number(row?.value)
  return isStartDay(n) ? n : 1
}

/** Bugünün içinde bulunduğu dönemin etiketi. */
export async function currentPeriodOf(c: Ctx, startDay?: number): Promise<string> {
  return periodOf(todayOf(c), startDay ?? (await getStartDay(c)))
}

export const effective = (e: { planned_amount: number; actual_amount: number | null }) => e.actual_amount ?? e.planned_amount

export const ENTRY_SELECT = `SELECT e.*, p.installment_count AS plan_installments, cu.name AS created_name, uu.name AS updated_name
  FROM entries e
  LEFT JOIN plans p ON p.id = e.plan_id
  LEFT JOIN users cu ON cu.id = e.created_by
  LEFT JOIN users uu ON uu.id = e.updated_by`

export function toEntryDto(r: EntryJoinRow): EntryDto {
  return {
    id: r.id,
    month: r.month,
    planId: r.plan_id,
    installmentNo: r.installment_no,
    installmentCount: r.plan_installments,
    type: r.type,
    direction: r.direction,
    name: r.name,
    plannedAmount: r.planned_amount,
    actualAmount: r.actual_amount,
    amount: effective(r),
    isEstimate: !!r.is_estimate,
    dueDate: r.due_date,
    paid: r.paid_at !== null,
    paidAt: r.paid_at,
    autoPay: !!r.auto_pay,
    overridden: !!r.overridden,
    note: r.note,
    createdBy: r.created_name ?? r.created_by,
    updatedBy: r.updated_name ?? r.updated_by,
  }
}

export function toPlanDto(r: PlanRow, stats?: { total: number; paid: number; remaining: number; next_due: string | null }): PlanDto {
  return {
    id: r.id,
    direction: r.direction,
    kind: r.kind,
    name: r.name,
    amount: r.amount,
    dayOfMonth: r.day_of_month,
    startMonth: r.start_month,
    endMonth: r.kind === 'installment' ? addMonths(r.start_month, (r.installment_count ?? 1) - 1) : r.end_month,
    installmentCount: r.installment_count,
    variable: !!r.variable,
    autoPay: !!r.auto_pay,
    note: r.note,
    closed: r.closed_at !== null,
    stats: { total: stats?.total ?? 0, paid: stats?.paid ?? 0, remainingAmount: stats?.remaining ?? 0, nextDue: stats?.next_due ?? null },
  }
}

export async function loadMonthRows(c: Ctx): Promise<MonthRow[]> {
  return (await c.env.DB.prepare('SELECT * FROM months ORDER BY month').all<MonthRow>()).results
}

export const toState = (r: MonthRow): MonthState => ({
  month: r.month,
  status: r.status,
  anchorBalance: r.anchor_balance,
  closingBalance: r.closing_balance,
})

export async function closedMonths(c: Ctx): Promise<Set<string>> {
  const { results } = await c.env.DB.prepare("SELECT month FROM months WHERE status = 'closed'").all<{ month: string }>()
  return new Set(results.map((r) => r.month))
}

export async function assertOpen(c: Ctx, month: string) {
  const row = await c.env.DB.prepare("SELECT 1 AS x FROM months WHERE month = ? AND status = 'closed'").bind(month).first()
  if (row) fail(409, `${month} ayı kapalı; önce ayı yeniden açmalısın`)
}

/** Her ayın (gelir, gider) toplamı; silinmiş kayıtlar hariç. */
export async function loadNets(c: Ctx): Promise<Map<string, { income: number; expense: number }>> {
  const { results } = await c.env.DB.prepare(
    'SELECT month, direction, SUM(COALESCE(actual_amount, planned_amount)) AS total FROM entries WHERE deleted_at IS NULL GROUP BY month, direction',
  ).all<{ month: string; direction: 'income' | 'expense'; total: number }>()
  const map = new Map<string, { income: number; expense: number }>()
  for (const r of results) {
    const v = map.get(r.month) ?? { income: 0, expense: 0 }
    v[r.direction] = r.total
    map.set(r.month, v)
  }
  return map
}

export const netOf = (nets: Map<string, { income: number; expense: number }>) => (month: string) => {
  const v = nets.get(month)
  return v ? v.income - v.expense : 0
}

export interface NewEntry {
  id: string
  month: string
  planId: string | null
  installmentNo: number | null
  type?: 'normal' | 'reconciliation'
  direction: 'income' | 'expense'
  name: string
  plannedAmount: number
  isEstimate: boolean
  dueDate: string | null
  paidAt: number | null
  autoPay: boolean
  note: string | null
}

export function insertEntry(c: Ctx, e: NewEntry, now: number, ignoreConflict = false) {
  const by = userId(c)
  return c.env.DB.prepare(
    `INSERT ${ignoreConflict ? 'OR IGNORE ' : ''}INTO entries
       (id, month, plan_id, installment_no, type, direction, name, planned_amount, is_estimate, due_date, paid_at, auto_pay, note, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    e.id,
    e.month,
    e.planId,
    e.installmentNo,
    e.type ?? 'normal',
    e.direction,
    e.name,
    e.plannedAmount,
    Number(e.isEstimate),
    e.dueDate,
    e.paidAt,
    Number(e.autoPay),
    e.note,
    by,
    by,
    now,
    now,
  )
}

export function auditStatement(c: Ctx, entity: 'plan' | 'entry' | 'month' | 'settings', entityId: string, action: string, before: unknown, after: unknown, now: number) {
  return c.env.DB.prepare('INSERT INTO audit_log (id, entity, entity_id, action, before_json, after_json, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
    crypto.randomUUID(),
    entity,
    entityId,
    action,
    before === null || before === undefined ? null : JSON.stringify(before),
    after === null || after === undefined ? null : JSON.stringify(after),
    userId(c),
    now,
  )
}

export async function runBatch(c: Ctx, statements: D1PreparedStatement[]) {
  // D1 tek istekte çok sayıda ifadeyi kabul eder; yine de makul parçalara bölünür.
  for (let i = 0; i < statements.length; i += 90) await c.env.DB.batch(statements.slice(i, i + 90))
}

/**
 * Etkin tekrarlayan planların `through` ayına kadar eksik kayıtlarını üretir. Kapalı aylara yazılmaz,
 * silinmiş (mezar taşı) kayıtlar yeniden üretilmez. Tekrar çağrılması zararsızdır.
 */
export async function ensureRecurring(c: Ctx, through: string) {
  const startDay = await getStartDay(c)
  const limit = addMonths(periodOf(todayOf(c), startDay), MAX_MONTHS_AHEAD)
  const upTo = through > limit ? limit : through
  const { results: plans } = await c.env.DB.prepare(
    "SELECT * FROM plans WHERE kind = 'recurring' AND closed_at IS NULL AND deleted_at IS NULL AND start_month <= ?",
  )
    .bind(upTo)
    .all<PlanRow>()
  if (!plans.length) return
  const closed = await closedMonths(c)
  const { results: existing } = await c.env.DB.prepare("SELECT plan_id, month FROM entries WHERE plan_id IN (SELECT id FROM plans WHERE kind = 'recurring')").all<{
    plan_id: string
    month: string
  }>()
  const have = new Set(existing.map((e) => `${e.plan_id}|${e.month}`))
  const now = Date.now()
  const statements: D1PreparedStatement[] = []
  for (const plan of plans) {
    const list = scheduleFor(
      {
        kind: 'recurring',
        startMonth: plan.start_month,
        dayOfMonth: plan.day_of_month,
        installmentCount: null,
        endMonth: plan.end_month,
        amount: plan.amount,
        variable: !!plan.variable,
      },
      upTo,
      startDay,
    )
    for (const item of list) {
      if (closed.has(item.month) || have.has(`${plan.id}|${item.month}`)) continue
      statements.push(
        insertEntry(
          c,
          {
            id: crypto.randomUUID(),
            month: item.month,
            planId: plan.id,
            installmentNo: null,
            direction: plan.direction,
            name: plan.name,
            plannedAmount: item.plannedAmount,
            isEstimate: item.isEstimate,
            dueDate: item.dueDate,
            paidAt: null,
            autoPay: !!plan.auto_pay,
            note: plan.note,
          },
          now,
          true,
        ),
      )
    }
  }
  if (statements.length) await runBatch(c, statements)
}
