import Feather from '@expo/vector-icons/Feather';
import { type ReactNode, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { hapticAction } from '@/lib/chatHaptics';
import { closeOpenSwipeRow, openSwipeRow } from '@/lib/swipeRegistry';
import { motion, S3, useReducedMotion } from '@/theme/chatMotion';
import { colors, space, type } from '@/theme';

/**
 * §8 rev F: row swipes, rebuilt to the single-translating-front model.
 *
 * ─── WHAT THE GATE FOUND, AND WHY THIS IS A REBUILD ─────────────────
 *
 * The shipped version used `ReanimatedSwipeable`, and frame analysis of a
 * device recording found three things wrong with it:
 *
 *   · near-zero translation during the drag, then a THRESHOLD POP to
 *     open (t≈2.4→2.7s) — the row was not attached to the finger
 *   · SPLIT TRANSLATION TEARING — the pin glyph and timestamp stayed put
 *     and rendered ON TOP of the revealed MUTE panel while the rest of
 *     the row slid (t≈8.4s)
 *   · a ~38pt pin panel against a spec of 72, and the front overshooting
 *     past the panels with no clamp
 *
 * None of those is a tuning problem, so none of them is patched here. The
 * whole thing is one shared value the finger writes to, and one container
 * that reads it.
 *
 * ─── ONE FRONT, AND EVERYTHING IS IN IT ─────────────────────────────
 *
 * `children` is the entire row — gutter dot, avatar, main column, and the
 * trailing time/pin column. Nothing in the row renders outside the front,
 * which is what makes the tearing structurally impossible rather than
 * merely fixed: there is only one thing that moves.
 *
 * ─── WHY THE PANELS MOVE TOO ────────────────────────────────────────
 *
 * Rev F says panels sit absolutely behind the front, which assumes the
 * front is opaque enough to hide them at rest. This app's rows are
 * deliberately TRANSPARENT — the shared photo ground shows through them,
 * and `ScreenShell` throws in development if a screen paints over it. An
 * opaque front would be the "looks fine, just flat" bug that assertion
 * exists to prevent.
 *
 * So the panels live just OUTSIDE the container's edges and translate in
 * lockstep with the front, clipped by `overflow: hidden`. At rest they
 * are entirely outside and the photo shows through; at a snap they occupy
 * exactly their own width. The front and the panels are one rigid system,
 * so this is not the split translation that caused the tearing — nothing
 * inside the ROW moves independently of anything else inside the row.
 *
 * Each panel is backed by an OVERSCAN of extra fill on its outer side, so
 * that rubber-banding past a snap cannot open a gap at the screen edge.
 */
export function ConversationSwipe({
  rowId,
  pinned,
  muted,
  onTogglePin,
  onToggleMute,
  onArchive,
  canArchive,
  children,
}: {
  /** Identity for the open-row registry — exclusivity, on the UI thread. */
  rowId: string;
  pinned: boolean;
  muted: boolean;
  onTogglePin: () => void;
  onToggleMute: () => void;
  onArchive: () => void;
  /** False hides Archive entirely rather than showing a button that 403s. */
  canArchive: boolean;
  children: ReactNode;
}) {
  const trailing = canArchive ? -PANEL * 2 : -PANEL;

  const x = useSharedValue(0);
  const start = useSharedValue(0);
  // §10: the OS setting can flip mid-session, so it is read from the hook
  // rather than captured as a constant.
  const reduced = useReducedMotion();

  /*
   * A __DEV__ render counter, mounted so the rebuild's central claim --
   * zero React re-renders during a drag -- is provable rather than
   * asserted. It counts renders of THIS component; the drag writes only
   * to a shared value, so it must not move.
   */
  const renders = useRef(0);
  if (__DEV__) {
    renders.current += 1;
    (globalThis as { __swipeRenders__?: Record<string, number> }).__swipeRenders__ = {
      ...((globalThis as { __swipeRenders__?: Record<string, number> }).__swipeRenders__ ?? {}),
      [rowId]: renders.current,
    };
  }

  /** Another row opening, or the list scrolling, closes this one. */
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
    /*
     * The standing offsets, unchanged from the thread's own drag: a
     * horizontal intent has to win before anything moves, and a vertical
     * one hands the finger straight back to the list.
     */
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      start.value = x.value;
      // Claimed on touch, not on release: any other open row starts
      // closing the moment this one is touched.
      openSwipeRow.value = rowId;
    })
    .onUpdate((event) => {
      const raw = start.value + event.translationX;
      /*
       * 1:1 with the finger inside the range, rubber-banded outside it.
       * The resistance is the same 0.55 the thread's reveal uses -- past
       * the stop the row still follows, just reluctantly, which is what
       * says "this is as far as it goes" without the screen freezing
       * under a moving hand.
       */
      if (raw > PANEL) x.value = PANEL + (raw - PANEL) * RUBBER;
      else if (raw < trailing) x.value = trailing + (raw - trailing) * RUBBER;
      else x.value = raw;
    })
    .onEnd((event) => {
      /*
       * Where the finger was GOING, not just where it stopped: a flick
       * that has barely travelled still means open, and requiring the
       * distance from it makes the gesture feel sticky.
       */
      const projected = x.value + event.velocityX * PROJECTION;
      const snaps = [trailing, 0, PANEL];
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
      {/* Leading: pin. One action, so one panel. */}
      <Animated.View style={[styles.leadingPanel, front]} pointerEvents="box-none">
        <Action
          label={pinned ? 'Unpin' : 'Pin'}
          icon="bookmark"
          panel={styles.pin}
          tint={colors.accentFg}
          onPress={() => {
            hapticAction();
            commit(onTogglePin);
          }}
        />
      </Animated.View>

      {/* Trailing: mute, then archive. */}
      <Animated.View style={[styles.trailingPanel, front]} pointerEvents="box-none">
        <Action
          label={muted ? 'Unmute' : 'Mute'}
          icon={muted ? 'bell' : 'bell-off'}
          panel={styles.mute}
          tint={colors.fgSecondary}
          onPress={() => commit(onToggleMute)}
        />
        {canArchive ? (
          <Action
            label="Archive"
            icon="archive"
            panel={styles.archive}
            tint={colors.fgMuted}
            // Tap commits, never the swipe -- archive is studio-wide
            // (rev E), and this is the tap it demands.
            onPress={() => commit(onArchive)}
          />
        ) : null}
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={front}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

/** §8 rev F: 72pt, each. */
const PANEL = 72;
/** §2.3's resistance, reused past the snaps. */
const RUBBER = 0.55;
/** How far ahead of the finger to look when picking a snap. */
const PROJECTION = 0.12;
/**
 * Extra fill on each panel's outer side. Rubber-banding past a snap moves
 * the panels with the front, and without this the screen edge would open
 * a gap behind them.
 */
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

  /*
   * Outside the container at rest, clipped away entirely; the overscan is
   * fill, and the action itself sits at the inner edge.
   */
  leadingPanel: {
    ...StyleSheet.absoluteFillObject,
    left: -(OVERSCAN + PANEL),
    right: undefined,
    width: OVERSCAN + PANEL,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: colors.accent,
  },
  trailingPanel: {
    ...StyleSheet.absoluteFillObject,
    left: undefined,
    right: -(OVERSCAN + PANEL * 2),
    width: OVERSCAN + PANEL * 2,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    /* The overscan behind ARCHIVE, so the far edge matches the last panel. */
    backgroundColor: colors.surfaceInset,
  },

  action: { width: PANEL, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  actionLabel: { ...type.label, fontSize: 10 },
  pressed: { opacity: 0.75 },

  pin: { backgroundColor: colors.accent },
  mute: { backgroundColor: colors.surfaceRaised },
  /* Recedes on purpose: it is the one action with reach beyond this
     viewer, and a loud panel would invite the tap rather than warn. */
  archive: { backgroundColor: colors.surfaceInset },
});
