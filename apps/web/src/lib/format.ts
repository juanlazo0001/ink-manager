import { dateLocale, DEFAULT_LOCALE, type Locale } from '../i18n/locales'

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Date only, no time -- for grouping/section headers (e.g. AuditTrail's
// per-day activity groups) where the full timestamp already shows
// per-entry and a repeated day label would be noise. `locale` defaults to
// English -- AuditTrail (staff-only, English-only for v1) never passes
// one; DepositGiftCardCard (public, locale-aware) does.
export function formatDateOnly(iso: string, locale: Locale = DEFAULT_LOCALE) {
  return new Date(iso).toLocaleDateString(dateLocale(locale), { dateStyle: 'medium' })
}

// Service lines: a FLAT-pricing service (e.g. Powder Brows) is entered with
// the SAME value in both priceEstimateLow and priceEstimateHigh (see
// InquiryDetail.tsx's estimate form) -- reusing the entire existing
// estimate pipeline unchanged, rather than adding a parallel single-price
// field. This is the one shared place every display site renders that as
// one number instead of a redundant "$X-$X" range; a genuine RANGE (Tattoo)
// estimate with low !== high still renders as a real range, unaffected.
export function formatPriceEstimate(low: number | null, high: number | null): string | null {
  if (low == null && high == null) return null
  if (low != null && high != null && low !== high) return `$${low.toLocaleString()}–$${high.toLocaleString()}`
  return `$${(low ?? high)!.toLocaleString()}`
}

export function formatStatus(status: string) {
  return status
    .toLowerCase()
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

// Package H: AWAITING_CLIENT_RESPONSE covers two meaningfully different
// moments -- the client hasn't looked yet vs. they've opened it and are
// deciding -- and investigation confirmed the timestamps to tell them apart
// (estimateSentAt/estimateOpenedAt) already existed, so this is a display
// derivation rather than a new stored status. Only that one raw status gets
// a substituted label; every other status still falls through to
// formatStatus's generic Title Case.
export function describeInquiryStatus(inquiry: {
  status: string
  estimateSentAt?: string | null
  estimateOpenedAt?: string | null
}): string {
  if (inquiry.status === 'AWAITING_CLIENT_RESPONSE' && inquiry.estimateSentAt) {
    return inquiry.estimateOpenedAt ? 'Opened, awaiting response' : 'Sent, not opened yet'
  }
  return formatStatus(inquiry.status)
}

// An appointment can be structurally REQUESTED/CONFIRMED while still
// needing staff attention -- an unsigned waiver, or a session that already
// happened but hasn't been checked out -- which the raw AppointmentStatus
// enum has no way to represent on its own. Unlike describeInquiryStatus
// above, this returns a synthetic status KEY (mapped in StatusPill's
// STATUS_TONE, never a real AppointmentStatus value), not a pre-formatted
// label, since the pill's color needs to change too (red once checkout has
// been overdue more than 24h), not just its text -- pass the result
// straight into <StatusPill status={...} />, no label override needed.
// COMPLETED/CANCELLED/NO_SHOW are terminal and never overridden.
export function describeAppointmentStatus(appointment: {
  status: string
  checkedOutAt?: string | null
  endTime: string
  liabilityWaiver?: { status: string } | null
}): string {
  if (appointment.status !== 'REQUESTED' && appointment.status !== 'CONFIRMED') {
    return appointment.status
  }

  if (!appointment.checkedOutAt && new Date(appointment.endTime) < new Date()) {
    const hoursSinceEnd = (Date.now() - new Date(appointment.endTime).getTime()) / (1000 * 60 * 60)
    return hoursSinceEnd > 24 ? 'CHECKOUT_OVERDUE' : 'CHECKOUT_PENDING'
  }

  if (appointment.liabilityWaiver?.status === 'PENDING') {
    return 'WAIVER_PENDING'
  }

  return appointment.status
}

// Elapsed time between two ISO timestamps, e.g. "3h 12m" or "2d 4h" --
// used for the estimate timeline's "opened 3h 12m after sending" style notes.
export function formatDuration(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  if (ms < 0) return '0m'

  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / (60 * 24))
  const hours = Math.floor((minutes % (60 * 24)) / 60)
  const mins = minutes % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

// Flash gallery duration, shown/entered in hours everywhere (FlashGallery.tsx,
// FlashPublicGallery.tsx) even though FlashPiece.estimatedDurationMinutes is
// still stored in minutes -- that's what the self-scheduling duration math
// elsewhere in the app (getSuggestedTimes, selfSchedule.ts's durationMinutesFor)
// actually consumes, so the underlying unit is unchanged, only the unit
// staff sees/enters. Trims a whole-number hour to "2 hrs" rather than "2.00 hrs".
export function formatDurationHours(minutes: number): string {
  const hours = minutes / 60
  const label = Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100)
  return `${label} hr${hours === 1 ? '' : 's'}`
}

// Short relative time for conversation list rows, e.g. "3m", "5h", "2d".
export function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(ms / 60_000)

  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`

  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Compact due-date display for task rows (mobile row redesign): "Today"/
// "Tomorrow", else a short date ("Aug 7"), with the year appended only
// when it isn't the current year. Deliberately no "Yesterday"/"N days
// ago" wording -- an overdue task's date still just reads as a plain
// short date, distinguished by color (see the task row's own overdue
// styling), not by a different word. Browser-local calendar day -- tasks
// have no per-studio timezone concept the way appointments/settings do
// (a plain <input type="date">, already compared client-side elsewhere
// in Tasks.tsx's own isOverdue).
export function formatCompactDueDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayDiff = Math.round((dateDay - today) / 86_400_000)

  if (dayDiff === 0) return 'Today'
  if (dayDiff === 1) return 'Tomorrow'

  const includeYear = date.getFullYear() !== now.getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' as const } : {}),
  })
}

// The civil (calendar) date of `date` as observed in `timeZone` -- needed
// because "today"/"yesterday" depend on the studio's own timezone, not the
// browser's, and not a naive UTC day boundary either.
function civilDateParts(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    date,
  )
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

// Plain-language timestamp for the Settings -> System panel: "Today at
// 2:00 AM", "Yesterday at 2:00 AM", "3 days ago", falling back to a short
// date beyond a week. Computed against the studio's own timezone (not the
// viewer's browser timezone) so "today" means the studio's today.
export function formatRelativeDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso)
  const target = civilDateParts(date, timeZone)
  const today = civilDateParts(new Date(), timeZone)

  const targetUtcMidnight = Date.UTC(target.y, target.m - 1, target.d)
  const todayUtcMidnight = Date.UTC(today.y, today.m - 1, today.d)
  const dayDiff = Math.round((todayUtcMidnight - targetUtcMidnight) / 86_400_000)

  const time = date.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })

  if (dayDiff === 0) return `Today at ${time}`
  if (dayDiff === 1) return `Yesterday at ${time}`
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} days ago`
  return date.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' })
}

