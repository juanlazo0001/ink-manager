/**
 * Editorial Gold, ported from the web app's own canonical token block
 * (`:root[data-theme="editorial-gold"]` in apps/web/src/index.css).
 *
 * Values are copied verbatim rather than re-picked by eye — the two
 * clients are one product, and a mobile-only palette would drift the
 * moment either side is touched. Each entry names the CSS custom property
 * it came from so a change on either side is traceable.
 */
export const colors = {
  /** --color-bg (reference --ink). The page. */
  bg: '#0e0b08',
  /** --color-surface (reference --panel). Cards, rows, sheets. */
  surface: '#171310',
  /** --color-surface-raised (reference --panel-2). A surface on a surface. */
  surfaceRaised: '#1d1813',
  /** --color-surface-inset (reference --wall). Wells, recessed areas. */
  surfaceInset: '#120f0b',

  /** --color-border. Gold-tinted hairline, the default card edge. */
  border: 'rgba(201, 154, 91, 0.18)',
  /** --color-border-strong. For an edge that has to actually read. */
  borderStrong: 'rgba(201, 154, 91, 0.38)',
  /** --color-border-soft. Neutral hairline, no gold cast — dividers inside a card. */
  borderSoft: 'rgba(255, 255, 255, 0.08)',

  /** --color-fg (reference --cream). Body text. */
  fg: '#f2ece0',
  /** --color-fg-secondary. Supporting text that still needs to be read. */
  fgSecondary: '#c7bea9',
  /** --color-fg-muted (reference --smoke). Timestamps, labels, hints. */
  fgMuted: '#9b927f',

  /**
   * --color-accent (reference --gold). The brand primary, and the only
   * colour that should ever carry emphasis or indicate data. Never red.
   */
  accent: '#c99a5b',
  /** --color-accent-hover (reference --gold-hi). Pressed/active gold. */
  accentHover: '#e4be85',
  /** --color-accent-button. Hand-tuned for a filled button surface specifically. */
  accentButton: '#d5a05c',
  /** --color-accent-fg. Text ON gold. */
  accentFg: '#171208',

  /** --color-input-bg. Deliberately neutral, not gold-tinted. */
  inputBg: '#0f0e0d',
  /** --color-input-border. */
  inputBorder: '#252322',

  /**
   * --color-danger. RED IS PUNCTUATION, NOT DECORATION — errors, failed
   * sends, destructive confirmations. Never a fill, never a large surface,
   * never "this is important". This tint is the one that clears the 4.5:1
   * text floor; use it for anything a person reads.
   */
  danger: '#e08272',
  /**
   * --color-danger-strong (reference --red). Only clears the 3:1 non-text
   * floor, so: fills, borders, icon strokes and dots ONLY. Never text.
   */
  dangerStrong: '#c2402f',

  /** --color-success (reference --green). */
  success: '#5f9e6e',
  /** --color-info. */
  info: '#96aad6',
  /** --color-warning. */
  warning: '#d9a441',
  /** --color-neutral. */
  neutral: '#9b927f',

  /**
   * --color-card-glass. The card surface used app-wide under Editorial
   * Gold, NOT a login-only value: web's `.card-surface` marker class puts
   * it on every card wrapper in the app (Dashboard's CardShell, Widget,
   * Team, Settings...). It reads as translucent over the background photo
   * — 0xd6 is 84% — which is the whole point of the treatment.
   *
   * It has lived under `login` in this file since the login screen was the
   * first thing to need it. Promoted here now that the rest of the app
   * uses it too; `login.cardGlass` still points at the same value.
   */
  cardGlass: '#100f0ed6',
  /** --color-card-glass-opaque. The same surface where translucency is wrong. */
  cardGlassOpaque: '#100f0e',
  /** --color-border-glass. Fainter than the app-wide border, by design. */
  cardBorder: 'rgba(201, 154, 91, 0.1)',
} as const;

/**
 * Status tones, from the web's own `--color-*` set. These carry MEANING,
 * not decoration -- `warning` is "someone must act", `danger` is
 * genuinely lost, `hold` is paused. Red only ever arrives here by asking
 * for `danger`, which keeps the palette rule intact even though this map
 * makes eight colours available.
 */
