// Minimal, deliberately NOT a design system -- this session's brief is
// "dark background, gold accent for the primary action" and nothing more.
// The real Editorial Gold pass lands in a later session; when it does, it
// replaces this file rather than growing around it.
//
// The values are lifted verbatim from the web app's own canonical
// `editorial-gold` token block (apps/web/src/index.css) rather than
// invented here, so the two clients don't drift apart before the proper
// pass even starts. Gold is the brand primary; red is punctuation only
// (errors), per the standing design rules in the repo root CLAUDE.md.
export const Colors = {
  /** --color-bg (reference --ink) */
  background: '#0e0b08',
  /** --color-surface (reference --panel) */
  surface: '#171310',
  /** --color-input-bg */
  inputBackground: '#0f0e0d',
  /** --color-input-border */
  inputBorder: '#252322',
  /** --color-border-strong */
  border: 'rgba(201, 154, 91, 0.38)',
  /** --color-fg (reference --cream) */
  text: '#f2ece0',
  /** --color-fg-secondary */
  textSecondary: '#c7bea9',
  /** --color-fg-muted (reference --smoke) */
  textMuted: '#9b927f',
  /** --color-accent (reference --gold) */
  accent: '#c99a5b',
  /** --color-accent-button -- hand-tuned for a filled button surface */
  accentButton: '#d5a05c',
  /** --color-accent-fg */
  accentText: '#171208',
  /** --color-danger -- the readable-as-text red, never the fill red */
  danger: '#e08272',
} as const;

export const Spacing = {
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 48,
} as const;

export const Radius = {
  /** --radius-card */
  card: 10,
  /** --radius-btn -- editorial-gold's buttons are fully square */
  button: 0,
  input: 8,
} as const;
