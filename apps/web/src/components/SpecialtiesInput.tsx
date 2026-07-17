import { useState } from 'react'
import { CloseIcon } from './icons'

// Common industry specialties, shown as quick-pick suggestions. Studios
// aren't limited to this list — typing anything else and pressing Enter
// (or clicking "Add") adds it as a custom specialty.
const SUGGESTED_SPECIALTIES = [
  'Blackwork',
  'Fine Line',
  'Traditional',
  'Neo-Traditional',
  'Realism',
  'Watercolor',
  'Japanese / Irezumi',
  'Tribal',
  'Dotwork',
  'Geometric',
  'Portrait',
  'Lettering / Script',
  'New School',
  'Illustrative',
  'Biomechanical',
  'Chicano',
  'Trash Polka',
  'Minimalist',
  'Ornamental',
]

interface SpecialtiesInputProps {
  value: string[]
  onChange: (next: string[]) => void
}

export default function SpecialtiesInput({ value, onChange }: SpecialtiesInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [open, setOpen] = useState(false)

  const normalizedSelected = new Set(value.map((v) => v.toLowerCase()))

  const suggestions = SUGGESTED_SPECIALTIES.filter(
    (option) =>
      !normalizedSelected.has(option.toLowerCase()) && option.toLowerCase().includes(inputValue.toLowerCase()),
  )

  const trimmedInput = inputValue.trim()
  const isNewCustomValue = trimmedInput.length > 0 && !normalizedSelected.has(trimmedInput.toLowerCase())

  function addSpecialty(specialty: string) {
    const trimmed = specialty.trim()
    if (!trimmed || normalizedSelected.has(trimmed.toLowerCase())) return
    onChange([...value, trimmed])
    setInputValue('')
    setOpen(false)
  }

  function removeSpecialty(specialty: string) {
    onChange(value.filter((v) => v !== specialty))
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (suggestions.length > 0) {
        addSpecialty(suggestions[0])
      } else if (trimmedInput) {
        addSpecialty(trimmedInput)
      }
    }
  }

  return (
    <div>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((specialty) => (
            <span
              key={specialty}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-1 pl-2.5 pr-1.5 text-xs font-medium text-fg-secondary"
            >
              {specialty}
              <button
                type="button"
                onClick={() => removeSpecialty(specialty)}
                aria-label={`Remove ${specialty}`}
                className="flex h-4 w-4 items-center justify-center rounded-full text-fg-muted hover:bg-surface-raised hover:text-fg"
              >
                <CloseIcon className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Search or add a specialty…"
          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />

        {open && (suggestions.length > 0 || isNewCustomValue) && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface-raised shadow-lg">
            {suggestions.map((option) => (
              <button
                key={option}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addSpecialty(option)}
                className="block w-full px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface"
              >
                {option}
              </button>
            ))}
            {isNewCustomValue && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addSpecialty(trimmedInput)}
                className="block w-full border-t border-border px-3 py-2 text-left text-sm font-medium text-fg hover:bg-surface"
              >
                Add "{trimmedInput}"
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
