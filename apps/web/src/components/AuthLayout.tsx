import type { ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'framer-motion'
import { useLocation, useOutlet } from 'react-router-dom'
import { crossfadeTransition, crossfadeVariants } from '../lib/motion'
import loginBackground from '../assets/login-background-no-artist.png'

// Persistent chrome for every "fixed platform identity" public auth page
// (Sign In, Forgot Password, Reset Password, Accept Invite, Confirm Email
// Change) -- this component (background photo, overlay, rings) renders
// once and never unmounts while navigating between them; only the card
// content inside swaps.
//
// The card swap is Framer Motion's AnimatePresence in its DEFAULT mode
// (no `mode` prop -- NOT "wait", which forces the outgoing element to
// finish exiting before the incoming one starts entering, i.e. exactly
// the sequential fade-out-then-fade-in this replaces). Default mode
// mounts both simultaneously and lets their own initial/animate/exit
// transitions run concurrently, which is what makes this a real
// overlapping crossfade rather than a scripted illusion of one -- a hand-
// rolled setTimeout-based version of the same idea existed here before
// and was replaced outright (not left dormant) because fighting React's
// default "unmount the instant the condition goes false" behavior with
// manual timers is exactly the kind of thing that stays "almost right" no
// matter how many timing tweaks it gets.
//
// AuthCard below is why this ALSO fixes the height-jump between cards of
// different lengths (e.g. Sign In vs. the shorter Forgot Password form):
// `useIsPresent()` is true for the current/entering card and false for
// the one mid-exit, so only the entering card stays in normal document
// flow -- the exiting one switches to absolute positioning (visually
// still overlapping, stacked on top) the instant it starts leaving. That
// means at any moment there's only ever ONE card actually contributing to
// this container's height, so the `layout` prop on the wrapper below can
// FLIP-animate a real height change smoothly instead of snapping (nothing
// to snap to -- the box just tracks whichever single card is in flow).
function AuthCard({ children }: { children: ReactNode }) {
  const isPresent = useIsPresent()

  return (
    <motion.div
      style={{ position: isPresent ? 'static' : 'absolute', top: 0, left: 0, right: 0 }}
      variants={crossfadeVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={crossfadeTransition}
    >
      {children}
    </motion.div>
  )
}

export default function AuthLayout() {
  const location = useLocation()
  const outlet = useOutlet()

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

      {/* transition={{ layout: crossfadeTransition }}: `layout` animations
          use Framer's own default spring by default, which settles on a
          noticeably different (longer, bouncier-tailed) timeline than the
          card's own opacity/y transition -- measured at ~500ms to fully
          rest versus the card's 320ms fade, so the box was visibly still
          resizing after the incoming card had already fully faded in.
          Pinning the layout transition to the exact same preset makes the
          height change and the crossfade read as one motion instead of
          two independently-timed ones. */}
      <motion.div layout transition={{ layout: crossfadeTransition }} className="relative z-10 w-full max-w-sm">
        <AnimatePresence initial={false}>
          <AuthCard key={location.pathname}>{outlet}</AuthCard>
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
