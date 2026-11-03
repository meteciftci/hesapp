import { useEffect, useState } from 'react'
import { api, errorMessage } from './api'
import { Button, Card, Notice } from './ui'

type State = 'loading' | 'unsupported' | 'no-key' | 'denied' | 'off' | 'on'

function urlBase64ToUint8Array(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent)

/** Ayarlar: bu cihazda vade bildirimlerini aç/kapat (plan, bölüm 14.7). */
export function NotificationsCard() {
  const [state, setState] = useState<State>('loading')
  const [key, setKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  useEffect(() => {
    void (async () => {
      if (!supported()) return setState('unsupported')
      const { publicKey } = await api<{ publicKey: string | null }>('/push/key').catch(() => ({ publicKey: null }))
      if (!publicKey) return setState('no-key')
      setKey(publicKey)
      if (Notification.permission === 'denied') return setState('denied')
      const reg = await navigator.serviceWorker.ready
      setState((await reg.pushManager.getSubscription()) ? 'on' : 'off')
    })()
  }, [])

  async function run(action: () => Promise<string | void>) {
    setBusy(true)
    setMessage(null)
    try {
      const text = await action()
      if (text) setMessage({ kind: 'info', text })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const enable = () =>
    run(async () => {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key as string) }))
      await api('/push/subscribe', { body: sub.toJSON() })
      setState('on')
      return 'Bildirimler bu cihazda açıldı.'
    })

  const disable = () =>
    run(async () => {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } })
        await sub.unsubscribe()
      }
      setState('off')
      return 'Bildirimler bu cihazda kapatıldı.'
    })

  const test = () => run(async () => (await api('/push/test', { body: {} }), 'Deneme bildirimi gönderildi.'))

  return (
    <Card>
      <h2 className="text-[15px]">Vade bildirimi</h2>
      <p className="text-xs text-muted">Vadesi ertesi gün olan ödemeler her sabah 09:00’da bu cihaza bildirilir. Her cihazda ayrı açılır.</p>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {state === 'loading' && <p className="text-sm text-muted">Denetleniyor…</p>}
      {state === 'unsupported' && (
        <p className="text-sm text-muted">{isIos() ? 'iPhone ve iPad’de bildirim için önce uygulamayı Paylaş → Ana Ekrana Ekle ile ekleyip oradan açın.' : 'Bu tarayıcı bildirimleri desteklemiyor.'}</p>
      )}
      {state === 'no-key' && <p className="text-sm text-muted">Sunucuda bildirim anahtarı tanımlı değil. Kurulum için README’deki “Vade bildirimi” bölümüne bakın.</p>}
      {state === 'denied' && <p className="text-sm text-muted">Bu site için bildirim izni kapalı. Tarayıcının site ayarlarından izin verip sayfayı yenileyin.</p>}
      {state === 'off' && <Button disabled={busy} onClick={() => void enable()}>Bildirimleri aç</Button>}
      {state === 'on' && (
        <div className="flex gap-2">
          <Button variant="secondary" className="grow" disabled={busy} onClick={() => void test()}>Deneme gönder</Button>
          <Button variant="secondary" className="grow" disabled={busy} onClick={() => void disable()}>Kapat</Button>
        </div>
      )}
    </Card>
  )
}
