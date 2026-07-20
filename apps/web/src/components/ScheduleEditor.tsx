// Extracted from ArtistDetail.tsx's inline preferred-schedule editor so the
// new comprehensive artist-creation page can reuse the exact same
// interaction pattern (checkbox + two time inputs per weekday, day off when
// unchecked) instead of a third independently-built copy. Data shape
// matches Artist.preferredSchedule exactly: a sparse array of
// { dayOfWeek, startTime, endTime } blocks, one entry per enabled day.
export interface ScheduleBlock {
  dayOfWeek: number
  startTime: string
  endTime: string
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function defaultScheduleDays(): (ScheduleBlock | null)[] {
  return Array.from({ length: 7 }, () => null)
}

export function scheduleDaysToBlocks(days: (ScheduleBlock | null)[]): ScheduleBlock[] {
  return days.filter((day): day is ScheduleBlock => day !== null)
}

export function scheduleBlocksToDays(blocks: ScheduleBlock[] | null): (ScheduleBlock | null)[] {
  const days = defaultScheduleDays()
  for (const block of blocks ?? []) {
    if (block.dayOfWeek >= 0 && block.dayOfWeek <= 6) days[block.dayOfWeek] = block
  }
  return days
}

interface ScheduleEditorProps {
  days: (ScheduleBlock | null)[]
  onChange: (days: (ScheduleBlock | null)[]) => void
  editable: boolean
}

export default function ScheduleEditor({ days, onChange, editable }: ScheduleEditorProps) {
  function toggleDay(dayOfWeek: number, enabled: boolean) {
    const next = [...days]
    next[dayOfWeek] = enabled ? { dayOfWeek, startTime: '09:00', endTime: '17:00' } : null
    onChange(next)
  }

  function updateTime(dayOfWeek: number, field: 'startTime' | 'endTime', value: string) {
    const next = [...days]
    const day = next[dayOfWeek]
    if (day) next[dayOfWeek] = { ...day, [field]: value }
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {DAY_NAMES.map((dayName, dayOfWeek) => {
        const day = days[dayOfWeek]
        return (
          <div key={dayOfWeek} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
            <label className="flex w-32 shrink-0 items-center gap-2 text-sm text-fg-secondary">
              {editable ? (
                <input
                  type="checkbox"
                  checked={day !== null}
                  onChange={(e) => toggleDay(dayOfWeek, e.target.checked)}
                  className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                />
              ) : null}
              {dayName}
            </label>

            {day ? (
              editable ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={day.startTime}
                    onChange={(e) => updateTime(dayOfWeek, 'startTime', e.target.value)}
                    className="rounded-lg border border-border bg-surface-inset px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <span className="text-fg-muted">to</span>
                  <input
                    type="time"
                    value={day.endTime}
                    onChange={(e) => updateTime(dayOfWeek, 'endTime', e.target.value)}
                    className="rounded-lg border border-border bg-surface-inset px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              ) : (
                <span className="text-sm text-fg-secondary">
                  {day.startTime} – {day.endTime}
                </span>
              )
            ) : (
              <span className="text-sm text-fg-muted">Not available</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
