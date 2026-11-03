import type { Hono } from 'hono'
import { z } from 'zod'
import { DATE_PATTERN, isDate, MONTH_PATTERN } from '../../shared/month'
import { isStartDay } from '../../shared/period'
import type { AppBindings } from '../env'
import { type Ctx, fail } from './http'
import { auditStatement, getStartDay, userId } from './repo'

export const BACKUP_FORMAT = 'hesapp-backup'
/** 2: gider kalemleri (`entryItems`). 3: kategoriler (`categories`, `category_id`). Eski sürümler aynen yüklenir. */
export const BACKUP_VERSION = 3

const int = z.number().int()
const nullInt = int.nullable()
const text = z.string().max(2000)
const nullText = text.nullable()
const bool01 = z.union([z.literal(0), z.literal(1)])
const month = z.string().regex(MONTH_PATTERN)
const date = z.string().regex(DATE_PATTERN).refine(isDate)
const direction = z.enum(['income', 'expense'])

const planRow = z.object({
  id: z.string().min(1).max(64),
  direction,
  kind: z.enum(['recurring', 'installment']),
  name: text,
  amount: int.min(0),
  day_of_month: int.min(1).max(31),
  start_month: month,
  installment_count: int.min(1).max(600).nullable(),
  end_month: month.nullable(),
  variable: bool01,
  is_card: bool01.default(0),
  auto_pay: bool01,
  note: nullText,
  closed_at: nullInt,
  category_id: nullText.optional(),
  created_by: nullText,
  updated_by: nullText,
  created_at: int,
  updated_at: int,
  deleted_at: nullInt,
})

const entryRow = z.object({
  id: z.string().min(1).max(64),
  month,
  plan_id: z.string().max(64).nullable(),
  installment_no: nullInt,
  type: z.enum(['normal', 'reconciliation']),
  direction,
  name: text,
  planned_amount: int.min(0),
  actual_amount: int.min(0).nullable(),
  is_estimate: bool01,
  due_date: date.nullable(),
  paid_at: nullInt,
  auto_pay: bool01,
  overridden: bool01,
  note: nullText,
  category_id: nullText.optional(),
  created_by: nullText,
  updated_by: nullText,
  created_at: int,
  updated_at: int,
  deleted_at: nullInt,
})

const monthRow = z.object({
  month,
  status: z.enum(['open', 'closed']),
  anchor_balance: nullInt,
  opening_balance: nullInt,
  closing_balance: nullInt,
  closed_at: nullInt,
  closed_by: nullText,
  recon_before: nullInt.default(null),
})

const categoryRow = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  direction: z.enum(['income', 'expense', 'both']),
  sort: int,
  created_at: int,
  deleted_at: nullInt,
})

const itemRow = z.object({
  id: z.string().min(1).max(64),
  entry_id: z.string().min(1).max(64),
  name: text,
  amount: int.min(0),
  date: date.nullable(),
  installment_no: int.min(1).nullable(),
  installment_count: int.min(1).nullable(),
  created_by: nullText,
  created_at: int,
  updated_at: int,
})

const auditRow = z.object({
  id: z.string().min(1).max(64),
  entity: z.enum(['plan', 'entry', 'month', 'settings']),
  entity_id: text,
  action: z.string().max(40),
  before_json: z.string().max(20_000).nullable(),
  after_json: z.string().max(20_000).nullable(),
  user_id: nullText,
  at: int,
})

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1),
  exportedAt: z.string().optional(),
  data: z.object({
    settings: z.object({ periodStartDay: z.number().int() }).optional(),
    users: z.array(z.unknown()).optional(),
    plans: z.array(planRow).max(5_000),
    entries: z.array(entryRow).max(100_000),
    months: z.array(monthRow).max(2_000),
    categories: z.array(categoryRow).max(1_000).optional(),
    entryItems: z.array(itemRow).max(200_000).default([]),
    auditLog: z.array(auditRow).max(200_000).default([]),
  }),
})

type Backup = z.infer<typeof backupSchema>

const COLUMNS = {
  categories: ['id', 'name', 'direction', 'sort', 'created_at', 'deleted_at'],
  plans: ['id', 'direction', 'kind', 'name', 'amount', 'day_of_month', 'start_month', 'installment_count', 'end_month', 'variable', 'is_card', 'auto_pay', 'note', 'category_id', 'closed_at', 'created_by', 'updated_by', 'created_at', 'updated_at', 'deleted_at'],
  entries: ['id', 'month', 'plan_id', 'installment_no', 'type', 'direction', 'name', 'planned_amount', 'actual_amount', 'is_estimate', 'due_date', 'paid_at', 'auto_pay', 'overridden', 'note', 'category_id', 'created_by', 'updated_by', 'created_at', 'updated_at', 'deleted_at'],
  months: ['month', 'status', 'anchor_balance', 'opening_balance', 'closing_balance', 'closed_at', 'closed_by', 'recon_before'],
  entry_items: ['id', 'entry_id', 'name', 'amount', 'date', 'installment_no', 'installment_count', 'created_by', 'created_at', 'updated_at'],
  audit_log: ['id', 'entity', 'entity_id', 'action', 'before_json', 'after_json', 'user_id', 'at'],
} as const

