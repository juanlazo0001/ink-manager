import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './api'
import { navCountsQueryKey } from './queryKeys'
import { useAuth } from '../context/useAuth'

export interface NavCounts {
  inquiries: number
  appointments: number
  clients: number
  conversations: number
  // UI-1 §7: OWNER-controlled Settings toggle (default off). Rides along
  // on this response rather than a separate /studio-settings call, since
  // ARTIST can't call that route but still needs to know whether to render
  // bubbles.
  showSidebarBadges: boolean
}

const POLL_MS = 60_000

// Sidebar is rendered per-page (not a persistent layout), so it remounts on
// every route change -- refetchOnMount alone covers "refreshed on route
// change" here, plus a modest poll for whoever stays on one page a while.
// No websockets this phase.
export function useNavCounts() {
  const { user } = useAuth()

  return useQuery({
    queryKey: user ? navCountsQueryKey(user.userId) : ['nav-counts', 'anonymous'],
    queryFn: () => apiFetch<NavCounts>('/nav-counts'),
    enabled: !!user,
    refetchInterval: POLL_MS,
    refetchOnMount: true,
  })
}

export function formatBubbleCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}
