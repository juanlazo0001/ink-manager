import { Platform } from 'react-native';

import type { Rect } from '@/components/SendFly';

/**
 * Where a thread row actually is on screen — for an inverted list, without
 * ever asking the row for its window position.
 *
 * ─── WHY NOT `measureInWindow` ──────────────────────────────────────
 *
 * The standing rule from the send-fly: anything computing screen
 * coordinates for a thread child measures SIZE in-row and derives
 * POSITION from the list's rect, taken outside the transform. Asked
 * directly, a row inside an inverted FlatList answered with its
 * pre-transform box — measured once at y=109 while it was visibly at
 * y≈660, mirrored about the list's centre.
 *
 * The send-fly could take a shortcut: the row it wanted was always the
 * newest, and an inverted list bottom-anchors that by construction. A
 * long-press lands on ANY row, so the general case needs the arithmetic —
 * and writing it out surfaced something the rule did not anticipate.
 *
 * ─── THE TWO PLATFORMS MEAN DIFFERENT THINGS BY `layout.y` ──────────
 *
 * `inverted` is implemented differently in the two places this app runs,
 * and the difference is visible in what a cell's `onLayout` reports.
 *
 * **iOS** flips a normally-ordered list with a transform. Cells lay out in
 * DATA order — index 0, the newest message, at content y≈0 — and the
 * transform puts that at the bottom afterwards. `layout.y` is therefore
 * distance from the content's start, which after the flip is the list's
 * BOTTOM edge.
 *
 * **react-native-web** reverses the flow instead (`column-reverse` on the
 * content container, plus its own scaleY compensation). Cells lay out in
 * VISUAL order, so `layout.y` is already distance from the list's TOP.
 *
 * Measured in the harness, list at y=97, `contentOffset` 0:
 *
 *     cell layout.y   152   284   482
 *     on screen       249   381   579      = layout.y + 97, exactly
 *
 * i.e. on web `screenY = listTop + layout.y - offset`, with no inversion
 * anywhere in it. Under the iOS mapping those same rows would have been
 * derived at 503, 371 and 173 — out by −254, +10 and +406, in both
 * directions, which is why this is a branch and not a fudge factor.
 *
 * A `Platform.OS` branch is usually a smell. Here it is a description of
 * two genuinely different implementations of the same prop, evidenced
 * above, and collapsing them would mean one of the two is silently wrong.
 *
 * **The iOS branch is a device-gate item.** It is the one production
 * actually runs, and the harness cannot exercise it — the numbers above
 * are the web branch being right, not the iOS branch being checked.
 */
export interface RowBox {
  /** The CELL's `onLayout` y. See above for what that means where. */
  y: number;
  height: number;
}

export function rowScreenRect(list: Rect, row: RowBox, offset: number): Rect {
  const y =
    Platform.OS === 'web'
      ? // Already in visual order — the offset is the only correction.
        list.y + row.y - offset
      : /*
         * Content coordinate `c` sits `(c - offset)` from the list's
         * BOTTOM edge, because inverted content grows upward from there.
         * A row spanning [y, y + height] therefore has its top edge at
         * listBottom - (y - offset) - height.
         */
        list.y + list.height - (row.y - offset) - row.height;

  return { x: list.x, y, width: list.width, height: row.height };
}
