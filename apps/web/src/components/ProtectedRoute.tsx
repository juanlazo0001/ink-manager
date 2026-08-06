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

  // Single chokepoint for the artist-onboarding-wizard redirect (see
  // UserProfile.showProfileSetupWizard's own comment) -- every protected
  // route goes through here, so this doesn't need repeating per-page.
  // Gated on `!loading` so a profile that hasn't loaded yet can't bounce
  // someone who's actually already finished/skipped the wizard; excluding
  // the literal /welcome path itself is what stops this from looping.
  if (!loading && profile?.showProfileSetupWizard && location.pathname !== '/welcome') {
    return <Navigate to="/welcome" replace />
  }

  return <>{children}</>
}
