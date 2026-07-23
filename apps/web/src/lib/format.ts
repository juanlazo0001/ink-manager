export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
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

export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10)
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
