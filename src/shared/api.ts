export interface MeResponse {
  id: string
  name: string
  role: 'owner' | 'member'
}

export interface AuthState {
  mode: 'passkey' | 'access'
  hasUsers: boolean
}

export interface PasskeyInfo {
  id: string
  name: string
  device_type: string
  backed_up: number
  created_at: number
  last_used_at: number | null
  current: boolean
}

export interface MemberInfo {
  id: string
  name: string
  role: 'owner' | 'member'
  created_at: number
  passkeys: number
}
