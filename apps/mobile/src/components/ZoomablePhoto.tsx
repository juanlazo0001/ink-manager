import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { motion, S2 } from '@/theme/chatMotion';

/**
 * §2.5's viewer page: pinch-zoom, and swipe-down to dismiss with
 * progressive opacity.
 *
 * ─── WHY BESPOKE ────────────────────────────────────────────────────
 *
 * Q13 ruled bespoke over `react-native-awesome-gallery`. The library is
 * good, but every dependency this app adds has to survive the Expo SDK 54
 * pin (apps/mobile/README.md), and what is actually wanted here is two
 * gestures over an image that already renders — not a gallery framework.
 *
 * ─── HOW THE THREE GESTURES STAY OUT OF EACH OTHER'S WAY ────────────
 *
 * This page lives inside a horizontally paging ScrollView, so there are
 * three claims on a finger: page across, zoom, and dismiss. They are
 * separated by what the finger DOES, not by modes:
 *
 *   pinch          two fingers — unambiguous, never contested
 *   drag down      one finger, `activeOffsetY` + `failOffsetX`, and only
 *                  while UNZOOMED, so horizontal intent goes to the pager
 *   drag anywhere  one finger, only while ZOOMED — panning the photo,
 *                  where the pager has nothing to offer anyway
 *
 * The `zoomed` test is what makes the last two the same gesture with two
 * meanings, and it is read from the shared value on the UI thread, so it
 * is never a frame behind the pinch that changed it.
 *
 * ─── PROGRESSIVE OPACITY ────────────────────────────────────────────
 *
 * The backdrop fades as the photo falls, so a half-committed drag SHOWS
 * you it is half-committed — release and it springs back, keep going and
 * it is already most of the way gone. A dismiss that only happens at the
 * end of the gesture makes people guess.
 */
export function ZoomablePhoto({
  url,
  width,
  height,
  /** Shared with the viewer's backdrop — see progressive opacity above. */
  dismissProgress,
  onDismiss,
}: {
  url: string;
  width: number;
  height: number;
  dismissProgress: SharedValue<number>;
  onDismiss: () => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      // Clamped in the gesture rather than after it: letting the value run
      // free and correcting on release means the photo visibly overshoots
      // and snaps, which reads as a glitch rather than a limit.
      scale.value = Math.min(MAX_SCALE, Math.max(0.8, savedScale.value * event.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        // Back to fit, and centred — a zoomed-out photo hanging off to
        // one side is the state nobody asked for.
        scale.value = motion(1, S2, false);
        x.value = motion(0, S2, false);
        y.value = motion(0, S2, false);
        savedScale.value = 1;
        savedX.value = 0;
        savedY.value = 0;
        return;
      }
      savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    // Vertical intent has to win before this moves, and any horizontal
    // component hands the finger back to the pager.
    .activeOffsetY([-12, 12])
    .failOffsetX([-18, 18])
    .onUpdate((event) => {
      if (scale.value > 1) {
        // Zoomed: this is panning the photo.
        x.value = savedX.value + event.translationX;
        y.value = savedY.value + event.translationY;
        return;
      }
      // Unzoomed: this is the dismissal. Downward only — dragging up has
      // no meaning here and following it would imply one.
      const dy = Math.max(0, event.translationY);
      y.value = dy;
      dismissProgress.value = Math.min(1, dy / DISMISS_DISTANCE);
    })
    .onEnd((event) => {
      if (scale.value > 1) {
        savedX.value = x.value;
        savedY.value = y.value;
        return;
      }
      // Distance OR speed: a fast flick is as clear an intention as a
      // long drag, and requiring the full distance from both makes the
      // gesture feel sticky.
      if (event.translationY > DISMISS_DISTANCE * 0.6 || event.velocityY > 900) {
        dismissProgress.value = 1;
        runOnJS(onDismiss)();
        return;
      }
      y.value = motion(0, S2, false);
      dismissProgress.value = motion(0, S2, false);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = scale.value > 1 ? 1 : 2.5;
      scale.value = motion(next, S2, false);
      savedScale.value = next;
      if (next === 1) {
        x.value = motion(0, S2, false);
        y.value = motion(0, S2, false);
        savedX.value = 0;
        savedY.value = 0;
      }
    });

  const gesture = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan));

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
    // The photo shrinks slightly as it falls, which is what makes it read
    // as going away rather than merely moving down.
    opacity: 1 - 0.25 * dismissProgress.value,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.page, { width, height }]} collapsable={false}>
        <Animated.View style={[styles.fill, style]}>
          <Image source={{ uri: url }} style={styles.fill} contentFit="contain" transition={150} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/** How far a drag has to travel for the backdrop to reach full clear. */
const DISMISS_DISTANCE = 220;
const MAX_SCALE = 4;

const styles = StyleSheet.create({
  page: { alignItems: 'center', justifyContent: 'center' },
  fill: { width: '100%', height: '100%' },
});
