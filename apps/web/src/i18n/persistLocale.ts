import { apiFetch } from '../lib/api'
import type { Locale } from './locales'

// Multi-language public forms: fire-and-forget persistence for the
// language picker's own onChange, shared by every token-scoped public
// flow that has a resolvable Client by the time the picker renders
// (deposit, waiver, self-schedule, flash-payment, estimate, estimate
// revision -- intake and the flash gallery have no Client yet at that
// point in the funnel, so they persist locale at their own submission
// moment instead, not here). A failed PATCH (network hiccup, expired
// token) shouldn't block the client from using the picker -- the
// UI-visible switch already happened via LocaleContext's setLocale
// before this ever fires.
export function persistPickerLocale(path: string, locale: Locale): void {
  apiFetch(path, { method: 'PATCH', body: JSON.stringify({ locale }) }).catch(() => {})
}
