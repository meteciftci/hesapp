import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { MemberInfo, PasskeyInfo } from '../../shared/api'
import { api, ApiError, errorMessage } from '../api'
import { useAuth } from '../auth'
import { registerPasskey, suggestDeviceName } from '../passkey'
import { getTheme, setTheme, type Theme } from '../theme'
import { useConfirm } from '../confirm'
import { ExcelImportSheet } from '../data/ExcelImport'
import { downloadBackup, downloadExcel, restoreBackup, wipeData } from '../data/files'
import { NotificationsCard } from '../notifications'
import { SetupSheet } from '../month/SetupSheet'
import { useSettings } from '../month/queries'
import { BottomNav, Button, Card, Field, Group, Icon, Notice, Page, PageHeader, SectionLabel, Segmented } from '../ui'

const date = (ms: number) => new Date(ms).toLocaleDateString('tr-TR')

export function Ayarlar() {
  const { user, logout } = useAuth()
  const confirm = useConfirm()
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
      await navigator.share({ title: 'HesApp daveti', url: link }).catch(() => undefined)
    } else {
      await navigator.clipboard.writeText(link)
      setMessage({ kind: 'info', text: 'Bağlantı kopyalandı.' })
    }
  }

  return (
    <Page>
      <PageHeader title="Ayarlar" />
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      <SectionLabel>Görünüm</SectionLabel>
      <ThemeCard />

      <SectionLabel>Bütçe</SectionLabel>
      <BudgetCard />
      <NotificationsCard />

      <SectionLabel>Veri</SectionLabel>
      <DataCard />

      <Group>
        <li className="border-b border-line">
          <Link to="/kategoriler" className="flex min-h-15 items-center justify-between px-3.5 py-2.5">
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-medium">Kategoriler</span>
              <span className="text-xs text-muted">Ekle, adını değiştir, sil</span>
            </span>
            <Icon name="ileri" size={18} />
          </Link>
        </li>
        <li>
          <Link to="/gecmis" className="flex min-h-15 items-center justify-between px-3.5 py-2.5">
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-medium">Değişiklik geçmişi</span>
              <span className="text-xs text-muted">Kim, neyi, ne zaman değiştirdi</span>
            </span>
            <Icon name="ileri" size={18} />
          </Link>
        </li>
      </Group>

      <SectionLabel>Hesap</SectionLabel>
      <Card>
        <h2 className="font-semibold">Cihazlarım</h2>
        <ul className="flex flex-col gap-2">
          {keys.map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate">{key.name}{key.current && <span className="ml-2 text-xs text-muted">(bu cihaz)</span>}</p>
                <p className="text-xs text-muted">Eklendi {date(key.created_at)}{key.last_used_at ? ` · son kullanım ${date(key.last_used_at)}` : ''}</p>
              </div>
              {!key.current && keys.length > 1 && (
                <Button variant="danger" className="min-h-11" disabled={busy} onClick={() => void confirm({ title: 'Cihaz silinsin mi?', message: `“${key.name}” bu hesaba bir daha giriş yapamaz. Gerekirse yeniden eklenebilir.`, confirmLabel: 'Cihazı sil', destructive: true }).then((ok) => { if (ok) void act(() => api(`/auth/passkeys/${key.id}`, { method: 'DELETE' }), 'Cihaz silindi.') })}>
                  Sil
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Button variant="secondary" disabled={busy} onClick={() => void act(() => registerPasskey({ kind: 'device', keyName: suggestDeviceName() }), 'Cihaz eklendi.')}>
          Bu cihazı ekle
        </Button>
        <p className="text-xs text-muted">Güvenlik için, cihaz eklemek ya da silmek son 10 dakika içinde giriş yapmış olmayı gerektirir.</p>
      </Card>

      <Card>
        <h2 className="font-semibold">Kişiler</h2>
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2">
              <span>{m.name} <span className="text-xs text-muted">· {m.role === 'owner' ? 'sahip' : 'üye'} · {m.passkeys} cihaz</span></span>
              {isOwner && m.role !== 'owner' && (
                <Button variant="danger" className="min-h-11" disabled={busy} onClick={() => void confirm({ title: `${m.name} çıkarılsın mı?`, message: 'Kişinin tüm cihazları silinir ve oturumu kapanır. Eklediği kayıtlar kalır. Yeniden davet edilebilir.', confirmLabel: 'Çıkar', destructive: true }).then((ok) => { if (ok) void act(() => api(`/auth/members/${m.id}`, { method: 'DELETE' }), 'Kişi çıkarıldı.') })}>
                  Çıkar
                </Button>
              )}
            </li>
          ))}
        </ul>
        {isOwner && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <Field label="Yeni kişi davet et" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Kişinin adı" maxLength={40} />
            <Button variant="secondary" disabled={busy || !inviteName.trim()} onClick={() => void act(createInvite)}>Davet bağlantısı oluştur</Button>
            {inviteLink && (
              <div className="flex flex-col gap-2">
                <Notice kind="info">Bağlantı 24 saat geçerli ve tek kullanımlık. Yalnızca davet ettiğin kişiyle paylaş.</Notice>
                <input readOnly value={inviteLink} aria-label="Davet bağlantısı" className="min-h-12 rounded-xl border border-edge bg-transparent px-3 text-sm" onFocus={(e) => e.currentTarget.select()} />
                <Button onClick={() => void share(inviteLink)}>Paylaş / kopyala</Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <p className="text-center text-xs text-muted">Açık kaynak · v{__APP_VERSION__}</p>
      <Button variant="secondary" disabled={busy} onClick={() => void logout().then(() => navigate('/giris', { replace: true }))}>
        Çıkış yap
      </Button>
      <BottomNav />
    </Page>
  )
}

function ThemeCard() {
  const [theme, setCurrent] = useState<Theme>(getTheme)
  return (
    <Card>
      <h2 className="text-[15px]">Tema</h2>
      <Segmented
        label="Tema"
        value={theme}
        onChange={(value) => { setTheme(value); setCurrent(value) }}
        options={[{ value: 'system', label: 'Sistem' }, { value: 'light', label: 'Açık' }, { value: 'dark', label: 'Koyu' }]}
      />
    </Card>
  )
}

function BudgetCard() {
  const day = useSettings().data?.periodStartDay
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <p className="text-[15px]">Dönem başlangıç günü: <strong>{day ?? '…'}</strong></p>
      <p className="text-xs text-muted">Bütçe dönemi her ayın bu gününde başlar. Başlangıç bakiyesi de buradan girilir.</p>
      <Button variant="secondary" onClick={() => setOpen(true)}>Başlangıç ayarlarını düzenle</Button>
      {open && <SetupSheet onClose={() => setOpen(false)} />}
    </Card>
  )
}

function DataCard() {
  const client = useQueryClient()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  async function run(action: () => Promise<string | void>) {
    setBusy(true)
    setMessage(null)
    try {
      const done = await action()
      if (done) setMessage({ kind: 'info', text: done })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  async function restore(file: File | undefined) {
    if (!file) return
    await run(async () => {
      let result
      try {
        result = await restoreBackup(file)
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 409 || !e.message.includes('zaten var')) throw e
        const ok = await confirm({ title: 'Mevcut veri silinsin mi?', message: 'Uygulamada zaten bütçe verisi var. Mevcut tüm planlar, kayıtlar ve aylar silinip bu yedekle değiştirilecek. Bu işlem geri alınamaz.', confirmLabel: 'Sil ve yükle', destructive: true })
        if (!ok) return
        result = await restoreBackup(file, true)
      }
      await client.invalidateQueries()
      return `Geri yüklendi: ${result.plans} plan, ${result.entries} kayıt, ${result.months} ay.`
    })
  }

  async function wipe() {
    const ok = await confirm({
      title: 'Tüm veriler silinsin mi?',
      message: 'Tüm planlar, kayıtlar, aylar ve değişiklik geçmişi kalıcı olarak silinir. Kişiler ve cihazlar kalır. Önce tam yedek indirmeniz önerilir. Bu işlem geri alınamaz.',
      confirmLabel: 'Tümünü sil',
      destructive: true,
      requireText: 'SİL',
    })
    if (!ok) return
    await run(async () => {
      const result = await wipeData()
      await client.invalidateQueries()
      return `Silindi: ${result.plans} plan, ${result.entries} kayıt, ${result.months} ay.`
    })
  }

  const rows = [
    { title: 'Tam yedek indir (JSON)', sub: 'Tüm planlar, kayıtlar ve geçmiş. Geri yüklenebilir.', action: () => run(async () => { await downloadBackup() }) },
    { title: 'Excel olarak indir (.xlsx)', sub: 'Her ay bir sayfa, ayrıca planlar sayfası', action: () => run(async () => { await downloadExcel() }) },
    { title: 'Yedekten geri yükle', sub: 'JSON yedeğini boş bir kuruluma aktar', action: () => fileInput.current?.click() },
    { title: 'Excel’den içe aktar', sub: 'Bütçe dosyası ya da bankanın kredi ödeme planı', action: () => setImporting(true) },
    { title: 'Tüm verileri sil', sub: 'Planlar, kayıtlar ve aylar silinir; kişiler kalır', action: () => void wipe(), danger: true },
  ]
  return (
    <>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <Group>
        {rows.map((r) => (
          <li key={r.title} className="border-b border-line">
            <button type="button" disabled={busy} onClick={r.action} className="flex min-h-15 w-full flex-col items-start gap-0.5 px-3.5 py-2.5 text-left disabled:opacity-60">
              <span className={`text-[15px] font-medium ${r.danger ? 'text-bad' : ''}`}>{r.title}</span>
              <span className="text-xs text-muted">{r.sub}</span>
            </button>
          </li>
        ))}
      </Group>
      {importing && <ExcelImportSheet onClose={(m) => { setImporting(false); if (m) setMessage({ kind: 'info', text: m }) }} />}
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = '' }} />
    </>
  )
}
