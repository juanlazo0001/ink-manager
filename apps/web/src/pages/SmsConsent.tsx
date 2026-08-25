import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import PublicPageFooter from '../components/PublicPageFooter'

// Public, unauthenticated: the client's own SMS opt-in page, opened from a
// single-use link staff issued from the client record.
//
// Same "one of the platform's own Editorial Gold pages, never
// studio-themed" treatment as GiftCardResponse/DepositResponse -- the
// login-shell CSS redefines the --color-* properties the bg-bg/text-fg
// utilities read, so this deliberately does NOT call applyThemePreset and
// pollute the global [data-theme] for wherever the visitor goes next.
//
// The consent copy is not decorative. A2P 10DLC / CTIA expect an opt-in
// surface to name the sender, describe the message types, state frequency
// and rate disclosure, and show the STOP/HELP instructions -- and the
// checkbox must be unticked by default, because a pre-ticked box is
// exactly the "consent that isn't freely given" a carrier reviewer flags.
// This codebase has already been through that once on the public intake
// form (routes/smsConsentOptional.test.ts documents it).

interface ConsentView {
  studioName: string
  studioSlug: string | null
  studioLogoUrl: string | null
  studioPhone: string | null
  themePreset: string | null
  clientFirstName: string
  maskedPhone: string | null
}

type PageState = 'loading' | 'ready' | 'blocked' | 'done'

export default function SmsConsent() {
  const { token } = useParams<{ token: string }>()

  const [state, setState] = useState<PageState>('loading')
  const [data, setData] = useState<ConsentView | null>(null)
  const [blockedTitle, setBlockedTitle] = useState('This link is invalid')
  const [blockedMessage, setBlockedMessage] = useState('Ask the studio for a new link.')

  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let ignore = false

    apiFetch<ConsentView>(`/sms-consent/${token}`)
      .then((result) => {
        if (ignore) return
        setData(result)
        setState('ready')
      })
      .catch((err) => {
        if (ignore) return
        const code = err instanceof ApiError ? err.code : undefined
        // already_given is a success from the client's point of view, not
        // a failure -- they are opted in, which is what they came here to
        // do. Saying "invalid link" would read as something gone wrong.
        if (code === 'already_given') {
          setBlockedTitle('You are already signed up')
          setBlockedMessage('This number is already set up to receive texts. Reply STOP to any message to opt out.')
        } else if (code === 'opted_out') {
          setBlockedTitle('You opted out of texts')
          setBlockedMessage('To start receiving texts again, send START to the studio from the phone you want to use.')
        } else if (code === 'expired') {
          setBlockedTitle('This link has expired')
          setBlockedMessage('Ask the studio to send you a new one.')
        } else if (code === 'no_phone') {
          setBlockedTitle('No phone number on file')
          setBlockedMessage('Ask the studio to add your number, then send a new link.')
        } else {
          setBlockedTitle('This link is invalid')
          setBlockedMessage(err instanceof Error ? err.message : 'Ask the studio for a new link.')
        }
        setState('blocked')
      })

    return () => {
      ignore = true
    }
  }, [token])

  async function handleSubmit() {
    if (!token || !agreed || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await apiFetch(`/sms-consent/${token}`, { method: 'POST' })
      setState('done')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-shell flex min-h-screen items-center justify-center px-4 py-10 text-fg">
      <div className="login-panel-surface w-full max-w-lg px-4 py-8 sm:p-8">
        {state === 'loading' && <p className="text-center text-sm text-fg-secondary">Loading&hellip;</p>}

        {state === 'blocked' && (
          <div className="text-center">
            <h1 className="login-jura text-xl font-semibold text-fg">{blockedTitle}</h1>
            <p className="mt-2 text-sm text-fg-secondary">{blockedMessage}</p>
          </div>
        )}

        {state === 'done' && data && (
          <div className="text-center">
            {data.studioLogoUrl && (
              <img src={data.studioLogoUrl} alt={data.studioName} className="mx-auto mb-4 h-14 w-auto object-contain" />
            )}
            <h1 className="login-jura text-xl font-semibold text-fg">You&rsquo;re all set</h1>
            <p className="mt-2 text-sm text-fg-secondary">
              {data.studioName} can now text you{data.maskedPhone ? ` at ${data.maskedPhone}` : ''}. You should get a
              confirmation text shortly.
            </p>
            <p className="mt-4 text-xs text-fg-muted">
              Changed your mind? Reply <span className="font-semibold text-fg-secondary">STOP</span> to any message to
              opt out, or <span className="font-semibold text-fg-secondary">HELP</span> for help.
            </p>
          </div>
        )}

        {state === 'ready' && data && (
          <div>
            <div className="text-center">
              {data.studioLogoUrl && (
                <img
                  src={data.studioLogoUrl}
                  alt={data.studioName}
                  className="mx-auto mb-4 h-14 w-auto object-contain"
                />
              )}
              <h1 className="login-jura text-xl font-semibold text-fg">Text messages from {data.studioName}</h1>
              <p className="mt-2 text-sm text-fg-secondary">
                Hi {data.clientFirstName} &mdash; turn on text messages so we can reach you about your appointments.
              </p>
            </div>

            {data.maskedPhone && (
              <p className="mt-5 rounded-lg border border-border bg-surface-inset px-3 py-2 text-center text-sm text-fg">
                Messages will go to <span className="font-semibold">{data.maskedPhone}</span>
              </p>
            )}

            <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-surface-inset">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
              />
              <span className="text-sm text-fg-secondary">
                I agree to receive text messages from {data.studioName} about my appointments, including reminders and
                updates. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for
                help.
              </span>
            </label>

            {submitError && <p className="mt-3 text-sm text-danger">{submitError}</p>}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!agreed || submitting}
              className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Turn on text messages'}
            </button>

            <p className="mt-4 text-center text-xs text-fg-muted">
              You can opt out at any time by replying STOP.
              {data.studioPhone ? ` Questions? Call ${data.studioPhone}.` : ''}
            </p>
          </div>
        )}

        <PublicPageFooter studioSlug={data?.studioSlug} />
      </div>
    </div>
  )
}
