import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { StudioContext, type Studio } from './studio-context'
import { useAuth } from './useAuth'
import { apiFetch } from '../lib/api'

export function StudioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [studio, setStudio] = useState<Studio | null>(null)
  // Starts true (rather than flipping true once the effect below fires) so
  // the very first render already reports "loading" -- otherwise there's a
  // one-frame window where loading=false and studio=null, which reads
  // identically to "no studio logo configured" and flashes the fallback logo.
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user?.studioId) {
      setStudio(null)
      setLoading(false)
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
