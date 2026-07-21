// Pure client-side slot-suggestion algorithm for AppointmentForm's "New
// Appointment" flow. Deliberately client-side (no new backend endpoint):
// the inputs it needs -- Artist.preferredSchedule and the artist's own
// appointments in range -- are both already fetchable from existing
// routes, and this only ever *suggests*, it never blocks; the real
// enforcement (buffer warning) still happens server-side on submit exactly
// as before.
//
// Deliberately does NOT factor in Location.hours -- there's no
// Artist.locationId to resolve which location an artist belongs to, only
// User.locationId (unselected by /artists today), so location hours would
// need a separate lookup with no clean way to associate it back to the
// artist. An artist's own preferredSchedule is the more directly relevant
// signal anyway (it's literally named for this); studio-wide default hours
// are used as a fallback only when an artist hasn't configured one.

export interface ScheduleBlock {
  dayOfWeek: number
  startTime: string // HH:mm
  endTime: string // HH:mm
}

export interface ExistingAppointmentRange {
  startTime: string // ISO
  endTime: string // ISO
}

export interface SuggestedSlot {
  date: string // yyyy-mm-dd
  startTime: string // HH:mm
  endTime: string // HH:mm
}

// Same 1.5h buffer AppointmentForm's own submit already gets warned about
// server-side (apps/api/src/lib/schedulingConflict.ts's SCHEDULING_BUFFER_MS)
// -- mirrored here so a "suggested" slot is never one that would immediately
// trigger that same warning.
const BUFFER_MINUTES = 90
const DEFAULT_DURATION_MINUTES = 120
const DEFAULT_WINDOW_START = '10:00'
const DEFAULT_WINDOW_END = '18:00'
const SLOT_STEP_MINUTES = 30
const SEARCH_DAYS = 14
const MAX_SUGGESTIONS = 6

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Local (not UTC) yyyy-mm-dd -- same off-by-one-day trap Calendar.tsx's own
// dateKey helper guards against, avoided here the same way.
function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function suggestAppointmentSlots(params: {
  schedule: ScheduleBlock[] | null
  isGuest: boolean
  guestStartDate: string | null
  guestEndDate: string | null
  existingAppointments: ExistingAppointmentRange[]
  now?: Date
  durationMinutes?: number
}): SuggestedSlot[] {
  const {
    schedule,
    isGuest,
    guestStartDate,
    guestEndDate,
    existingAppointments,
    now = new Date(),
    durationMinutes = DEFAULT_DURATION_MINUTES,
  } = params

  const suggestions: SuggestedSlot[] = []

  // Never suggests a slot already in the past today -- rounds up to the
  // next slot-step boundary from right now.
  const searchStart = new Date(now)
  searchStart.setSeconds(0, 0)
  const roundUp = SLOT_STEP_MINUTES - (searchStart.getMinutes() % SLOT_STEP_MINUTES || SLOT_STEP_MINUTES)
  searchStart.setMinutes(searchStart.getMinutes() + roundUp)

  for (let dayOffset = 0; dayOffset < SEARCH_DAYS && suggestions.length < MAX_SUGGESTIONS; dayOffset++) {
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() + dayOffset)
    const dateKey = localDateKey(day)

    if (isGuest) {
      if (guestStartDate && dateKey < guestStartDate.slice(0, 10)) continue
      if (guestEndDate && dateKey > guestEndDate.slice(0, 10)) continue
    }

    let windowStart: string
    let windowEnd: string
    if (schedule && schedule.length > 0) {
      // No entry for this weekday = fully unavailable that day -- same
      // convention Calendar.tsx's isArtistUnavailable already uses.
      const match = schedule.find((b) => b.dayOfWeek === day.getDay())
      if (!match) continue
      windowStart = match.startTime
      windowEnd = match.endTime
    } else {
      windowStart = DEFAULT_WINDOW_START
      windowEnd = DEFAULT_WINDOW_END
    }

    const windowStartMin = timeToMinutes(windowStart)
    const windowEndMin = timeToMinutes(windowEnd)
    if (windowEndMin - windowStartMin < durationMinutes) continue

    const dayAppointments = existingAppointments
      .map((a) => ({ start: new Date(a.startTime), end: new Date(a.endTime) }))
      .filter((a) => localDateKey(a.start) === dateKey)

    for (
      let slotStartMin = windowStartMin;
      slotStartMin + durationMinutes <= windowEndMin && suggestions.length < MAX_SUGGESTIONS;
      slotStartMin += SLOT_STEP_MINUTES
    ) {
      const slotStart = new Date(day)
      slotStart.setMinutes(slotStartMin)
      if (dayOffset === 0 && slotStart < searchStart) continue

      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000)

      const buffered = dayAppointments.some(
        (a) =>
          slotStart.getTime() < a.end.getTime() + BUFFER_MINUTES * 60_000 &&
          a.start.getTime() < slotEnd.getTime() + BUFFER_MINUTES * 60_000,
      )
      if (buffered) continue

      suggestions.push({
        date: dateKey,
        startTime: minutesToTime(slotStartMin),
        endTime: minutesToTime(slotStartMin + durationMinutes),
      })
    }
  }

  return suggestions
}
