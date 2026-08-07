import { useState, type ReactNode } from 'react'
import { AuthContext, TOKEN_STORAGE_KEY, type AuthUser } from './auth-context'
import { ApiError } from '../lib/api'

const API_URL = import.meta.env.VITE_API_URL

function decodeJwtPayload(token: string): AuthUser | null {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY))
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY)
    return stored ? decodeJwtPayload(stored) : null
  })

  // Shared by login() below and by any other flow that ends with a fresh,
  // already-issued JWT (invite-accept, most notably) -- writing straight to
  // localStorage without also calling this was a real bug: AuthContext's
  // token/user state is only ever initialized from localStorage once, on
  // mount, so a raw localStorage.setItem elsewhere is invisible to every
  // component already rendering (ProtectedRoute's own useAuth().token stays
  // null), and the very next render bounces straight back to /login even
  // though a valid token now exists on disk.
  function setSession(token: string) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token)
    setToken(token)
    setUser(decodeJwtPayload(token))
  }

  async function login(email: string, password: string) {
    const response = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    if (!response.ok) {
      const body = await response.json().catch(() => null)
      // ApiError (not a plain Error), matching apiFetch's own error shape --
      // this route predates apiFetch's existence, so it grew its own raw
      // fetch instead. /login's email_not_verified `code` needs to survive
      // to the caller (SignInOrForgotCard) so it can offer a "resend
      // verification" action instead of a bare error banner.
      throw new ApiError(body?.error ?? 'Login failed', response.status, body?.code)
    }

    const data = await response.json()
    setSession(data.token)
  }

  function logout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setToken(null)
    setUser(null)
  }

  return <AuthContext.Provider value={{ token, user, login, logout, setSession }}>{children}</AuthContext.Provider>
}
