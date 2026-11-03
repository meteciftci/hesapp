import { formatMoney } from '../../shared/money'
import { addDays, todayIn } from '../../shared/month'
import type { Env } from '../env'
import { sendPush, type VapidKeys } from './webpush'

export function vapidOf(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || env.SITE_URL || 'mailto:hesapp@example.invalid' }
}

export interface Notice {
  title: string
  body: string
  url: string
}

interface SubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
  user_id: string | null
}

/** Abonelere iletiyi gönderir; geçersizleşen (404/410) abonelikleri siler. Gönderilen sayısını döner. */
export async function broadcast(env: Env, notice: Notice, onlyUser?: string, fetcher: typeof fetch = fetch): Promise<number> {
  const vapid = vapidOf(env)
  if (!vapid) return 0
  const { results } = await env.DB.prepare(`SELECT endpoint, p256dh, auth, user_id FROM push_subscriptions${onlyUser ? ' WHERE user_id = ?' : ''}`)
    .bind(...(onlyUser ? [onlyUser] : []))
    .all<SubscriptionRow>()
  let sent = 0
  const now = Date.now()
  for (const sub of results) {
    let status: number
    try {
      status = await sendPush(sub, notice, vapid, fetcher)
    } catch {
      status = 0
    }
    if (status === 404 || status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run()
    else await env.DB.prepare('UPDATE push_subscriptions SET last_sent_at = ?, last_status = ? WHERE endpoint = ?').bind(now, status, sub.endpoint).run()
    if (status >= 200 && status < 300) sent++
  }
  return sent
}

/** Ertesi gün vadesi gelen, ödenmemiş giderlerin özeti; yoksa null. */
export async function dueTomorrow(env: Env, today = todayIn(env.TZ)): Promise<Notice | null> {
  const tomorrow = addDays(today, 1)
  const { results } = await env.DB.prepare(
    `SELECT name, COALESCE(actual_amount, planned_amount) AS amount, is_estimate FROM entries
      WHERE due_date = ? AND paid_at IS NULL AND deleted_at IS NULL AND direction = 'expense'
        AND month NOT IN (SELECT month FROM months WHERE status = 'closed')
      ORDER BY amount DESC, name`,
  )
    .bind(tomorrow)
    .all<{ name: string; amount: number; is_estimate: number }>()
  if (!results.length) return null
  const total = results.reduce((sum, r) => sum + r.amount, 0)
  const shown = results.slice(0, 3).map((r) => `${r.name} ${formatMoney(r.amount)} ₺${r.is_estimate ? ' (tahmini)' : ''}`)
  const more = results.length > 3 ? ` ve ${results.length - 3} ödeme daha` : ''
  return {
    title: results.length === 1 ? 'Yarın 1 ödeme var' : `Yarın ${results.length} ödeme var · ${formatMoney(total)} ₺`,
    body: shown.join(', ') + more,
    url: '/yaklasan',
  }
}

/** Zamanlanmış görev: her gün 09:00 (İstanbul) ertesi günün ödemelerini bildirir. */
export async function sendDueReminders(env: Env, fetcher: typeof fetch = fetch): Promise<number> {
  if (!vapidOf(env)) return 0
  const notice = await dueTomorrow(env)
  return notice ? broadcast(env, notice, undefined, fetcher) : 0
}
