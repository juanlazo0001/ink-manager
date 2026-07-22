// Package C2: keep this list of keys in sync with
// apps/api/src/lib/themePresets.ts's own copy (see that file's comment for
// why it's duplicated rather than shared). The actual CSS custom-property
// values for each preset live in index.css as `[data-theme="<key>"]`
// blocks -- this file only has the metadata needed to render the picker
// UI (name, description, swatch colors) and to apply a preset by setting
// the root data-theme attribute.

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
}

export const THEME_PRESETS: ThemePresetInfo[] = [
  {
    key: 'onyx-lime',
    name: 'Onyx & Lime',
    description: 'The original — near-black with a chartreuse accent.',
    swatchBg: '#0a0a0b',
    swatchSurface: '#17171a',
    swatchAccent: '#c9f031',
  },
  {
    key: 'slate-teal',
    name: 'Slate & Teal',
    description: 'Cooler, with a teal accent.',
    swatchBg: '#0a0a0b',
    swatchSurface: '#17171a',
    swatchAccent: '#2dd4bf',
  },
  {
    key: 'ember-amber',
    name: 'Ember & Amber',
    description: 'Warmer, with an amber/coral accent.',
    swatchBg: '#0a0a0b',
    swatchSurface: '#17171a',
    swatchAccent: '#fb923c',
  },
  {
    key: 'orchid-magenta',
    name: 'Orchid & Magenta',
    description: 'Deeper, with a magenta accent.',
    swatchBg: '#0a0a0b',
    swatchSurface: '#17171a',
    swatchAccent: '#e879f9',
  },
]

export const DEFAULT_THEME_PRESET = 'onyx-lime'

// The one place every consumer (authenticated app shell, every public
// page) applies a fetched preset -- setting this attribute is all that's
// needed, since every existing color utility already reads from the
// --color-* custom properties index.css's [data-theme] blocks override.
export function applyThemePreset(preset: string | null | undefined): void {
  document.documentElement.setAttribute('data-theme', preset || DEFAULT_THEME_PRESET)
}
