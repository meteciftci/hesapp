import { Hono } from 'hono'
import type { EntryDto, MonthDto, MonthTotals, PlanDto, SettingsDto, SettingsUpdateResult, UpcomingDto, YearDto } from '../../shared/api'
import { addDays, addMonths, isMonth } from '../../shared/month'
import { dueDateInPeriod, isDateInPeriod, periodOf, periodRange } from '../../shared/period'
import type { AppBindings } from '../env'
import { closeBlocker, lastClosedMonth, openingFor, reconcile } from './balance'
import { type Ctx, fail, monthParam, parseBody } from './http'
import { parsePastedAmounts } from './paste'
import {
  assertOpen,
  auditStatement,
  closedMonths,
  currentPeriodOf,
  type EntryRow,
  ENTRY_SELECT,
  ensureRecurring,
  getStartDay,
  insertEntry,
  loadMonthRows,
  loadNets,
  type MonthRow,
  netOf,
  type PlanRow,
  runBatch,
  todayOf,
  toEntryDto,
  toPlanDto,
  toState,
  userId,
} from './repo'
import { RECURRING_HORIZON_MONTHS, scheduleFor } from './schedule'
import { scopeTargets } from './scope'
import { entryCreate, entryPatch, monthClose, monthOpening, payBody, planClose, planCreate, schedulePaste, settingsUpdate } from './schemas'

type EntryJoin = Parameters<typeof toEntryDto>[0]

