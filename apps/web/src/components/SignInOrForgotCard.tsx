import { forwardRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../context/useAuth'
import { apiFetch } from '../lib/api'
import { blurTextVariants, crossfadeVariants } from '../lib/motion'

export type SignInOrForgotMode = 'sign-in' | 'forgot-password'

interface SignInOrForgotCardProps {
  mode: SignInOrForgotMode
}

// Sign In and Forgot Password share a genuinely common element -- the
// email field -- and used to be two entirely separate page components,
// each mounting its own copy of the logo/email input, that AuthLayout
// swapped between (a full unmount+remount, even under the smoothest
// crossfade). This component is the fix: AuthLayout renders ONE instance
// of it, under one stable key, for both routes (see AuthLayout's own
// comment) -- switching between Sign In and Forgot Password is just a
// re-render with a new `mode` prop, never an unmount/remount, so the card
// surface, logo, and email input never fade or reset. Each has its own
// `layout` prop so if content elsewhere changes their size/position,
// they resize/reposition smoothly rather than snapping -- they just never
// animate in/out themselves.
//
// The submit button gets the SAME persistent treatment as the card/logo/
// email above -- it's the same button (position, size, styling) across
// Sign In and Forgot Password, not two buttons being swapped. Only its
// text LABEL swaps, via a small nested AnimatePresence using
// `blurTextVariants` (the same fade+blur technique the removed heading
// used to use) so "SIGN IN" dissolves into "SEND RESET LINK" in place
// rather than the whole button disappearing and a new one reappearing.
// The button only actually unmounts for the one state that never had a
// button at all -- Forgot Password's post-submit "check your inbox"
// confirmation -- which is a real, different state, not a case this
// persistence claim needs to cover.
//
// Only the content that's genuinely different per mode -- the password
// field vs. the explanatory paragraph, the button's label (see above),
// the link text/destination -- lives in its own small `AnimatePresence`
// nested inside this persistent card, not a replacement of the card
// itself. One side effect worth calling out, not just tolerated: since
// the email input is now truly shared state, typing an email on Sign In
// and then clicking through to Forgot Password carries it over instead
// of starting blank.
//
// Wrapped in forwardRef because it's a direct child of AuthLayout's own
// outer `AnimatePresence mode="popLayout"` (alongside the other, still-
// per-route AuthCard) -- popLayout requires that of any custom-component
// child so it can measure/position this while it's mid-transition on the
// rarer cross-boundary case (e.g. arriving here from Reset Password's
// "Back to sign in" link). It's never actually popped for the common
// Sign In <-> Forgot Password switch, since the key AuthLayout gives this
// component doesn't change between those two -- this is the same
// component instance the whole time.
const SignInOrForgotCard = forwardRef<HTMLDivElement, SignInOrForgotCardProps>(function SignInOrForgotCard(
  { mode },
  ref,
) {
  const { login } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signInError, setSignInError] = useState<string | null>(null)
  const [signInSubmitting, setSignInSubmitting] = useState(false)

  const [forgotSubmitting, setForgotSubmitting] = useState(false)
  // Deliberately a single "done" flag, not a distinct success/error state
  // -- the API always returns the same generic response regardless of
  // whether the email matched an account (see POST /auth/forgot-password's
  // own comment), so this component has nothing more specific to show.
  const [forgotDone, setForgotDone] = useState(false)

  async function handleSignIn(event: FormEvent) {
    event.preventDefault()
    setSignInError(null)
    setSignInSubmitting(true)

    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSignInSubmitting(false)
    }
  }

  const buttonLabel =
    mode === 'sign-in' ? (signInSubmitting ? 'Signing in…' : 'Sign in') : forgotSubmitting ? 'Sending…' : 'Send reset link'

  async function handleForgot(event: FormEvent) {
    event.preventDefault()
    setForgotSubmitting(true)

    try {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })
    } catch {
      // Same generic outcome either way -- see above.
    } finally {
      setForgotSubmitting(false)
      setForgotDone(true)
    }
  }

  return (
    <motion.div ref={ref} layout className="login-panel-surface relative z-10 w-full max-w-sm p-8 shadow-2xl">
      <motion.img layout src="/branding/logo-white-512.png" alt="Ink Manager" className="mx-auto mb-2 h-24 w-auto" />

      <form onSubmit={mode === 'sign-in' ? handleSignIn : handleForgot}>
        <motion.input
          layout
          id="email"
          type="email"
          required
          placeholder="Email"
          aria-label="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="login-input mb-6 w-full px-3 py-3 text-sm"
        />

        {/* Content genuinely unique to each mode, above the persistent
            button: sign-in's error banner + password field, or forgot-
            password's explanatory paragraph. Nothing renders here once
            forgot-password is done -- there's nothing left to ask for. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {mode === 'sign-in' && (
            <motion.div key="sign-in-fields" layout variants={crossfadeVariants} initial="initial" animate="animate" exit="exit">
              {signInError && (
                <div className="mb-4 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                  {signInError}
                </div>
              )}

              <input
                id="password"
                type="password"
                required
                placeholder="Password"
                aria-label="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="login-input mb-6 w-full px-3 py-3 text-sm"
              />
            </motion.div>
          )}

          {mode === 'forgot-password' && !forgotDone && (
            <motion.div key="forgot-fields" layout variants={crossfadeVariants} initial="initial" animate="animate" exit="exit">
              <p className="mb-4 text-center text-sm text-[var(--login-smoke)]">
                Enter your email above and we'll send you a link to reset your password.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The persistent button itself: same element, same position/
            size/styling, across Sign In <-> Forgot Password -- it only
            unmounts for the one state that never had a button at all
            (forgot-password's post-submit confirmation). Only the label
            TEXT inside gets its own small blur-fade swap. */}
        {!(mode === 'forgot-password' && forgotDone) && (
          <motion.button
            layout
            type="submit"
            disabled={mode === 'sign-in' ? signInSubmitting : forgotSubmitting}
            className="login-button login-jura relative w-full overflow-hidden px-4 py-3 text-xs font-bold uppercase disabled:opacity-60"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={buttonLabel}
                variants={blurTextVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="inline-block"
              >
                {buttonLabel}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        )}

        {/* Content genuinely unique to each mode, below the button: the
            mode-switch link, or (once forgot-password is done) the
            confirmation message replacing the button entirely. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {mode === 'sign-in' && (
            <motion.div key="sign-in-link" layout variants={crossfadeVariants} initial="initial" animate="animate" exit="exit">
              <Link
                to="/forgot-password"
                className="login-jura mt-4 block text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--login-smoke)] hover:text-[var(--login-cream)]"
              >
                Forgot password?
              </Link>
            </motion.div>
          )}

          {mode === 'forgot-password' && !forgotDone && (
            <motion.div key="forgot-link" layout variants={crossfadeVariants} initial="initial" animate="animate" exit="exit">
              <Link
                to="/login"
                className="login-jura mt-4 block text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--login-smoke)] hover:text-[var(--login-cream)]"
              >
                Back to sign in
              </Link>
            </motion.div>
          )}

          {mode === 'forgot-password' && forgotDone && (
            <motion.div key="forgot-done" layout variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" className="text-center">
              <p className="mb-4 text-sm text-[var(--login-cream)]">
                If an account exists for that email, a password reset link has been sent. Check your inbox.
              </p>

              <Link
                to="/login"
                className="login-jura inline-block text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--login-gold)] hover:text-[var(--login-gold-hi)]"
              >
                Back to sign in
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </form>
    </motion.div>
  )
})

export default SignInOrForgotCard
