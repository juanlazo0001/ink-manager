import { useEffect, useState } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import loginBackground from '../assets/login-background-no-artist.png'

const CARD_SWAP_OUT_MS = 140

// Persistent chrome for every "fixed platform identity" public auth page
// (Sign In, Forgot Password, Reset Password, Accept Invite, Confirm Email
// Change) -- replaces the old per-page AuthPageChrome wrapper, which each
// page mounted independently. Nesting these routes under this layout in
// App.tsx means THIS component (background photo, overlay, rings) renders
// once and never unmounts while navigating between them; only the card
// content inside swaps, which is what actually fixes the jarring
// full-reload-looking flash a remounted background layer caused before --
// same background image flashing white/black for a frame every time is
// exactly the kind of thing a browser hard-refresh does that this was
// meant to stop feeling like.
//
// The crossfade+slide on the card swap uses `useOutlet(location)` (not the
// zero-arg `useOutlet()`) specifically so the OUTGOING page's element can
// keep rendering, unchanged, for the short "out" transition even after
// react-router's own current location has already moved to the new URL --
// see https://reactrouter.com/en/main/hooks/use-outlet, this is the
// documented technique for animating between nested routes. No animation
// library added for this: the "in" half reuses the app's existing
// animate-fade-slide-up utility (already used by Calendar.tsx/
// ConversationsPanel.tsx for the same kind of "new content just appeared"
// moment), the "out" half is a couple-line CSS keyframe in index.css.
export default function AuthLayout() {
  const location = useLocation()
  const [renderedLocation, setRenderedLocation] = useState(location)
  const [transitioningOut, setTransitioningOut] = useState(false)
  const outlet = useOutlet(renderedLocation)

  useEffect(() => {
    if (location.pathname === renderedLocation.pathname) return

    setTransitioningOut(true)
    const timeout = setTimeout(() => {
      setRenderedLocation(location)
      setTransitioningOut(false)
    }, CARD_SWAP_OUT_MS)

    return () => clearTimeout(timeout)
  }, [location, renderedLocation])

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

      <div className={transitioningOut ? 'auth-card-out' : 'animate-fade-slide-up'}>{outlet}</div>
    </div>
  )
}
