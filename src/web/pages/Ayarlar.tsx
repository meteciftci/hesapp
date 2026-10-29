import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { MemberInfo, PasskeyInfo } from '../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { registerPasskey, suggestDeviceName } from '../passkey'
import { Button, Card, Field, Notice, Page } from '../ui'

const date = (ms: number) => new Date(ms).toLocaleDateString('tr-TR')

export function Ayarlar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [keys, setKeys] = useState<PasskeyInfo[]>([])
  const [members, setMembers] = useState<MemberInfo[]>([])
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [inviteName, setInviteName] = useState('')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isOwner = user?.role === 'owner'

  const load = useCallback(async () => {
    const [k, m] = await Promise.all([api<PasskeyInfo[]>('/auth/passkeys'), api<MemberInfo[]>('/auth/members')])
    setKeys(k)
    setMembers(m)
  }, [])

  useEffect(() => {
    load().catch((e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  }, [load])

  async function act(action: () => Promise<void>, done?: string) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      await load()
      if (done) setMessage({ kind: 'info', text: done })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  async function createInvite() {
    const { token } = await api<{ token: string }>('/auth/invites', { body: { name: inviteName } })
    setInviteLink(`${window.location.origin}/davet#${token}`)
    setInviteName('')
  }

  async function share(link: string) {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: 'hesapp daveti', url: link }).catch(() => undefined)
    } else {
      await navigator.clipboard.writeText(link)
      setMessage({ kind: 'info', text: 'Bağlantı kopyalandı.' })
    }
  }

  return (
    <Page>
      <header className="flex items-center justify-between pt-4">
        <h1 className="text-2xl font-semibold">Ayarlar</h1>
        <Link to="/" className="min-h-11 content-center rounded-lg px-3 text-sm underline">Geri</Link>
      </header>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      <Card>
        <h2 className="font-semibold">Cihazlarım</h2>
        <ul className="flex flex-col gap-2">
          {keys.map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate">{key.name}{key.current && <span className="ml-2 text-xs opacity-60">(bu cihaz)</span>}</p>
                <p className="text-xs opacity-60">Eklendi {date(key.created_at)}{key.last_used_at ? ` · son kullanım ${date(key.last_used_at)}` : ''}</p>
              </div>
              {!key.current && keys.length > 1 && (
                <Button variant="danger" className="min-h-11" disabled={busy} onClick={() => void act(() => api(`/auth/passkeys/${key.id}`, { method: 'DELETE' }), 'Cihaz silindi.')}>
                  Sil
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Button variant="secondary" disabled={busy} onClick={() => void act(() => registerPasskey({ kind: 'device', keyName: suggestDeviceName() }), 'Cihaz eklendi.')}>
          Bu cihazı ekle
        </Button>
        <p className="text-xs opacity-60">Güvenlik için, cihaz eklemek ya da silmek son 10 dakika içinde giriş yapmış olmayı gerektirir.</p>
      </Card>

      <Card>
        <h2 className="font-semibold">Kişiler</h2>
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2">
              <span>{m.name} <span className="text-xs opacity-60">· {m.role === 'owner' ? 'sahip' : 'üye'} · {m.passkeys} cihaz</span></span>
              {isOwner && m.role !== 'owner' && (
                <Button variant="danger" className="min-h-11" disabled={busy} onClick={() => void act(() => api(`/auth/members/${m.id}`, { method: 'DELETE' }), 'Kişi çıkarıldı.')}>
                  Çıkar
                </Button>
              )}
            </li>
          ))}
        </ul>
        {isOwner && (
          <div className="flex flex-col gap-2 border-t border-black/10 pt-3 dark:border-white/10">
            <Field label="Yeni kişi davet et" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Kişinin adı" maxLength={40} />
            <Button variant="secondary" disabled={busy || !inviteName.trim()} onClick={() => void act(createInvite)}>Davet bağlantısı oluştur</Button>
            {inviteLink && (
              <div className="flex flex-col gap-2">
                <Notice kind="info">Bağlantı 24 saat geçerli ve tek kullanımlık. Yalnızca davet ettiğin kişiyle paylaş.</Notice>
                <input readOnly value={inviteLink} aria-label="Davet bağlantısı" className="min-h-12 rounded-xl border border-black/15 bg-transparent px-3 text-sm dark:border-white/20" onFocus={(e) => e.currentTarget.select()} />
                <Button onClick={() => void share(inviteLink)}>Paylaş / kopyala</Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <Button variant="secondary" disabled={busy} onClick={() => void logout().then(() => navigate('/giris', { replace: true }))}>
        Çıkış yap
      </Button>
    </Page>
  )
}
