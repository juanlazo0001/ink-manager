import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { DayPicker } from 'react-day-picker'
import { es as dayPickerEs, enUS as dayPickerEnUs } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { FlatArtistAvatar } from '../components/ArtistAvatar'
import { applyThemePreset } from '../lib/themePresets'
import PublicPageFooter from '../components/PublicPageFooter'
import { toDateString, parseDateString } from '../components/DateAndTimeRangeFields'
import { LocaleProvider, useLocale, useTranslations, dateLocale, type Locale } from '../i18n'

// Token-lifecycle bug fix: 'alreadyBooked' is new -- a client revisiting
// their own link after their booking already completed (see
// Inquiry.selfScheduleBookedAt's own schema comment) now gets a real
// "you're all set" message instead of a bare "invalid."
type PageState = 'loading' | 'invalid' | 'ready' | 'success' | 'alreadyBooked'
// Same three-way distinction as EstimateResponse.tsx's own fix -- see that
// file's comment. This picker's own token can genuinely be superseded too
// (a resend via revise-estimate's self-scheduling-aware branch), unlike
// the revision-response page's more limited two-way version.
type InvalidKind = 'invalid' | 'expired' | 'superseded'

function invalidKindFromStatus(status: number | undefined): InvalidKind {
  if (status === 409) return 'superseded'
  if (status === 410) return 'expired'
  return 'invalid'
}

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
  // Language becomes customer-specific: which locale the API actually
  // resolved (this client's own stored preference, else Accept-Language)
  // -- synced back into LocaleProvider on load, same pattern as every
  // other flow's own verify response.
  resolvedLocale?: string
}

interface AlreadyBookedResponse {
  alreadyBooked: true
  clientFirstName: string
  studioName: string
  studioSlug: string
  themePreset: string
}

function formatTimeOnly(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleTimeString(dateLocale(locale), { hour: 'numeric', minute: '2-digit' })
}

// How far out the calendar lets someone navigate -- kept a bit past the
// backend's own SELF_SCHEDULE_SEARCH_DAYS window (90 days -- see
// selfSchedule.ts) so every date the backend could ever mark available
// is actually reachable by navigating forward, with a little headroom
// rather than an exact day-for-day match.
const CALENDAR_MONTHS_AHEAD = 4

export default function SelfSchedule() {
  return (
    <LocaleProvider>
      <SelfScheduleContent />
    </LocaleProvider>
  )
}

