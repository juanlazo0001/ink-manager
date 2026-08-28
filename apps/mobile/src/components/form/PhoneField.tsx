import { TextField } from '@/components/form/Fields';
import { maskPhone, nextPhoneDigits } from '@/lib/phoneMask';

/**
 * A phone field whose VALUE is digits and whose DISPLAY is the mask.
 *
 * A wrapper rather than a flag on `TextField`, because the rule it
 * enforces is about the value and not about the input: `value` here is
 * always bare digits, the masked string exists only for the length of a
 * render, and no call site can accidentally store the formatted text.
 * The three client-phone forms all held raw user text before, which is
 * why each of them had its own `replace(/\D/g, '')` to validate.
 *
 * `keyboardType` is fixed rather than exposed — a masked NANP field with
 * any other keyboard is a bug, not a variation.
 */
export function PhoneField({
  label,
  value,
  onChange,
  error,
  hint,
}: {
  /** Bare digits, never the mask. */
  value: string;
  onChange: (digits: string) => void;
  label: string;
  error?: string;
  hint?: string;
}) {
  const shown = maskPhone(value);
  return (
    <TextField
      label={label}
      value={shown}
      // The input reports the whole new string, so the previous DISPLAY
      // is what the diff has to be taken against — see phoneMask.ts on
      // why a shorter string with the same digits means backspace.
      onChange={(next) => onChange(nextPhoneDigits(shown, next))}
      error={error}
      keyboardType="phone-pad"
      hint={hint}
    />
  );
}
