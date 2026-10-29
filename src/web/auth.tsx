import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import type { AuthState, MeResponse } from '../shared/api'
import { api, ApiError } from './api'

type Status = 'loading' | 'ready' | 'error'

interface AuthContextValue {
  status: Status
  state: AuthState | null
  user: MeResponse | null
  error: string | null
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [state, setState] = useState<AuthState | null>(null)
  const [user, setUser] = useState<MeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const authState = await api<AuthState>('/auth/state')
      setState(authState)
      try {
        setUser(await api<MeResponse>('/me'))
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401) throw e
        setUser(null)
      }
      setError(null)
      setStatus('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'bağlantı kurulamadı')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    await api('/auth/logout', { body: {} })
    setUser(null)
  }, [])

  return <AuthContext value={{ status, state, user, error, refresh, logout }}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider eksik')
  return value
}
