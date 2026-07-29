// Package C2 (extended for dual themes): keep this list of keys in sync
// with apps/api/src/lib/themePresets.ts's own copy (see that file's comment
// for why it's duplicated rather than shared). The actual CSS custom-
// property VALUES for each preset (colors, fonts, radii) live in index.css
// as `[data-theme="<key>"]` blocks -- this file has the metadata needed to
// render the picker UI (name, description, swatch colors) plus, since the
// "editorial-gold" preset changes more than just colors, a `shape`/
// `decorative` flag every structural/typographic component branches on via
// `useThemePreset()` below.

// 'default' is the original four presets' shared component shapes (plain
// circle avatars/pipeline nodes, filled-pill nav/status, no grain/arcs).
// 'editorial' is the ui/restyle-v3 branch's shapes (hex nodes, bordered
// Jura-tracked pills, grain + arc ornaments). Only ONE preset uses
// 'editorial' today, but this is a real field (not a hardcoded key check)
// so a future third shape doesn't require re-deriving it from the key
// everywhere it's consumed.
export type ThemeShape = 'default' | 'editorial'

// CSS custom-property VALUES (not classNames) for the three font roles --
// consumed as `--font-sans`/`--font-display`/`--font-jura` in index.css's
// per-preset blocks. Both font families (Inter and Fraunces/Jura/Outfit)
// are self-hosted and loaded unconditionally in index.css regardless of
// which preset is active, so switching presets is purely a variable swap,
// never a font (re)load.
export interface ThemeFonts {
  sans: string
  display: string
  jura: string
}

export interface ThemePresetInfo {
  key: string
  name: string
  description: string
  // Swatch preview colors for the picker card -- intentionally duplicated
  // from index.css's [data-theme] blocks rather than read from computed
  // CSS at runtime, since the picker needs to show every preset's swatch
  // simultaneously (including ones not currently applied to the page).
  swatchBg: string
  swatchSurface: string
  swatchAccent: string
  shape: ThemeShape
  // Grain texture + concentric arc ornaments + the sidebar's ornamental
  // divider -- purely decorative DOM/CSS the 'default' shape never had.
  decorative: boolean
  fonts: ThemeFonts
}

const DEFAULT_FONTS: ThemeFonts = {
  sans: "'Inter', ui-sans-serif, system-ui, sans-serif",
  display: "'Inter', ui-sans-serif, system-ui, sans-serif",
  jura: "'Inter', ui-sans-serif, system-ui, sans-serif",
}

const EDITORIAL_FONTS: ThemeFonts = {
  sans: "'Outfit', ui-sans-serif, system-ui, sans-serif",
  display: "'Fraunces', ui-serif, serif",
  jura: "'Jura', ui-sans-serif, system-ui, sans-serif",
}

export const THEME_PRESETS: ThemePresetInfo[] = [
  {
    key: 'onyx-lime',
    name: 'Onyx & Lime',
    description: 'The original — near-black with a chartreuse accent.',
    swatchBg: '#0a0a0b',
    swatchSurface: '#17171a',
    swatchAccent: '#c9f031',
    shape: 'default',
    decorative: false,
    fonts: DEFAULT_FONTS,
  },
  {
    key: 'slate-teal',
    name: 'Slate & Teal',
    description: 'Cooler, with a teal accent.',
    swatchBg: '#0a0a0b',
    swatchSurface: '#17171a',
    swatchAccent: '#2dd4bf',
    shape: 'default',
    decorative: false,
    fonts: DEFAULT_FONTS,
  },
  {
    key: 'ember-amber',
    name: 'Ember & Amber',
    description: 'Warmer, with an amber/coral accent.',
    swatchBg: '#0a0a0b',
    swatchSurface: '#17171a',
    swatchAccent: '#fb923c',
    shape: 'default',
    decorative: false,
    fonts: DEFAULT_FONTS,
  },
  {
    key: 'orchid-magenta',
    name: 'Orchid & Magenta',
    description: 'Deeper, with a magenta accent.',
    swatchBg: '#0a0a0b',
    swatchSurface: '#17171a',
    swatchAccent: '#e879f9',
    shape: 'default',
    decorative: false,
    fonts: DEFAULT_FONTS,
  },
  // Integrated from the ui/restyle-v3 branch: a full second visual identity,
  // not just a new accent color -- warm-ink surfaces, brass-gold accent,
  // a three-font system (Fraunces/Jura/Outfit), grain texture, and hex
  // pipeline nodes. See REPORT.md ("Dual themes" entry) for the full
  // pure-style-vs-structural investigation this was built from.
  {
    key: 'editorial-gold',
    name: 'Editorial Gold',
    description: 'A full second identity — warm ink, brass gold, serif headlines, and grain texture.',
    swatchBg: '#0e0b08',
    swatchSurface: '#171310',
    swatchAccent: '#c99a5b',
    shape: 'editorial',
    decorative: true,
    fonts: EDITORIAL_FONTS,
  },
]

