import { useState } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { toDateString, parseDateString } from './DateAndTimeRangeFields'

interface DatePickerFieldProps {
  value: string // yyyy-mm-dd, '' if unset
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  id?: string
}

// A single date (no time) picked from the same calendar-grid popover as
// DateAndTimeRangeFields' date field -- the app's standard since UI-4, never
// a typed input. Extracted as its own component because guest-artist date
// ranges and studio-hours-adjacent fields need one date at a time, not the
// date+start-time+end-time bundle that component is shaped for.
export default function DatePickerField({ value, onChange, placeholder, disabled, id }: DatePickerFieldProps) {
  const [showCalendar, setShowCalendar] = useState(false)
  const selectedDate = parseDateString(value)

  return (
    <div className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setShowCalendar((v) => !v)}
        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-left text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
      >
        {selectedDate
          ? selectedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
          : (placeholder ?? 'Select a date')}
      </button>
      {showCalendar && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowCalendar(false)} aria-hidden="true" />
          <div className="absolute z-20 mt-1 rounded-xl border border-border bg-surface-raised p-2 shadow-xl">
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={(day) => {
                onChange(day ? toDateString(day) : '')
                setShowCalendar(false)
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
