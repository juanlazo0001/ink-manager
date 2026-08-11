import { useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import DropdownPortal from './DropdownPortal'
import TimeSelect from './TimeSelect'

// Phase UI-4: an appointment never spans more than one calendar day, so
// this is deliberately one date + two times -- never a separate end-date
// field. The date is always picked from a calendar grid (react-day-picker,
// the new standard for this app -- no existing date-picker component was
// found to reuse; every other date field in the app is a native
// `<input type="date">`), never typed by hand.
export interface DateAndTimeRangeValue {
  date: string // yyyy-mm-dd
  startTime: string // HH:mm
  endTime: string // HH:mm
}

interface DateAndTimeRangeFieldsProps {
  value: DateAndTimeRangeValue
  onChange: (value: DateAndTimeRangeValue) => void
  disabled?: boolean
  // Package I: optional, additive -- days (0 = Sunday) with no
  // preferredSchedule entry at all for the currently-selected artist get
  // greyed in the calendar grid. Omitted by every caller that doesn't have
  // an artist-schedule concept, so existing behavior is unchanged for them.
  // This is advisory styling only -- the day remains fully selectable.
  unavailableDaysOfWeek?: number[]
}

// Exported so other single-date pickers (e.g. DatePickerField) can share
// the exact same yyyy-mm-dd <-> Date conversion -- one source of truth for
// the format every date-string field in the app now uses.
export function toDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDateString(value: string): Date | undefined {
  if (!value) return undefined
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d)
}

// Pure helpers other appointment forms need too (validation, ISO
// conversion for the API payload) without embedding this component.
export function combineDateAndTime(date: string, time: string): Date | null {
  if (!date || !time) return null
  const combined = new Date(`${date}T${time}:00`)
  return Number.isNaN(combined.getTime()) ? null : combined
}

export function isCompleteTimeRange(value: DateAndTimeRangeValue): boolean {
  return !!value.date && !!value.startTime && !!value.endTime
}

export function isValidTimeRange(value: DateAndTimeRangeValue): boolean {
  const start = combineDateAndTime(value.date, value.startTime)
  const end = combineDateAndTime(value.date, value.endTime)
  if (!start || !end) return false
  return end > start
}

export default function DateAndTimeRangeFields({
  value,
  onChange,
  disabled,
  unavailableDaysOfWeek,
}: DateAndTimeRangeFieldsProps) {
  const [showCalendar, setShowCalendar] = useState(false)
  const selectedDate = parseDateString(value.date)
  const rangeInvalid = !!value.date && !!value.startTime && !!value.endTime && !isValidTimeRange(value)
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="relative">
          <label className="mb-1 block text-sm font-medium text-fg-secondary">Date</label>
          <button
            ref={buttonRef}
            type="button"
            disabled={disabled}
            onClick={() => setShowCalendar((v) => !v)}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-left text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
          >
            {selectedDate
              ? selectedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
              : 'Select a date'}
          </button>
          <DropdownPortal
            open={showCalendar}
            onClose={() => setShowCalendar(false)}
            anchorRef={buttonRef}
            maxHeightCap={360}
            className="rounded-xl border border-border bg-surface-raised p-2 shadow-xl"
          >
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={(day) => {
                if (!day) return
                onChange({ ...value, date: toDateString(day) })
                setShowCalendar(false)
              }}
              modifiers={
                unavailableDaysOfWeek && unavailableDaysOfWeek.length > 0
                  ? { unavailable: (day) => unavailableDaysOfWeek.includes(day.getDay()) }
                  : undefined
              }
              modifiersClassNames={{ unavailable: 'opacity-40' }}
              // Same fix as SelfSchedule.tsx's and DatePickerField.tsx's
              // own DayPicker: react-day-picker/style.css's light-mode
              // --rdp-accent-color: blue can win the cascade tie against
              // index.css's gold-accent override depending on stylesheet
              // injection order. Inline styles on the root element beat
              // any stylesheet rule regardless of that order.
              style={
                {
                  '--rdp-accent-color': 'var(--color-accent)',
                  '--rdp-accent-background-color': 'color-mix(in srgb, var(--color-accent) 20%, transparent)',
                  '--rdp-today-color': 'var(--color-accent)',
                } as React.CSSProperties
              }
            />
            {unavailableDaysOfWeek && unavailableDaysOfWeek.length > 0 && (
              <p className="mt-1 px-1 text-[10px] text-fg-muted">
                Greyed days are outside this artist's usual schedule.
              </p>
            )}
          </DropdownPortal>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-fg-secondary">Start Time</label>
          <TimeSelect
            disabled={disabled}
            value={value.startTime}
            onChange={(startTime) => onChange({ ...value, startTime })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-fg-secondary">End Time</label>
          <TimeSelect
            disabled={disabled}
            value={value.endTime}
            onChange={(endTime) => onChange({ ...value, endTime })}
          />
        </div>
      </div>

      {rangeInvalid && <p className="mt-2 text-xs text-danger">End time must be after start time.</p>}
    </div>
  )
}
