// Package C2: the fixed, curated set of theme presets a studio can pick
// from -- StudioSettings.themePreset must be one of these keys, never
// free-form. Keep this list in sync with apps/web/src/lib/themePresets.ts's
// own copy (the frontend needs the same keys for its picker UI and CSS
// [data-theme] selectors; duplicated rather than shared across the
// apps/api <-> apps/web boundary since no shared package exists between
// them anywhere else in this codebase either -- same convention already
// noted in apps/api/src/lib/realtime/registry.ts's own comment).
export const THEME_PRESET_KEYS = ["onyx-lime", "slate-teal", "ember-amber", "orchid-magenta", "editorial-gold"] as const;

export type ThemePresetKey = (typeof THEME_PRESET_KEYS)[number];

export const DEFAULT_THEME_PRESET: ThemePresetKey = "onyx-lime";

export function isValidThemePreset(value: unknown): value is ThemePresetKey {
  return typeof value === "string" && (THEME_PRESET_KEYS as readonly string[]).includes(value);
}

// Same duplication convention as THEME_PRESET_KEYS above (no shared package
// between apps/api and apps/web) -- these are apps/web/src/lib/
// themePresets.ts's own THEME_PRESETS[].swatchAccent values, copied over
// for the one place the API needs an actual color rather than just a key:
// branding a studio's generated PDFs (lib/pdf.ts) with their chosen accent.
// Kept deliberately narrow (accent only, not the full swatch/font/shape
// metadata) -- a PDF has no theme "shape" to branch on, just this one color.
export const THEME_PRESET_ACCENT_COLORS: Record<ThemePresetKey, string> = {
  "onyx-lime": "#c9f031",
  "slate-teal": "#2dd4bf",
  "ember-amber": "#fb923c",
  "orchid-magenta": "#e879f9",
  "editorial-gold": "#c99a5b",
};
