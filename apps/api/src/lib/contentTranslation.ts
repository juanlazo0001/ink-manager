import { isSupportedLocale, type Locale } from "./locale";
import { SYSTEM_FIELD_DEFAULTS } from "./intakeFormFields";

// Multi-language public forms, Part 4: the read-side of the studio-
// content translation system approved in this epic's Part 1 proposal.
// Every public verify route (deposits, estimates, waivers, self-
// schedule, flash-payment, flash-pieces public, studio-settings public)
// wires through resolveRequestLocale + withLocale so this logic exists
// in exactly one place, per the proposal's own explicit design goal.

// Resolution order, highest priority first: an explicit ?locale= query
// param (the language picker's own choice, always wins when present) ->
// the client's own stored preferredLocale (once Part 5's persistence
// layer has set it) -> the studio's own defaultLocale -> the platform
// DEFAULT_LOCALE. Every public verify route calls this once, then passes
// the result to withLocale for each translatable field.
export function resolveRequestLocale(
  queryLocale: unknown,
  clientPreferredLocale: string | null | undefined,
  studioDefaultLocale: string | null | undefined,
): Locale {
  if (isSupportedLocale(queryLocale)) return queryLocale;
  if (isSupportedLocale(clientPreferredLocale)) return clientPreferredLocale;
  if (isSupportedLocale(studioDefaultLocale)) return studioDefaultLocale;
  return "en";
}

// Per-field fallback, not per-row: a studio might have translated
// privacyPolicy but not refundPolicy yet, so each field independently
// falls back to the base (English) value when the translation row is
// missing entirely OR exists but has that one field still empty/null --
// same nullish/falsy-coalescing convention already used everywhere else
// in this codebase (`themePreset ?? DEFAULT_THEME_PRESET`,
// `referralProgramEnabled ?? true`), just applied across a translation
// row instead of a single column. Locale itself is not part of the
// return value -- callers already know what they asked for.
export function withLocale<T extends Record<string, unknown>>(
  base: T,
  // Deliberately looser than `Partial<T>`: a translation row's own
  // nullable-String/Json columns (e.g. `title: string | null`) don't
  // structurally satisfy `Partial<T>` when the base model's own column
  // is non-nullable (`title: string`) -- every real Prisma translation
  // model this is called with has this exact shape mismatch on purpose
  // (nullable, since a studio may not have translated every field yet).
  translation: Partial<{ [K in keyof T]: T[K] | null | undefined }> | null | undefined,
  fields: (keyof T)[],
): T {
  if (!translation) return base;
  const result = { ...base };
  for (const field of fields) {
    const value = translation[field];
    if (value !== null && value !== undefined && value !== "") {
      result[field] = value as T[typeof field];
    }
  }
  return result;
}

// SEED-EQUALITY rule (Part 1 proposal, confirmed on review -- no new flag
// column): a SYSTEM intake field's Spanish label/helpText comes from the
// platform's own translated defaults ONLY when the studio's current,
// live English value is still byte-identical to the platform's own seed
// (SYSTEM_FIELD_DEFAULTS) for that field key -- i.e. the studio never
// customized it. The instant a studio edits the English away from the
// seed, this function stops applying, and the caller's own normal
// withLocale fallback (the studio's own IntakeFormFieldTranslation row,
// else the studio's now-diverged English) takes over instead. This is
// why the rule is a live comparison at read time, not a stored flag: a
// flag would need updating every time the English changes, and could
// drift out of sync; comparing against the seed can never drift.
const SYSTEM_FIELD_DEFAULTS_ES: Record<string, string> = {
  name: "Nombre",
  email: "Correo electrónico",
  phone: "Teléfono",
  referralSource: "¿Cómo te enteraste de nosotros?",
  description: "Describe el tatuaje que quieres",
  colorOrBlackGrey: "¿Color o Negro y Gris?",
  placement: "Ubicación",
  size: "Tamaño estimado",
  hasBeenTattooedBefore: "¿Te has tatuado antes?",
  preferredArtist: "Artista preferido",
  budget: "Presupuesto",
  desiredTiming: "Fecha deseada",
  referenceImages: "Imágenes de referencia",
  placementImages: "Fotos de la ubicación",
};

const SEED_LABEL_BY_KEY = new Map(SYSTEM_FIELD_DEFAULTS.map((f) => [f.key, f.label]));

// Applied ONLY to fieldKind: SYSTEM rows -- a CUSTOM question was never
// seeded from a platform default, so it always follows the plain
// withLocale fallback (its own translation row, else the studio's own
// English), never the platform's seed dictionary.
export function resolveSystemFieldLabel(
  systemFieldKey: string | null,
  liveEnglishLabel: string,
  locale: Locale,
  translatedLabel: string | null | undefined,
): string {
  if (translatedLabel) return translatedLabel;
  if (locale === "en" || !systemFieldKey) return liveEnglishLabel;

  const seedLabel = SEED_LABEL_BY_KEY.get(systemFieldKey);
  if (seedLabel && seedLabel === liveEnglishLabel) {
    const platformTranslation = SYSTEM_FIELD_DEFAULTS_ES[systemFieldKey];
    if (platformTranslation) return platformTranslation;
  }

  return liveEnglishLabel;
}
