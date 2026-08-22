/** 4px-based spacing scale. Named by step, not by use, so nothing is misnamed later. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  /** --radius-card */
  card: 10,
  /** --radius-btn -- editorial-gold's buttons are square, deliberately. */
  button: 0,
  input: 8,
  /** Chips, pills, avatars. */
  pill: 999,
  /** Message bubbles. */
  bubble: 14,
} as const;

/** One physical hairline reads too thin on a dark surface; 1 is the floor here. */
export const hairline = 1;
