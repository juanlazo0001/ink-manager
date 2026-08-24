import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { colors, radius, space } from '@/theme';
import { skeleton as tok } from '@/theme/motion';

/**
 * A loading placeholder shaped like the thing that is coming.
 *
 * Matches apps/web's `Skeleton` (`animate-pulse rounded-md bg-surface`) —
 * same surface colour, same 2s opacity cycle, so the two clients shimmer
 * at the same rate rather than merely both "having skeletons".
 *
 * ONE shared driver: every block on a screen reads the same shared value,
 * so a list of twelve rows runs one animation, not twelve. That matters
 * on a phone in a way it does not in a browser.
 */
function usePulse(): SharedValue<number> {
  const v = useSharedValue<number>(tok.maxOpacity);
  useEffect(() => {
    v.value = withRepeat(
      withSequence(
        withTiming(tok.minOpacity, { duration: tok.cycleMs / 2 }),
        withTiming(tok.maxOpacity, { duration: tok.cycleMs / 2 }),
      ),
      -1,
      false,
    );
  }, [v]);
  return v;
}

export function Skeleton({
  width,
  height = 14,
  style,
  pulse,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** Pass a shared driver when several blocks appear together. */
  pulse?: SharedValue<number>;
}) {
  const own = usePulse();
  const v = pulse ?? own;
  const animated = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[styles.block, { width, height }, animated, style]} />;
}

/**
 * The list skeleton: N rows shaped like a real row (avatar, two lines).
 *
 * Used where the incoming shape is known — lists, grids, the dashboard.
 * A single record gets a spinner instead; see `LOADING_POLICY`.
 */
export function SkeletonList({
  rows = 6,
  avatar = true,
  style,
}: {
  rows?: number;
  avatar?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = usePulse();
  return (
    <View style={[styles.list, style]} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          {avatar ? <Skeleton width={42} height={42} pulse={pulse} style={styles.avatar} /> : null}
          <View style={styles.lines}>
            <Skeleton width="62%" height={15} pulse={pulse} />
            <Skeleton width="86%" height={12} pulse={pulse} style={styles.second} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Card-shaped skeleton, for the dashboard's stack of cards. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  const pulse = usePulse();
  return (
    <View style={styles.list} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.card}>
          <Skeleton width="38%" height={10} pulse={pulse} />
          <Skeleton width="55%" height={26} pulse={pulse} style={styles.second} />
          <Skeleton width="90%" height={12} pulse={pulse} style={styles.second} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surface, borderRadius: radius.input },
  list: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.lg },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  avatar: { borderRadius: radius.pill },
  lines: { flex: 1 },
  second: { marginTop: space.sm },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space.lg,
  },
});