export const tones = {
  /** --color-success */
  success: '#5f9e6e',
  /** --color-info */
  info: '#96aad6',
  /** --color-warning */
  warning: '#d9a441',
  /** --color-danger -- the readable-as-text red */
  danger: '#e08272',
  /** --color-neutral */
  neutral: '#9b927f',
  /** --color-progress */
  progress: '#c1a6de',
  /** --color-highlight */
  highlight: '#e0995a',
  /** --color-hold */
  hold: '#8fa3c2',
} as const;

/**
 * Per-channel dot colours, matching the web's `CHANNEL_DOT_CLASSES`.
 *
 * Instagram is a brand gradient on the web; flattened to its mid-stop here
 * rather than pulling in a gradient dependency for a 10px dot. IN_APP has
 * no entry on the web either and falls through to OTHER — kept identical
 * rather than inventing one.
 */
export const channelColors: Record<string, string> = {
  SMS: '#2fb35c',
  EMAIL: '#4a90d9',
  INSTAGRAM: '#ee2a7b',
  FACEBOOK: '#1877f2',
  PHONE: '#8a8a92',
  OTHER: '#5a5a62',
};

export function channelColor(channel: string): string {
  return channelColors[channel] ?? channelColors.OTHER;
}

/**
 * Login-only tokens.
 *
 * The web's Login page is deliberately LOCKED to Editorial Gold — its
 * `.login-shell` selector is the same one as
 * `:root[data-theme="editorial-gold"]`, so the page renders identically
 * whatever preset a studio has active. That "fixed platform identity"
 * property is why these live apart from the palette above rather than
 * being folded into it: they belong to one screen, not to the app.
 *
 * Every value is copied from apps/web/src/index.css, named after the
 * custom property it came from.
 */
export const login = {
  /** --color-card-glass. The frosted card fill — the photo stays softly visible behind it. */
  cardGlass: '#100f0ed6',
  /** --color-card-glass-opaque. Same RGB, no alpha — the fallback where blur is unavailable. */
  cardGlassOpaque: '#100f0e',
  /** --color-border-glass. Fainter than the app-wide border, by design. */
  cardBorder: 'rgba(201, 154, 91, 0.1)',
  /** --blur-card. */
  cardBlur: 16,

  /**
   * .rings — three concentric circles behind the card. Pure CSS on web
   * (no asset), so these are the real numbers, not a trace.
   */
  ring: [
    { size: 520, color: 'rgba(201, 154, 91, 0.18)' },
    { size: 780, color: 'rgba(201, 154, 91, 0.12)' },
    { size: 1060, color: 'rgba(201, 154, 91, 0.07)' },
  ],

  /**
   * .btn-gold-gradient — --btn-gold-light / --btn-gold-deep / --btn-gold-text,
   * plus the faint white-to-dark sheen layered over the ramp and the
   * low-opacity gold hairline. Note this is NOT the web LOGIN button's
   * own treatment (that one is a flat --color-accent-button); it is the
   * artist-page button token, adopted here deliberately.
   */
  buttonLight: '#dda65d',
  buttonDeep: '#c9924e',
  buttonText: '#0e0d0b',
  buttonBorder: 'rgba(215, 164, 94, 0.34)',
  buttonSheenTop: 'rgba(255, 255, 255, 0.08)',
  buttonSheenBottom: 'rgba(0, 0, 0, 0.03)',

  /**
   * .hero-shade — two stacked gradients over the photograph. Both are
   * rgba(12, 10, 8, x); only the alpha ramps, which is what keeps the
   * scrim from tinting the image a different colour as it darkens.
   */
  scrimVertical: {
    // Split into parallel tuples rather than a list of {color, at} pairs
    // purely so the types survive: expo-linear-gradient requires readonly
    // tuples of at least two entries, and `.map()` over an object list
    // widens back to a plain array.
    colors: ['rgba(12, 10, 8, 0.72)', 'rgba(12, 10, 8, 0.38)', 'rgba(12, 10, 8, 0.55)', 'rgba(12, 10, 8, 0.96)'],
    locations: [0, 0.34, 0.66, 1],
  },
  scrimHorizontal: {
    colors: ['rgba(12, 10, 8, 0.72)', 'rgba(12, 10, 8, 0.15)', 'rgba(12, 10, 8, 0.15)', 'rgba(12, 10, 8, 0.6)'],
    locations: [0, 0.3, 0.7, 1],
  },

  /** The flat colour behind the photo while it loads, so nothing flashes. */
  photoPlaceholder: '#0c0a08',
} as const;
