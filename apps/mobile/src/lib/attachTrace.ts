/**
 * The attach path's sequence log — permanent, `__DEV__`-only.
 *
 * ─── WHY THIS EXISTS AND WHY IT STAYS ───────────────────────────────
 *
 * The attach-flow freeze survived three fixes because every one of them
 * was verified in the web harness, where the bug cannot exist:
 * react-native-web has no iOS modal presentation queue, so a
 * dismiss→present race has nothing to race. The only place the sequence
 * is real is the device, and on the device the failure is silent — the
 * app renders normally and stops accepting touches, with nothing thrown
 * and nothing in the log.
 *
 * So the log is the instrument. Each step is emitted as it happens, and
 * a freeze is diagnosed by reading which step is LAST: the stall is
 * always between the last line printed and the next one that never
 * arrived. That turns "it froze" into an address.
 *
 * ─── THE STEPS, AND WHAT A STALL AT EACH ONE MEANS ──────────────────
 *
 *   item-selected      the tap registered; nothing has moved yet
 *   dismiss-start      a surface was asked to close
 *   dismissed          it finished closing — the iOS-reliable moment
 *   present-called     the next surface was asked to open
 *   presented          it mounted
 *   interaction-ready  its content is on screen and can be touched
 *
 * A stall after `dismiss-start` with no `dismissed` is a dismissal that
 * never completed — the animation was interrupted and the completion
 * callback never fired. A stall after `present-called` with no
 * `presented` is the presentation queue refusing the request, which is
 * the deadlock this restructure exists to prevent.
 *
 * ─── KEYED ON THE SURFACE, NOT ON A COUNTER ─────────────────────────
 *
 * `CLAUDE.md`'s instrumentation rule: identity must not be keyed on
 * something the system under test mutates. The key here is the surface's
 * own name — 'menu', 'links', 'portfolio' — which is fixed for the life
 * of the code, so two interleaved sequences stay readable and no step
 * can be misattributed the way a mount ledger keyed on a changing id
 * once was.
 */

export type AttachStep =
  | 'item-selected'
  | 'dismiss-start'
  | 'dismissed'
  | 'present-called'
  | 'presented'
  | 'interaction-ready';

/** The surfaces the attach path can show. Stable identity — see above. */
export type AttachSurface = 'menu' | 'links' | 'templates' | 'portfolio' | 'library' | 'camera';

/**
 * Relative to the first traced event, because a wall clock says nothing
 * about a stall — the GAP between two lines is the whole signal, and
 * milliseconds since the flow began make that gap readable at a glance.
 */
let origin: number | null = null;

export function traceAttach(step: AttachStep, surface: AttachSurface, detail?: string): void {
  if (!__DEV__) return;
  const now = Date.now();
  if (origin === null) origin = now;
  const t = String(now - origin).padStart(5, ' ');
  // eslint-disable-next-line no-console
  console.log(`[attach ${t}ms] ${step.padEnd(17)} ${surface}${detail ? ` (${detail})` : ''}`);
}

/**
 * Call when the whole flow is over, so the next one starts from zero
 * rather than accumulating into numbers nobody reads.
 */
export function resetAttachTrace(): void {
  origin = null;
}
