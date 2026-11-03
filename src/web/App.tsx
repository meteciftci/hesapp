import { Navigate, Outlet, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './auth'
import { ConfirmProvider } from './confirm'
import { Ara } from './pages/Ara'
import { Davet } from './pages/Davet'
import { Gecmis } from './pages/Gecmis'
import { Giris } from './pages/Giris'
import { Ana } from './pages/Ana'
import { Ayarlar } from './pages/Ayarlar'
import { Kategoriler } from './pages/Kategoriler'
import { PlanDetay } from './pages/PlanDetay'
import { Planlar } from './pages/Planlar'
import { Yaklasan } from './pages/Yaklasan'
import { Yil } from './pages/Yil'
import { Notice, Page } from './ui'

function Guard() {
  const { status, user, error, state } = useAuth()
  if (status === 'loading') return <Page><p className="text-muted">Yükleniyor…</p></Page>
  if (status === 'error') return <Page><Notice>Sunucuya ulaşılamadı: {error}</Notice></Page>
  if (!user) {
    return state?.mode === 'access' ? <Page><Notice>Oturum doğrulanamadı. Cloudflare Access ayarlarını kontrol edin.</Notice></Page> : <Navigate to="/giris" replace />
  }
  return <Outlet />
}

export function App() {
  return (
    <AuthProvider>
      <ConfirmProvider>
        <Routes>
          <Route path="/giris" element={<Giris />} />
          <Route path="/davet" element={<Davet />} />
          <Route element={<Guard />}>
            <Route path="/" element={<Ana />} />
            <Route path="/yaklasan" element={<Yaklasan />} />
            <Route path="/planlar" element={<Planlar />} />
            <Route path="/planlar/:id" element={<PlanDetay />} />
            <Route path="/yil" element={<Yil />} />
            <Route path="/ayarlar" element={<Ayarlar />} />
            <Route path="/gecmis" element={<Gecmis />} />
            <Route path="/ara" element={<Ara />} />
            <Route path="/kategoriler" element={<Kategoriler />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ConfirmProvider>
    </AuthProvider>
  )
}
