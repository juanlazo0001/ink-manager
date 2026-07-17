import { useAuth } from './useAuth'
import { useViewAs } from './useViewAs'
import type { AuthUser } from './auth-context'

// The identity every role/section/nav-visibility decision in the UI
// should read -- the impersonated target's userId/role while View As is
// active, the real logged-in user's otherwise. Deliberately separate from
// useAuth(), which always returns the real, JWT-decoded identity (needed
// for things like the account menu and the View As entry point itself,
// which must reflect who's REALLY logged in, not who they're viewing as).
export function useEffectiveUser(): AuthUser | null {
  const { user: realUser } = useAuth()
  const { target } = useViewAs()

  if (!realUser) return null
  if (!target) return realUser

  return { userId: target.id, studioId: realUser.studioId, role: target.role }
}
