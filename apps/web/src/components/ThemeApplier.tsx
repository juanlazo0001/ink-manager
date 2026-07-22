import { useEffect } from 'react'
import { useAuth } from '../context/useAuth'
import { apiFetch } from '../lib/api'
import { applyThemePreset } from '../lib/themePresets'

// Package C2: applies the studio's chosen theme preset to the
// authenticated app shell -- fetches once a user is logged in and sets
// the root data-theme attribute every color utility in index.css reads
// from. Public pages are NOT covered by this component at all; each one
// applies its own preset independently from its own public route's
// response (see Policies.tsx, IntakeForm.tsx, DepositResponse.tsx,
// EstimateResponse.tsx, WaiverSign.tsx, GiftCardResponse.tsx), since none
// of them have an authenticated user to fetch /studio-settings with.
export default function ThemeApplier() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return
    let ignore = false

    apiFetch<{ themePreset: string }>('/studio-settings')
      .then((data) => {
        if (!ignore) applyThemePreset(data.themePreset)
      })
      .catch(() => {
        // Non-critical -- leaves whatever theme was already applied (or
        // index.css's own onyx-lime default), no error banner warranted.
      })

    return () => {
      ignore = true
    }
  }, [user])

  return null
}
