// Multi-language public forms: the API-side mirror of apps/web/src/i18n/
// locales.ts's own SUPPORTED_LOCALES -- kept as a separate small file
// (not imported across the monorepo boundary from apps/web) since the
// two runtimes don't share a build step. Plain strings, not a Prisma
// enum, for the identical reason as every other locale field in this
// schema (StudioSettings.themePreset's own String-not-enum precedent) --
// adding a language is never a migration. Used by both lib/pdfStrings.ts
// (server-side PDF chrome) and lib/contentTranslation.ts (studio-content
// fallback resolution) -- one shared source of truth for what "a real
// locale" means on the API side.
export const SUPPORTED_LOCALES = ["en", "es"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
