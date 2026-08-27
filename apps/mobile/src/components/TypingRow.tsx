import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { chat, hairline, radius, space } from '@/theme';

/**
 * §6's typing indicator: an incoming-style bubble with three 7pt dots,
 * 150ms apart, on a 1.3s loop.
 *
 * ─── WHY IT IS DORMANT ──────────────────────────────────────────────
 *
 * §6 is unambiguous: wired only to real signals, never simulated. The
 * Chat UX 00 investigation went looking for a typing event on the socket
 * layer and found none -- not for internal threads, not for any provider
 * -- so there is nothing truthful to drive this with. The WS typing event
 * is on the Phase D backlog with the provider work.
 *
 * It ships built and unwired rather than not built: the alternative is
 * either an empty gap in the spec or, worse, a timer pretending a client
 * is typing. `chatDevToggles.typing` shows it in development so it can be
 * judged; nothing in production ever sets that.
 *
 * If you are here to wire it up: the only acceptable input is an event
 * that a real person really is typing. A "recently active" heuristic is
 * not that.
 */
export function TypingRow({ reduced }: { reduced: boolean }) {
  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        <Dot index={0} reduced={reduced} />
        <Dot index={1} reduced={reduced} />
        <Dot index={2} reduced={reduced} />
      </View>
    </View>
  );
}

const CYCLE_MS = 1300;
const STAGGER_MS = 150;
const LIFT_MS = 300;

function Dot({ index, reduced }: { index: number; reduced: boolean }) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      // Reduced motion: the dots stay put. A three-dot bubble is already
      // legible as "typing" without the bounce.
      t.value = 0.5;
      return;
    }
    t.value = withDelay(
      index * STAGGER_MS,
      withRepeat(
        withSequence(
          withTiming(1, { duration: LIFT_MS }),
          withTiming(0, { duration: LIFT_MS }),
          // The rest of the cycle is stillness, which is what makes it
          // read as a pulse rather than a jitter.
          withTiming(0, { duration: CYCLE_MS - 2 * LIFT_MS - index * STAGGER_MS }),
        ),
        -1,
        false,
      ),
    );
  }, [index, reduced, t]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + 0.65 * t.value,
    transform: [{ translateY: -3 * t.value }],
  }));

  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', paddingHorizontal: space.lg, marginTop: 10 },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.bubble,
    borderWidth: hairline,
    backgroundColor: chat.bubbleInBg,
    borderColor: chat.hairline,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: chat.textMuted },
});
