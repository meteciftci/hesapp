import { Hono } from 'hono'
import type { MeResponse } from '../shared/api'
import { accessAuth, type KeyResolver, remoteKeyResolver } from './auth'
import type { AppBindings } from './env'

export function createApp(keyResolver: KeyResolver = remoteKeyResolver) {
  const app = new Hono<AppBindings>().basePath('/api')

  app.get('/health', (c) => c.json({ ok: true }))

  app.use('*', accessAuth(keyResolver))

  app.get('/me', (c) => c.json<MeResponse>({ email: c.get('user').email }))

  app.notFound((c) => c.json({ error: 'bulunamadı' }, 404))
  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'sunucu hatası' }, 500)
  })

  return app
}
