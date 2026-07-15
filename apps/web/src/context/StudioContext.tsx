import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { StudioContext, type Studio } from './studio-context'
import { useAuth } from './useAuth'
import { apiFetch } from '../lib/api'

export function StudioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [studio, setStudio] = useState<Studio | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!user?.studioId) {
      setStudio(null)
      return
    }

    setLoading(true)

    try {
      const data = await apiFetch<Studio>(`/studios/${user.studioId}`)
      setStudio(data)
    } catch {
      setStudio(null)
    } finally {
      setLoading(false)
    }
  }, [user?.studioId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return <StudioContext.Provider value={{ studio, loading, refresh }}>{children}</StudioContext.Provider>
}
