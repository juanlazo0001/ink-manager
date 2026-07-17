import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import { navCountsQueryKey } from './queryKeys'
import { useAuth } from '../context/useAuth'
import { useNavCounts } from './useNavCounts'

// Fired once per page visit -- marks this nav section seen so its bubble
// clears, then invalidates the cached nav-counts so the sidebar updates
// without waiting for the next poll. UI-1 §7: a no-op while
// showSidebarBadges is off (the default) -- no bubbles are shown, so
// there's nothing to mark seen and no reason to write a SectionSeen row.
export function useMarkSectionSeen(section: 'inquiries' | 'appointments' | 'clients') {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { data: navCounts } = useNavCounts()
  const showBadges = navCounts?.showSidebarBadges ?? false

  useEffect(() => {
    if (!user || !showBadges) return

    apiFetch('/nav-counts/seen', { method: 'POST', body: JSON.stringify({ section }) })
      .then(() => queryClient.invalidateQueries({ queryKey: navCountsQueryKey(user.userId) }))
      .catch(() => {
        // Non-critical -- the bubble just won't clear until the next poll.
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, user?.userId, showBadges])
}
