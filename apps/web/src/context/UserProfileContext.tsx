import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { UserProfileContext, type UserProfile } from './user-profile-context'
import { useAuth } from './useAuth'
import { apiFetch } from '../lib/api'

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!user?.userId) {
      setProfile(null)
      return
    }

    setLoading(true)

    try {
      const data = await apiFetch<UserProfile>('/users/me')
      setProfile(data)
    } catch {
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [user?.userId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return <UserProfileContext.Provider value={{ profile, loading, refresh }}>{children}</UserProfileContext.Provider>
}
