import Feather from '@expo/vector-icons/Feather';
import { type ReactNode, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { closeOpenSwipeRow, openSwipeRow } from '@/lib/swipeRegistry';
import { motion, S3, useReducedMotion } from '@/theme/chatMotion';
import { colors, space, type } from '@/theme';

/**
 * The client row's swipe actions: swipe LEFT to reveal Message and
 * Archive behind the row.
 *
 * ─── WHY THIS WAS REBUILT ───────────────────────────────────────────
 *
 * Session AJ built this on `ReanimatedSwipeable`, modelled on what
 * `ConversationSwipe` looked like at the time. `ConversationSwipe` was
 * then rebuilt in 06-g3 — off that same library — because frame analysis
 * of a real device pass found three faults in it: threshold-pop reveals,
 * split translation tearing, and off-spec panel widths. So the model this
 * file was copied from had since been condemned with evidence, and the
 * clients list was quietly the last consumer of the rejected engine.
 *
 * This is that rebuild, ported: ONE translating front, the panels riding
 * with it, nothing rendering outside the front. Not a new design — the
 * same one, so the two lists answer a thumb identically instead of
 * merely looking as though they should.
 *
 * ─── WHAT THE PORT BUYS, BEYOND FEEL ────────────────────────────────
 *
 * Both of the gaps escalated at the end of session 07b close by
 * construction rather than by patch:
 *
 *   · EXCLUSIVITY. The row claims `openSwipeRow` on touch, so opening one
 *     client row closes any other — and closes an open CHAT row too, since
 *     it is one registry for the app. Before this, two client rows could
 *     sit open at once while two chat rows could not.
 *   · OUTSIDE TAP. `consumeTapIfRowOpen()` in the clients screen now has
 *     something to consume, because the registry is what it reads.
 *
 * ─── WHAT DELIBERATELY DIFFERS FROM THE CHAT ROW ────────────────────
 *
 * No LEADING panel. The chat row's left-swipe reveals Pin, which is a
 * per-viewer preference; a client row has no equivalent one-tap
 * preference, so the leading side stays closed and `snaps` carries two
 * stops rather than three.
 *
 * No haptic on commit. `hapticAction()` fires on the chat row's full-swipe
 * pin, which is a gesture that commits; nothing here commits on a swipe.
 *
 * ─── STILL NO FULL-SWIPE COMMIT ─────────────────────────────────────
 *
 * The rule `ConversationSwipe` wrote down holds: one action, full swipe;
 * more than one, tap to choose. This side has two, and Archive is an
 * explicit exception in either case — a write with reach beyond this
 * screen does not commit because a thumb travelled too far. Tapping
 * Archive opens the confirm.
 */
export function ClientSwipe({
  rowId,
  archived,
  hasThread,
  onMessage,
  onArchive,
  children,
}: {
  /** Identity in the shared registry — the client's id. */
  rowId: string;
  archived: boolean;
  /** False hides Message rather than revealing a button that goes nowhere. */
  hasThread: boolean;
  onMessage: () => void;
  onArchive: () => void;
  children: ReactNode;
}) {
  const panels = hasThread ? 2 : 1;
  const trailing = -PANEL * panels;

  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const reduced = useReducedMotion();

  /*
   * The same __DEV__ render counter the chat row carries, for the same
   * reason: the claim is zero React re-renders during a drag, and a
   * counter makes it provable rather than asserted.
   */
  const renders = useRef(0);
  if (__DEV__) {
    renders.current += 1;
    (globalThis as { __swipeRenders__?: Record<string, number> }).__swipeRenders__ = {
      ...((globalThis as { __swipeRenders__?: Record<string, number> }).__swipeRenders__ ?? {}),
      [rowId]: renders.current,
    };
  }

  /** Another row opening, the list scrolling, or an outside tap. */
  useAnimatedReaction(
    () => openSwipeRow.value,
    (open) => {
      if (open !== rowId && x.value !== 0) {
        x.value = motion(0, S3, reduced);
      }
    },
  );

  const settle = (to: number) => {
    'worklet';
    x.value = motion(to, S3, reduced);
    openSwipeRow.value = to === 0 ? '' : rowId;
  };

  const pan = Gesture.Pan()
    // Horizontal intent has to win; a vertical one hands the finger
    // straight back to the list, so scrolling is never hijacked.
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      start.value = x.value;
      // Claimed on touch, not release: any other open row starts closing
      // the moment this one is touched.
      openSwipeRow.value = rowId;
    })
    .onUpdate((event) => {
      const raw = start.value + event.translationX;
      // 1:1 with the finger inside the range, rubber-banded outside it.
      if (raw > 0) x.value = raw * RUBBER;
      else if (raw < trailing) x.value = trailing + (raw - trailing) * RUBBER;
      else x.value = raw;
    })
    .onEnd((event) => {
      // Where the finger was going, not merely where it stopped.
      const projected = x.value + event.velocityX * PROJECTION;
      const snaps = [trailing, 0];
      let nearest = 0;
      let best = Infinity;
      for (const snap of snaps) {
        const distance = Math.abs(projected - snap);
        if (distance < best) {
          best = distance;
          nearest = snap;
        }
      }
      settle(nearest);
    });

  const front = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const commit = (action: () => void) => {
    closeOpenSwipeRow();
    x.value = motion(0, S3, reduced);
    action();
  };

  return (
    <View style={styles.clip}>
      <Animated.View
        style={[styles.trailingPanel, { right: -(OVERSCAN + PANEL * panels), width: OVERSCAN + PANEL * panels }, front]}
        pointerEvents="box-none"
      >
        {hasThread ? (
          <Action
            label="Message"
            icon="message-circle"
            panel={styles.message}
            tint={colors.fgSecondary}
            onPress={() => commit(onMessage)}
          />
        ) : null}
        <Action
          label={archived ? 'Unarchive' : 'Archive'}
          icon="archive"
          panel={styles.archive}
          /* White, not cream: cream on dangerStrong measures 4.39:1,
             under the AA floor, and this label is 10pt. */
          tint="#ffffff"
          onPress={() => commit(onArchive)}
        />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={front}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

/** §8's panel width, shared with the chat row so a thumb learns one size. */
const PANEL = 72;
const RUBBER = 0.55;
const PROJECTION = 0.12;
/** Fill past the last panel, so overscroll never opens a gap at the edge. */
const OVERSCAN = 260;

function Action({
  label,
  icon,
  panel,
  tint,
  onPress,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  panel: object;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, panel, pressed && styles.pressed]}
    >
      <Feather name={icon} size={18} color={tint} />
      <Text style={[styles.actionLabel, { color: tint }]} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },

  trailingPanel: {
    ...StyleSheet.absoluteFillObject,
    left: undefined,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    /* The overscan sits behind ARCHIVE, so the far edge matches the last
       panel rather than showing a seam on a rubber-banded overscroll. */
    backgroundColor: colors.dangerStrong,
  },

  action: { width: PANEL, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  actionLabel: { ...type.label, fontSize: 10 },
  pressed: { opacity: 0.75 },

  message: { backgroundColor: colors.surfaceRaised },
  archive: { backgroundColor: colors.dangerStrong },
});
