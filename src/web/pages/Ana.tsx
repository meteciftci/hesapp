import { Link } from 'react-router'
import { useAuth } from '../auth'
import { Card, Page } from '../ui'

export function Ana() {
  const { user } = useAuth()
  return (
    <Page>
      <header className="flex items-center justify-between pt-4">
        <h1 className="text-2xl font-semibold">hesapp</h1>
        <Link to="/ayarlar" className="min-h-11 content-center rounded-lg px-3 text-sm underline">Ayarlar</Link>
      </header>
      <Card>
        <p>Merhaba {user?.name}.</p>
        <p className="text-sm opacity-60">Bütçe ekranları sonraki adımlarda burada olacak.</p>
      </Card>
    </Page>
  )
}