function insertAll(c: Ctx, table: keyof typeof COLUMNS, rows: Record<string, unknown>[]): D1PreparedStatement[] {
  const cols = COLUMNS[table]
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  return rows.map((row) => c.env.DB.prepare(sql).bind(...cols.map((col) => row[col] ?? null)))
}

async function readAll(c: Ctx) {
  const db = c.env.DB
  const [categories, plans, months, entries, entry_items, audit_log] = await Promise.all(
    ['categories', 'plans', 'months', 'entries', 'entry_items', 'audit_log'].map((t) => db.prepare(`SELECT * FROM ${t}`).all<Record<string, unknown>>()),
  )
  return { categories: categories!.results, plans: plans!.results, months: months!.results, entries: entries!.results, entry_items: entry_items!.results, audit_log: audit_log!.results }
}

async function runInChunks(c: Ctx, statements: D1PreparedStatement[]) {
  for (let i = 0; i < statements.length; i += 90) await c.env.DB.batch(statements.slice(i, i + 90))
}

/** JSON tam yedek: `GET /export` ve boş veritabanına geri yükleme: `POST /import`. */
export function registerBackup(app: Hono<AppBindings>) {
  app.get('/export', async (c) => {
    const db = c.env.DB
    const [categories, plans, entries, entryItems, months, auditLog, users, startDay] = await Promise.all([
      db.prepare('SELECT * FROM categories ORDER BY sort, id').all(),
      db.prepare('SELECT * FROM plans ORDER BY created_at, id').all(),
      db.prepare('SELECT * FROM entries ORDER BY month, created_at, id').all(),
      db.prepare('SELECT * FROM entry_items ORDER BY entry_id, created_at, id').all(),
      db.prepare('SELECT * FROM months ORDER BY month').all(),
      db.prepare('SELECT * FROM audit_log ORDER BY at, id').all(),
      db.prepare('SELECT id, name, role, created_at FROM users ORDER BY created_at').all().catch(() => ({ results: [] })),
      getStartDay(c),
    ])
    const body = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: { settings: { periodStartDay: startDay }, users: users.results, categories: categories.results, plans: plans.results, entries: entries.results, entryItems: entryItems.results, months: months.results, auditLog: auditLog.results },
    }
    c.header('Content-Disposition', `attachment; filename="hesapp-yedek-${body.exportedAt.slice(0, 10)}.json"`)
    c.header('Cache-Control', 'no-store')
    return c.json(body)
  })

  /** Tüm bütçe verisini siler (planlar, kayıtlar, aylar, geçmiş). Kullanıcılar ve dönem başlangıç günü kalır. Yalnızca hesap sahibi. */
  app.post('/data/wipe', async (c) => {
    if (c.get('user').role !== 'owner') fail(403, 'bu işlemi yalnızca hesap sahibi yapabilir')
    const body = await c.req.json().catch(() => null)
    if ((body as { confirm?: unknown } | null)?.confirm !== true) fail(400, 'onay gerekli')
    const db = c.env.DB
    const before = await db.prepare('SELECT (SELECT COUNT(*) FROM plans) AS plans, (SELECT COUNT(*) FROM entries) AS entries, (SELECT COUNT(*) FROM months) AS months').first<{ plans: number; entries: number; months: number }>()
    await db.batch(['audit_log', 'entry_items', 'entries', 'months', 'plans'].map((t) => db.prepare(`DELETE FROM ${t}`)))
    await db.batch([auditStatement(c, 'settings', 'data', 'wipe', before, null, Date.now())])
    return c.json({ ok: true, ...before })
  })

  app.post('/import', async (c) => {
    const raw = await c.req.json().catch((): unknown => fail(400, 'geçersiz JSON'))
    const header = z.object({ format: z.unknown(), version: z.unknown() }).safeParse(raw)
    if (!header.success || header.data.format !== BACKUP_FORMAT) fail(400, 'bu bir hesapp yedeği değil')
    if (typeof header.data.version !== 'number' || header.data.version > BACKUP_VERSION) fail(400, 'yedek daha yeni bir sürümden; uygulamayı güncelle')
    const parsed = backupSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      fail(400, `yedek geçersiz: ${issue?.path.join('.')} ${issue?.message ?? ''}`.trim())
    }
    const backup: Backup = parsed.data
    const { categories, plans, entries, entryItems, months, auditLog, settings } = backup.data
    if (settings && !isStartDay(settings.periodStartDay)) fail(400, 'yedek geçersiz: dönem başlangıç günü 1–28 olmalı')

    const planIds = new Set(plans.map((p) => p.id))
    if (planIds.size !== plans.length || new Set(entries.map((e) => e.id)).size !== entries.length) fail(400, 'yedek geçersiz: yinelenen kimlik')
    if (entries.some((e) => e.plan_id !== null && !planIds.has(e.plan_id))) fail(400, 'yedek geçersiz: kayıt var olmayan bir plana bağlı')
    // Kategoriler: yedekte varsa onlar, yoksa (eski sürüm) mevcut liste geçerlidir.
    const known = new Set(
      categories ? categories.map((x) => x.id) : (await c.env.DB.prepare('SELECT id FROM categories').all<{ id: string }>()).results.map((r) => r.id),
    )
    if ([...plans, ...entries].some((r) => r.category_id && !known.has(r.category_id))) fail(400, 'yedek geçersiz: kayıt var olmayan bir kategoriye bağlı')
    const entryIds = new Set(entries.map((e) => e.id))
    if (entryItems.some((i) => !entryIds.has(i.entry_id))) fail(400, 'yedek geçersiz: kalem var olmayan bir kayda bağlı')

    const db = c.env.DB
    const existing = await db
      .prepare('SELECT (SELECT COUNT(*) FROM plans) + (SELECT COUNT(*) FROM entries) + (SELECT COUNT(*) FROM months) + (SELECT COUNT(*) FROM entry_items) AS n')
      .first<{ n: number }>()
    const replace = c.req.query('replace') === '1'
    if ((existing?.n ?? 0) > 0 && !replace) fail(409, 'geri yükleme yalnızca boş bir veritabanına yapılır; bütçe verisi zaten var')

    // Değiştirme modu: mevcut bütçe verisi bellekte saklanır, yazma başarısız olursa geri konur.
    const wipe = ['audit_log', 'entry_items', 'entries', 'months', 'plans'].map((t) => db.prepare(`DELETE FROM ${t}`))
    const snapshot = replace && (existing?.n ?? 0) > 0 ? await readAll(c) : null
    const priorCategories = snapshot ? null : (await db.prepare('SELECT * FROM categories').all<Record<string, unknown>>()).results

    const categoryStatements = categories ? [db.prepare('DELETE FROM categories'), ...insertAll(c, 'categories', categories)] : []
    const statements = [...categoryStatements, ...insertAll(c, 'plans', plans), ...insertAll(c, 'months', months), ...insertAll(c, 'entries', entries), ...insertAll(c, 'entry_items', entryItems), ...insertAll(c, 'audit_log', auditLog)]
    if (settings) statements.push(db.prepare("INSERT INTO settings (key, value) VALUES ('period_start_day', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(settings.periodStartDay)))
    try {
      if (snapshot) await db.batch(wipe)
      for (let i = 0; i < statements.length; i += 90) await db.batch(statements.slice(i, i + 90))
    } catch {
      // Parçalı yazma yarım kalırsa yazılanlar silinir; değiştirme modundaysa önceki veri geri konur.
      await db.batch(wipe)
      if (priorCategories && categories) await runInChunks(c, [db.prepare('DELETE FROM categories'), ...insertAll(c, 'categories', priorCategories)])
      if (snapshot) {
        const restore = [db.prepare('DELETE FROM categories'), ...insertAll(c, 'categories', snapshot.categories), ...insertAll(c, 'plans', snapshot.plans), ...insertAll(c, 'months', snapshot.months), ...insertAll(c, 'entries', snapshot.entries), ...insertAll(c, 'entry_items', snapshot.entry_items), ...insertAll(c, 'audit_log', snapshot.audit_log)]
        for (let i = 0; i < restore.length; i += 90) await db.batch(restore.slice(i, i + 90))
      }
      fail(409, snapshot ? 'geri yükleme tamamlanamadı; önceki veri korundu' : 'geri yükleme tamamlanamadı; hiçbir veri eklenmedi')
    }
    await db.batch([auditStatement(c, 'settings', 'backup', 'import', null, { plans: plans.length, entries: entries.length, months: months.length }, Date.now())])
    return c.json({ ok: true, plans: plans.length, entries: entries.length, months: months.length, by: userId(c) }, 201)
  })
}
