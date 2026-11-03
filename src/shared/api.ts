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
  /** Ekleyen kişinin kimliği (süzgeç için; içe aktarılan kayıtlarda boş) */
  createdById: string | null
  updatedBy: string | null
  /** Kayıt, tutarı her ay değişen bir plandan (kart ekstresi, fatura) geliyor */
  variablePlan: boolean
  /** Kayıt bir kredi kartı planından geliyor */
  cardPlan: boolean
  categoryId: string | null
  categoryName: string | null
  /** Gider kalemi sayısı ve toplamı (kart ekstresi dökümü) */
  itemCount: number
  itemsTotal: number
}

export interface EntryItemDto {
  id: string
  name: string
  amount: number
  date: string | null
  installmentNo: number | null
  installmentCount: number | null
  createdBy: string | null
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
  /** Devir + alınan gelirler − ödenen giderler: bankada şu an olması gereken */
  currentBalance: number
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
  /** Hiç kapalı ay yok ve bu ay ya da öncesinde başlangıç bakiyesi girilmemiş: kurulum önerilir */
  needsOpening: boolean
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
  /** Kredi kartı tanımı */
  card: boolean
  autoPay: boolean
  note: string | null
  categoryId: string | null
  closed: boolean
  /** Sayılar kayıt adedi; tutarlar planın silinmemiş kayıtlarından (ödenen + kalan = toplam) */
  stats: { total: number; paid: number; paidAmount: number; remainingAmount: number; totalAmount: number; nextDue: string | null }
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
  /** Giderlerin kategoriye göre dağılımı, büyükten küçüğe (kategorisiz: id null) */
  categories: { id: string | null; name: string; expense: number }[]
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

export interface AuditRecentItem {
  id: string
  entity: 'plan' | 'entry' | 'month' | 'settings'
  entityId: string
  action: string
  at: number
  /** Değişikliği yapan kişinin adı (bulunamazsa kimliği) */
  by: string | null
  /** Kaydın ya da planın adı */
  label: string | null
  /** Kaydın dönemi ya da ay işlemlerinde ayın kendisi */
  month: string | null
}

/** Hızlı ekleme önerisi: son kullanılan tek seferlik kalem */
export interface RecentEntryDto {
  name: string
  direction: 'income' | 'expense'
  amount: number
  categoryId: string | null
}

export interface CategoryDto {
  id: string
  name: string
  direction: 'income' | 'expense' | 'both'
  sort: number
}

export interface SearchDto {
  entries: EntryDto[]
  /** Sonuç sınırı aşıldıysa true (toplamlar yine tüm eşleşmeler içindir) */
  truncated: boolean
  totals: { income: number; expense: number; count: number }
}

/** Kalan borç: dönemin başındaki ödenmemiş taksit toplamı */
export interface DebtPoint {
  month: string
  remaining: number
}

/** GET /plans/:id */
export interface PlanDetailDto {
  plan: PlanDto
  entries: EntryDto[]
  /** Ay kapalı olduğu için oluşmamış kayıtların ayları (POST /plans/:id/backfill ile eklenir) */
  missingClosed: string[]
}
