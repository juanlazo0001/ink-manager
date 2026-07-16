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
              className="inline-flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-800 py-1 pl-2.5 pr-1.5 text-xs font-medium text-neutral-300"
            >
              {specialty}
              <button
                type="button"
                onClick={() => removeSpecialty(specialty)}
                aria-label={`Remove ${specialty}`}
                className="flex h-4 w-4 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-700 hover:text-white"
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
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
        />

        {open && (suggestions.length > 0 || isNewCustomValue) && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-lg">
            {suggestions.map((option) => (
              <button
                key={option}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addSpecialty(option)}
                className="block w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800"
              >
                {option}
              </button>
            ))}
            {isNewCustomValue && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addSpecialty(trimmedInput)}
                className="block w-full border-t border-neutral-800 px-3 py-2 text-left text-sm font-medium text-white hover:bg-neutral-800"
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
