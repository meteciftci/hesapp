import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useAuth } from '../auth'
import { errorMessage } from '../api'
import { passkeysSupported, registerPasskey, suggestDeviceName } from '../passkey'
import { Button, Card, Field, Notice, Page } from '../ui'

export function Davet() {
  const { status, user, refresh } = useAuth()
  const navigate = useNavigate()
  const [keyName, setKeyName] = useState(suggestDeviceName())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Belirteç adres parçasında (#) taşınır; sunucu kayıtlarına ve yönlendirici başlıklarına girmez.
  const token = window.location.hash.slice(1)

  if (status === 'loading') return <Page><p className="text-muted">Yükleniyor…</p></Page>
  if (user) return <Navigate to="/" replace />

  async function accept() {
    setBusy(true)
    setError(null)
    try {
      await registerPasskey({ kind: 'invite', inviteToken: token, keyName })
      window.history.replaceState(null, '', '/davet')
      await refresh()
      navigate('/', { replace: true })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <header className="flex flex-col gap-1 pt-8">
        <h1 className="text-3xl font-semibold">HesApp</h1>
        <p className="opacity-70">Davet edildin. Bu cihazda bir passkey oluşturarak katıl.</p>
      </header>
      {!passkeysSupported() && <Notice>Bu tarayıcı passkey desteklemiyor.</Notice>}
      {!token && <Notice>Davet bağlantısı eksik görünüyor. Bağlantıyı yeniden iste.</Notice>}
      {error && <Notice>{error}</Notice>}
      <Card>
        <Field label="Bu cihazın adı" value={keyName} onChange={(e) => setKeyName(e.target.value)} maxLength={60} />
        <Button onClick={() => void accept()} disabled={busy || !token || !passkeysSupported()}>
          {busy ? 'Doğrulanıyor…' : 'Passkey oluştur ve katıl'}
        </Button>
      </Card>
    </Page>
  )
}
