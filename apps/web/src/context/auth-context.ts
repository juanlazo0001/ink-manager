import { createContext } from 'react'

export const TOKEN_STORAGE_KEY = 'ink-manager-token'

export interface AuthUser {
  userId: string
  studioId: string
  role: string
  iat?: number
  exp?: number
}

export interface AuthContextValue {
  token: string | null
  user: AuthUser | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  // For flows that already have a freshly-issued JWT from a non-/login
  // endpoint (invite-accept) and need the app to recognize the session
  // immediately, the same way a real login() call does.
  setSession: (token: string) => void
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)
