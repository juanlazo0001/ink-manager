import { BlurView } from 'expo-blur';
import { type ReactNode, useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

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
    transform: [{ translateY: -TAPBACK_GAP - 6 * (1 - lift.value) }],
  }));

  /*
   * The sheet goes below the bubble when there is room, and otherwise at
   * the foot of the screen. Long-pressing what you just sent is the common
   * case, and a bubble near the bottom has no room under it at all.
   */
  const sheetAtBottom = screenHeight - (rect.y + rect.height) < SHEET_MIN_ROOM;

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
          style={[styles.layer, { top: rect.y, left: rect.x, width: rect.width }, tapback]}
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
/** How far above the bubble the tapback row sits. */
const TAPBACK_GAP = 52;

const styles = StyleSheet.create({
  // §7: ~45% dim, over the blur.
  dim: { backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  layer: { position: 'absolute' },
});
