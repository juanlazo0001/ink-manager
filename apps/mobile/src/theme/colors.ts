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
