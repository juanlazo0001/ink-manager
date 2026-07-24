import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import { widgetLayoutQueryKey } from './queryKeys'
import { useEffectiveUser } from '../context/useEffectiveUser'

interface WidgetLayoutResponse {
  widgetOrder: string[]
  collapsedWidgetIds: string[]
}

// Saved order, filtered to only ids actually present right now (a widget
// hidden by the current inquiry/appointment's state is skipped, never
// treated as "removed" from the saved layout), followed by any id NOT yet
// in the saved order -- new widgets shipped after the user's last save, or
// ones they've simply never touched -- appended in their built-in default
// relative order. A saved layout can never silently hide a widget it
// doesn't know about.
function computeOrder(defaultOrder: string[], savedOrder: string[], presentIds: string[]): string[] {
  const present = new Set(presentIds)
  const savedSet = new Set(savedOrder)
  const savedPresent = savedOrder.filter((id) => present.has(id))
  const missingFromSaved = defaultOrder.filter((id) => present.has(id) && !savedSet.has(id))
  return [...savedPresent, ...missingFromSaved]
}

// Per-user, per-page-type widget order/collapsed state for the Inquiry and
// Project (Appointment) detail pages' reorderable/collapsible section
// cards. pageKey is "inquiry-detail" or "appointment-detail" -- a plain
// string, matching the backend model, so a future third page needs no
// schema change.
export function useWidgetLayout(pageKey: string, defaultOrder: string[]) {
  const user = useEffectiveUser()
  const queryClient = useQueryClient()
  const queryKey = widgetLayoutQueryKey(user?.userId ?? '', pageKey)

  const { data } = useQuery({
    queryKey,
    queryFn: () => apiFetch<WidgetLayoutResponse>(`/widget-layouts/${pageKey}`),
    staleTime: 60_000,
    enabled: !!user,
  })

  const savedOrder = data?.widgetOrder ?? []
  const collapsedWidgetIds = data?.collapsedWidgetIds ?? []

  function getOrder(presentIds: string[]): string[] {
    return computeOrder(defaultOrder, savedOrder, presentIds)
  }

  // Optimistic + best-effort: the local cache (and therefore the render)
  // updates immediately regardless of the PUT's outcome. A failed save
  // just means the change doesn't survive a refresh -- never worth
  // blocking or rolling back an already-applied drag/collapse over.
  function persist(nextOrder: string[], nextCollapsed: string[]) {
    queryClient.setQueryData(queryKey, { widgetOrder: nextOrder, collapsedWidgetIds: nextCollapsed })
    apiFetch(`/widget-layouts/${pageKey}`, {
      method: 'PUT',
      body: JSON.stringify({ widgetOrder: nextOrder, collapsedWidgetIds: nextCollapsed }),
    }).catch(() => {})
  }

  function reorder(presentIds: string[], fromIndex: number, toIndex: number) {
    const current = getOrder(presentIds)
    const next = [...current]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    persist(next, collapsedWidgetIds)
  }

  function toggleCollapsed(id: string, presentIds: string[]) {
    const isCollapsed = collapsedWidgetIds.includes(id)
    const nextCollapsed = isCollapsed ? collapsedWidgetIds.filter((wid) => wid !== id) : [...collapsedWidgetIds, id]
    persist(getOrder(presentIds), nextCollapsed)
  }

  return {
    getOrder,
    isCollapsed: (id: string) => collapsedWidgetIds.includes(id),
    toggleCollapsed,
    reorder,
  }
}
