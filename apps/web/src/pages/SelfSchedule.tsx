import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { FlatArtistAvatar } from '../components/ArtistAvatar'
import { applyThemePreset } from '../lib/themePresets'
import PublicPageFooter from '../components/PublicPageFooter'
import { toDateString, parseDateString } from '../components/DateAndTimeRangeFields'

type PageState = 'loading' | 'invalid' | 'ready' | 'success'

interface TimeSlot {
  startTime: string
  endTime: string
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
  // yyyy-mm-dd, whichever dates have at least one genuinely open slot --
  // every other date is disabled outright in the calendar below, not just
  // greyed, since this picker only ever offers what's actually available.
  availableDates: string[]
}

function formatTimeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// How far out the calendar lets someone navigate -- every date beyond
// this is disabled anyway (the backend's own search window is narrower
// still), this just keeps the picker from scrolling into months that can
// never have anything in them.
const CALENDAR_MONTHS_AHEAD = 2

export default function SelfSchedule() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState('This link is invalid or has expired.')
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null)
  const [confirmed, setConfirmed] = useState<{ startTime: string; endTime: string } | null>(null)

  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)

  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
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

  function selectDate(date: string) {
    if (!token) return
    setSelectedDate(date)
    setSelectedSlot(null)
    setSlots([])
    setSlotsError(null)
    setSlotsLoading(true)

    apiFetch<{ slots: TimeSlot[] }>(`/self-schedule/slots/${token}?date=${date}`)
      .then((data) => setSlots(data.slots))
      .catch((err) => setSlotsError(err instanceof Error ? err.message : 'Failed to load times for this date'))
      .finally(() => setSlotsLoading(false))
  }

  async function submit() {
    if (!token || !selectedSlot) return

    setSubmitError(null)
    setSubmitting(true)

    try {
      const result = await apiFetch<{ success: true; startTime: string; endTime: string }>(
        `/self-schedule/respond/${token}`,
        { method: 'PATCH', body: JSON.stringify({ startTime: selectedSlot.startTime, endTime: selectedSlot.endTime }) },
      )
      setConfirmed({ startTime: result.startTime, endTime: result.endTime })
      setState('success')
    } catch (err) {
      // A 409 (slot taken since it was fetched) or 400 (stale/mismatched
      // selection) both land here as a plain message -- re-fetching the
      // date's slots isn't attempted automatically; picking the date again
      // (or another one) refreshes it.
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const availableDateSet = new Set(verifyData?.availableDates ?? [])
  const today = new Date()
  const calendarToDate = new Date(today.getFullYear(), today.getMonth() + CALENDAR_MONTHS_AHEAD, today.getDate())

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
                {verifyData.clientFirstName}, here's {verifyData.artistName}'s real availability.
              </p>
            </div>

            {verifyData.availableDates.length === 0 ? (
              <p className="mt-5 text-sm text-fg-secondary">
                No open times found right now -- please contact the studio directly to schedule.
              </p>
            ) : (
              <>
                <p className="mt-5 text-xs font-medium uppercase tracking-wider text-fg-muted">Choose a date</p>
                <div className="mt-2 flex justify-center rounded-xl border border-border bg-surface-inset p-2">
                  <DayPicker
                    mode="single"
                    selected={selectedDate ? parseDateString(selectedDate) : undefined}
                    onSelect={(day) => {
                      if (!day) return
                      selectDate(toDateString(day))
                    }}
                    startMonth={today}
                    endMonth={calendarToDate}
                    disabled={(day) => !availableDateSet.has(toDateString(day))}
                  />
                </div>

                {selectedDate && (
                  <div className="mt-4">
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-fg-muted">
                      Available times on {parseDateString(selectedDate)?.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                    </p>

                    {slotsLoading && <p className="text-sm text-fg-secondary">Loading times…</p>}
                    {slotsError && <p className="text-sm text-danger">{slotsError}</p>}

                    {!slotsLoading && !slotsError && slots.length === 0 && (
                      <p className="text-sm text-fg-secondary">
                        No open times left on this date -- please pick another.
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {slots.map((slot) => {
                        const isSelected = selectedSlot?.startTime === slot.startTime
                        return (
                          <button
                            key={slot.startTime}
                            type="button"
                            onClick={() => setSelectedSlot(slot)}
                            className={[
                              'rounded-full border px-3 py-1.5 text-xs font-medium transition',
                              isSelected ? 'border-accent bg-accent/15 text-accent' : 'border-border text-fg-secondary hover:bg-surface',
                            ].join(' ')}
                          >
                            {formatTimeOnly(slot.startTime)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

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
                disabled={!selectedSlot || submitting}
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
