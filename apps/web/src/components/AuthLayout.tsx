import { forwardRef, type ReactNode } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { useLocation, useOutlet } from 'react-router-dom'
import { authSpringTransition, crossfadeVariants, headingVariants } from '../lib/motion'
import SignInOrForgotCard, { type SignInOrForgotMode } from './SignInOrForgotCard'
import loginBackground from '../assets/login-background-no-artist.png'

// Persistent chrome for every "fixed platform identity" public auth page
// (Sign In, Forgot Password, Reset Password, Accept Invite, Confirm Email
// Change) -- this component (background photo, overlay, rings) renders
// once and never unmounts while navigating between them; only the
// heading + card content inside swaps.
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
//   - One shared piece of state (`mode`, derived from the route) driving
//     two independently-varianted, independently-animated elements: the
//     heading and the card. Both key off the same `mode`/pathname so they
//     swap in lockstep, but the heading uses its own `headingVariants`
//     (fade + blur) while the card uses `crossfadeVariants` (fade + slide,
//     no blur) -- giving the heading its own distinct "materialize"
//     moment rather than just a bigger copy of the card's own effect.
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

const AUTH_HEADINGS: Record<AuthMode, string> = {
  'sign-in': 'Sign in',
  'forgot-password': 'Forgot your password?',
  'reset-password': 'Reset your password',
  'accept-invite': 'Join your studio',
  'confirm-email-change': 'Confirm your email',
}

function getAuthMode(pathname: string): AuthMode {
  if (pathname.startsWith('/forgot-password')) return 'forgot-password'
  if (pathname.startsWith('/reset-password')) return 'reset-password'
  if (pathname.startsWith('/invite')) return 'accept-invite'
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

      <MotionConfig transition={authSpringTransition}>
        <motion.div layout className="relative z-10 flex w-full max-w-sm flex-col items-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.h1
              key={mode}
              variants={headingVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="font-display mb-4 text-center text-2xl font-normal tracking-[-0.01em] text-[var(--login-cream)]"
            >
              {AUTH_HEADINGS[mode]}
            </motion.h1>
          </AnimatePresence>

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
