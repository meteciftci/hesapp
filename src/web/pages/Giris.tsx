import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useAuth } from '../auth'
import { errorMessage } from '../api'
import { loginWithPasskey, passkeysSupported, registerPasskey, suggestDeviceName } from '../passkey'
import { Button, Card, Field, Notice, Page } from '../ui'

export function Giris() {
  const { status, state, user, refresh } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status === 'loading') return <Page><p className="text-muted">Yükleniyor…</p></Page>
  if (user) return <Navigate to="/" replace />

  const supported = passkeysSupported()
  const needsSetup = state?.mode === 'passkey' && !state.hasUsers

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
      navigate('/', { replace: true })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function onSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void run(() =>
      registerPasskey({
        kind: 'setup',
        setupCode: String(data.get('setupCode') ?? ''),
        name: String(data.get('name') ?? ''),
        keyName: String(data.get('keyName') ?? ''),
      }),
    )
  }

  return (
    <Page>
      <header className="flex flex-col gap-1 pt-8">
        <h1 className="text-3xl font-semibold">HesApp</h1>
        <p className="opacity-70">{needsSetup ? 'İlk kurulum: hesap sahibini oluştur.' : 'Devam etmek için passkey ile giriş yap.'}</p>
      </header>

      {!supported && <Notice>Bu tarayıcı passkey desteklemiyor. Güncel Safari, Chrome ya da Firefox ile aç.</Notice>}
      {error && <Notice>{error}</Notice>}

      {needsSetup ? (
        <Card>
          <form className="flex flex-col gap-3" onSubmit={onSetup}>
            <Field label="Adın" name="name" required maxLength={40} autoComplete="name" />
            <Field label="Kurulum kodu" name="setupCode" required type="password" autoComplete="off" hint="Worker'a SETUP_CODE olarak girdiğin değer." />
            <Field label="Bu cihazın adı" name="keyName" defaultValue={suggestDeviceName()} required maxLength={60} />
            <Button type="submit" disabled={busy || !supported}>{busy ? 'Doğrulanıyor…' : 'Passkey oluştur'}</Button>
          </form>
        </Card>
      ) : (
        <Card>
          <Button onClick={() => void run(loginWithPasskey)} disabled={busy || !supported}>
            {busy ? 'Doğrulanıyor…' : 'Passkey ile giriş yap'}
          </Button>
          <p className="text-sm text-muted">Yeni bir cihazdan katılacaksan, hesap sahibinden davet bağlantısı iste.</p>
        </Card>
      )}
    </Page>
  )
}
