import { useState } from 'react'
import { formatPhoneInput } from '../lib/format'

interface PhoneInputProps {
  id?: string
  value: string
  onChange: (digits: string) => void
  required?: boolean
  disabled?: boolean
  className?: string
  placeholder?: string
}

// Single shared phone-capture control for the whole app (Phase UI-4).
// Displays/accepts US-formatted input live ("(910) 555-0123") while
// `value`/`onChange` always carry the canonical bare-digits form (up to 10
// digits, no country code, no punctuation) -- the same scheme
// apps/api/src/routes/clients.ts's normalizePhone already produces for
// duplicate-detection, adopted here as the actual stored format
// everywhere rather than a comparison-time-only transform. Every phone
// field in the app should render through this component instead of a
// bare `<input type="tel">`.
export default function PhoneInput({ id, value, onChange, required, disabled, className, placeholder }: PhoneInputProps) {
  const [touched, setTouched] = useState(false)
  const incomplete = value.length > 0 && value.length < 10

  return (
    <div>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        required={required}
        disabled={disabled}
        placeholder={placeholder ?? '(910) 555-0123'}
        value={formatPhoneInput(value)}
        onChange={(event) => {
          onChange(event.target.value.replace(/\D/g, '').slice(0, 10))
          if (touched) setTouched(false)
        }}
        onBlur={() => setTouched(true)}
        className={className}
      />
      {touched && incomplete && <p className="mt-1 text-xs text-danger">Enter a complete 10-digit phone number</p>}
    </div>
  )
}
