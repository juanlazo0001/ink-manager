import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import { navCountsQueryKey } from './queryKeys'
import { useAuth } from '../context/useAuth'

// Fired once per page visit -- marks this nav section seen so its bubble
// clears, then invalidates the cached nav-counts so the sidebar updates
// without waiting for the next poll.
export function useMarkSectionSeen(section: 'inquiries' | 'appointments' | 'clients') {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!user) return

    apiFetch('/nav-counts/seen', { method: 'POST', body: JSON.stringify({ section }) })
      .then(() => queryClient.invalidateQueries({ queryKey: navCountsQueryKey(user.userId) }))
      .catch(() => {
        // Non-critical -- the bubble just won't clear until the next poll.
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, user?.userId])
}
