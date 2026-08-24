import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, SectionHeader } from '@/components/editorial';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * A card section that collapses, with an optional header action.
 *
 * The shape apps/web's client detail uses: a card per subject, its title
 * in the serif small-caps treatment, and the section's own action sitting
 * in the header rather than loose in the body.
 *
 * `count` renders beside the title the way web's headings carry theirs,
 * so a collapsed section still says how much is inside — which is the
 * whole reason collapsing is safe on a phone.
 */
export function CollapsibleSection({
  title,
  count,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  actions?: SectionAction[];
  children: ReactNode;
}) {
  return (
    <Card>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}${count === undefined ? '' : `, ${count}`}`}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <Feather
          name={open ? 'chevron-down' : 'chevron-right'}
          size={15}
          color={colors.fgMuted}
        />
        <SectionHeader style={styles.title}>{title}</SectionHeader>
        {count !== undefined ? <Text style={styles.count}>{count}</Text> : null}
      </Pressable>

      {actions && actions.length > 0 ? (
        <View style={styles.actionRow}>
          {actions.map((a) => (
            <SectionActionButton key={a.label} action={a} />
          ))}
        </View>
      ) : null}

      {open ? <View style={styles.body}>{children}</View> : null}
    </Card>
  );
}

export interface SectionAction {
  label: string;
  /** Omitted means the action exists on web but has no mobile write yet. */
  onPress?: () => void;
  /**
   * Why it is inactive, in the app's own voice. Shown instead of a
   * silent grey button — the owner asked for parity of SHAPE now, with
   * function following, and a control that says nothing about why it is
   * off is just broken-looking.
   */
  unavailableNote?: string;
}

/**
 * A section's header action.
 *
 * Rendered DISABLED rather than hidden when the write behind it is not
 * built, so the screen has web's shape today and gains its function later
 * without moving. Each carries its own one-line reason.
 */
export function SectionActionButton({ action }: { action: SectionAction }) {
  const enabled = !!action.onPress;
  return (
    <View style={styles.actionWrap}>
      <Pressable
        onPress={action.onPress}
        disabled={!enabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: !enabled }}
        accessibilityHint={enabled ? undefined : action.unavailableNote}
        style={({ pressed }) => [
          styles.action,
          !enabled && styles.actionDisabled,
          pressed && enabled && styles.pressed,
        ]}
      >
        <Text style={[styles.actionLabel, !enabled && styles.actionLabelDisabled]}>
          {action.label.toUpperCase()}
        </Text>
      </Pressable>
      {!enabled && action.unavailableNote ? (
        <Text style={styles.actionNote}>{action.unavailableNote}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1 },
  count: { ...type.meta, color: colors.fgMuted },

  body: { marginTop: space.md },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  actionWrap: { marginTop: space.md, gap: space.xs },
  action: {
    alignSelf: 'flex-start',
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  actionDisabled: { borderColor: colors.border, opacity: 0.55 },
  actionLabel: {
    fontFamily: type.button.fontFamily,
    fontSize: 11.5,
    lineHeight: 14,
    letterSpacing: 1.61,
    color: colors.accent,
  },
  actionLabelDisabled: { color: colors.fgMuted },
  actionNote: { ...type.meta, color: colors.fgMuted },

  pressed: { opacity: 0.6 },
});
