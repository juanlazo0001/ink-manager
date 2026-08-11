import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/useAuth'
import { studioSettingsQueryKey } from '../lib/queryKeys'
import { ChevronDownIcon } from './icons'
import DropdownPortal from './DropdownPortal'

interface BusinessHoursDay {
  dayOfWeek: number
  isOpen: boolean
  openTime?: string
  closeTime?: string
}

const DEFAULT_MIN = '06:00'
const DEFAULT_MAX = '23:00'

function timeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function formatTimeLabel(hhmm: string): string {
  const minutes = timeToMinutes(hhmm)
  if (minutes === null) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// Manual exact-minute entry escape hatch -- accepts "9", "9:15", "0915",
// "9:15pm", "14:30", loose about separators/leading zeros/AM-PM casing,
// so a staff member typing a real value never gets rejected just because
// it doesn't happen to land on the 30-minute grid.
export function parseTypedTime(text: string): string | null {
  const trimmed = text.trim().toLowerCase().replace(/\s+/g, '')
  if (!trimmed) return null
  const match = /^(\d{1,2}):?(\d{2})?(am|pm)?$/.exec(trimmed)
  if (!match) return null
  let h = Number(match[1])
  const m = match[2] ? Number(match[2]) : 0
  const period = match[3]
  if (m > 59) return null
  if (period) {
    if (h < 1 || h > 12) return null
    if (period === 'pm' && h !== 12) h += 12
    if (period === 'am' && h === 12) h = 0
  }
  if (h > 23) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function buildOptions(minTime: string, maxTime: string): string[] {
  const min = timeToMinutes(minTime) ?? 0
  const max = timeToMinutes(maxTime) ?? 23 * 60 + 30
  const options: string[] = []
  for (let m = min; m <= max; m += 30) {
    options.push(minutesToTime(m))
  }
  return options
}

// Studio-wide operating window (widest open..close span across the
// configured week) -- purely a default range for the dropdown, not a
// hard validation rule (same "advisory, never blocks" convention as
// Calendar.tsx's own isStudioClosed shading, Artist.preferredSchedule,
// etc.). A studio that's never configured business hours gets the
// generic DEFAULT_MIN/MAX instead of an empty/broken list.
function widestOperatingWindow(businessHours: BusinessHoursDay[] | null | undefined): { min: string; max: string } {
  if (!businessHours || businessHours.length === 0) return { min: DEFAULT_MIN, max: DEFAULT_MAX }
  let min: number | null = null
  let max: number | null = null
  for (const day of businessHours) {
    if (!day.isOpen || !day.openTime || !day.closeTime) continue
    const open = timeToMinutes(day.openTime)
    const close = timeToMinutes(day.closeTime)
    if (open === null || close === null) continue
    if (min === null || open < min) min = open
    if (max === null || close > max) max = close
  }
  if (min === null || max === null) return { min: DEFAULT_MIN, max: DEFAULT_MAX }
  return { min: minutesToTime(min), max: minutesToTime(max) }
}

interface TimeSelectProps {
  id?: string
  value: string // "HH:mm", '' = unset
  onChange: (value: string) => void
  disabled?: boolean
  // Explicit override -- when omitted, this component fetches the
  // studio's own business hours and spans its widest open..close window.
  minTime?: string
  maxTime?: string
  placeholder?: string
  className?: string
}

// 30-minute-step time combobox: a text input showing a friendly "9:00 AM"
// label, typing filters the option list live (type-to-jump) and also
// accepts any parseable exact-minute value not on the grid (manual entry
// for the odd case), replacing every free-entry <input type="time"> staff
// use to pick an appointment time. Options span the studio's operating
// window by default (see widestOperatingWindow above).
export default function TimeSelect({
  id,
  value,
  onChange,
  disabled,
  minTime,
  maxTime,
  placeholder = 'Select a time',
  className = '',
}: TimeSelectProps) {
  const { user } = useAuth()
  const needsBusinessHours = minTime === undefined || maxTime === undefined

  const { data: settings } = useQuery({
    queryKey: studioSettingsQueryKey(user?.studioId ?? ''),
    queryFn: () => apiFetch<{ businessHours: BusinessHoursDay[] | null }>('/studio-settings'),
    enabled: needsBusinessHours && !!user?.studioId,
    staleTime: 5 * 60 * 1000,
  })

  const resolvedRange = needsBusinessHours ? widestOperatingWindow(settings?.businessHours) : null
  const effectiveMin = minTime ?? resolvedRange?.min ?? DEFAULT_MIN
  const effectiveMax = maxTime ?? resolvedRange?.max ?? DEFAULT_MAX
  const options = buildOptions(effectiveMin, effectiveMax)

  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Typed buffer resets whenever the committed value changes from
  // outside (a parent resetting the form, another field driving this
  // one, etc.) so the input never shows a stale draft.
  useEffect(() => {
    setTyped(null)
  }, [value])

  const displayValue = typed !== null ? typed : value ? formatTimeLabel(value) : ''
  const filtered =
    typed === null || typed.trim() === ''
      ? options
      : options.filter((opt) => formatTimeLabel(opt).toLowerCase().replace(/\s+/g, '').startsWith(typed.toLowerCase().replace(/\s+/g, '')))

  function commitTyped() {
    if (typed === null) return
    const parsed = parseTypedTime(typed)
    if (parsed) {
      onChange(parsed)
    }
    setTyped(null)
    setOpen(false)
  }

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={displayValue}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setTyped(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitTyped()
              inputRef.current?.blur()
            } else if (e.key === 'Escape') {
              setTyped(null)
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
          onBlur={commitTyped}
          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 pr-8 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
        />
        <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
      </div>
      <DropdownPortal
        open={open && filtered.length > 0}
        onClose={() => setOpen(false)}
        anchorRef={inputRef}
        matchWidth
        maxHeightCap={240}
        className="rounded-lg border border-border bg-surface-inset py-1 shadow-lg"
      >
        <ul role="listbox" aria-labelledby={id}>
          {filtered.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                role="option"
                aria-selected={opt === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(opt)
                  setTyped(null)
                  setOpen(false)
                }}
                className={`flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-surface ${
                  opt === value ? 'text-accent' : 'text-fg'
                }`}
              >
                {formatTimeLabel(opt)}
              </button>
            </li>
          ))}
        </ul>
      </DropdownPortal>
    </div>
  )
}
