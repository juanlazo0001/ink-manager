import { formatCurrencyInput } from '../lib/money'

interface CurrencyInputProps {
  id?: string
  value: string
  onChange: (digits: string) => void
  placeholder?: string
  className?: string
}

// Same value/onChange contract as PhoneInput: value/onChange always carry
// the canonical clean form (a bare whole-dollar-amount string, no `$`, no
// commas -- matching Inquiry.priceEstimateLow/High's Int columns), while
// the field displays a live "$1,500"-style mask. Whole dollars only (no
// cents) since nothing this feeds accepts a decimal amount.
export default function CurrencyInput({ id, value, onChange, placeholder, className }: CurrencyInputProps) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      placeholder={placeholder ?? '$0'}
      value={formatCurrencyInput(value)}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
      className={className}
    />
  )
}
