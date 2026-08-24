import { Easing } from 'react-native-reanimated';

/**
 * The motion canon.
 *
 * apps/web defines real motion tokens and then applies them unevenly —
 * skeletons on four surfaces, "Loading…" text on four others, nothing at
 * all on five, and hover transitions that have no meaning on a phone.
 * Mobile had no motion at all: no `Animated`, no duration tokens, every
 * list and every bar a hard cut.
 *
 * So this is not a transcription of web. It is web's TOKENS (which are
 * good and worth sharing exactly) plus ONE consistent policy for applying
 * them (which web does not have). Where the two disagree, the divergence
 * is deliberate and recorded in OWNER-PARITY-AUDIT.md's canon table.
 *
 * Durations are web's own, verbatim — `--duration-fast/base/slow` in
 * apps/web/src/index.css, confirmed against computed style at runtime.
 */
export const duration = {
  /** 120ms — press feedback, colour changes. Web: `--duration-fast`. */
  fast: 120,
  /** 200ms — the default. Enters, exits, bar fills. Web: `--duration-base`. */
  base: 200,
  /** 300ms — larger surfaces (sheets). Web: `--duration-slow`. */
  slow: 300,
} as const;

/**
 * Web's standard curve, measured off the live dashboard rather than
 * assumed: every transition there computes to
 * `cubic-bezier(0.4, 0, 0.2, 1)` — Tailwind's default ease, which is
 * also Material's "standard" curve.
 */
export const easing = {
  standard: Easing.bezier(0.4, 0, 0.2, 1),
  /** For things entering only — matches web's `ease-out` keyframes. */
  out: Easing.out(Easing.quad),
} as const;

/**
 * List/card enter, equal to web's `fade-slide-up` keyframe:
 * `opacity 0→1, translateY 6px→0` over `--duration-base`, ease-out.
 * The 6 is web's own number; on a phone it reads as points, which is the
 * right analogue for a hand-held surface.
 */
export const enter = {
  translateY: 6,
  duration: duration.base,
} as const;

/**
 * Per-item stagger for a list appearing at once.
 *
 * Web has no equivalent — its lists appear in one frame. A phone list is
 * shorter and closer to the eye, and a small stagger reads as the list
 * arriving rather than snapping. Capped so a long list never makes the
 * last row wait: beyond `staggerMax` items everything shares the final
 * delay.
 */
export const stagger = { step: 18, max: 8 } as const;

/**
 * Skeleton pulse. Web's is Tailwind's `animate-pulse` — a 2s
 * ease-in-out opacity cycle between 1 and .5 — reproduced rather than
 * reinvented so the two clients shimmer at the same rate.
 */
export const skeleton = { cycleMs: 2000, minOpacity: 0.5, maxOpacity: 1 } as const;

/**
 * Which loading treatment a surface gets.
 *
 * This is the policy web lacks. The rule: if the shape of what is coming
 * is KNOWN (a list of rows, a grid of cards, a dashboard of cards), draw
 * that shape as a skeleton. If it is a single record whose height is
 * unknown until it arrives, a spinner is honest and a skeleton would lie
 * about the layout.
 */
export const LOADING_POLICY = {
  /** Lists, grids, dashboards. */
  skeleton: 'skeleton',
  /** Single records — inquiry, appointment, client detail. */
  spinner: 'spinner',
} as const;