export const DEFAULT_THEME_PRESET = 'onyx-lime'

export function getThemePresetInfo(key: string | null | undefined): ThemePresetInfo {
  return THEME_PRESETS.find((preset) => preset.key === key) ?? THEME_PRESETS.find((preset) => preset.key === DEFAULT_THEME_PRESET)!
}

// Last-applied preset, cached across page loads so a returning user's very
// FIRST paint already uses their real theme instead of always starting
// from onyx-lime and visibly swapping once /studio-settings resolves --
// the flash this was added to fix. Read synchronously at module load
// (before React even mounts, via main.tsx's own top-level call into this
// module) and re-written every time applyThemePreset runs, so it tracks
// whatever the studio's real preset actually is. try/catch guards private
// browsing / storage-disabled environments, where this is just a no-op --
// ThemeLoadingOverlay (ThemeApplier.tsx) is the fallback for exactly that
// case (and any genuine first-ever visit with no cache yet).
const THEME_CACHE_KEY = 'ink-manager-theme-preset'

export function getCachedThemePresetKey(): string | null {
  try {
    return localStorage.getItem(THEME_CACHE_KEY)
  } catch {
    return null
  }
}

function setCachedThemePresetKey(key: string): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, key)
  } catch {
    // Non-critical -- next load just falls back to the loading overlay.
  }
}

// Reactive store behind useThemePreset() (lib/useThemePreset.ts). Plain
// module-level pub-sub, not React context -- applyThemePreset is called
// from many independent places with no shared React tree connecting them
// (ThemeApplier for the authenticated shell, and each of the five public
// pages independently from their own fetched route data), so there's no
// single provider to hang a context on. useSyncExternalStore is what makes
// this safe to read from during render.
type Listener = () => void
const listeners = new Set<Listener>()
let currentPresetKey: string = getCachedThemePresetKey() || DEFAULT_THEME_PRESET

export function subscribeThemePreset(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getThemePresetSnapshot(): string {
  return currentPresetKey
}

// The one place every consumer (authenticated app shell, every public
// page) applies a fetched preset -- setting this attribute is all that's
// needed for every existing color/font/radius utility, since they all read
// from the --color-*/--font-*/--radius-* custom properties index.css's
// [data-theme] blocks override. Also updates the reactive store above, so
// the small set of components whose actual DOM structure (not just token
// values) differs between shapes -- see REPORT.md -- can react to a
// preset change immediately, without a page reload.
export function applyThemePreset(preset: string | null | undefined): void {
  const key = preset || DEFAULT_THEME_PRESET
  document.documentElement.setAttribute('data-theme', key)
  setCachedThemePresetKey(key)
  if (key !== currentPresetKey) {
    currentPresetKey = key
    listeners.forEach((listener) => listener())
  }
}
