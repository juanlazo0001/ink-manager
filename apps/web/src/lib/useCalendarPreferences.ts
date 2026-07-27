import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import { useEffectiveUser } from '../context/useEffectiveUser'

export interface CalendarPreferences {
  view: 'month' | 'week' | 'day'
  selectedArtistIds: string[] | null
  selectedLocationId: string | null
  includePastGuests: boolean
}

export function calendarPreferencesQueryKey(userId: string) {
  return ['calendar-preferences', userId] as const
}

// Per-user Calendar page preference -- one row per user, no page variants
// (unlike useWidgetLayout's per-pageKey rows). Deliberately excludes the
// currently-viewed date: a fresh visit always opens on today, same as any
// other calendar app; only view/filter/display toggles survive navigating
// away and back.
export function useCalendarPreferences() {
  const user = useEffectiveUser()
  const queryClient = useQueryClient()
  const queryKey = calendarPreferencesQueryKey(user?.userId ?? '')

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => apiFetch<CalendarPreferences>('/calendar-preferences'),
    staleTime: 60_000,
    enabled: !!user,
  })

  // Optimistic + best-effort, same as useWidgetLayout's own persist -- the
  // local cache (and therefore the render) updates immediately regardless
  // of the PUT's outcome. A failed save just means the change doesn't
  // survive a refresh, never worth blocking a filter click over.
  function persist(next: CalendarPreferences) {
    queryClient.setQueryData(queryKey, next)
    apiFetch('/calendar-preferences', {
      method: 'PUT',
      body: JSON.stringify(next),
    }).catch(() => {})
  }

  return { preferences: data, isLoading, persist }
}
