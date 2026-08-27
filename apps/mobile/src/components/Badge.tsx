import { formatBubbleCount } from '@ink-manager/shared-types';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius } from '@/theme';

/**
 * The one count bubble in this app — cream fill, dark text, `99+` above
 * ninety-nine.
 *
 * It lived inside `TopBar.tsx`, exported but housed with the top cluster,
 * which is how the CHAT fab ended up drawing its OWN copy of the same
 * treatment in local styles instead of importing it. Two implementations
 * of one bubble is a fork waiting to drift, and §8 rev F asks for this
 * exact treatment on the fab — so it moves here, where a third caller can
 * find it without importing the top bar.
 *
 * Never red. A count is data; red in this palette is punctuation, and on
 * the fab it would also be red-on-red.
 */
export function Badge({ count, style }: { count: number; style?: object }) {
  return (
    <View style={[styles.badge, style]} pointerEvents="none">
      <Text style={styles.badgeText}>{formatBubbleCount(count)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  /* web: -right-1 -top-1 h-5 min-w-5 rounded-full bg-fg px-1 */
  badge: {
    position: 'absolute',
    right: -4,
    top: -4,
    height: 20,
    minWidth: 20,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* web: text-[11px] font-medium text-accent-fg */
  badgeText: { fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 14, color: colors.accentFg },
});
