import { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon, CheckIcon } from './icons'

export interface DateRange {
  start: string // YYYY-MM-DD
  end: string // YYYY-MM-DD
}

interface Preset {
  label: string
  days: number
}

const PRESETS: Preset[] = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
]

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function presetRange(days: number): DateRange {
  const end = new Date()
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
  return { start: toDateInputValue(start), end: toDateInputValue(end) }
}

interface DateRangePresetFilterProps {
  value: DateRange
  activeDays: number | null // which preset (if any) currently matches value -- null means a custom range
  onChange: (range: DateRange, days: number | null) => void
}

// Same button+popover shape as MultiSelectFilter.tsx, adapted per the
// dataviz skill's own filter guidance: presets listed as rows (nobody
// fights a calendar grid for "last 30 days"), a bold check marks the
// active one, and a custom range is tucked behind a hairline in the
// footer rather than competing with the presets for attention.
export default function DateRangePresetFilter({ value, activeDays, onChange }: DateRangePresetFilterProps) {
  const [open, setOpen] = useState(false)
  const [customStart, setCustomStart] = useState(value.start)
  const [customEnd, setCustomEnd] = useState(value.end)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCustomStart(value.start)
    setCustomEnd(value.end)
  }, [value.start, value.end])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const buttonLabel = activeDays != null ? (PRESETS.find((p) => p.days === activeDays)?.label ?? 'Custom range') : `${value.start} – ${value.end}`

  function applyCustom() {
    if (!customStart || !customEnd || customStart > customEnd) return
    onChange({ start: customStart, end: customEnd }, null)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface-inset px-3 py-2 text-left text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <span>{buttonLabel}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-fg-muted" />
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-64 rounded-lg border border-border bg-surface-inset py-1 shadow-lg">
          {PRESETS.map((preset) => (
            <button
              key={preset.days}
              type="button"
              onClick={() => {
                onChange(presetRange(preset.days), preset.days)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface"
            >
              {preset.label}
              {activeDays === preset.days && <CheckIcon className="h-4 w-4 shrink-0 text-accent" />}
            </button>
          ))}

          <div className="mt-1 border-t border-border px-3 pt-2 pb-1">
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Custom range</p>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none"
              />
              <span className="text-xs text-fg-muted">to</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={applyCustom}
              disabled={!customStart || !customEnd || customStart > customEnd}
              className="mt-2 w-full rounded-md bg-accent px-2 py-1 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
