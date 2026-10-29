import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { MeResponse } from '../shared/api'
import { accessUser, type KeyResolver, remoteKeyResolver } from './auth/access'
import { createAuthRoutes } from './auth/passkey'
import { getSession, sameOrigin } from './auth/session'
import { type AppBindings, authMode } from './env'

export function createApp(keyResolver: KeyResolver = remoteKeyResolver) {
  const app = new Hono<AppBindings>().basePath('/api')

  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  app.get('/health', (c) => c.json({ ok: true }))

  app.use('*', sameOrigin)

  // Kimlik doğrulama uçları: Access modunda yalnızca durum bilgisi döner.
  app.use('/auth/*', async (c, next) => {
    if (authMode(c.env) === 'access') {
      if (c.req.method === 'GET' && c.req.path === '/api/auth/state') return c.json({ mode: 'access' as const, hasUsers: true })
      return c.json({ error: 'bulunamadı' }, 404)
    }
    await next()
  })
  app.route('/auth', createAuthRoutes())

  // Buradan sonraki her şey oturum ister.
  app.use(
    '*',
    createMiddleware<AppBindings>(async (c, next) => {
      if (authMode(c.env) === 'access') {
        const result = await accessUser(c.env, c.req.raw.headers, keyResolver)
        if (!result.ok) return c.json({ error: result.message }, result.status)
        c.set('user', result.user)
      } else {
        const session = await getSession(c)
        if (!session) return c.json({ error: 'oturum gerekli' }, 401)
        c.set('user', { id: session.userId, name: session.name, role: session.role })
        c.set('session', { tokenHash: session.tokenHash, credentialId: session.credentialId, createdAt: session.createdAt })
      }
      await next()
    }),
  )

  app.get('/me', (c) => c.json<MeResponse>(c.get('user')))

  app.notFound((c) => c.json({ error: 'bulunamadı' }, 404))
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: 'sunucu hatası' }, 500)
  })

  return app
}
