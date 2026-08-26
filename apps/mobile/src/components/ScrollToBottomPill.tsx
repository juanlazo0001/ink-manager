import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { chat, colors, hairline, space, type } from '@/theme';

/**
 * §5's scroll-to-bottom pill: a 36pt raised espresso circle with a cream
 * chevron, and a red count badge when messages arrived while you were
 * reading history.
 *
 * ─── WHY IT EXISTS ──────────────────────────────────────────────────
 *
 * §5 is explicit that a message arriving while you are more than 200pt up
 * must NOT move the viewport. That rule is only humane if there is a way
 * back -- otherwise a thread that is quietly receiving messages strands
 * you in the past with no signal that anything happened. The pill is that
 * signal and that way back, in one control.
 *
 * ─── WHY THE COUNT IS RED ───────────────────────────────────────────
 *
 * Red is punctuation in this app, never a fill (CLAUDE.md). A count of
 * messages you have not seen is exactly punctuation -- the same reading
 * as an unread badge anywhere else -- and it is small. The circle itself
 * is espresso, not red.
 *
 * ─── VISIBILITY IS A SHARED VALUE ───────────────────────────────────
 *
 * `shown` is driven from the scroll handler, which runs on every frame of
 * a drag. Routing that through React state would re-render the whole
 * thread sixty times a second while someone scrolls; a shared value
 * animates the pill without waking the list at all.
 */
export function ScrollToBottomPill({
  shown,
  count,
  onPress,
}: {
  /** 0 hidden, 1 shown. Animated by the caller (S2, §10). */
  shown: SharedValue<number>;
  /** Messages that arrived while the viewport was held back. */
  count: number;
  onPress: () => void;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ scale: 0.85 + 0.15 * shown.value }, { translateY: 8 * (1 - shown.value) }],
  }));

  return (
    <Animated.View style={[styles.wrap, style]} pointerEvents={count >= 0 ? 'box-none' : 'none'}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={
          count > 0 ? `Jump to ${count} new message${count === 1 ? '' : 's'}` : 'Jump to newest'
        }
        style={styles.circle}
        hitSlop={8}
      >
        <Ionicons name="chevron-down" size={20} color={colors.fg} />
      </Pressable>
      {count > 0 ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText} numberOfLines={1}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const PILL = 36;

const styles = StyleSheet.create({
  /*
   * Sits inside the keyboard-translated container, so it rides up with the
   * composer instead of being buried behind the keyboard.
   */
  wrap: { position: 'absolute', right: space.lg, bottom: space.md, width: PILL, height: PILL },
  circle: {
    width: PILL,
    height: PILL,
    borderRadius: PILL / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chat.surfaceRaised,
    borderWidth: hairline,
    borderColor: chat.hairline,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chat.alert,
  },
  badgeText: { ...type.label, fontSize: 10, lineHeight: 12, color: '#ffffff' },
});