// Deposit confirmation enrichment: the appointment card states the studio's
// timezone explicitly (per its own design brief) rather than letting a
// client assume it's shown in their own -- e.g. "Friday, August 15, 2026 at
// 2:00 PM PDT", not just a bare time. Intl's own `timeZoneName: 'short'`
// gives the correct abbreviation for the zone at that specific date (PST
// vs PDT, etc.), not a hardcoded guess.
// Multi-language public forms closeout: `locale` defaults to English --
// this function had exactly one call site (DepositAppointmentCard.tsx),
// shipped hardcoded to 'en-US' before this fix.
export function formatAppointmentDateTime(iso: string, timeZone: string, locale: Locale = DEFAULT_LOCALE): string {
  const date = new Date(iso)
  return date.toLocaleString(dateLocale(locale), {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export function formatPhoneInput(value: string): string {
  const allDigits = value.replace(/\D/g, '')
  // A leading "1" on an 11-digit run is a US country code, not part of the
  // area code -- same convention apps/api/src/lib/phone.ts's normalizePhone
  // already uses server-side. Without this, "+1 555 123 4567" (11 digits)
  // silently truncated to its first 10 -- "1555123456" -- producing a
  // garbled, wrong-looking number instead of the real one.
  const digits = (allDigits.length === 11 && allDigits.startsWith('1') ? allDigits.slice(1) : allDigits).slice(0, 10)
  const len = digits.length

  if (len === 0) return ''
  if (len < 4) return `(${digits}`
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

// Phase UI-4: a phone field is either untouched (blank -- most phone
// fields in this app are optional) or a genuinely complete 10-digit US
// number; anything in between (someone typed 6 digits and stopped) is
// invalid. Whether blank is ACTUALLY acceptable for a given field is the
// HTML `required` attribute's job, same as any other field -- this only
// answers "if something was entered, is it complete."
export function isValidPhoneDigits(digits: string): boolean {
  return digits.length === 0 || digits.length === 10
}

// Conversations' "new chat" -> "Add new client" flow: staff types once into
// a single free-text box, and this decides which field it belongs in
// instead of making them pick a field type manually. Order matters -- email
// is checked first since a stray "@" is never a plausible phone digit or,
// realistically, a name.
export type ContactFieldGuess = 'email' | 'phone' | 'name'

export function detectContactField(raw: string): ContactFieldGuess {
  const value = raw.trim()

  // "Plausible domain pattern" kept loose on purpose: anything after the
  // "@" counts, so an email that's still mid-typing (e.g. "jane@gm") lands
  // in the email field where finishing it is a single keystroke, rather
  // than in name/phone where it would look obviously wrong. A bare
  // trailing "@" with nothing after it yet doesn't count -- too little
  // signal, falls through to the name guess below.
  if (value.includes('@') && !value.endsWith('@')) return 'email'

  // Common formatting punctuation stripped before judging "predominantly
  // digits" -- spaces, dashes, parens, and a single leading "+". A
  // genuinely all-numeric name is vanishingly rare and, per this app's own
  // 10-digit US convention (isValidPhoneDigits), 7+ remaining digits is
  // itself already a strong phone signal -- staff can still correct a
  // wrong guess in the form either way.
  const digitsOnly = value.replace(/^\+/, '').replace(/[\s().-]/g, '')
  if (digitsOnly.length >= 7 && /^\d+$/.test(digitsOnly)) return 'phone'

  return 'name'
}

// Kept in sync with MAX_IMAGE_SOURCE_MB in apps/api/src/lib/images.ts.
export const MAX_IMAGE_FILE_BYTES = 5_000_000 // 5MB; base64-encoded this stays under the API's data URL limit

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
