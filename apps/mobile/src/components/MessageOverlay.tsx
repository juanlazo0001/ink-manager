import { BlurView } from 'expo-blur';
import { type ReactNode, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Rect } from '@/components/SendFly';
import { motion, REDUCED_MS, S1, S2 } from '@/theme/chatMotion';
import { space } from '@/theme';

/**
 * §7's long-press overlay: the bubble lifts off a blurred thread, and the
 * things you can do to it appear around it.
 *
 * ─── WHY BESPOKE ────────────────────────────────────────────────────
 *
 * Expo Go has no native context menu, and this app is pinned to Expo Go
 * (apps/mobile/README.md). The iOS behaviour everyone expects from a
 * long-press on a message therefore has to be built rather than called.
 *
 * ─── WHY THE BUBBLE IS CLONED ───────────────────────────────────────
 *
 * The lifted bubble is a COPY, drawn in screen coordinates over the
 * scrim, while the real row stays exactly where it is underneath. The
 * alternative — lifting the row itself — means animating a cell inside a
 * virtualised, inverted, keyboard-translated list, and it would be
 * clipped by the list's own bounds the moment it grew past them.
 *
 * Its rect comes from `rowScreenRect`, never `measureInWindow`. See
 * lib/threadGeometry.ts for why that distinction is load-bearing.
 *
 * ─── WHY BLUR AND FADE ARE KEPT APART ───────────────────────────────
 *
 * CLAUDE.md: never combine a backdrop blur with animation without testing
 * on a real phone first — that pair has caused real on-device jank in this
 * project which desktop tooling did not show. So the blur mounts at its
 * final intensity and never animates; the only animating thing is the dim
 * layer's opacity, a plain composited fade.
 *
 * Android gets the dim alone. `expo-blur` there is an approximation with a
 * real cost, and 45% dim over an already-dark thread reads as "the thread
 * is behind this" perfectly well.
 *
 * ─── WHY THE TAPBACK ROW IS PLACED, NOT OFFSET (session 14) ─────
 *
 * The row used to be pinned to the bubble by a fixed `translateY` of -52
 * and nothing else. It was therefore ALWAYS above, always exactly there,
 * and never compared against anything — while the sheet, for a bubble low
 * on screen, moves to `bottom: 0` and grows upward by its own content
 * height. Those two rules meet: `sheetAtBottom` fires precisely for low
 * bubbles, which is precisely when the row sits in the band the sheet has
 * moved into, and the sheet is the later sibling, so it paints over it.
 *
 * Measured at 393x852, rect.y = 712: row [660, 710], sheet top 674 — 36 of
 * the row's 50pt buried, 14 left. From rect.y >= 726 the row is gone
 * entirely.
 *
 * Note what was NOT wrong, since it was the first suspect: no in-list
 * coordinate is read here. The clone and the row are placed from the SAME
 * `rect`, which `rowScreenRect` has already resolved out of the inverted
 * list's mirrored y. A mirrored value would have moved both of them.
 *
 * So placement is computed rather than offset, and clamped, so the row
 * cannot land under the sheet or above the safe area wherever the bubble
 * is. The row and the sheet both report their real heights through
 * `onLayout`: both are content-sized and neither is knowable in advance.
 */
