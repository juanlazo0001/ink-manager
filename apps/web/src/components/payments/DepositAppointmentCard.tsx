import { formatAppointmentDateTime } from '../../lib/format'
import { buildGoogleCalendarUrl, buildIcsContent, downloadIcs } from '../../lib/calendar'

// State-aware, per the real post-payment states (investigated against
// issueGiftCardForPaidDeposit, apps/api/src/lib/deposits.ts): paying a
// deposit does NOT always produce a real appointment -- a scheduling
// conflict re-checked at payment time can leave the deposit paid with no
// Appointment row at all. Confirmed (startIso/endIso both present) gets
// the explicit date/time + Add to Calendar; needs-scheduling gets honest
// "what happens next" copy, no calendar button, no fabricated time.
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
  const confirmed = Boolean(startIso && endIso)

  if (!confirmed) {
    return (
      <div className="mt-5 rounded-lg border border-border p-4 text-left">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Your appointment</p>
        <p className="mt-1 text-sm font-medium text-fg">Not yet scheduled</p>
        <p className="mt-2 text-sm text-fg-secondary">
          {studioName} will reach out to lock in a time that works{artistName ? ` with ${artistName}` : ''}. You
          don't need to do anything else right now.
        </p>
      </div>
    )
  }

  const title = artistName ? `Tattoo session with ${artistName} — ${studioName}` : `Tattoo session — ${studioName}`
  const event = { title, startIso: startIso!, endIso: endIso!, address }

  function handleDownloadIcs() {
    downloadIcs('appointment.ics', buildIcsContent(event))
  }

  return (
    <div className="mt-5 rounded-lg border border-border p-4 text-left">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Your appointment</p>
      <p className="mt-1 text-sm font-medium text-fg">{formatAppointmentDateTime(startIso!, timeZone)}</p>
      {address && <p className="mt-1 text-sm text-fg-secondary">{address}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleDownloadIcs}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface-inset"
        >
          Add to Calendar (.ics)
        </button>
        <a
          href={buildGoogleCalendarUrl(event)}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface-inset"
        >
          Google Calendar
        </a>
      </div>
    </div>
  )
}
