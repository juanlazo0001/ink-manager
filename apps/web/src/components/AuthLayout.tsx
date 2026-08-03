import { forwardRef, type ReactNode } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { useLocation, useOutlet } from 'react-router-dom'
import { authSpringTransition, crossfadeVariants, ringModeTransform } from '../lib/motion'
import SignInOrForgotCard, { type SignInOrForgotMode } from './SignInOrForgotCard'
import loginBackground from '../assets/login-background-no-artist.png'

// Persistent chrome for every "fixed platform identity" public auth page
// (Sign In, Forgot Password, Reset Password, Accept Invite, Confirm Email
// Change) -- this component (background photo, overlay, rings) renders
// once and never unmounts while navigating between them; only the card
// content inside swaps.
//
// Rebuilt around the specific techniques from motion.dev's "Clerk: Sign-
// in-or-up" example (borrowed for the animation mechanics only -- none of
// its email/password/OTP UI applies here):
//
//   - `AnimatePresence mode="popLayout"`, not the default "sync" mode a
//     prior version of this used. popLayout pops an exiting element out
//     of document flow (position: absolute) the INSTANT it starts
//     animating out, so the incoming element takes its layout position
//     immediately rather than waiting -- this is what actually fixes the
//     height-jump between differently-sized cards (Sign In's 3 fields vs.
//     Forgot Password's 1, etc). It replaces the previous version's
//     manual `useIsPresent()` position-toggling hack outright: popLayout
//     does the same thing internally, more robustly.
//   - A single spring (`authSpringTransition`, see lib/motion.ts) set
//     once via `MotionConfig` for the whole transitioning region, not a
//     fixed-duration easing curve per element.
//
// A separate per-mode heading used to live here (its own AnimatePresence
// + blur-fade text swap) but was removed once the same blur-fade
// technique moved onto SignInOrForgotCard's own submit button label --
// that button already communicates "this is a different action now,"
// making a redundant heading above the card unnecessary.
//
// popLayout requires any custom component that's a direct AnimatePresence
// child to forward its ref to the actual DOM node (so Framer can measure
// and position it while it's popped out) -- hence AuthCard is wrapped in
// forwardRef rather than being a plain function component.
//
// AuthCard now only handles Reset Password / Accept Invite / Confirm
// Email Change -- Sign In and Forgot Password moved to their own
// persistent SignInOrForgotCard (see that file's own comment for why:
// they share a real email field, which AuthCard's per-route remount
// model can't represent without it briefly fading/resetting).
const AuthCard = forwardRef<HTMLDivElement, { children: ReactNode }>(function AuthCard({ children }, ref) {
  return (
    <motion.div ref={ref} layout variants={crossfadeVariants} initial="initial" animate="animate" exit="exit">
      {children}
    </motion.div>
  )
})

type AuthMode = 'sign-in' | 'forgot-password' | 'reset-password' | 'accept-invite' | 'confirm-email-change'

function getAuthMode(pathname: string): AuthMode {
  if (pathname.startsWith('/forgot-password')) return 'forgot-password'
  if (pathname.startsWith('/reset-password')) return 'reset-password'
  if (pathname.startsWith('/invite') || pathname.startsWith('/artist-invite')) return 'accept-invite'
  if (pathname.startsWith('/confirm-email-change')) return 'confirm-email-change'
  return 'sign-in'
}

// A type guard (not just a boolean) so the branch below can narrow
// `mode` down to SignInOrForgotCard's own narrower prop type -- a plain
// `mode === 'sign-in' || mode === 'forgot-password'` stored in a boolean
// variable doesn't carry that narrowing through to a later ternary.
function isSignInOrForgotMode(mode: AuthMode): mode is SignInOrForgotMode {
  return mode === 'sign-in' || mode === 'forgot-password'
}

export default function AuthLayout() {
  const location = useLocation()
  const outlet = useOutlet()
  const mode = getAuthMode(location.pathname)

  return (
    <div className="login-shell relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      {/* fixed, not absolute: a genuinely tall page (a long card, or the
          on-screen keyboard shrinking the visible viewport) makes
          .login-shell taller than one screenful, and an absolutely-
          positioned layer only covers ITS OWN container's height -- fixed
          pins to the true viewport instead, so scrolling to the very
          bottom never reveals raw, un-tinted background. Same fix already
          proven for the authenticated app shell's own equivalent layers
          (.app-bg-photo/.app-bg-wash below, in index.css). */}
      <img
        src={loginBackground}
        alt=""
        aria-hidden="true"
        className="fixed inset-0 h-full w-full object-cover"
      />
      <div className="hero-shade" aria-hidden="true" />
      {/* Rotate/scale keyed off the same `mode` that drives the card/button
          transition below -- a deliberately subtle background echo of the
          same state change, not an independent effect. `ringModeTransform`
          falls back to sign-in's neutral values for any mode it doesn't
          list, though every AuthMode currently has its own entry. The dot
          ("electron")'s own continuous orbit lives entirely in CSS
          (`.ring-orbit`'s keyframe animation) rather than here, since it
          must keep running independent of `mode`/React state -- nesting
          its plain CSS rotation inside this motion.div's spring rotation
          composes fine, the two transforms just stack. */}
      <motion.div
        className="rings"
        aria-hidden="true"
        animate={ringModeTransform[mode] ?? ringModeTransform['sign-in']}
        transition={authSpringTransition}
      >
        <i />
        <i />
        <i />
        <div className="ring-orbit">
          <s />
        </div>
        {/* Second satellite on ring 2, spinning the opposite direction
            (`.ring-orbit-2`'s `animation-direction: reverse`) -- same
            wrapper technique as the first dot, just a different ring
            radius and a class on <s> for its own position/size. */}
        <div className="ring-orbit ring-orbit-2">
          <s className="dot-2" />
        </div>
      </motion.div>

      <MotionConfig transition={authSpringTransition}>
        <motion.div layout className="relative z-10 flex w-full max-w-sm flex-col items-center">
          {/* SignInOrForgotCard is keyed identically regardless of which of
              the two routes matched -- that's what makes it ONE
              continuously-mounted instance across that switch rather than
              an exit+enter. Every other mode still gets AuthCard, keyed by
              the literal route, same as before. */}
          <AnimatePresence mode="popLayout" initial={false}>
            {isSignInOrForgotMode(mode) ? (
              <SignInOrForgotCard key="sign-in-or-forgot" mode={mode} />
            ) : (
              <AuthCard key={location.pathname}>{outlet}</AuthCard>
            )}
          </AnimatePresence>
        </motion.div>
      </MotionConfig>
    </div>
  )
}
