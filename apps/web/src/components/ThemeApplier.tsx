import { useEffect, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { apiFetch } from '../lib/api'
import { applyThemePreset, getCachedThemePresetKey } from '../lib/themePresets'

// Package C2: applies the studio's chosen theme preset to the
// authenticated app shell -- fetches once a user is logged in and sets
// the root data-theme attribute every color utility in index.css reads
// from. Public pages are NOT covered by this component at all; each one
// applies its own preset independently from its own public route's
// response (see Policies.tsx, IntakeForm.tsx, DepositResponse.tsx,
// EstimateResponse.tsx, WaiverSign.tsx, GiftCardResponse.tsx), since none
// of them have an authenticated user to fetch /studio-settings with.
//
// Also covers the "flash of onyx-lime, then the real theme" problem: this
// fetch is async, so between mount and it resolving, the app previously
// rendered with whatever theme happened to already be on <html> (index.css's
// own onyx-lime default on a cold load) before visibly swapping to the
// studio's real preset. main.tsx now applies a cached theme synchronously
// before React even renders, so returning users skip this entirely --
// `ready` below starts true whenever that cache hit. The overlay only
// actually shows for a genuine first-ever visit (or private browsing,
// where nothing persists) while this fetch is still in flight.
export default function ThemeApplier() {
  const { user } = useAuth()
  const [ready, setReady] = useState(() => Boolean(getCachedThemePresetKey()))

  useEffect(() => {
    if (!user) {
      setReady(true)
      return
    }

    let ignore = false

    apiFetch<{ themePreset: string }>('/studio-settings')
      .then((data) => {
        if (!ignore) applyThemePreset(data.themePreset)
      })
      .catch(() => {
        // Non-critical -- leaves whatever theme was already applied (or
        // index.css's own onyx-lime default), no error banner warranted.
      })
      .finally(() => {
        if (!ignore) setReady(true)
      })

    return () => {
      ignore = true
    }
  }, [user])

  if (ready) return null

  // Plain, theme-agnostic near-black -- can't reach for a --color-* token
  // here, since which theme's values are even correct is exactly the
  // unresolved question this overlay exists to cover. Every preset's own
  // base is some near-black shade anyway (#0a0a0b onyx-lime, #0e0b08
  // editorial-gold, etc.), so this reads as a seamless continuation
  // rather than a mismatched flash of its own.
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-[#0a0a0b]">
      <img src="/branding/logo-white-512.png" alt="" className="h-auto w-40 animate-pulse object-contain" />
    </div>
  )
}
