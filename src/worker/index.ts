import { createApp } from './app'
import type { Env } from './env'
import { sendDueReminders } from './push/reminders'

const app = createApp()

export default {
  fetch: app.fetch,
  /** Günlük zamanlanmış görev (wrangler.jsonc → triggers): ertesi günün ödemelerini bildirir. */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDueReminders(env))
  },
} satisfies ExportedHandler<Env>