function SelfScheduleContent() {
  const { t } = useTranslations()
  const { locale, setLocale } = useLocale()

  const INVALID_HEADINGS: Record<InvalidKind, string> = {
    invalid: t('common.linkInvalidHeading'),
    expired: t('common.linkExpiredHeading'),
    superseded: t('common.linkSupersededHeading'),
  }

  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [invalidKind, setInvalidKind] = useState<InvalidKind>('invalid')
  const [invalidMessage, setInvalidMessage] = useState(t('common.linkExpiredHeading'))
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null)
  const [alreadyBookedData, setAlreadyBookedData] = useState<AlreadyBookedResponse | null>(null)
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

    // Fix pass: no explicit ?locale= on this first fetch -- see
    // DepositResponse.tsx's identical comment. This page has no other
    // server-resolved, locale-dependent content (availableDates/
    // durationMinutes/artistName aren't translatable), so unlike
    // Deposit/Waiver there's no need for a second, toggle-triggered
    // re-fetch here -- the calendar/time-slot formatting already
    // re-renders instantly off the `locale` state alone (see
    // formatTimeOnly/DayPicker's own locale prop above).
    apiFetch<VerifyResponse | AlreadyBookedResponse>(`/self-schedule/verify/${token}`)
      .then((data) => {
        if (ignore) return
        if ('alreadyBooked' in data) {
          applyThemePreset(data.themePreset)
          setAlreadyBookedData(data)
          setState('alreadyBooked')
          return
        }
        setVerifyData(data)
        applyThemePreset(data.themePreset)
        // Server-resolved locale (client's own stored preference or the
        // studio's default) wins on first load.
        if (data.resolvedLocale && data.resolvedLocale !== locale) setLocale(data.resolvedLocale as typeof locale)
        setState('ready')
      })
      .catch((err) => {
        if (ignore) return
        setInvalidKind(invalidKindFromStatus(err instanceof ApiError ? err.status : undefined))
        setInvalidMessage(err instanceof Error ? err.message : t('common.linkExpiredHeading'))
        setState('invalid')
      })

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      .catch((err) => setSlotsError(err instanceof Error ? err.message : t('selfSchedule.failedToLoadTimes')))
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
      setSubmitError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
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
        {state === 'loading' && <p className="text-center text-sm text-fg-secondary">{t('common.loading')}</p>}

        {state === 'invalid' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">{INVALID_HEADINGS[invalidKind]}</h1>
            <p className="mt-2 text-sm text-fg-secondary">{invalidMessage}</p>
            <p className="mt-4 text-sm text-fg-secondary">
              {invalidKind === 'superseded'
                ? t('common.pleaseCheckMessagesForNewestLink')
                : t('selfSchedule.invalidBodyByKind.expired')}
            </p>
          </div>
        )}

        {state === 'alreadyBooked' && alreadyBookedData && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">{t('selfSchedule.alreadyBookedHeading', { firstName: alreadyBookedData.clientFirstName })}</h1>
            <p className="mt-2 text-sm text-fg-secondary">
              {t('selfSchedule.alreadyBookedBody', { studioName: alreadyBookedData.studioName })}
            </p>
          </div>
        )}

        {state === 'success' && confirmed && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">{t('selfSchedule.requestSentHeading')}</h1>
            <p className="mt-2 text-sm text-fg-secondary">
              {t('selfSchedule.requestSentBody', {
                range: `${formatDateTime(confirmed.startTime, locale)} – ${formatDateTime(confirmed.endTime, locale)}`,
              })}
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
            <h1 className="text-xl font-semibold text-fg">{t('selfSchedule.pageHeading')}</h1>
            <p className="mt-1 text-sm font-medium text-fg-secondary">{verifyData.studioName}</p>
            <div className="mt-3 flex items-center gap-2.5">
              <FlatArtistAvatar name={verifyData.artistName} avatarUrl={verifyData.artistAvatarUrl} className="h-8 w-8" />
              <p className="text-sm text-fg-secondary">
                {t('selfSchedule.intro', { firstName: verifyData.clientFirstName, artistName: verifyData.artistName })}
              </p>
            </div>

            {verifyData.availableDates.length === 0 ? (
              <p className="mt-5 text-sm text-fg-secondary">{t('selfSchedule.noOpenTimes')}</p>
            ) : (
              <>
                <p className="mt-5 text-xs font-medium uppercase tracking-wider text-fg-muted">{t('selfSchedule.chooseDate')}</p>
                <div className="mt-2 flex justify-center rounded-xl border border-border bg-surface-inset p-2">
                  <DayPicker
                    mode="single"
                    locale={locale === 'es' ? dayPickerEs : dayPickerEnUs}
                    selected={selectedDate ? parseDateString(selectedDate) : undefined}
                    onSelect={(day) => {
                      if (!day) return
                      selectDate(toDateString(day))
                    }}
                    startMonth={today}
                    endMonth={calendarToDate}
                    disabled={(day) => !availableDateSet.has(toDateString(day))}
                    // react-day-picker/style.css defines its own light-mode
                    // --rdp-accent-color: blue (etc.) directly on .rdp-root,
                    // at the exact same specificity as index.css's own
                    // gold-accent override of that same selector -- on this
                    // page specifically, the library's stylesheet ends up
                    // injected after index.css's, so it wins the cascade
                    // tie and the calendar renders blue instead of gold.
                    // Inline styles on the root element (this `style` prop)
                    // beat any stylesheet rule regardless of injection
                    // order, so this doesn't depend on import order staying
                    // lucky the way index.css's own .rdp-root rule does.
                    style={
                      {
                        '--rdp-accent-color': 'var(--color-accent)',
                        '--rdp-accent-background-color': 'color-mix(in srgb, var(--color-accent) 20%, transparent)',
                        '--rdp-today-color': 'var(--color-accent)',
                      } as React.CSSProperties
                    }
                  />
                </div>

                {selectedDate && (
                  <div className="mt-4">
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-fg-muted">
                      {t('selfSchedule.availableTimesOn', {
                        date:
                          parseDateString(selectedDate)?.toLocaleDateString(dateLocale(locale), {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                          }) ?? '',
                      })}
                    </p>

                    {slotsLoading && <p className="text-sm text-fg-secondary">{t('selfSchedule.loadingTimes')}</p>}
                    {slotsError && <p className="text-sm text-danger">{slotsError}</p>}

                    {!slotsLoading && !slotsError && slots.length === 0 && (
                      <p className="text-sm text-fg-secondary">{t('selfSchedule.noOpenTimesOnDate')}</p>
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
                            {formatTimeOnly(slot.startTime, locale)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            <p className="mt-5 rounded-lg border border-border bg-surface-inset p-3 text-xs text-fg-secondary">
              {t('selfSchedule.requestDisclaimer', { studioName: verifyData.studioName })}
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
                {submitting ? t('selfSchedule.requesting') : t('selfSchedule.requestThisTime')}
              </button>
            </div>
          </div>
        )}

        <PublicPageFooter studioSlug={verifyData?.studioSlug} />
      </div>
    </div>
  )
}
