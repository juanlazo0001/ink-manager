interface MiniScheduleSnippetProps {
  date: string // yyyy-mm-dd, local
  appointments: { startTime: string; endTime: string }[]
  highlightStart: string // ISO
  highlightEnd: string // ISO
}

const DAY_START_HOUR = 8
const DAY_END_HOUR = 20
const TOTAL_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60

function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function toPercent(iso: string): number {
  const d = new Date(iso)
  const minutes = d.getHours() * 60 + d.getMinutes() - DAY_START_HOUR * 60
  return Math.min(100, Math.max(0, (minutes / TOTAL_MINUTES) * 100))
}

// Deliberately a simple custom strip, not a second embedded
// Calendar/react-big-calendar instance -- just enough to let staff glance
// at "does this artist already have something else that day" alongside a
// suggested/selected time. One day only, 8am-8pm.
export default function MiniScheduleSnippet({ date, appointments, highlightStart, highlightEnd }: MiniScheduleSnippetProps) {
  const dayAppointments = appointments.filter((a) => localDateKey(new Date(a.startTime)) === date)

  return (
    <div className="mt-3">
      <p className="mb-1 text-xs text-fg-muted">
        {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })}{' '}
        schedule
      </p>
      <div className="relative h-6 w-full overflow-hidden rounded-full bg-surface-inset">
        {dayAppointments.map((appt, index) => (
          <div
            key={index}
            className="absolute top-0 h-full bg-fg-muted/40"
            style={{
              left: `${toPercent(appt.startTime)}%`,
              width: `${Math.max(1, toPercent(appt.endTime) - toPercent(appt.startTime))}%`,
            }}
          />
        ))}
        <div
          className="absolute top-0 h-full rounded-full bg-accent/70"
          style={{
            left: `${toPercent(highlightStart)}%`,
            width: `${Math.max(2, toPercent(highlightEnd) - toPercent(highlightStart))}%`,
          }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-fg-muted">
        <span>{DAY_START_HOUR}:00</span>
        <span>{DAY_END_HOUR}:00</span>
      </div>
    </div>
  )
}
