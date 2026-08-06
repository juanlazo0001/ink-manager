import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useUserProfile } from '../context/useUserProfile'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const { profile, loading } = useUserProfile()
  const location = useLocation()

  if (!token) {
    return <Navigate to="/login" replace />
  }

  // Single chokepoint for both onboarding-wizard redirects (see
  // UserProfile.showProfileSetupWizard/showStudioSetupWizard's own
  // comments) -- every protected route goes through here, so neither needs
  // repeating per-page. Gated on `!loading` so a profile that hasn't
  // loaded yet can't bounce someone who's actually already finished/
  // skipped a wizard. A solo OWNER+Artist account is eligible for BOTH at
  // once -- each check excludes BOTH wizard paths, not just its own, so
  // being on either one never redirects to the other (that would loop:
  // /setup -> eligible for /welcome too -> /welcome -> still eligible for
  // /setup -> back again, infinitely, the real bug this fixed). Studio
  // checked first only for approaching from a THIRD, non-wizard page --
  // /setup's own Done step is what actually hands a solo signup off into
  // /welcome next, not redirect-check order here.
  const onEitherWizardPath = location.pathname === '/setup' || location.pathname === '/welcome'

  if (!loading && profile?.showStudioSetupWizard && !onEitherWizardPath) {
    return <Navigate to="/setup" replace />
  }

  if (!loading && profile?.showProfileSetupWizard && !onEitherWizardPath) {
    return <Navigate to="/welcome" replace />
  }

  return <>{children}</>
}
