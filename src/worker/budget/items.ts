import type { Hono } from 'hono'
import type { EntryDto, EntryItemDto } from '../../shared/api'
import type { AppBindings } from '../env'
import { type Ctx, fail, parseBody } from './http'
import { assertOpen, auditStatement, ENTRY_SELECT, type EntryRow, runBatch, toEntryDto, userId } from './repo'
import { itemCreate, itemPatch } from './schemas'

interface ItemRow {
  id: string
  entry_id: string
  name: string
  amount: number
  date: string | null
  installment_no: number | null
  installment_count: number | null
  created_by: string | null
  created_name: string | null
  created_at: number
  updated_at: number
}

const toItemDto = (r: ItemRow): EntryItemDto => ({
  id: r.id,
  name: r.name,
  amount: r.amount,
  date: r.date,
  installmentNo: r.installment_no,
  installmentCount: r.installment_count,
  createdBy: r.created_name ?? r.created_by,
})

async function loadEntry(c: Ctx, id: string): Promise<EntryRow> {
  const row = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL').bind(id).first<EntryRow>()
  if (!row) fail(404, 'kayıt bulunamadı')
  return row
}

async function listItems(c: Ctx, entryId: string): Promise<EntryItemDto[]> {
  const { results } = await c.env.DB.prepare(
    `SELECT i.*, u.name AS created_name FROM entry_items i LEFT JOIN users u ON u.id = i.created_by WHERE i.entry_id = ? ORDER BY COALESCE(i.date, '9999'), i.created_at`,
  )
    .bind(entryId)
    .all<ItemRow>()
  return results.map(toItemDto)
}

async function respond(c: Ctx, entryId: string) {
  const entry = await c.env.DB.prepare(`${ENTRY_SELECT} WHERE e.id = ?`).bind(entryId).first<Parameters<typeof toEntryDto>[0]>()
  const body: { entry: EntryDto; items: EntryItemDto[] } = { entry: toEntryDto(entry!), items: await listItems(c, entryId) }
  return body
}

/**
 * Gerçekleşen tutar boşken kalemlerin toplamı tahmini (planlanan) tutarı aşarsa planlanan tutar
 * kalem toplamına yükseltilir: tahmin hiçbir zaman girilen kalemlerin altında kalmaz.
 */
function raiseEstimate(c: Ctx, entry: EntryRow, now: number): D1PreparedStatement {
  return c.env.DB.prepare(
    `UPDATE entries SET planned_amount = t.total, overridden = CASE WHEN plan_id IS NULL THEN overridden ELSE 1 END, updated_by = ?, updated_at = ?
       FROM (SELECT COALESCE(SUM(amount), 0) AS total FROM entry_items WHERE entry_id = ?) AS t
      WHERE entries.id = ? AND entries.actual_amount IS NULL AND t.total > entries.planned_amount`,
  ).bind(userId(c), now, entry.id, entry.id)
}

async function editable(c: Ctx, entryId: string): Promise<EntryRow> {
  const entry = await loadEntry(c, entryId)
  if (entry.direction !== 'expense' || entry.type !== 'normal') fail(400, 'kalem yalnızca giderlere eklenir')
  await assertOpen(c, entry.month)
  return entry
}

/** Gider kalemleri (kart ekstresi dökümü): plan, bölüm 14.2. */
export function registerItems(app: Hono<AppBindings>) {
  app.get('/entries/:id/items', async (c) => {
    await loadEntry(c, c.req.param('id'))
    return c.json(await respond(c, c.req.param('id')))
  })

  app.post('/entries/:id/items', async (c) => {
    const entry = await editable(c, c.req.param('id'))
    const body = await parseBody(c, itemCreate)
    const now = Date.now()
    const id = crypto.randomUUID()
    await runBatch(c, [
      c.env.DB.prepare(
        'INSERT INTO entry_items (id, entry_id, name, amount, date, installment_no, installment_count, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, entry.id, body.name, body.amount, body.date ?? null, body.installmentNo ?? null, body.installmentCount ?? null, userId(c), now, now),
      raiseEstimate(c, entry, now),
      auditStatement(c, 'entry', entry.id, 'item_add', null, { item: id, name: body.name, amount: body.amount }, now),
    ])
    return c.json(await respond(c, entry.id), 201)
  })

  app.patch('/entries/:id/items/:itemId', async (c) => {
    const entry = await editable(c, c.req.param('id'))
    const item = await c.env.DB.prepare('SELECT * FROM entry_items WHERE id = ? AND entry_id = ?').bind(c.req.param('itemId'), entry.id).first<ItemRow>()
    if (!item) fail(404, 'kalem bulunamadı')
    const body = await parseBody(c, itemPatch)
    const next = {
      name: body.name ?? item.name,
      amount: body.amount ?? item.amount,
      date: body.date === undefined ? item.date : body.date,
      installmentNo: body.installmentNo === undefined ? item.installment_no : body.installmentNo,
      installmentCount: body.installmentCount === undefined ? item.installment_count : body.installmentCount,
    }
    if ((next.installmentNo === null) !== (next.installmentCount === null)) fail(400, 'taksit için sıra ve sayı birlikte girilmeli')
    if (next.installmentNo !== null && next.installmentCount !== null && next.installmentNo > next.installmentCount) fail(400, 'taksit sırası taksit sayısından büyük olamaz')
    const now = Date.now()
    await runBatch(c, [
      c.env.DB.prepare('UPDATE entry_items SET name = ?, amount = ?, date = ?, installment_no = ?, installment_count = ?, updated_at = ? WHERE id = ?').bind(
        next.name,
        next.amount,
        next.date,
        next.installmentNo,
        next.installmentCount,
        now,
        item.id,
      ),
      raiseEstimate(c, entry, now),
      auditStatement(c, 'entry', entry.id, 'item_update', { item: item.id, name: item.name, amount: item.amount }, { item: item.id, name: next.name, amount: next.amount }, now),
    ])
    return c.json(await respond(c, entry.id))
  })

  app.delete('/entries/:id/items/:itemId', async (c) => {
    const entry = await editable(c, c.req.param('id'))
    const item = await c.env.DB.prepare('SELECT * FROM entry_items WHERE id = ? AND entry_id = ?').bind(c.req.param('itemId'), entry.id).first<ItemRow>()
    if (!item) fail(404, 'kalem bulunamadı')
    const now = Date.now()
    await runBatch(c, [
      c.env.DB.prepare('DELETE FROM entry_items WHERE id = ?').bind(item.id),
      auditStatement(c, 'entry', entry.id, 'item_delete', { item: item.id, name: item.name, amount: item.amount }, null, now),
    ])
    return c.json(await respond(c, entry.id))
  })
}
