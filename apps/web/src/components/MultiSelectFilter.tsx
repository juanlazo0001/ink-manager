import { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon } from './icons'

interface MultiSelectFilterOption {
  value: string
  label: string
}

interface MultiSelectFilterProps {
  placeholder: string
  options: MultiSelectFilterOption[]
  selected: string[]
  onChange: (values: string[]) => void
  className?: string
}

// Same button+listbox dropdown shape already established for the artist
// picker (AppointmentForm.tsx/InquiryDetail.tsx), adapted for checkboxes:
// clicking an option toggles it without closing the panel, since picking
// several is the whole point (Package H -- status/artist filters becoming
// multi-select instead of a single-value <select>).
export default function MultiSelectFilter({ placeholder, options, selected, onChange, className = '' }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  const buttonLabel =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? placeholder)
        : `${selected.length} selected`

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-inset px-3 py-2 text-left text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <span className={selected.length === 0 ? 'text-fg-muted' : undefined}>{buttonLabel}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-fg-muted" />
      </button>

      {open && (
        <div className="absolute z-10 mt-1 max-h-72 w-56 overflow-auto rounded-lg border border-border bg-surface-inset py-1 shadow-lg">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="block w-full px-3 py-1.5 text-left text-xs font-medium text-fg-secondary hover:bg-surface"
            >
              Clear all
            </button>
          )}
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
                className="h-4 w-4 shrink-0 rounded border-border accent-accent"
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
