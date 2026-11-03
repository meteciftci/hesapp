import { Hono } from 'hono'
import { z } from 'zod'
import type { AppBindings } from '../env'
import { fail, parseBody } from '../budget/http'
import { broadcast, vapidOf } from './reminders'
import { isPushEndpoint } from './webpush'

const subscription = z
  .object({
    endpoint: z.string().max(2000).refine(isPushEndpoint, 'desteklenmeyen bildirim hizmeti'),
    keys: z.object({ p256dh: z.string().min(80).max(200), auth: z.string().min(16).max(64) }),
  })
  .passthrough()

/** Vade bildirimi abonelikleri (plan, bölüm 14.7). */
export function createPushRoutes() {
  const app = new Hono<AppBindings>()

  app.get('/key', (c) => c.json({ publicKey: vapidOf(c.env)?.publicKey ?? null }))

  app.post('/subscribe', async (c) => {
    if (!vapidOf(c.env)) fail(409, 'sunucuda bildirim anahtarı tanımlı değil')
    const body = await parseBody(c, subscription)
    await c.env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    )
      .bind(body.endpoint, c.get('user').id, body.keys.p256dh, body.keys.auth, Date.now())
      .run()
    return c.json({ ok: true })
  })

  app.post('/unsubscribe', async (c) => {
    const body = await parseBody(c, z.object({ endpoint: z.string().max(2000) }).strict())
    await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(body.endpoint).run()
    return c.json({ ok: true })
  })

  /** Kendi cihazlarına deneme bildirimi. */
  app.post('/test', async (c) => {
    if (!vapidOf(c.env)) fail(409, 'sunucuda bildirim anahtarı tanımlı değil')
    const sent = await broadcast(c.env, { title: 'HesApp bildirimleri açık', body: 'Vadesi yarın olan ödemeler her sabah 09:00’da bildirilecek.', url: '/yaklasan' }, c.get('user').id)
    if (!sent) fail(409, 'deneme bildirimi gönderilemedi; bildirimleri bu cihazda yeniden açmayı deneyin')
    return c.json({ sent })
  })

  return app
}
