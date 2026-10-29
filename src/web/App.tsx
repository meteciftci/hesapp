import { Navigate, Outlet, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './auth'
import { Davet } from './pages/Davet'
import { Giris } from './pages/Giris'
import { Ana } from './pages/Ana'
import { Ayarlar } from './pages/Ayarlar'
import { Notice, Page } from './ui'

function Guard() {
  const { status, user, error, state } = useAuth()
  if (status === 'loading') return <Page><p className="opacity-60">Yükleniyor…</p></Page>
  if (status === 'error') return <Page><Notice>Sunucuya ulaşılamadı: {error}</Notice></Page>
  if (!user) {
    return state?.mode === 'access' ? <Page><Notice>Oturum doğrulanamadı. Cloudflare Access ayarlarını kontrol edin.</Notice></Page> : <Navigate to="/giris" replace />
  }
  return <Outlet />
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/giris" element={<Giris />} />
        <Route path="/davet" element={<Davet />} />
        <Route element={<Guard />}>
          <Route path="/" element={<Ana />} />
          <Route path="/ayarlar" element={<Ayarlar />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
