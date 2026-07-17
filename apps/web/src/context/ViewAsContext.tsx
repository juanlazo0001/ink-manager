import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ViewAsContext, type ViewAsTarget } from './view-as-context'
import { useUserProfile } from './useUserProfile'
import { apiFetch, setViewAsUserId } from '../lib/api'

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ViewAsTarget | null>(null)
  const queryClient = useQueryClient()
  const { refresh: refreshProfile } = useUserProfile()

  // Called as the real OWNER (no header attached yet), so the activation
  // audit row's actor is genuinely the admin. Every cached query is
  // cleared so the whole app refetches under the impersonated identity --
  // otherwise anything already cached under the admin's own query keys
  // (e.g. tasksQueryKey(adminUserId)) would keep showing the admin's own
  // stale data instead of the target's.
  async function startViewAs(targetUserId: string) {
    const result = await apiFetch<ViewAsTarget>('/view-as/activate', {
      method: 'POST',
      body: JSON.stringify({ targetUserId }),
    })
    setViewAsUserId(result.id)
    setTarget(result)
    queryClient.clear()
    await refreshProfile()
  }

  // Drop the header FIRST, then call deactivate -- that call needs to land
  // as the real owner again (matching activate's own requirement), not
  // carrying the very header it's ending.
  function exitViewAs() {
    const wasTarget = target
    setViewAsUserId(null)
    setTarget(null)
    if (wasTarget) {
      apiFetch('/view-as/deactivate', {
        method: 'POST',
        body: JSON.stringify({ targetUserId: wasTarget.id }),
      }).catch(() => {
        // Non-critical -- the client-side exit (dropping the header) is
        // what actually matters; this is just the audit bookend.
      })
    }
    queryClient.clear()
    refreshProfile()
  }

  return <ViewAsContext.Provider value={{ target, startViewAs, exitViewAs }}>{children}</ViewAsContext.Provider>
}
