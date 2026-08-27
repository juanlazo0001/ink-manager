import { makeMutable, type SharedValue } from 'react-native-reanimated';

/**
 * Which row, if any, is currently swiped open.
 *
 * ─── WHY A SHARED VALUE AND NOT STATE ───────────────────────────────
 *
 * Exclusivity has to be decided in the same place the swipe lives: on the
 * UI thread, mid-gesture. The moment one row's finger starts moving it,
 * every other open row should already be closing — routing that through
 * React means the close lands a frame or more later, and it means a
 * re-render of the whole list during a drag, which is exactly what §8
 * rev F forbids.
 *
 * `makeMutable` rather than a hook, because this is one value for the
 * whole screen and no component owns it.
 *
 * Empty string means "nothing open". Not null: comparing a string on the
 * UI thread avoids a nullable read in every row's reaction worklet.
 */
export const openSwipeRow: SharedValue<string> = makeMutable('');

/** Close whatever is open — list scroll, navigation, a committed action. */
export function closeOpenSwipeRow() {
  openSwipeRow.value = '';
}

/**
 * §8 rev G — the outside tap.
 *
 * Call this FIRST in any press handler that would navigate. It answers
 * "did this tap get spent closing an open row?", and when it says yes the
 * caller must return without doing anything else: a tap that closes a row
 * never also opens a thread.
 *
 *     onPress={() => {
 *       if (consumeTapIfRowOpen()) return;
 *       router.push(...)
 *     }}
 *
 * ─── WHY A PLAIN FUNCTION AND NOT A HOOK OR STATE ───────────────────
 *
 * Reading `.value` off a shared value on the JS thread is just a property
 * read — it does not subscribe, so nothing re-renders and the swipe
 * render-counter stays at 0 through a drag. That was a hard requirement:
 * the 06-g3 rebuild exists because re-rendering rows mid-gesture is what
 * tore the old implementation. A `useState` mirror of "is a row open"
 * would have re-introduced exactly that.
 *
 * Setting the value to '' is what closes: every row's
 * `useAnimatedReaction` on `openSwipeRow` sees an id that is not its own
 * and animates its front back with S3. So the close runs entirely on the
 * UI thread, from one string write.
 */
export function consumeTapIfRowOpen(): boolean {
  if (openSwipeRow.value === '') return false;
  openSwipeRow.value = '';
  return true;
}
