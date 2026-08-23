import Feather from '@expo/vector-icons/Feather';
import { formatBubbleCount } from '@ink-manager/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, space } from '@/theme';

/**
 * The centre tab: web's chat FAB, moved onto the tab bar.
 *
 * Ported value-for-value from `ConversationsPanel.tsx`'s editorial branch:
 *
 *   button   h-16 w-16 rounded-full bg-danger-strong text-white
 *            shadow-xl shadow-black/40, flex-col gap-0.5
 *   halo     absolute -inset-2 rounded-full border border-danger-strong/25
 *   icon     MessageIcon h-5 w-5
 *   label    font-jura text-[8px] font-bold tracking-[0.14em] uppercase
 *   badge    -right-1 -top-1 h-5 min-w-5 rounded-full bg-fg px-1
 *            text-[11px] font-semibold text-accent-fg
 *
 * 64px against the top bar's 44px icon buttons — the size difference is
 * web's, not an invention.
 *
 * The label is WHITE, not cream, and that is deliberate on web with the
 * reason recorded: cream on danger-strong measures 4.39:1, just under the
 * 4.5:1 AA floor for small text, and white clears it at 5.16:1. At 8px
 * this is the smallest text in the app, so it is exactly where that
 * matters.
 *
 * RED HERE IS A BRAND FILL, NOT PUNCTUATION. That is a deliberate
 * amendment to this repo's design rule, made by the owner and written
 * into CLAUDE.md alongside this component, so that a later session
 * reading "red is never a fill" does not revert it.
 */
export function ChatTabButton({
  focused,
  unread,
  onPress,
}: {
  focused: boolean;
  unread: number;
  onPress: () => void;
}) {
  return (
    <View style={styles.slot} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={unread > 0 ? `Chat, ${unread} unread` : 'Chat'}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        {/* The faint hairline halo -- web calls it the marketing site's own
            red-FAB character. Non-interactive and outside the fill. */}
        <View style={styles.halo} pointerEvents="none" />
        <Feather name="message-square" size={20} color="#ffffff" />
        <Text style={styles.label}>CHAT</Text>
        {unread > 0 ? (
          <View style={styles.badge} pointerEvents="none">
            <Text style={styles.badgeText}>{formatBubbleCount(unread)}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

/** How far the button protrudes above the bar. Consumed by the layout too. */
export const CHAT_BUTTON_SIZE = 64;
export const CHAT_BUTTON_LIFT = 18;

const styles = StyleSheet.create({
  // The slot keeps the tab item's own width while the button itself is
  // lifted out of it, so the four other items stay evenly spaced.
  slot: { flex: 1, alignItems: 'center', justifyContent: 'flex-start' },
  button: {
    width: CHAT_BUTTON_SIZE,
    height: CHAT_BUTTON_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    marginTop: -CHAT_BUTTON_LIFT,
    backgroundColor: colors.dangerStrong,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  halo: {
    position: 'absolute',
    top: -space.sm,
    left: -space.sm,
    right: -space.sm,
    bottom: -space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(194, 64, 47, 0.25)',
  },
  /* font-jura text-[8px] font-bold tracking-[0.14em] uppercase, white */
  label: { fontFamily: fonts.labelBold, fontSize: 8, lineHeight: 10, letterSpacing: 1.12, color: '#ffffff' },

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
  badgeText: { fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 14, color: colors.accentFg },

  pressed: { opacity: 0.85 },
});
