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

// Language-becomes-customer-specific: the browser-detection tier of the
// new priority chain (stored preference -> Accept-Language -> English).
// Deliberately simple per the feature's own spec -- "es* -> Spanish,
// anything else -> English" -- not a full RFC 4647 language-range
// matcher. Still respects q-value ordering (a real header can list
// multiple ranges, e.g. "fr;q=0.9,es;q=0.5") by picking the
// highest-weighted entry before checking its primary subtag, so a
// browser whose top preference isn't Spanish doesn't get flipped to
// Spanish by a lower-weighted es entry further down the header.
export function parseAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;

  const top = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const q = qParam ? parseFloat(qParam.slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.q - a.q)[0];

  if (!top) return DEFAULT_LOCALE;
  return top.tag.split("-")[0].toLowerCase() === "es" ? "es" : DEFAULT_LOCALE;
}
