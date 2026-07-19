import { useState } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'

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
}

function toDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseDateString(value: string): Date | undefined {
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

export default function DateAndTimeRangeFields({ value, onChange, disabled }: DateAndTimeRangeFieldsProps) {
  const [showCalendar, setShowCalendar] = useState(false)
  const selectedDate = parseDateString(value.date)
  const rangeInvalid = !!value.date && !!value.startTime && !!value.endTime && !isValidTimeRange(value)

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="relative">
          <label className="mb-1 block text-sm font-medium text-fg-secondary">Date</label>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowCalendar((v) => !v)}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-left text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
          >
            {selectedDate
              ? selectedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
              : 'Select a date'}
          </button>
          {showCalendar && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowCalendar(false)} aria-hidden="true" />
              <div className="absolute z-20 mt-1 rounded-xl border border-border bg-surface-raised p-2 shadow-xl">
                <DayPicker
                  mode="single"
                  selected={selectedDate}
                  onSelect={(day) => {
                    if (!day) return
                    onChange({ ...value, date: toDateString(day) })
                    setShowCalendar(false)
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-fg-secondary">Start Time</label>
          <input
            type="time"
            disabled={disabled}
            value={value.startTime}
            onChange={(event) => onChange({ ...value, startTime: event.target.value })}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-fg-secondary">End Time</label>
          <input
            type="time"
            disabled={disabled}
            value={value.endTime}
            onChange={(event) => onChange({ ...value, endTime: event.target.value })}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
          />
        </div>
      </div>

      {rangeInvalid && <p className="mt-2 text-xs text-danger">End time must be after start time.</p>}
    </div>
  )
}
