import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { FlatArtistAvatar } from '../components/ArtistAvatar'
import { applyThemePreset } from '../lib/themePresets'
import PublicPageFooter from '../components/PublicPageFooter'

type PageState = 'loading' | 'invalid' | 'ready' | 'success'

interface SuggestedTimeCandidate {
  startTime: string
  endTime: string
  hasBufferConflict: boolean
}

interface VerifyResponse {
  clientFirstName: string
  studioName: string
  studioSlug: string
  studioLogoUrl: string | null
  themePreset: string
  artistName: string
  artistAvatarUrl: string | null
  durationMinutes: number
  candidates: SuggestedTimeCandidate[]
}

export default function SelfSchedule() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState('This link is invalid or has expired.')
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null)
  const [confirmed, setConfirmed] = useState<{ startTime: string; endTime: string } | null>(null)

  const [selected, setSelected] = useState<SuggestedTimeCandidate | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return

    let ignore = false

    apiFetch<VerifyResponse>(`/self-schedule/verify/${token}`)
      .then((data) => {
        if (ignore) return
        setVerifyData(data)
        applyThemePreset(data.themePreset)
        setState('ready')
      })
      .catch((err) => {
        if (ignore) return
        setInvalidMessage(err instanceof Error ? err.message : 'This link is invalid or has expired.')
        setState('invalid')
      })

    return () => {
      ignore = true
    }
  }, [token])

  async function submit() {
    if (!token || !selected) return

    setSubmitError(null)
    setSubmitting(true)

    try {
      const result = await apiFetch<{ success: true; startTime: string; endTime: string }>(
        `/self-schedule/respond/${token}`,
        { method: 'PATCH', body: JSON.stringify({ startTime: selected.startTime, endTime: selected.endTime }) },
      )
      setConfirmed({ startTime: result.startTime, endTime: result.endTime })
      setState('success')
    } catch (err) {
      // A 409 (slot taken since /verify loaded) or 400 (stale/mismatched
      // selection) both land here as a plain message -- re-fetching fresh
      // candidates isn't attempted automatically; the client can reload the
      // link to see current availability.
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-lg rounded-2xl card-surface border border-border bg-surface p-8">
        {state === 'loading' && <p className="text-center text-sm text-fg-secondary">Loading…</p>}

        {state === 'invalid' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">This link has expired</h1>
            <p className="mt-2 text-sm text-fg-secondary">{invalidMessage}</p>
            <p className="mt-4 text-sm text-fg-secondary">Please contact the studio to schedule your appointment.</p>
          </div>
        )}

        {state === 'success' && confirmed && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">Request sent!</h1>
            <p className="mt-2 text-sm text-fg-secondary">
              You've requested {formatDateTime(confirmed.startTime)} – {formatDateTime(confirmed.endTime)}. The
              studio will confirm this time shortly -- it's not booked yet, so keep an eye out for a message from
              them.
            </p>
          </div>
        )}

        {state === 'ready' && verifyData && (
          <div>
            {verifyData.studioLogoUrl && (
              <img
                src={verifyData.studioLogoUrl}
                alt={verifyData.studioName}
                className="mb-4 h-10 w-auto object-contain"
              />
            )}
            <h1 className="text-xl font-semibold text-fg">Pick a time</h1>
            <p className="mt-1 text-sm font-medium text-fg-secondary">{verifyData.studioName}</p>
            <div className="mt-3 flex items-center gap-2.5">
              <FlatArtistAvatar name={verifyData.artistName} avatarUrl={verifyData.artistAvatarUrl} className="h-8 w-8" />
              <p className="text-sm text-fg-secondary">
                {verifyData.clientFirstName}, here's {verifyData.artistName}'s next available times.
              </p>
            </div>

            <p className="mt-5 text-xs font-medium uppercase tracking-wider text-fg-muted">
              Suggested times
            </p>

            {verifyData.candidates.length === 0 && (
              <p className="mt-2 text-sm text-fg-secondary">
                No open times found right now -- please contact the studio directly to schedule.
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-2">
              {verifyData.candidates.map((candidate) => {
                const isSelected = selected?.startTime === candidate.startTime
                return (
                  <button
                    key={candidate.startTime}
                    type="button"
                    onClick={() => setSelected(candidate)}
                    className={[
                      'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                      isSelected ? 'border-accent bg-accent/15 text-accent' : 'border-border text-fg-secondary hover:bg-surface',
                    ].join(' ')}
                  >
                    {formatDateTime(candidate.startTime)} – {formatDateTime(candidate.endTime)}
                    {candidate.hasBufferConflict && (
                      <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                        Close
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <p className="mt-5 rounded-lg border border-border bg-surface-inset p-3 text-xs text-fg-secondary">
              Picking a time sends a request to {verifyData.studioName} -- it's not a confirmed booking until they
              get back to you.
            </p>

            {submitError && (
              <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {submitError}
              </div>
            )}

            <div className="mt-6">
              <button
                type="button"
                onClick={submit}
                disabled={!selected || submitting}
                className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
              >
                {submitting ? 'Requesting…' : 'Request this time'}
              </button>
            </div>
          </div>
        )}

        <PublicPageFooter studioSlug={verifyData?.studioSlug} />
      </div>
    </div>
  )
}
