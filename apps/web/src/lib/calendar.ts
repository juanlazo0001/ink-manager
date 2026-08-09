// Deposit confirmation enrichment: Add to Calendar (.ics download + Google
// Calendar link) for a CONFIRMED post-payment appointment only -- never
// called for a needs-scheduling state, since there's no real time to put
// in a calendar yet.

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

// UTC, Z-suffixed -- RFC 5545's own DATE-TIME form, universally
// timezone-correct regardless of which zone the calendar app (or its
// viewer) is in, since every real calendar client converts a UTC instant
// to the viewer's own local time correctly. Simpler and more robust than
// embedding a VTIMEZONE block, which needs real IANA transition-rule data
// this app has no library for -- the startTime/endTime this app already
// stores are true UTC instants representing the correct real-world
// moment, so this is "timezone-correct" without needing to know or
// re-derive the studio's own zone at all here (that only matters for the
// on-page TEXT display, which uses Intl.DateTimeFormat with an explicit
// timeZone elsewhere).
function toIcsUtc(iso: string): string {
  const d = new Date(iso)
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

// RFC 5545 TEXT escaping -- backslash, comma, semicolon, and embedded
// newlines are all structurally significant in an ICS value.
function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n')
}

export interface CalendarEventInput {
  title: string
  startIso: string
  endIso: string
  address: string | null
  description?: string
}

export function buildIcsContent(event: CalendarEventInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ink Manager//Appointment//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@inkmanager.app`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(event.startIso)}`,
    `DTEND:${toIcsUtc(event.endIso)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    ...(event.address ? [`LOCATION:${escapeIcsText(event.address)}`] : []),
    ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  // CRLF line endings per RFC 5545, not just \n.
  return lines.join('\r\n')
}

export function downloadIcs(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function buildGoogleCalendarUrl(event: CalendarEventInput): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toIcsUtc(event.startIso)}/${toIcsUtc(event.endIso)}`,
  })
  if (event.address) params.set('location', event.address)
  if (event.description) params.set('details', event.description)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
