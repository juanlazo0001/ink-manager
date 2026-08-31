import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The pill row under a detail screen's identity block — Message, Copy,
 * Edit, More on the client page.
 *
 * Lifted out of `client/[id].tsx` rather than reimplemented, because the
 * inquiry screens needed exactly this and the alternative was a second
 * pill that was nearly the same size. It is the client page's own
 * component, so the two screens cannot drift apart by construction.
 *
 * ─── DISABLED IS A STATE, NOT AN ABSENCE ────────────────────────────
 *
 * Omitting `onPress` renders the pill dimmed and unpressable rather than
 * hiding it, and `note` becomes its accessibility hint. That is the
 * client page's existing behaviour and it is deliberate: "Message" with
 * no thread yet tells the artist the action exists and why it is not
 * available, where a missing pill just looks like a screen with fewer
 * options.
 */
export function QuickAction({
  icon,
  Icon,
  label,
  onPress,
  note,
  busy,
}: {
  icon?: React.ComponentProps<typeof Feather>['name'];
  /** See Banner's note — web's own glyph, where it differs from Feather's. */
  Icon?: React.ComponentType<{ size?: number; color: string }>;
  label: string;
  onPress?: () => void;
  /** Why it is unavailable. Spoken as the accessibility hint. */
  note?: string;
  /**
   * In flight. Renders exactly like the disabled state rather than
   * swapping in a spinner — these are 15pt icons in a four-up row, and a
   * spinner at that size is a smudge. What it has to prevent is a second
   * tap firing a second write, and disabling does that.
   */
  busy?: boolean;
}) {
  const enabled = !!onPress && !busy;
  return (
    <Pressable
      onPress={enabled ? onPress : undefined}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityHint={note}
      style={({ pressed }) => [styles.quick, !enabled && styles.quickDisabled, pressed && enabled && styles.pressed]}
    >
      {Icon ? (
        <Icon size={15} color={enabled ? colors.fg : colors.fgMuted} />
      ) : icon ? (
        <Feather name={icon} size={15} color={enabled ? colors.fg : colors.fgMuted} />
      ) : null}
      <Text style={[styles.quickLabel, !enabled && styles.quickLabelDisabled]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The row they sit in. It WRAPS — four pills do not fit on a 320pt
 * screen, and the client page has four.
 */
export function QuickActionRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.quickRow}>{children}</View>;
}

const styles = StyleSheet.create({
  quickRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  quick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexShrink: 0,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  quickDisabled: { borderColor: colors.border, opacity: 0.55 },
  quickLabel: { ...type.small, color: colors.fg },
  quickLabelDisabled: { color: colors.fgMuted },
  pressed: { opacity: 0.6 },
});
