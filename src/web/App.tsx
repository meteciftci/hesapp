import { useEffect, useState } from 'react'
import type { MeResponse } from '../shared/api'

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? (r.json() as Promise<MeResponse>) : Promise.reject(new Error(String(r.status)))))
      .then(setMe)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 p-6">
      <h1 className="text-2xl font-semibold">hesapp</h1>
      {me && <p className="text-sm opacity-70">Giriş: {me.email}</p>}
      {error && <p className="text-sm text-red-600">Oturum doğrulanamadı ({error})</p>}
    </main>
  )
}