export function createBudgetRoutes() {
  const app = new Hono<AppBindings>()

  async function getEntry(c: Ctx, id: string, includeDeleted = false): Promise<EntryRow> {
    const row = await c.env.DB.prepare(`SELECT * FROM entries WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`).bind(id).first<EntryRow>()
    if (!row) fail(404, 'kayıt bulunamadı')
    return row
  }

  async function getPlan(c: Ctx, id: string): Promise<PlanRow> {
    const row = await c.env.DB.prepare('SELECT * FROM plans WHERE id = ? AND deleted_at IS NULL').bind(id).first<PlanRow>()
    if (!row) fail(404, 'plan bulunamadı')
    return row
  }

  async function entryDto(c: Ctx, id: string): Promise<EntryDto> {
    const row = await c.env.DB.prepare(`${ENTRY_SELECT} WHERE e.id = ?`).bind(id).first<EntryJoin>()
    if (!row) fail(404, 'kayıt bulunamadı')
    return toEntryDto(row)
  }

  // ---------------------------------------------------------------- aylar
  async function buildMonth(c: Ctx, month: string): Promise<MonthDto> {
    const [rows, nets, startDay] = await Promise.all([loadMonthRows(c), loadNets(c), getStartDay(c)])
    const states = rows.map(toState)
    const opening = openingFor(month, states, netOf(nets))
    const self = rows.find((r) => r.month === month)
    const range = periodRange(month, startDay)
    const { results } = await c.env.DB.prepare(
      `${ENTRY_SELECT} WHERE e.month = ? AND e.deleted_at IS NULL ORDER BY (e.type = 'reconciliation'), (e.due_date IS NULL), e.due_date, e.name`,
    )
      .bind(month)
      .all<EntryJoin>()
    const entries = results.map(toEntryDto)

    const totals: MonthTotals = { income: 0, expense: 0, net: 0, expectedClosing: 0, incomeReceived: 0, incomePending: 0, expensePaid: 0, expenseUnpaid: 0 }
    for (const e of entries) {
      if (e.direction === 'income') {
        totals.income += e.amount
        if (e.paid) totals.incomeReceived += e.amount
        else totals.incomePending += e.amount
      } else {
        totals.expense += e.amount
        if (e.paid) totals.expensePaid += e.amount
        else totals.expenseUnpaid += e.amount
      }
    }
    totals.net = totals.income - totals.expense
    totals.expectedClosing = opening.amount + totals.net

    return {
      month,
      start: range.start,
      end: range.end,
      status: self?.status ?? 'open',
      opening,
      anchor: self?.anchor_balance ?? null,
      closingBalance: self?.status === 'closed' ? self.closing_balance : null,
      totals,
      entries,
    }
  }

  app.get('/months/:month', async (c) => {
    const month = monthParam(c)
    await ensureRecurring(c, month)
    return c.json(await buildMonth(c, month))
  })

  app.put('/months/:month/opening', async (c) => {
    const month = monthParam(c)
    const { balance } = await parseBody(c, monthOpening)
    const rows = await loadMonthRows(c)
    if (rows.some((r) => r.status === 'closed')) fail(409, 'kapanmış ay varken başlangıç bakiyesi değiştirilemez')
    const before = rows.find((r) => r.anchor_balance !== null) ?? null
    const now = Date.now()
    await runBatch(c, [
      c.env.DB.prepare("UPDATE months SET anchor_balance = NULL WHERE month <> ? AND status = 'open'").bind(month),
      c.env.DB.prepare("DELETE FROM months WHERE status = 'open' AND anchor_balance IS NULL AND month <> ?").bind(month),
      c.env.DB.prepare("INSERT INTO months (month, status, anchor_balance) VALUES (?, 'open', ?) ON CONFLICT(month) DO UPDATE SET anchor_balance = excluded.anchor_balance").bind(month, balance),
      auditStatement(c, 'month', month, 'opening', before ? { month: before.month, balance: before.anchor_balance } : null, { month, balance }, now),
    ])
    await ensureRecurring(c, month)
    return c.json(await buildMonth(c, month))
  })

  app.post('/months/:month/close', async (c) => {
    const month = monthParam(c)
    const body = await parseBody(c, monthClose)
    const rows = await loadMonthRows(c)
    const startDay = await getStartDay(c)
    const blocker = closeBlocker(month, rows.map(toState), await currentPeriodOf(c, startDay))
    if (blocker) fail(409, blocker)
    await ensureRecurring(c, month)

    const nets = await loadNets(c)
    const opening = openingFor(month, rows.map(toState), netOf(nets))
    const own = nets.get(month) ?? { income: 0, expense: 0 }
    const expected = opening.amount + own.income - own.expense
    const diff = reconcile(expected, body.bankBalance)
    const now = Date.now()
    const by = userId(c)

    const statements: D1PreparedStatement[] = []
    let reconId: string | null = null
    if (diff) {
      reconId = crypto.randomUUID()
      // Aynı anda ikinci bir kapanış gelirse tekrar kayıt eklenmesin diye koşullu yazılır.
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO entries (id, month, plan_id, installment_no, type, direction, name, planned_amount, is_estimate, due_date, paid_at, auto_pay, created_by, updated_by, created_at, updated_at)
           SELECT ?, ?, NULL, NULL, 'reconciliation', ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM months WHERE month = ? AND status = 'closed')`,
        ).bind(reconId, month, diff.direction, body.name ?? 'Kayıt dışı harcamalar', diff.amount, periodRange(month, startDay).end, now, by, by, now, now, month),
      )
    }
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO months (month, status, opening_balance, closing_balance, closed_at, closed_by) VALUES (?, 'closed', ?, ?, ?, ?)
         ON CONFLICT(month) DO UPDATE SET status = 'closed', opening_balance = excluded.opening_balance, closing_balance = excluded.closing_balance, closed_at = excluded.closed_at, closed_by = excluded.closed_by
         WHERE months.status = 'open'`,
      ).bind(month, opening.amount, body.bankBalance, now, by),
      auditStatement(c, 'month', month, 'close', null, { expected, bankBalance: body.bankBalance, reconciliation: diff }, now),
    )
    await runBatch(c, statements)
    return c.json(await buildMonth(c, month))
  })

  app.post('/months/:month/reopen', async (c) => {
    const month = monthParam(c)
    const rows = await loadMonthRows(c)
    const last = lastClosedMonth(rows.map(toState))
    if (!last || last !== month) fail(409, last ? `yalnızca en son kapatılan ay (${last}) yeniden açılabilir` : 'kapalı ay yok')
    const before = rows.find((r) => r.month === month) as MonthRow
    const now = Date.now()
    await runBatch(c, [
      c.env.DB.prepare("DELETE FROM entries WHERE month = ? AND type = 'reconciliation'").bind(month),
      c.env.DB.prepare("UPDATE months SET status = 'open', opening_balance = NULL, closing_balance = NULL, closed_at = NULL, closed_by = NULL WHERE month = ?").bind(month),
      auditStatement(c, 'month', month, 'reopen', { closingBalance: before.closing_balance }, null, now),
    ])
    return c.json(await buildMonth(c, month))
  })

  // ---------------------------------------------------------------- yaklaşan, yıl
  app.get('/upcoming', async (c) => {
    const daysRaw = Number(c.req.query('days') ?? 30)
    const days = Number.isInteger(daysRaw) && daysRaw >= 1 && daysRaw <= 366 ? daysRaw : 30
    const today = todayOf(c)
    const until = addDays(today, days)
    await ensureRecurring(c, periodOf(until, await getStartDay(c)))
    const { results } = await c.env.DB.prepare(
      `${ENTRY_SELECT} WHERE e.deleted_at IS NULL AND e.paid_at IS NULL AND e.due_date IS NOT NULL AND e.due_date <= ?
         AND e.month NOT IN (SELECT month FROM months WHERE status = 'closed') ORDER BY e.due_date, e.name`,
    )
      .bind(until)
      .all<EntryJoin>()
    const all = results.map(toEntryDto)
    const body: UpcomingDto = {
      today,
      overdue: all.filter((e) => (e.dueDate as string) < today),
      upcoming: all.filter((e) => (e.dueDate as string) >= today),
    }
    return c.json(body)
  })

  app.get('/years/:year', async (c) => {
    const year = Number(c.req.param('year'))
    if (!Number.isInteger(year) || year < 2000 || year > 2200) fail(400, 'yıl geçersiz')
    await ensureRecurring(c, `${year}-12`)
    const [rows, nets, startDay] = await Promise.all([loadMonthRows(c), loadNets(c), getStartDay(c)])
    const states = rows.map(toState)
    const net = netOf(nets)
    const body: YearDto = { year, months: [], totals: { income: 0, expense: 0, net: 0 } }
    for (let m = 1; m <= 12; m++) {
      const month = `${year}-${String(m).padStart(2, '0')}`
      const own = nets.get(month) ?? { income: 0, expense: 0 }
      const opening = openingFor(month, states, net)
      const row = rows.find((r) => r.month === month)
      const closed = row?.status === 'closed'
      const range = periodRange(month, startDay)
      body.months.push({
        month,
        start: range.start,
        end: range.end,
        status: closed ? 'closed' : 'open',
        income: own.income,
        expense: own.expense,
        net: own.income - own.expense,
        opening,
        closing: closed && row?.closing_balance != null ? row.closing_balance : opening.amount + own.income - own.expense,
      })
      body.totals.income += own.income
      body.totals.expense += own.expense
    }
    body.totals.net = body.totals.income - body.totals.expense
    return c.json(body)
  })

  // ---------------------------------------------------------------- planlar
  async function planStats(c: Ctx) {
    const { results } = await c.env.DB.prepare(
      `SELECT plan_id, COUNT(*) AS total, SUM(paid_at IS NOT NULL) AS paid,
              SUM(CASE WHEN paid_at IS NULL THEN COALESCE(actual_amount, planned_amount) ELSE 0 END) AS remaining,
              MIN(CASE WHEN paid_at IS NULL THEN due_date END) AS next_due
         FROM entries WHERE deleted_at IS NULL AND plan_id IS NOT NULL GROUP BY plan_id`,
    ).all<{ plan_id: string; total: number; paid: number; remaining: number; next_due: string | null }>()
    return new Map(results.map((r) => [r.plan_id, r]))
  }

  app.get('/plans', async (c) => {
    const status = c.req.query('status') ?? 'active'
    await ensureRecurring(c, addMonths(await currentPeriodOf(c), RECURRING_HORIZON_MONTHS))
    const { results } = await c.env.DB.prepare('SELECT * FROM plans WHERE deleted_at IS NULL ORDER BY created_at').all<PlanRow>()
    const stats = await planStats(c)
    const list = results.map((p) => toPlanDto(p, stats.get(p.id)))
    const filtered = status === 'all' ? list : list.filter((p) => (status === 'closed' ? p.closed : !p.closed))
    return c.json(filtered)
  })

  app.post('/plans', async (c) => {
    const body = await parseBody(c, planCreate)
    const now = Date.now()
    const by = userId(c)
    const id = crypto.randomUUID()
    const startDay = await getStartDay(c)
    const through = addMonths(await currentPeriodOf(c, startDay), RECURRING_HORIZON_MONTHS)
    const items = scheduleFor(
      {
        kind: body.kind,
        startMonth: body.startMonth,
        dayOfMonth: body.dayOfMonth,
        installmentCount: body.installmentCount ?? null,
        endMonth: body.endMonth ?? null,
        amount: body.amount,
        variable: body.variable ?? false,
      },
      through,
      startDay,
    )
    const closed = await closedMonths(c)
    const today = todayOf(c)

    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `INSERT INTO plans (id, direction, kind, name, amount, day_of_month, start_month, installment_count, end_month, variable, auto_pay, note, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, body.direction, body.kind, body.name, body.amount, body.dayOfMonth, body.startMonth, body.installmentCount ?? null, body.endMonth ?? null, Number(body.variable ?? false), Number(body.autoPay ?? false), body.note ?? null, by, by, now, now),
    ]
    let created = 0
    for (const item of items) {
      if (closed.has(item.month)) continue
      const pastDue = body.markPastPaid === true && item.dueDate < today
      statements.push(
        insertEntry(
          c,
          {
            id: crypto.randomUUID(),
            month: item.month,
            planId: id,
            installmentNo: item.installmentNo,
            direction: body.direction,
            name: body.name,
            plannedAmount: item.plannedAmount,
            isEstimate: item.isEstimate,
            dueDate: item.dueDate,
            paidAt: pastDue ? Date.parse(`${item.dueDate}T12:00:00Z`) : null,
            autoPay: body.autoPay ?? false,
            note: body.note ?? null,
          },
          now,
        ),
      )
      created++
    }
    statements.push(auditStatement(c, 'plan', id, 'create', null, { ...body, entries: created }, now))
    await runBatch(c, statements)
    const plan = await getPlan(c, id)
    const stats = await planStats(c)
    return c.json({ plan: toPlanDto(plan, stats.get(id)), createdEntries: created }, 201)
  })

  app.get('/plans/:id', async (c) => {
    const plan = await getPlan(c, c.req.param('id'))
    const { results } = await c.env.DB.prepare(`${ENTRY_SELECT} WHERE e.plan_id = ? AND e.deleted_at IS NULL ORDER BY e.month`).bind(plan.id).all<EntryJoin>()
    const stats = await planStats(c)
    const body: { plan: PlanDto; entries: EntryDto[] } = { plan: toPlanDto(plan, stats.get(plan.id)), entries: results.map(toEntryDto) }
    return c.json(body)
  })

  app.delete('/plans/:id', async (c) => {
    const plan = await getPlan(c, c.req.param('id'))
    const now = Date.now()
    const by = userId(c)
    const affected = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM entries WHERE plan_id = ? AND deleted_at IS NULL AND paid_at IS NULL AND month NOT IN (SELECT month FROM months WHERE status = 'closed')`,
    ).bind(plan.id).first<{ n: number }>()
    await runBatch(c, [
      c.env.DB.prepare(
        `UPDATE entries SET deleted_at = ?, updated_by = ?, updated_at = ?
          WHERE plan_id = ? AND deleted_at IS NULL AND paid_at IS NULL AND month NOT IN (SELECT month FROM months WHERE status = 'closed')`,
      ).bind(now, by, now, plan.id),
      c.env.DB.prepare('UPDATE plans SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(now, by, now, plan.id),
      auditStatement(c, 'plan', plan.id, 'delete', { name: plan.name }, null, now),
    ])
    return c.json({ ok: true, removedEntries: affected?.n ?? 0 })
  })

  app.post('/plans/:id/close', async (c) => {
    const plan = await getPlan(c, c.req.param('id'))
    if (plan.closed_at !== null) fail(409, 'plan zaten kapalı')
    const body = await parseBody(c, planClose)
    await assertOpen(c, body.fromMonth)
    const now = Date.now()
    const by = userId(c)
    const affected = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM entries WHERE plan_id = ? AND month >= ? AND deleted_at IS NULL AND paid_at IS NULL AND month NOT IN (SELECT month FROM months WHERE status = 'closed')`,
    ).bind(plan.id, body.fromMonth).first<{ n: number }>()
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `UPDATE entries SET deleted_at = ?, updated_by = ?, updated_at = ?
          WHERE plan_id = ? AND month >= ? AND deleted_at IS NULL AND paid_at IS NULL AND month NOT IN (SELECT month FROM months WHERE status = 'closed')`,
      ).bind(now, by, now, plan.id, body.fromMonth),
      c.env.DB.prepare('UPDATE plans SET closed_at = ?, end_month = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(now, addMonths(body.fromMonth, -1), by, now, plan.id),
    ]
    if (body.payoffAmount !== undefined && body.payoffAmount > 0) {
      statements.push(
        insertEntry(
          c,
          {
            id: crypto.randomUUID(),
            month: body.fromMonth,
            planId: null,
            installmentNo: null,
            direction: plan.direction,
            name: `${plan.name} (erken kapatma)`,
            plannedAmount: body.payoffAmount,
            isEstimate: false,
            dueDate: dueDateInPeriod(body.fromMonth, plan.day_of_month, await getStartDay(c)),
            paidAt: null,
            autoPay: false,
            note: null,
          },
          now,
        ),
      )
    }
    statements.push(auditStatement(c, 'plan', plan.id, 'close', { name: plan.name }, { fromMonth: body.fromMonth, payoff: body.payoffAmount ?? null }, now))
    await runBatch(c, statements)
    return c.json({ ok: true, removedEntries: affected?.n ?? 0 })
  })

  app.post('/plans/:id/schedule', async (c) => {
    const plan = await getPlan(c, c.req.param('id'))
    if (plan.kind !== 'installment') fail(400, 'ödeme planı yalnızca taksitli planlara uygulanır')
    const body = await parseBody(c, schedulePaste)
    let amounts: number[]
    if (body.text !== undefined) {
      const parsed = parsePastedAmounts(body.text)
      if (parsed.invalid.length) fail(400, `anlaşılamayan satırlar: ${parsed.invalid.map((i) => `${i.line}. satır "${i.text}"`).join(', ')}`)
      amounts = parsed.amounts
    } else amounts = body.amounts ?? []
    if (!amounts.length) fail(400, 'tutar bulunamadı')

    const startNo = body.startNo ?? 1
    const total = plan.installment_count ?? 0
    const expected = total - startNo + 1
    if (expected < 1) fail(400, 'başlangıç taksit numarası plan sınırının dışında')

    const { results } = await c.env.DB.prepare('SELECT id, month, installment_no, paid_at FROM entries WHERE plan_id = ? AND deleted_at IS NULL AND installment_no >= ? ORDER BY installment_no')
      .bind(plan.id, startNo)
      .all<{ id: string; month: string; installment_no: number; paid_at: number | null }>()
    const closed = await closedMonths(c)

    const mismatch = amounts.length !== expected
    const changes = results
      .map((r) => ({ ...r, amount: amounts[r.installment_no - startNo] }))
      .filter((r) => r.amount !== undefined)
      .map((r) => ({ id: r.id, installmentNo: r.installment_no, month: r.month, amount: r.amount as number, skipped: r.paid_at !== null || closed.has(r.month) }))

    const preview = { count: amounts.length, expected, mismatch, willUpdate: changes.filter((x) => !x.skipped).length, skipped: changes.filter((x) => x.skipped).length }
    if (body.dryRun) return c.json({ dryRun: true, ...preview })
    if (mismatch && !body.force) fail(409, `${amounts.length} tutar girildi, ${expected} taksit bekleniyordu; yine de uygulamak için force kullan`)

    const now = Date.now()
    const by = userId(c)
    const statements = changes
      .filter((x) => !x.skipped)
      .map((x) => c.env.DB.prepare('UPDATE entries SET planned_amount = ?, overridden = 1, updated_by = ?, updated_at = ? WHERE id = ?').bind(x.amount, by, now, x.id))
    statements.push(auditStatement(c, 'plan', plan.id, 'schedule', null, { startNo, amounts: amounts.length }, now))
    await runBatch(c, statements)
    return c.json({ dryRun: false, ...preview })
  })

  // ---------------------------------------------------------------- kayıtlar
  app.post('/entries', async (c) => {
    const body = await parseBody(c, entryCreate)
    await assertOpen(c, body.month)
    const startDay = await getStartDay(c)
    if (body.dueDate && !isDateInPeriod(body.dueDate, body.month, startDay)) fail(400, `vade tarihi dönemin içinde olmalı (${periodRange(body.month, startDay).start} – ${periodRange(body.month, startDay).end})`)
    const now = Date.now()
    const id = crypto.randomUUID()
    await runBatch(c, [
      insertEntry(
        c,
        {
          id,
          month: body.month,
          planId: null,
          installmentNo: null,
          direction: body.direction,
          name: body.name,
          plannedAmount: body.plannedAmount,
          isEstimate: body.isEstimate ?? false,
          dueDate: body.dueDate ?? null,
          paidAt: null,
          autoPay: body.autoPay ?? false,
          note: body.note ?? null,
        },
        now,
      ),
      auditStatement(c, 'entry', id, 'create', null, body, now),
    ])
    return c.json(await entryDto(c, id), 201)
  })

  app.patch('/entries/:id', async (c) => {
    const entry = await getEntry(c, c.req.param('id'))
    if (entry.type === 'reconciliation') fail(400, 'kapanış farkı kaydı düzenlenemez')
    await assertOpen(c, entry.month)
    const body = await parseBody(c, entryPatch)
    const scope = body.scope ?? 'this'
    if (scope !== 'this' && (body.actualAmount !== undefined || body.isEstimate !== undefined)) fail(400, 'gerçekleşen tutar ve tahmin işareti yalnızca "sadece bu kayıt" kapsamında değişir')
    if (scope !== 'this' && !entry.plan_id) fail(400, 'bu kayıt bir plana bağlı değil')
    const startDay = await getStartDay(c)
    if (body.dueDate && !isDateInPeriod(body.dueDate, entry.month, startDay)) fail(400, `vade tarihi dönemin içinde olmalı (${periodRange(entry.month, startDay).start} – ${periodRange(entry.month, startDay).end})`)

    const now = Date.now()
    const by = userId(c)
    const statements: D1PreparedStatement[] = []
    const planFields: Record<string, unknown> = {}

    // Hedef kayıt
    const sets: string[] = []
    const binds: unknown[] = []
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = ?`)
      binds.push(value)
    }
    if (body.name !== undefined) set('name', body.name)
    if (body.plannedAmount !== undefined) set('planned_amount', body.plannedAmount)
    if (body.actualAmount !== undefined) {
      set('actual_amount', body.actualAmount)
      if (body.actualAmount !== null && body.isEstimate === undefined) set('is_estimate', 0)
    }
    if (body.isEstimate !== undefined) set('is_estimate', Number(body.isEstimate))
    if (body.dueDate !== undefined) set('due_date', body.dueDate)
    if (body.autoPay !== undefined) set('auto_pay', Number(body.autoPay))
    if (body.note !== undefined) set('note', body.note)
    if (!sets.length) fail(400, 'değiştirilecek bir alan verilmedi')

    let affected = 1
    if (scope === 'this') {
      if (entry.plan_id && (body.name !== undefined || body.plannedAmount !== undefined || body.dueDate !== undefined || body.autoPay !== undefined || body.note !== undefined)) set('overridden', 1)
      statements.push(c.env.DB.prepare(`UPDATE entries SET ${sets.join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`).bind(...binds, by, now, entry.id))
    } else {
      if (body.name !== undefined) planFields.name = body.name
      if (body.plannedAmount !== undefined) planFields.amount = body.plannedAmount
      if (body.autoPay !== undefined) planFields.auto_pay = Number(body.autoPay)
      if (body.note !== undefined) planFields.note = body.note
      const newDay = body.dueDate ? Number(body.dueDate.slice(8, 10)) : null
      if (newDay !== null) planFields.day_of_month = newDay

      const { results } = await c.env.DB.prepare('SELECT id, plan_id, month, paid_at, deleted_at FROM entries WHERE plan_id = ?').bind(entry.plan_id).all<{ id: string; plan_id: string; month: string; paid_at: number | null; deleted_at: number | null }>()
      const closed = await closedMonths(c)
      const targets = scopeTargets(
        { id: entry.id, planId: entry.plan_id, month: entry.month, paid: entry.paid_at !== null, deleted: false },
        results.map((r) => ({ id: r.id, planId: r.plan_id, month: r.month, paid: r.paid_at !== null, deleted: r.deleted_at !== null })),
        scope,
        closed,
      )
      affected = targets.length
      const monthOfId = new Map(results.map((r) => [r.id, r.month]))
      for (const id of targets) {
        const own: string[] = []
        const ownBinds: unknown[] = []
        if (body.name !== undefined) (own.push('name = ?'), ownBinds.push(body.name))
        if (body.plannedAmount !== undefined) (own.push('planned_amount = ?'), ownBinds.push(body.plannedAmount))
        if (body.autoPay !== undefined) (own.push('auto_pay = ?'), ownBinds.push(Number(body.autoPay)))
        if (body.note !== undefined) (own.push('note = ?'), ownBinds.push(body.note))
        if (newDay !== null) (own.push('due_date = ?'), ownBinds.push(dueDateInPeriod(monthOfId.get(id) as string, newDay, startDay)))
        own.push('overridden = 0')
        statements.push(c.env.DB.prepare(`UPDATE entries SET ${own.join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`).bind(...ownBinds, by, now, id))
      }
      if (Object.keys(planFields).length) {
        const cols = Object.keys(planFields)
        statements.push(
          c.env.DB.prepare(`UPDATE plans SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`).bind(...cols.map((k) => planFields[k]), by, now, entry.plan_id),
          auditStatement(c, 'plan', entry.plan_id as string, 'update', null, planFields, now),
        )
      }
    }
    statements.push(auditStatement(c, 'entry', entry.id, 'update', pick(entry), { ...body, affected }, now))
    await runBatch(c, statements)
    return c.json({ entry: await entryDto(c, entry.id), affected })
  })

  app.post('/entries/:id/pay', async (c) => {
    const entry = await getEntry(c, c.req.param('id'))
    await assertOpen(c, entry.month)
    const raw = await c.req.json().catch(() => ({}))
    const body = payBody.safeParse(raw)
    if (!body.success) fail(400, 'geçersiz istek')
    const now = Date.now()
    const by = userId(c)
    const actual = body.data.actualAmount
    await runBatch(c, [
      c.env.DB.prepare(
        `UPDATE entries SET paid_at = ?, actual_amount = COALESCE(?, actual_amount), is_estimate = CASE WHEN ? IS NOT NULL THEN 0 ELSE is_estimate END, updated_by = ?, updated_at = ? WHERE id = ?`,
      ).bind(now, actual ?? null, actual ?? null, by, now, entry.id),
      auditStatement(c, 'entry', entry.id, 'pay', { paidAt: entry.paid_at }, { paidAt: now, actualAmount: actual ?? null }, now),
    ])
    return c.json(await entryDto(c, entry.id))
  })

  app.post('/entries/:id/unpay', async (c) => {
    const entry = await getEntry(c, c.req.param('id'))
    await assertOpen(c, entry.month)
    const now = Date.now()
    await runBatch(c, [
      c.env.DB.prepare('UPDATE entries SET paid_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?').bind(userId(c), now, entry.id),
      auditStatement(c, 'entry', entry.id, 'unpay', { paidAt: entry.paid_at }, null, now),
    ])
    return c.json(await entryDto(c, entry.id))
  })

  app.delete('/entries/:id', async (c) => {
    const entry = await getEntry(c, c.req.param('id'))
    if (entry.type === 'reconciliation') fail(400, 'kapanış farkı kaydı silinemez; ayı yeniden açın')
    await assertOpen(c, entry.month)
    const now = Date.now()
    await runBatch(c, [
      c.env.DB.prepare('UPDATE entries SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(now, userId(c), now, entry.id),
      auditStatement(c, 'entry', entry.id, 'delete', pick(entry), null, now),
    ])
    return c.json({ ok: true })
  })

  app.post('/entries/:id/restore', async (c) => {
    const entry = await getEntry(c, c.req.param('id'), true)
    if (entry.deleted_at === null) fail(409, 'kayıt zaten silinmemiş')
    await assertOpen(c, entry.month)
    const now = Date.now()
    await runBatch(c, [
      c.env.DB.prepare('UPDATE entries SET deleted_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?').bind(userId(c), now, entry.id),
      auditStatement(c, 'entry', entry.id, 'restore', null, pick(entry), now),
    ])
    return c.json(await entryDto(c, entry.id))
  })

  // ---------------------------------------------------------------- ayarlar
  app.get('/settings', async (c) => c.json<SettingsDto>({ periodStartDay: await getStartDay(c) }))

  app.put('/settings', async (c) => {
    const body = await parseBody(c, settingsUpdate)
    const before = await getStartDay(c)
    if (body.periodStartDay === before) return c.json<SettingsUpdateResult>({ periodStartDay: before, recalculated: 0, outsidePeriod: await countOutsidePeriod(c, before) })
    // Kapalı dönem varsa geçmişin tutarlılığı için değiştirilemez.
    if ((await closedMonths(c)).size > 0) fail(409, 'kapanmış dönem varken dönem başlangıç günü değiştirilemez')

    const now = Date.now()
    const by = userId(c)
    // Plana bağlı kayıtlar: elle düzenlenmemişler plan gününe göre yeniden hesaplanır; elle düzenlenmişlerde
    // kullanıcının seçtiği gün korunur, yalnızca yeni dönemin dışında kalıyorsa dönemin içine yerleştirilir.
    // Plansız (tek seferlik) kayıtların tarihine dokunulmaz; dışarıda kalanlar `outsidePeriod` ile bildirilir.
    const { results } = await c.env.DB.prepare(
      `SELECT e.id, e.month, e.overridden, e.due_date, p.day_of_month FROM entries e JOIN plans p ON p.id = e.plan_id
        WHERE e.deleted_at IS NULL AND e.type = 'normal'`,
    ).all<{ id: string; month: string; overridden: number; due_date: string | null; day_of_month: number }>()
    const changes: { id: string; dueDate: string }[] = []
    for (const r of results) {
      let next: string | null = null
      if (!r.overridden) next = dueDateInPeriod(r.month, r.day_of_month, body.periodStartDay)
      else if (r.due_date && !isDateInPeriod(r.due_date, r.month, body.periodStartDay)) next = dueDateInPeriod(r.month, Number(r.due_date.slice(8, 10)), body.periodStartDay)
      if (next && next !== r.due_date) changes.push({ id: r.id, dueDate: next })
    }
    const statements = [
      c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('period_start_day', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(body.periodStartDay)),
      ...changes.map((r) => c.env.DB.prepare('UPDATE entries SET due_date = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(r.dueDate, by, now, r.id)),
      auditStatement(c, 'settings', 'period_start_day', 'update', { periodStartDay: before }, { periodStartDay: body.periodStartDay, recalculated: changes.length }, now),
    ]
    await runBatch(c, statements)
    return c.json<SettingsUpdateResult>({ periodStartDay: body.periodStartDay, recalculated: changes.length, outsidePeriod: await countOutsidePeriod(c, body.periodStartDay) })
  })

  /** Vadesi, kaydın kendi döneminin dışında kalan kayıt sayısı (elle girilmiş tarihler). */
  async function countOutsidePeriod(c: Ctx, startDay: number): Promise<number> {
    const { results } = await c.env.DB.prepare('SELECT month, due_date FROM entries WHERE deleted_at IS NULL AND due_date IS NOT NULL').all<{ month: string; due_date: string }>()
    return results.filter((r) => !isDateInPeriod(r.due_date, r.month, startDay)).length
  }

  // ---------------------------------------------------------------- geçmiş
  app.get('/audit', async (c) => {
    const entity = c.req.query('entity')
    const id = c.req.query('id')
    if (!entity || !['plan', 'entry', 'month', 'settings'].includes(entity) || !id) fail(400, 'entity ve id gerekli')
    if (entity === 'month' && !isMonth(id)) fail(400, 'ay geçersiz')
    const { results } = await c.env.DB.prepare(
      `SELECT a.id, a.action, a.before_json, a.after_json, a.at, COALESCE(u.name, a.user_id) AS by
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.at DESC LIMIT 100`,
    )
      .bind(entity, id)
      .all<{ id: string; action: string; before_json: string | null; after_json: string | null; at: number; by: string | null }>()
    return c.json(results.map((r) => ({ id: r.id, action: r.action, at: r.at, by: r.by, before: r.before_json ? JSON.parse(r.before_json) : null, after: r.after_json ? JSON.parse(r.after_json) : null })))
  })

  return app
}

function pick(e: EntryRow) {
  return { name: e.name, plannedAmount: e.planned_amount, actualAmount: e.actual_amount, dueDate: e.due_date, paidAt: e.paid_at, autoPay: !!e.auto_pay, note: e.note, isEstimate: !!e.is_estimate }
}
