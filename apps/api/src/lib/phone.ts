// Phase UI-4: single source of truth for the canonical stored phone
// format across the whole app (clients, team members, the public intake
// form, waivers). Originally a comparison-time-only transform in
// clients.ts's duplicate-detection; promoted here once every write path
// needed to normalize on the way in, not just compare on the way out.
// Canonical form: bare 10-digit US number, no country code, no
// punctuation. apps/web/src/components/PhoneInput.tsx re-formats this for
// display/typing ("(910) 555-0123") but never stores the formatted string.
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}
