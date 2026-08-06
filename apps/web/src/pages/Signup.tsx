import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { apiFetch } from '../lib/api'
import { crossfadeVariants, uiSpringTransition } from '../lib/motion'

type Persona = 'SOLO' | 'STUDIO'
type Step = 'persona' | 'details' | 'check-email'

// Single route, three internal steps -- unlike Sign In <-> Forgot Password
// (two different URLs AuthLayout has to specially keep one component
// instance across, see SignInOrForgotCard's own comment), everything here
// already lives in one component instance for the whole flow, so the
// "shared elements persist, only step content swaps" effect just falls
// out of normal React state -- the logo/card wrapper below never
// unmounts, only the nested AnimatePresence's step content does. Same
// crossfadeVariants + spring this app's other step-based motion uses, not
// a new pattern. The card itself (`login-panel-surface`, backdrop-filter)
// only ever gets `layout` (a resize animation), never enter/exit variants
// -- same discipline as SignInOrForgotCard's outer wrapper, since
// backdrop-filter combined with an animating transform/opacity is what
// causes the flicker this app avoids elsewhere.
export default function Signup() {
  const [step, setStep] = useState<Step>('persona')
  const [persona, setPersona] = useState<Persona | null>(null)
  const [studioName, setStudioName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle')

  function choosePersona(next: Persona) {
    setPersona(next)
    setStep('details')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await apiFetch('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          persona,
          ...(persona === 'STUDIO' ? { studioName: studioName.trim() } : {}),
          ownerName: ownerName.trim(),
          email: email.trim(),
          password,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
      })
      setStep('check-email')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResend() {
    setResendState('sending')
    try {
      await apiFetch('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: email.trim() }) })
    } catch {
      // Same generic outcome either way -- matches forgot-password's own
      // identical-response-regardless convention (see that route/card).
    } finally {
      setResendState('sent')
    }
  }

  return (
    <motion.div layout className="login-panel-surface relative z-10 w-full max-w-sm p-8 shadow-2xl">
      <motion.img layout src="/branding/logo-white-512.png" alt="Ink Manager" className="mx-auto mb-2 h-24 w-auto" />

      <AnimatePresence mode="popLayout" initial={false}>
        {step === 'persona' && (
          <motion.div
            key="persona"
            layout
            variants={crossfadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={uiSpringTransition}
          >
            <p className="mb-6 text-center text-sm text-[var(--login-smoke)]">How will you be using Ink Manager?</p>

            <button
              type="button"
              onClick={() => choosePersona('STUDIO')}
              className="login-input mb-3 w-full px-4 py-3 text-left transition hover:border-[var(--login-gold)]"
            >
              <span className="login-jura block text-xs font-bold uppercase tracking-[0.1em] text-[var(--login-cream)]">
                I run a studio
              </span>
              <span className="mt-1 block text-xs text-[var(--login-smoke)]">
                Multiple artists, one shared calendar and client list.
              </span>
            </button>

            <button
              type="button"
              onClick={() => choosePersona('SOLO')}
              className="login-input w-full px-4 py-3 text-left transition hover:border-[var(--login-gold)]"
            >
              <span className="login-jura block text-xs font-bold uppercase tracking-[0.1em] text-[var(--login-cream)]">
                I'm an independent artist
              </span>
              <span className="mt-1 block text-xs text-[var(--login-smoke)]">
                Just you -- your own bookings, clients, and profile.
              </span>
            </button>

            <Link
              to="/login"
              className="login-jura mt-4 block text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--login-smoke)] hover:text-[var(--login-cream)]"
            >
              Already have an account? Sign in
            </Link>
          </motion.div>
        )}

        {step === 'details' && persona && (
          <motion.div
            key="details"
            layout
            variants={crossfadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={uiSpringTransition}
          >
            <form onSubmit={handleSubmit}>
              {error && (
                <div className="mb-4 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}

              {persona === 'STUDIO' && (
                <input
                  type="text"
                  required
                  placeholder="Studio name"
                  aria-label="Studio name"
                  value={studioName}
                  onChange={(event) => setStudioName(event.target.value)}
                  className="login-input mb-3 w-full px-3 py-3 text-sm"
                />
              )}
              <input
                type="text"
                required
                placeholder="Your name"
                aria-label="Your name"
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                className="login-input mb-3 w-full px-3 py-3 text-sm"
              />
              <input
                type="email"
                required
                placeholder="Email"
                aria-label="Email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="login-input mb-3 w-full px-3 py-3 text-sm"
              />
              <input
                type="password"
                required
                placeholder="Password (min 8 characters)"
                aria-label="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="login-input mb-3 w-full px-3 py-3 text-sm"
              />
              <input
                type="tel"
                placeholder="Phone (optional)"
                aria-label="Phone (optional)"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className="login-input mb-6 w-full px-3 py-3 text-sm"
              />

              <button
                type="submit"
                disabled={submitting}
                className="login-button login-jura w-full px-4 py-3 text-xs font-bold uppercase disabled:opacity-60"
              >
                {submitting ? 'Creating account…' : persona === 'STUDIO' ? 'Create studio account' : 'Create my account'}
              </button>

              <button
                type="button"
                onClick={() => setStep('persona')}
                className="login-jura mt-4 block w-full text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--login-smoke)] hover:text-[var(--login-cream)]"
              >
                Back
              </button>
            </form>
          </motion.div>
        )}

        {step === 'check-email' && (
          <motion.div
            key="check-email"
            layout
            variants={crossfadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={uiSpringTransition}
            className="text-center"
          >
            <p className="mb-4 text-sm text-[var(--login-cream)]">
              Check your email at <span className="font-medium">{email}</span> to verify your account.
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === 'sending'}
              className="login-jura text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--login-gold)] hover:text-[var(--login-gold-hi)] disabled:opacity-60"
            >
              {resendState === 'sent' ? 'Email sent' : resendState === 'sending' ? 'Sending…' : 'Resend email'}
            </button>
            <Link
              to="/login"
              className="login-jura mt-4 block text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--login-smoke)] hover:text-[var(--login-cream)]"
            >
              Back to sign in
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
