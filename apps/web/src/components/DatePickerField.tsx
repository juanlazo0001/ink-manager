import { useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { toDateString, parseDateString } from './DateAndTimeRangeFields'
import DropdownPortal from './DropdownPortal'

interface DatePickerFieldProps {
  value: string // yyyy-mm-dd, '' if unset
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  id?: string
  // Tasks' mobile row redesign: lets a caller show a compact resting
  // label ("Today"/"Aug 7") instead of the default full weekday/month/
  // day/year -- the calendar popover and editing interaction underneath
  // are completely unchanged, only the trigger button's own text.
  formatValue?: (date: Date) => string
  // Same redesign: replaces the trigger button's className outright
  // (not merged) so a caller can turn it into a compact pill instead of
  // the default full-width block -- every other call site keeps the
  // default below unchanged since this is optional.
  buttonClassName?: string
}

// A single date (no time) picked from the same calendar-grid popover as
// DateAndTimeRangeFields' date field -- the app's standard since UI-4, never
// a typed input. Extracted as its own component because guest-artist date
// ranges and studio-hours-adjacent fields need one date at a time, not the
// date+start-time+end-time bundle that component is shaped for.
export default function DatePickerField({
  value,
  onChange,
  placeholder,
  disabled,
  id,
  formatValue,
  buttonClassName,
}: DatePickerFieldProps) {
  const [showCalendar, setShowCalendar] = useState(false)
  const selectedDate = parseDateString(value)
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setShowCalendar((v) => !v)}
        className={
          buttonClassName ??
          'w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-left text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60'
        }
      >
        {selectedDate
          ? (formatValue ?? ((d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })))(
              selectedDate,
            )
          : (placeholder ?? 'Select a date')}
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
            onChange(day ? toDateString(day) : '')
            setShowCalendar(false)
          }}
          // Same fix as SelfSchedule.tsx's own DayPicker: react-day-
          // picker/style.css defines its own light-mode --rdp-accent-
          // color: blue directly on .rdp-root, at the exact same
          // specificity as index.css's gold-accent override of that
          // same selector -- whichever stylesheet happens to be
          // injected last wins the cascade tie, so this can render blue
          // depending on load order rather than reliably matching the
          // theme. Inline styles on the root element beat any
          // stylesheet rule regardless of injection order.
          style={
            {
              '--rdp-accent-color': 'var(--color-accent)',
              '--rdp-accent-background-color': 'color-mix(in srgb, var(--color-accent) 20%, transparent)',
              '--rdp-today-color': 'var(--color-accent)',
            } as React.CSSProperties
          }
        />
      </DropdownPortal>
    </div>
  )
}
