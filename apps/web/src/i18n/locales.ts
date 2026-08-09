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
