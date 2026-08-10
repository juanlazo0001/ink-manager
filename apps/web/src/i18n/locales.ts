// Multi-language public forms: the allow-list of locales the platform
// UI itself supports (not the same thing as which locales a STUDIO has
// translated their own content into -- that's per-studio, checked
// against the translation tables, not this list). Plain strings, not a
// TypeScript enum backed by anything the database enforces -- matches
// this schema's own StudioSettings.themePreset precedent (a String
// validated in app code, not a DB enum), so adding a language is never
// a migration on either side.
export const SUPPORTED_LOCALES = ['en', 'es'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

// Multi-language public forms closeout: es-US, not es-ES -- mirrors the
// API's own pdfDateLocale (apps/api/src/lib/pdfStrings.ts) for the
// identical reason: this app's whole audience is US-based, so date FORMAT
// conventions (MM/DD/YYYY-style ordering) stay consistent with the English
// version; only the surrounding month/weekday names actually change.
export function dateLocale(locale: Locale): string {
  return locale === 'es' ? 'es-US' : 'en-US';
}
