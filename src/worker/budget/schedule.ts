import { addMonths, compareMonth } from '../../shared/month'
import { dueDateInPeriod } from '../../shared/period'

/** Tekrarlayan planlar için bugünden itibaren kaç ay ileriye kayıt üretilir. */
export const RECURRING_HORIZON_MONTHS = 12

export interface PlanSchedule {
  kind: 'recurring' | 'installment'
  startMonth: string
  dayOfMonth: number
  installmentCount: number | null
  endMonth: string | null
  amount: number
  variable: boolean
}

export interface PlannedEntry {
  month: string
  installmentNo: number | null
  dueDate: string
  plannedAmount: number
  isEstimate: boolean
}

/**
 * Bir planın üretmesi gereken tüm kayıtlar.
 * `startDay`: bütçe döneminin başladığı gün (vade bu döneme göre hesaplanır).
 * Taksitli: `through` yok sayılır, tüm taksitler. Tekrarlayan: başlangıçtan `through`'a (ve varsa bitişe) kadar.
 */
export function scheduleFor(plan: PlanSchedule, through: string, startDay = 1): PlannedEntry[] {
  const make = (month: string, installmentNo: number | null): PlannedEntry => ({
    month,
    installmentNo,
    dueDate: dueDateInPeriod(month, plan.dayOfMonth, startDay),
    plannedAmount: plan.amount,
    isEstimate: plan.variable,
  })
  const out: PlannedEntry[] = []
  if (plan.kind === 'installment') {
    for (let no = 1; no <= (plan.installmentCount ?? 0); no++) out.push(make(addMonths(plan.startMonth, no - 1), no))
    return out
  }
  const last = plan.endMonth && compareMonth(plan.endMonth, through) < 0 ? plan.endMonth : through
  for (let month = plan.startMonth; compareMonth(month, last) <= 0; month = addMonths(month, 1)) out.push(make(month, null))
  return out
}
