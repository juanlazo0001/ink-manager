/**
 * The reaction balloon's geometry, measured by the component that draws
 * it — `__DEV__` only, permanent.
 *
 * ─── WHY IN-COMPONENT AND NOT FROM THE OUTSIDE ──────────────────────
 *
 * Session 20 tried to assert this from the harness by walking the DOM,
 * and the numbers came back inconsistent: `balloonRect ⊆ rowRect` passed
 * everywhere while the headroom read 16 on one row and 0 on two others.
 * The cause was the instrument, not the layout — the thread renders
 * inside an inverted list, so DOM "top" is the visual bottom and the
 * probe was measuring in a flipped frame. It is the same trap CLAUDE.md
 * already records for animations, one layer along: a measurement taken
 * through a transform is not a measurement of what the eye sees.
 *
 * `measureInWindow` on the views themselves reports the real screen box
 * after every transform in the chain, so the component measuring itself
 * is the only frame that cannot be wrong about where it ended up.
 *
 * ─── WHAT IT PRINTS, AND WHAT EACH NUMBER MEANS ─────────────────────
 *
 *   bubbleTop / bubbleRight   the anchor the balloon grips
 *   balloonRect               where the balloon actually landed
 *   overlapDepth              balloonBottom − bubbleTop   (contract: ≈14)
 *   outboard                  balloonRight − bubbleRight  (contract: ≈11)
 *   screenGap                 balloonRight → screen edge  (floor: 8)
 *
 * A balloon "floating above the bubble with no overlap" is
 * `overlapDepth ≈ 0`; a balloon tucked inside the bubble is a negative
 * `outboard`. Both were true of the shipped version and neither was
 * visible in a passing containment assertion, which is why these two
 * numbers are printed rather than a boolean.
 */

export interface ProbeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function traceReactionAnchor(params: {
  /** Which case this is — `own` / `incoming`, plus the reactor's side. */
  label: string;
  bubble: ProbeRect;
  balloon: ProbeRect;
  screenWidth: number;
}): void {
  if (!__DEV__) return;
  const { label, bubble, balloon, screenWidth } = params;

  const bubbleTop = bubble.y;
  const bubbleRight = bubble.x + bubble.width;
  const balloonBottom = balloon.y + balloon.height;
  const balloonRight = balloon.x + balloon.width;

  const overlapDepth = balloonBottom - bubbleTop;
  const outboard = balloonRight - bubbleRight;
  const screenGap = screenWidth - balloonRight;

  /*
   * ─── THE SAME FLIP, ONE LAYER ON ────────────────────────────────
   *
   * `overlapDepth` above is the contract as the DEVICE sees it:
   * `balloonBottom − bubbleTop`. In the web harness the thread is an
   * inverted list, so every row is drawn upside down and the balloon
   * that is visually above its bubble reports as below it — that formula
   * then measures two edges that are not facing each other and prints
   * something like 58 for a 14pt overlap.
   *
   * So both are printed. On device read `overlapDepth`; in the harness
   * read `overlapFlipped`. Whichever frame you are in, exactly one of
   * them is the contract, and seeing both makes it obvious which — far
   * better than a single number that is silently right half the time.
   */
  const overlapFlipped = bubble.y + bubble.height - balloon.y;

  /*
   * A LEFT-anchored balloon hangs off the bubble's left edge, so
   * `outboard` above — which measures against the right edge — says
   * nothing about it and prints a large negative. This is the same
   * quantity for that side, and one of the two is meaningful per case:
   * `outboard` for a right cluster, `outboardLeft` for a left one.
   */
  const outboardLeft = bubble.x - balloon.x;

  // eslint-disable-next-line no-console
  console.log(
    `[balloon] ${label.padEnd(22)} bubbleTop=${r1(bubbleTop)} bubbleRight=${r1(bubbleRight)} ` +
      `balloon=[x ${r1(balloon.x)}, y ${r1(balloon.y)}, w ${r1(balloon.width)}, h ${r1(balloon.height)}] ` +
      `overlapDepth=${r1(overlapDepth)} overlapFlipped=${r1(overlapFlipped)} ` +
      `outboard=${r1(outboard)} outboardLeft=${r1(outboardLeft)} screenGap=${r1(screenGap)}`,
  );
}