export function MessageOverlay({
  rect,
  reduced,
  onDismiss,
  bubble,
  above,
  below,
}: {
  /** The pressed row, in screen coordinates. */
  rect: Rect;
  reduced: boolean;
  onDismiss: () => void;
  /** The cloned bubble itself — the same component the row renders. */
  bubble: ReactNode;
  /** The tapback row (§7 rev D) — springs in ABOVE the lifted bubble. */
  above?: ReactNode;
  /** The action sheet, below. */
  below: ReactNode;
}) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  /*
   * Both are content-sized, so both must be measured. Until they are, the
   * row is held invisible for a frame rather than placed from a guess.
   */
  const [rowHeight, setRowHeight] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);

  // 0 at rest, 1 lifted. Drives the scale and everything's opacity.
  const lift = useSharedValue(0);

  useEffect(() => {
    // §10: S1 is the long-press lift.
    lift.value = motion(1, S1, reduced);
  }, [lift, reduced]);

  const dismiss = () => {
    // §7: dismiss reverses with S2.
    lift.value = motion(0, S2, reduced);
    // Long enough for the reverse to be seen, short enough that a second
    // long-press never lands on a dying overlay.
    setTimeout(onDismiss, reduced ? REDUCED_MS : 180);
  };

  const scrim = useAnimatedStyle(() => ({ opacity: lift.value }));
  const clone = useAnimatedStyle(() => ({
    opacity: lift.value,
    // §7: springs to 1.04. Small on purpose — it should read as the bubble
    // being picked up, not as a zoom.
    transform: [{ scale: 1 + 0.04 * lift.value }],
  }));
  const tapback = useAnimatedStyle(() => ({
    opacity: lift.value,
    // Rises into place rather than appearing: the same lift, read as
    // movement instead of scale.
    // The RESTING position is no longer in here — this is the entrance.
    transform: [{ translateY: -6 * (1 - lift.value) }],
  }));

  /*
   * The sheet goes below the bubble when there is room, and otherwise at
   * the foot of the screen. Long-pressing what you just sent is the common
   * case, and a bubble near the bottom has no room under it at all.
   */
  const sheetAtBottom = screenHeight - (rect.y + rect.height) < SHEET_MIN_ROOM;

  /*
   * ─── THE ROW'S PLACEMENT CONTRACT ───────────────────────────
   *
   * Above the bubble when there is room, below when there is not, and in
   * both cases clamped into the band between the safe area and the
   * sheet's top edge. The clamp is what makes "the row is visible" a
   * property of the code rather than of where the bubble happened to be.
   *
   * Every input is a WINDOW coordinate: `rect` is the clone's own rect,
   * the measurement already proven right, and the sheet's top comes from
   * its measured height. Nothing here reads the list.
   */
  const sheetTop = sheetAtBottom ? screenHeight - sheetHeight : rect.y + rect.height + space.md;

  const measured = rowHeight > 0 && (!sheetAtBottom || sheetHeight > 0);
  const minRowTop = insets.top + ROW_GAP;
  const maxRowTop = sheetTop - rowHeight - ROW_GAP;
  const spaceAbove = rect.y - minRowTop;
  const preferred =
    spaceAbove >= rowHeight + ROW_GAP
      ? rect.y - ROW_GAP - rowHeight // above, the §7 default
      : rect.y + rect.height + ROW_GAP; // below, when the bubble is near the top
  /* Math.max on the upper bound itself: if the sheet is tall enough that
     the band inverts, the safe-area floor wins and the row stays on
     screen rather than being clamped off the top of it. */
  const rowTop = Math.min(Math.max(preferred, minRowTop), Math.max(minRowTop, maxRowTop));

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Dismiss">
        {Platform.OS === 'ios' ? (
          // Constant intensity — see the header for why this never animates.
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        ) : null}
        <Animated.View style={[StyleSheet.absoluteFill, styles.dim, scrim]} />
      </Pressable>

      {above ? (
        <Animated.View
          onLayout={(e) => setRowHeight(e.nativeEvent.layout.height)}
          style={[
            styles.layer,
            styles.rowLayer,
            { top: rowTop, left: rect.x, width: rect.width },
            tapback,
            // One frame, before the two heights exist. Placing from a
            // guess and correcting it is a visible jump; this is not.
            measured ? null : styles.preMeasure,
          ]}
          pointerEvents="box-none"
        >
          {above}
        </Animated.View>
      ) : null}

      <Animated.View
        style={[styles.layer, { top: rect.y, left: rect.x, width: rect.width }, clone]}
        pointerEvents="none"
      >
        {bubble}
      </Animated.View>

      <Animated.View
        onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
        style={[
          styles.layer,
          sheetAtBottom
            ? { bottom: 0, left: 0, right: 0 }
            : { top: rect.y + rect.height + space.md, left: rect.x, width: rect.width },
          scrim,
        ]}
      >
        <View>{below}</View>
      </Animated.View>
    </Modal>
  );
}

/** Below this much room under the bubble, the sheet goes to the foot. */
const SHEET_MIN_ROOM = 260;
/**
 * §7: the row's gap from the bubble, and its minimum clearance from the
 * safe area and from the sheet. Replaces `TAPBACK_GAP = 52`, which was
 * not a gap at all — it was the row's own height plus two, written as an
 * offset, which is why the row read as flush against the bubble.
 */
const ROW_GAP = 12;

const styles = StyleSheet.create({
  // §7: ~45% dim, over the blur.
  dim: { backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  layer: { position: 'absolute' },
  /* Above the sheet, so that a frame of overlap during a re-measure can
     never bury the row even though the clamp already rules it out. */
  rowLayer: { zIndex: 2 },
  preMeasure: { opacity: 0 },
});
