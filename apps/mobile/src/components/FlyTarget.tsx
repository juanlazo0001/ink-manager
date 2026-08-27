import { type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

/**
 * Reports how big a message row turned out to be, so the send-fly knows
 * what it is flying to (§10).
 *
 * ─── WHY A SIZE AND NOT A POSITION ──────────────────────────────────
 *
 * The obvious implementation asks the row where it is (`measureInWindow`)
 * and flies there. That is wrong here, and measurably so: this row lives
 * inside an INVERTED FlatList, which is a `scaleY(-1)` transform. Asked
 * for its window position while the thread showed the new row at y≈660,
 * the row reported y=109 — the pre-transform layout box, mirrored about
 * the list's centre. A fly aimed at that number lands near the top of the
 * thread.
 *
 * A size is immune to that: `onLayout` reports the row's own box, and a
 * flip does not change how tall a thing is. The screen then combines it
 * with the LIST's window rect — measured outside the transform, so that
 * one is trustworthy — and the fact that an inverted list is
 * bottom-anchored: the newest row (rows[0], see threadRows.ts) is always
 * the bottom-most content, and a send scrolls there anyway.
 *
 *     to.y = listBottom - contentPadding - rowHeight
 *
 * Every term there is measured or a style constant. Nothing is guessed,
 * and nothing depends on how a platform reports coordinates through a
 * transform -- which is the one thing that differed between the harness
 * and the device.
 *
 * ─── WHY IT HIDES THE ROW ───────────────────────────────────────────
 *
 * While the clone is in the air the real row must not also be visible, or
 * the same bubble is on screen twice for 380ms. `opacity: 0` rather than
 * unmounting: the row must keep its space in the list, or the content
 * would shift underneath the very animation trying to land on it.
 *
 * A row that is neither flying nor about to renders its children
 * untouched and measures nothing.
 */
export function FlyTarget({
  messageId,
  active,
  hidden,
  onMeasured,
  children,
}: {
  messageId: string;
  /** This row is the one a pending fly is waiting on. */
  active: boolean;
  /** The clone is in the air -- hold the row's space but do not draw it. */
  hidden: boolean;
  onMeasured: (id: string, size: { width: number; height: number }) => void;
  children: ReactNode;
}) {
  if (!active && !hidden) return <>{children}</>;

  const onLayout = (event: LayoutChangeEvent) => {
    if (!active) return;
    const { width, height } = event.nativeEvent.layout;
    // A zero-sized row is a row that has not been laid out yet; flying to
    // it would be worse than not flying at all.
    if (width === 0 || height === 0) return;
    onMeasured(messageId, { width, height });
  };

  return (
    <View collapsable={false} onLayout={onLayout} style={hidden ? { opacity: 0 } : undefined}>
      {children}
    </View>
  );
}
