import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { withSpring, withTiming, type WithSpringConfig } from 'react-native-reanimated';

/**
 * Chat motion presets (spec §10).
 *
 * Named rather than inlined so the same spring is literally the same
 * object everywhere it is used — a header collapse and a drag snap-back
 * that differ by five units of damping read as two different apps.
 *
 * Part 1 uses S2 (header collapse, drag snap-back). Part 2 adds S3
 * (composer growth, send button). S1 and S4 land with Part 3; they are
 * declared here so that part adds callers rather than a second file.
 */

/** Pop — incoming entry, typing, long-press lift. */
export const S1: WithSpringConfig = { stiffness: 200, damping: 16, mass: 1 };

/** Settle — drag snap-back, header collapse, sheet dismiss, pill. */
export const S2: WithSpringConfig = { stiffness: 260, damping: 30, mass: 1 };

/** UI — composer growth, send-button, swipe snap. */
export const S3: WithSpringConfig = { stiffness: 320, damping: 28, mass: 1 };

/** Fly — the send-fly (§10). */
export const S4: WithSpringConfig = { stiffness: 240, damping: 26, mass: 1 };

/** §10's reduced-motion substitute: springs collapse to a 150ms fade. */
export const REDUCED_MS = 150;

/**
 * Is "Reduce Motion" on?
 *
 * A hook rather than a module constant, and that is not fussiness: the
 * setting can be toggled while the app is open, and a value read once at
 * import time would be wrong for the rest of the session. iOS fires the
 * change event; this listens for it.
 *
 * Read on the JS thread and passed INTO worklets as a plain boolean —
 * `AccessibilityInfo` is not callable from the UI thread.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (active) setReduced(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => setReduced(on));
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/**
 * A spring, or §10's flat 150ms when Reduce Motion is on.
 *
 * ─── WHY THIS EXISTS RATHER THAN `withSpring` AT EVERY CALL SITE ─────
 *
 * §10's reduced-motion rule is one sentence — "springs collapse to 150ms
 * fades" — and it applies to every animation in the chat surface. Written
 * out per call site it would be a conditional each time, and the first
 * one anybody forgot would be an accessibility regression nobody notices,
 * because the person who needs it is not the person writing it.
 *
 * `'worklet'` so it can be called from the UI thread, which is where
 * gesture and keyboard handlers run.
 *
 * @param reduced from `useReducedMotion()` — passed in, never read here,
 *   because a worklet cannot touch `AccessibilityInfo`.
 */
export function motion(value: number, config: WithSpringConfig, reduced: boolean) {
  'worklet';
  return reduced ? withTiming(value, { duration: REDUCED_MS }) : withSpring(value, config);
}
