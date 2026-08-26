import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';
import { useEffect } from 'react';

import { hapticSelect } from '@/lib/chatHaptics';
import { REACTION_EMOJIS, type ReactionEmoji } from '@/lib/conversations';
import { motion, S1 } from '@/theme/chatMotion';
import { chat, colors, hairline, radius, space } from '@/theme';

/**
 * §7 rev D: the reactions entry point, as an iMessage-style tapback row
 * springing in above the lifted bubble.
 *
 * ─── WHAT CHANGED, AND WHAT DELIBERATELY DID NOT ────────────────────
 *
 * Only the entry point. Reactions shipped in session AE as a real stored
 * feature, and §0 is explicit that they are NOT cut: the storage, the
 * one-per-person-per-message upsert, and the chips on the bubbles are all
 * reused untouched. What moved is where you reach for them.
 *
 * They were a row inside the action sheet, under a `React` eyebrow —
 * which put reacting on the same footing as Reply and Copy, three taps
 * of visual distance from the message it applies to. A tapback belongs
 * ON the message. Above the lifted bubble it is the first thing under
 * your thumb when the bubble comes up, which is what makes reacting a
 * gesture rather than a menu choice.
 *
 * ─── THE STAGGER ────────────────────────────────────────────────────
 *
 * Each emoji arrives on its own S1 spring, 18ms apart. iMessage does the
 * same thing and it is not decoration: the sweep left-to-right is what
 * tells you this is a ROW of choices rather than one wide control, in the
 * moment before you have read any of them.
 *
 * Under reduced motion they all arrive together — `motion()` collapses
 * the spring to a fade, and a staggered fade is just a slower fade.
 */
export function Tapback({
  own,
  mine,
  reduced,
  onReact,
}: {
  /** Which side the bubble is on — the row aligns to it. */
  own: boolean;
  /** The viewer's current reaction, if any. Tapping it again clears it. */
  mine: string | null;
  reduced: boolean;
  onReact: (emoji: ReactionEmoji) => void;
}) {
  return (
    <View style={[styles.wrap, own ? styles.wrapOwn : styles.wrapTheirs]} pointerEvents="box-none">
      <View style={styles.pill}>
        {REACTION_EMOJIS.map((emoji, index) => (
          <Emoji
            key={emoji}
            emoji={emoji}
            index={index}
            selected={mine === emoji}
            reduced={reduced}
            onPress={() => {
              hapticSelect();
              onReact(emoji);
            }}
          />
        ))}
      </View>
    </View>
  );
}

const STAGGER_MS = 18;

function Emoji({
  emoji,
  index,
  selected,
  reduced,
  onPress,
}: {
  emoji: string;
  index: number;
  selected: boolean;
  reduced: boolean;
  onPress: () => void;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = reduced ? motion(1, S1, true) : withDelay(index * STAGGER_MS, motion(1, S1, false));
  }, [index, reduced, t]);

  const style = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ scale: 0.6 + 0.4 * t.value }],
  }));

  return (
    <Animated.View style={style}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={selected ? `Remove ${emoji} reaction` : `React ${emoji}`}
        style={({ pressed }) => [styles.target, selected && styles.targetMine, pressed && styles.pressed]}
      >
        <Text style={styles.glyph}>{emoji}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, flexDirection: 'row' },
  /* Aligned to the bubble's own side, so the row reads as belonging to
     that message rather than floating over the thread. */
  wrapOwn: { justifyContent: 'flex-end' },
  wrapTheirs: { justifyContent: 'flex-start' },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: chat.surfaceRaised,
    borderWidth: hairline,
    borderColor: chat.hairline,
  },
  target: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: 'transparent',
  },
  /* The viewer's own choice, marked the way every other selected control
     in this app is marked. */
  targetMine: { borderColor: colors.accent, backgroundColor: 'rgba(201, 154, 91, 0.14)' },
  glyph: { fontSize: 22, lineHeight: 28 },
  pressed: { opacity: 0.6 },
});
