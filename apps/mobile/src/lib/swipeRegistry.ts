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
