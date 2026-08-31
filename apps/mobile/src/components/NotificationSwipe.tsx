import { type ReactNode, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { CheckIcon } from '@/components/icons';
import { hapticAction } from '@/lib/chatHaptics';
import { closeOpenSwipeRow, openSwipeRow } from '@/lib/swipeRegistry';
import { motion, S3, useReducedMotion } from '@/theme/chatMotion';
import { colors, space, type } from '@/theme';

/**
 * A notification row's trailing swipe: Mark read.
 *
 * ─── THE THIRD SIBLING, AND WHY IT IS NOT A FOURTH MODEL ────────────
 *
 * `ConversationSwipe` established this shape and `ClientSwipe` inherited
 * it; this is the same machinery again, with the numbers unchanged
 * (PANEL 72, RUBBER 0.55, PROJECTION 0.12, the S3 spring, the shared
 * open-row registry) so a thumb that has learned one row has learned all
 * three. What differs is what it reveals, and that is the only thing
 * that differs.
 *
 * ─── IT COMMITS ON A FULL SWIPE, AND THE OTHER TWO DO NOT ───────────
 *
 * That is not an inconsistency, it is `ConversationSwipe`'s own rule
 * applied: "one action, full swipe; more than one, tap to choose". This
 * side has exactly one. Archive is an explicit exception to that rule in
 * both siblings because it reaches past the screen it is on; marking a
 * notification read is the opposite kind of write — it is the thing that
 * happens anyway the moment you open the row, and the row stays on
 * screen showing its new state. So a committed full swipe is safe here
 * in a way it is not there.
 *
 * A read row has nothing to reveal, so the gesture is disabled outright
 * rather than opening onto a button that would do nothing.
 */
export function NotificationSwipe({
  rowId,
  read,
  onMarkRead,
  children,
}: {
  /** Identity in the shared registry — the notification's id. */
  rowId: string;
  /** True disables the gesture entirely: there is nothing to reveal. */
  read: boolean;
  onMarkRead: () => void;
  children: ReactNode;
}) {
  const trailing = -PANEL;

  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const reduced = useReducedMotion();

  /* The same __DEV__ counter both siblings carry — the claim is zero
     React re-renders during a drag, and this makes it checkable. */
  const renders = useRef(0);
  if (__DEV__) {
    renders.current += 1;
    (globalThis as { __swipeRenders__?: Record<string, number> }).__swipeRenders__ = {
      ...((globalThis as { __swipeRenders__?: Record<string, number> }).__swipeRenders__ ?? {}),
      [rowId]: renders.current,
    };
  }

  useAnimatedReaction(
    () => openSwipeRow.value,
    (open) => {
      if (open !== rowId && x.value !== 0) {
        x.value = motion(0, S3, reduced);
      }
    },
  );

  const pan = Gesture.Pan()
    .enabled(!read)
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      start.value = x.value;
      openSwipeRow.value = rowId;
    })
    .onUpdate((event) => {
      const raw = start.value + event.translationX;
      if (raw > 0) x.value = raw * RUBBER;
      else if (raw < trailing) x.value = trailing + (raw - trailing) * RUBBER;
      else x.value = raw;
    })
    .onEnd((event) => {
      const projected = x.value + event.velocityX * PROJECTION;
      /*
       * Past the full-swipe threshold the gesture IS the action — the
       * panel never has to be tapped. Threshold is 1.6 panels, so a
       * deliberate pull commits and a hesitant one only opens.
       */
      if (projected < trailing * FULL_SWIPE) {
        x.value = motion(0, S3, reduced);
        openSwipeRow.value = '';
        hapticAction();
        onMarkRead();
        return;
      }
      const nearest = Math.abs(projected - trailing) < Math.abs(projected) ? trailing : 0;
      x.value = motion(nearest, S3, reduced);
      openSwipeRow.value = nearest === 0 ? '' : rowId;
    });

  const front = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={styles.clip}>
      <Animated.View
        style={[styles.trailingPanel, { right: -(OVERSCAN + PANEL), width: OVERSCAN + PANEL }, front]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={() => {
            closeOpenSwipeRow();
            x.value = motion(0, S3, reduced);
            onMarkRead();
          }}
          accessibilityRole="button"
          accessibilityLabel="Mark read"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <CheckIcon size={18} color={colors.accentFg} />
          <Text style={styles.actionLabel} numberOfLines={1}>
            MARK READ
          </Text>
        </Pressable>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={front}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const PANEL = 72;
const RUBBER = 0.55;
const PROJECTION = 0.12;
const OVERSCAN = 260;
/** Multiples of a panel the projected position must pass to commit. */
const FULL_SWIPE = 1.6;

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  trailingPanel: {
    ...StyleSheet.absoluteFillObject,
    left: undefined,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    /* Gold, not red: this is the confirming action, not a destructive
       one, and `dangerStrong` is reserved for writes that take something
       away. The overscan behind it is the same fill so a rubber-banded
       overscroll shows no seam. */
    backgroundColor: colors.accent,
  },
  action: { width: PANEL, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  actionLabel: { ...type.label, fontSize: 10, color: colors.accentFg },
  pressed: { opacity: 0.75 },
});
