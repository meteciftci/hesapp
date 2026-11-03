import type { Hono } from 'hono'
import type { CategoryDto, SearchDto } from '../../shared/api'
import { isMonth } from '../../shared/month'
import type { AppBindings } from '../env'
import { fail, parseBody } from './http'
import { auditStatement, ENTRY_SELECT, runBatch, toEntryDto } from './repo'
import { categoryCreate, categoryPatch } from './schemas'

const LIMIT = 200

/** Kategoriler ve arama (plan, bölüm 14.4). */
export function registerCategories(app: Hono<AppBindings>) {
  app.get('/categories', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT id, name, direction, sort FROM categories WHERE deleted_at IS NULL ORDER BY sort, name').all<CategoryDto>()
    return c.json(results)
  })

  app.post('/categories', async (c) => {
    const body = await parseBody(c, categoryCreate)
    const dup = await c.env.DB.prepare('SELECT id FROM categories WHERE deleted_at IS NULL AND lower(name) = lower(?)').bind(body.name).first()
    if (dup) fail(409, 'bu adla bir kategori zaten var')
    const max = await c.env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM categories').first<{ m: number }>()
    const id = crypto.randomUUID()
    const now = Date.now()
    await runBatch(c, [
      c.env.DB.prepare('INSERT INTO categories (id, name, direction, sort, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, body.name, body.direction ?? 'both', (max?.m ?? 0) + 10, now),
      auditStatement(c, 'settings', `category:${id}`, 'category_add', null, body, now),
    ])
    return c.json<CategoryDto>({ id, name: body.name, direction: body.direction ?? 'both', sort: (max?.m ?? 0) + 10 }, 201)
  })

  app.patch('/categories/:id', async (c) => {
    const id = c.req.param('id')
    const row = await c.env.DB.prepare('SELECT id, name, direction, sort FROM categories WHERE id = ? AND deleted_at IS NULL').bind(id).first<CategoryDto>()
    if (!row) fail(404, 'kategori bulunamadı')
    const body = await parseBody(c, categoryPatch)
    if (body.name && body.name.toLocaleLowerCase('tr') !== row.name.toLocaleLowerCase('tr')) {
      const dup = await c.env.DB.prepare('SELECT id FROM categories WHERE deleted_at IS NULL AND lower(name) = lower(?) AND id <> ?').bind(body.name, id).first()
      if (dup) fail(409, 'bu adla bir kategori zaten var')
    }
    const next = { name: body.name ?? row.name, direction: body.direction ?? row.direction, sort: body.sort ?? row.sort }
    await runBatch(c, [
      c.env.DB.prepare('UPDATE categories SET name = ?, direction = ?, sort = ? WHERE id = ?').bind(next.name, next.direction, next.sort, id),
      auditStatement(c, 'settings', `category:${id}`, 'category_update', row, next, Date.now()),
    ])
    return c.json<CategoryDto>({ id, ...next })
  })

  app.delete('/categories/:id', async (c) => {
    const id = c.req.param('id')
    const row = await c.env.DB.prepare('SELECT id, name FROM categories WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ id: string; name: string }>()
    if (!row) fail(404, 'kategori bulunamadı')
    const now = Date.now()
    await runBatch(c, [
      c.env.DB.prepare('UPDATE categories SET deleted_at = ? WHERE id = ?').bind(now, id),
      c.env.DB.prepare('UPDATE entries SET category_id = NULL WHERE category_id = ?').bind(id),
      c.env.DB.prepare('UPDATE plans SET category_id = NULL WHERE category_id = ?').bind(id),
      auditStatement(c, 'settings', `category:${id}`, 'category_delete', { name: row.name }, null, now),
    ])
    return c.json({ ok: true })
  })

  /**
   * Arama: ad ya da notta geçen metin (büyük/küçük harf duyarsız), isteğe bağlı kategori
   * (`none`: kategorisiz) ve dönem aralığı. En çok 200 kayıt döner; toplamlar tüm eşleşmeler içindir.
   */
  app.get('/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 80)
    const category = c.req.query('category') ?? ''
    const from = c.req.query('from') ?? ''
    const to = c.req.query('to') ?? ''
    if ((from && !isMonth(from)) || (to && !isMonth(to))) fail(400, 'dönem YYYY-AA biçiminde olmalı')
    if (!q && !category) fail(400, 'aranacak metin ya da kategori gerekli')

    const where = ['e.deleted_at IS NULL']
    const binds: unknown[] = []
    if (q) {
      // SQLite'ın lower() işlevi Türkçe büyük harfleri küçültmez; her iki taraf da önceden küçültülür.
      const needle = `%${q.toLocaleLowerCase('tr').replace(/[%_\\]/g, (m) => `\\${m}`)}%`
      where.push(`(${TR_LOWER('e.name')} LIKE ? ESCAPE '\\' OR ${TR_LOWER("COALESCE(e.note, '')")} LIKE ? ESCAPE '\\')`)
      binds.push(needle, needle)
    }
    if (category === 'none') where.push('(e.category_id IS NULL OR e.category_id NOT IN (SELECT id FROM categories WHERE deleted_at IS NULL))')
    else if (category) (where.push('e.category_id = ?'), binds.push(category))
    if (from) (where.push('e.month >= ?'), binds.push(from))
    if (to) (where.push('e.month <= ?'), binds.push(to))
    const clause = where.join(' AND ')

    const [rows, totals] = await Promise.all([
      c.env.DB.prepare(`${ENTRY_SELECT} WHERE ${clause} ORDER BY e.month DESC, (e.due_date IS NULL), e.due_date DESC, e.name LIMIT ${LIMIT + 1}`)
        .bind(...binds)
        .all<Parameters<typeof toEntryDto>[0]>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN e.direction = 'income' THEN COALESCE(e.actual_amount, e.planned_amount) END), 0) AS income,
                COALESCE(SUM(CASE WHEN e.direction = 'expense' THEN COALESCE(e.actual_amount, e.planned_amount) END), 0) AS expense
           FROM entries e WHERE ${clause}`,
      )
        .bind(...binds)
        .first<{ count: number; income: number; expense: number }>(),
    ])
    const body: SearchDto = {
      entries: rows.results.slice(0, LIMIT).map(toEntryDto),
      truncated: rows.results.length > LIMIT,
      totals: { income: totals?.income ?? 0, expense: totals?.expense ?? 0, count: totals?.count ?? 0 },
    }
    return c.json(body)
  })
}

/** Türkçe büyük harfleri (İ, I, Ş, Ğ, Ü, Ö, Ç) küçültüp ardından lower() uygulayan SQL ifadesi. */
function TR_LOWER(expr: string): string {
  const pairs: [string, string][] = [['İ', 'i'], ['I', 'ı'], ['Ş', 'ş'], ['Ğ', 'ğ'], ['Ü', 'ü'], ['Ö', 'ö'], ['Ç', 'ç']]
  return pairs.reduce((acc, [from, to]) => `replace(${acc}, '${from}', '${to}')`, expr).replace(/^/, 'lower(') + ')'
}
