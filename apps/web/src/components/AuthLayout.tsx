import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import loginBackground from '../assets/login-background-no-artist.png'

const CARD_TRANSITION_MS = 320

// Persistent chrome for every "fixed platform identity" public auth page
// (Sign In, Forgot Password, Reset Password, Accept Invite, Confirm Email
// Change) -- replaces the old per-page AuthPageChrome wrapper, which each
// page mounted independently. Nesting these routes under this layout in
// App.tsx means THIS component (background photo, overlay, rings) renders
// once and never unmounts while navigating between them; only the card
// content inside swaps.
//
// The card swap is a real OVERLAPPING crossfade, not a sequential fade-out-
// then-fade-in -- an earlier version of this did the two halves back to
// back (fade the old card out completely, THEN swap, THEN fade the new one
// in), which left a beat with nothing on screen at all between them. That
// gap is exactly what read as "reloading the modal": the background never
// moved, but the card itself still visibly blinked away and back, which is
// the same jarring cue as a reload even without one actually happening.
// Fixed by keeping the outgoing card mounted (absolutely positioned, on
// top) while it fades+slides out, at the same time the incoming card fades
// +slides in underneath it, in normal flow -- both animate concurrently
// over the same window, so there's never a frame with neither visible.
//
// No animation library added: `useOutlet()` (no location argument, unlike
// the previous version) always reflects the CURRENT real route -- that's
// the incoming card, in normal flow, sizing the container. The outgoing
// card is whatever `useOutlet()` returned on the PREVIOUS render, captured
// into a ref right before it changes and held in state just long enough to
// finish its own exit animation. Two small CSS keyframes in index.css
// (auth-card-enter / auth-card-exit) do the actual motion, both driven by
// an "expo-out"-style easing curve that reads as considerably smoother/
// more natural than a linear or basic ease-in-out would.
export default function AuthLayout() {
  const location = useLocation()
  const outlet = useOutlet()

  const lastRef = useRef<{ pathname: string; outlet: ReactNode }>({ pathname: location.pathname, outlet })
  const [exiting, setExiting] = useState<{ pathname: string; outlet: ReactNode } | null>(null)

  useEffect(() => {
    const last = lastRef.current

    if (last.pathname !== location.pathname) {
      setExiting(last)
      lastRef.current = { pathname: location.pathname, outlet }

      const timeout = setTimeout(() => setExiting(null), CARD_TRANSITION_MS)
      return () => clearTimeout(timeout)
    }

    lastRef.current = { pathname: location.pathname, outlet }
  }, [location.pathname, outlet])

  return (
    <div className="login-shell relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <img
        src={loginBackground}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="hero-shade" aria-hidden="true" />
      <div className="rings" aria-hidden="true">
        <i />
        <i />
        <i />
        <s />
      </div>

      <div className="relative w-full max-w-sm">
        <div className={exiting ? 'auth-card-enter' : ''}>{outlet}</div>

        {/* inert: not just visually hidden -- unclickable/unfocusable/
            unselectable while it fades out on top of the real card. */}
        {exiting && (
          <div className="absolute inset-x-0 top-0 auth-card-exit" aria-hidden="true" inert>
            {exiting.outlet}
          </div>
        )}
      </div>
    </div>
  )
}
