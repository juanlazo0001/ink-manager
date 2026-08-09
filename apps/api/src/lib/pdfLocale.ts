// Multi-language public forms: the API-side mirror of apps/web/src/i18n/
// locales.ts's own SUPPORTED_LOCALES -- kept as a separate small file
// (not imported across the monorepo boundary from apps/web) since the
// two runtimes don't share a build step. Plain strings, not a Prisma
// enum, for the identical reason as every other locale field in this
// schema (StudioSettings.themePreset's own String-not-enum precedent) --
// adding a language is never a migration.
export const SUPPORTED_PDF_LOCALES = ["en", "es"] as const;

export type PdfLocale = (typeof SUPPORTED_PDF_LOCALES)[number];

export const DEFAULT_LOCALE: PdfLocale = "en";

export function isSupportedPdfLocale(value: unknown): value is PdfLocale {
  return typeof value === "string" && (SUPPORTED_PDF_LOCALES as readonly string[]).includes(value);
}
