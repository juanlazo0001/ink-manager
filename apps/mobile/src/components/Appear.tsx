import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { easing, enter, stagger } from '@/theme/motion';

/**
 * The list/card enter, equal to apps/web's `fade-slide-up` keyframe:
 * `opacity 0→1, translateY 6px→0` over `--duration-base` (200ms),
 * ease-out. Web applies it to newly-arrived items; mobile applies it on
 * first paint, because a phone list arrives all at once.
 *
 * `index` adds a small stagger web has no equivalent for — capped, so a
 * long list never makes its last row wait (see `stagger.max`). Pass it
 * from the list's own render index.
 *
 * Deliberately built on Reanimated's declarative entering API rather than
 * a manual shared value: it runs on the UI thread, it cancels cleanly
 * when a row unmounts mid-animation, and it costs nothing per row that a
 * FlatList recycles.
 *
 * Rows past `ANIMATE_BELOW` do NOT animate. Their enter happens below the
 * fold where nobody sees it, and on a list of a hundred clients that is a
 * hundred real animations bought for nothing. Web renders every row (no
 * virtualization under react-native-web), which is how this surfaced: the
 * whole list briefly absolutely-positions itself mid-flight because that
 * is how Reanimated implements `entering` on web.
 */
export const ANIMATE_BELOW = 12;
export function Appear({
  children,
  index = 0,
  style,
  /** Set false to render immediately — e.g. rows already on screen during a refresh. */
  enabled = true,
}: {
  children: ReactNode;
  index?: number;
  style?: StyleProp<ViewStyle>;
  enabled?: boolean;
}) {
  if (!enabled || index >= ANIMATE_BELOW) {
    return <Animated.View style={style}>{children}</Animated.View>;
  }

  return (
    <Animated.View
      style={style}
      entering={FadeIn.duration(enter.duration)
        .easing(easing.out)
        .delay(Math.min(index, stagger.max) * stagger.step)
        .withInitialValues({ transform: [{ translateY: enter.translateY }] })}
    >
      {children}
    </Animated.View>
  );
}
