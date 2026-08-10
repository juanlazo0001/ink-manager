import { formatAppointmentDateTime } from '../../lib/format'
import { buildGoogleCalendarUrl, buildIcsContent, downloadIcs } from '../../lib/calendar'
import { useTranslations, useLocale } from '../../i18n'

// State-aware, per the real post-payment states (investigated against
// issueGiftCardForPaidDeposit, apps/api/src/lib/deposits.ts): paying a
// deposit does NOT always produce a real appointment -- a scheduling
// conflict re-checked at payment time can leave the deposit paid with no
// Appointment row at all. Confirmed (startIso/endIso both present) gets
// the explicit date/time + Add to Calendar; needs-scheduling gets honest
// "what happens next" copy, no calendar button, no fabricated time.
//
// Multi-language public forms closeout: this shipped to main (post-branch-
// cut) with hardcoded English -- folded into t() here, same withArtist
// interpolation pattern DepositResponse.tsx's own agreement-intro string
// already uses. Callers always render this inside DepositResponse's own
// <LocaleProvider>, so useTranslations() here is safe.
//
// Part 2 sizing pass: rounded-2xl/p-5 (was rounded-lg/p-4), larger
// date/time text, larger pill buttons -- matches the reference screenshot's
// own card treatment, and the app's own established convention for a
// PRIMARY standalone card (Dashboard/Widget/Team/Settings all use
// rounded-2xl for this exact role, vs. rounded-lg for the smaller inline
// info asides elsewhere in this same payment family -- e.g.
// PaymentBreakdownDisclosure, PaymentTipStage's own total-today box).
// Reused by DepositGiftCardCard and the referral block right below it for
// a consistent card language. The eyebrow label itself (below) went to
// text-sm during that same pass, matched against this reference screenshot
// -- a later typography audit (computed styles, not the screenshot) found
// that was drift: text-xs is the established convention for this exact
// role everywhere else in the app (129 existing instances, including this
// same family's own PaymentBreakdownDisclosure and EstimateResponse),
// reverted back to text-xs.
const CARD_CLASS = 'relative z-10 mt-5 rounded-2xl border border-border p-5 text-left'

export default function DepositAppointmentCard({
  startIso,
  endIso,
  timeZone,
  address,
  artistName,
  studioName,
}: {
  startIso: string | null
  endIso: string | null
  timeZone: string
  address: string | null
  artistName: string | null
  studioName: string
}) {
  const { t } = useTranslations()
  const { locale } = useLocale()
  const confirmed = Boolean(startIso && endIso)
  const withArtist = artistName ? t('deposit.withArtistSuffix', { artistName }) : ''

  if (!confirmed) {
    return (
      // relative z-10: keeps this readable above the fixed personalized
      // background PaymentConfirmationStage can render as an earlier
      // sibling (position: fixed content otherwise paints above plain
      // in-flow content regardless of DOM order -- see that component's
      // own comment). No-op everywhere else.
      <div className={CARD_CLASS}>
        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('deposit.appointmentCard.label')}</p>
        <p className="mt-1 text-sm font-medium text-fg">{t('deposit.appointmentCard.notScheduledHeading')}</p>
        <p className="mt-2 text-sm text-fg-secondary">
          {t('deposit.appointmentCard.notScheduledBody', { studioName, withArtist })}
        </p>
      </div>
    )
  }

  const title = t('deposit.appointmentCard.eventTitle', { withArtist, studioName })
  const event = { title, startIso: startIso!, endIso: endIso!, address }

  function handleDownloadIcs() {
    downloadIcs('appointment.ics', buildIcsContent(event))
  }

  return (
    // relative z-10: keeps this readable above the fixed personalized
    // background PaymentConfirmationStage can render as an earlier sibling
    // (position: fixed content otherwise paints above plain in-flow
    // content regardless of DOM order -- see that component's own
    // comment). No-op everywhere else.
    <div className={CARD_CLASS}>
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('deposit.appointmentCard.label')}</p>
      <p className="mt-2 text-lg font-semibold text-fg">{formatAppointmentDateTime(startIso!, timeZone, locale)}</p>
      {address && <p className="mt-1 text-sm text-fg-secondary">{address}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleDownloadIcs}
          className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface-inset"
        >
          {t('deposit.appointmentCard.addToCalendar')}
        </button>
        <a
          href={buildGoogleCalendarUrl(event)}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface-inset"
        >
          {t('deposit.appointmentCard.googleCalendar')}
        </a>
      </div>
    </div>
  )
}
