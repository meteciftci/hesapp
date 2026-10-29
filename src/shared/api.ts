export interface MeResponse {
  id: string
  name: string
  role: 'owner' | 'member'
}

export interface AuthState {
  mode: 'passkey' | 'access'
  hasUsers: boolean
}

export interface PasskeyInfo {
  id: string
  name: string
  device_type: string
  backed_up: number
  created_at: number
  last_used_at: number | null
  current: boolean
}

export interface MemberInfo {
  id: string
  name: string
  role: 'owner' | 'member'
  created_at: number
  passkeys: number
}

// ---- Bütçe ----

export interface EntryDto {
  id: string
  month: string
  planId: string | null
  installmentNo: number | null
  installmentCount: number | null
  type: 'normal' | 'reconciliation'
  direction: 'income' | 'expense'
  name: string
  plannedAmount: number
  actualAmount: number | null
  /** Geçerli tutar: gerçekleşen varsa o, yoksa planlanan (kuruş) */
  amount: number
  isEstimate: boolean
  dueDate: string | null
  paid: boolean
  paidAt: number | null
  autoPay: boolean
  overridden: boolean
  note: string | null
  createdBy: string | null
  updatedBy: string | null
}

export interface OpeningDto {
  amount: number
  provisional: boolean
}

export interface MonthTotals {
  income: number
  expense: number
  net: number
  /** Devir + gelir − gider */
  expectedClosing: number
  incomeReceived: number
  incomePending: number
  expensePaid: number
  expenseUnpaid: number
}

export interface MonthDto {
  month: string
  /** Dönemin ilk günü (dahil), `YYYY-AA-GG` */
  start: string
  /** Dönemin son günü (dahil) */
  end: string
  status: 'open' | 'closed'
  opening: OpeningDto
  /** Bu ayda elle girilmiş başlangıç bakiyesi (varsa) */
  anchor: number | null
  closingBalance: number | null
  totals: MonthTotals
  entries: EntryDto[]
}

export interface PlanDto {
  id: string
  direction: 'income' | 'expense'
  kind: 'recurring' | 'installment'
  name: string
  amount: number
  dayOfMonth: number
  startMonth: string
  endMonth: string | null
  installmentCount: number | null
  variable: boolean
  autoPay: boolean
  note: string | null
  closed: boolean
  stats: { total: number; paid: number; remainingAmount: number; nextDue: string | null }
}

export interface UpcomingDto {
  today: string
  overdue: EntryDto[]
  upcoming: EntryDto[]
}

export interface YearMonthDto {
  month: string
  start: string
  end: string
  status: 'open' | 'closed'
  income: number
  expense: number
  net: number
  opening: OpeningDto
  /** Kapalıysa banka bakiyesi, değilse devir + net */
  closing: number
}

export interface YearDto {
  year: number
  months: YearMonthDto[]
  totals: { income: number; expense: number; net: number }
}

export interface SettingsDto {
  /** Bütçe döneminin başladığı gün (1–28). 1 ise dönem takvim ayıdır. */
  periodStartDay: number
}

export interface SettingsUpdateResult extends SettingsDto {
  /** Vadeleri yeni başlangıç gününe göre yeniden hesaplanan kayıt sayısı */
  recalculated: number
  /** Vadesi artık kendi döneminin dışında kalan (elle girilmiş) kayıt sayısı */
  outsidePeriod: number
}
