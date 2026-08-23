import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, hairline, radius, space, type } from '@/theme';

/**
 * One section of the artist profile: collapsible, and movable while the
 * screen is in reorder mode.
 *
 * Web reorders these by dragging. Mobile uses explicit up/down controls
 * behind a "Reorder" toggle instead — the capability and the persisted
 * result are identical (the same `PUT /widget-layouts/artist-detail`, the
 * same ids), only the gesture differs. Drag-to-reorder inside a
 * vertically scrolling form is the one gesture a phone handles worst, and
 * an arrow is reachable one-handed where a long-press-drag is not.
 */
export function ProfileSection({
  title,
  collapsed,
  onToggleCollapse,
  reordering,
  onMoveUp,
  onMoveDown,
  /** Shown next to the title when collapsed — "3 photos", "Not set". */
  summary,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  reordering?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  summary?: string | null;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={onToggleCollapse}
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          accessibilityLabel={`${title}, ${collapsed ? 'collapsed' : 'expanded'}`}
          style={({ pressed }) => [styles.header, pressed && styles.pressed]}
        >
          <Feather
            name={collapsed ? 'chevron-right' : 'chevron-down'}
            size={16}
            color={colors.fgMuted}
            style={styles.chevron}
          />
          <Text style={styles.title}>{title.toUpperCase()}</Text>
          {collapsed && summary ? (
            <Text style={styles.summary} numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
        </Pressable>

        {reordering ? (
          <View style={styles.moveGroup}>
            <MoveButton icon="arrow-up" label={`Move ${title} up`} onPress={onMoveUp} />
            <MoveButton icon="arrow-down" label={`Move ${title} down`} onPress={onMoveDown} />
          </View>
        ) : null}
      </View>

      {collapsed ? null : <View style={styles.body}>{children}</View>}
    </View>
  );
}

function MoveButton({
  icon,
  label,
  onPress,
}: {
  icon: 'arrow-up' | 'arrow-down';
  label: string;
  onPress?: () => void;
}) {
  // No handler means this section is already at that end. Rendered
  // disabled rather than removed, so the two buttons don't shift position
  // between rows.
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !onPress }}
      hitSlop={6}
      style={({ pressed }) => [styles.move, !onPress && styles.moveOff, pressed && styles.pressed]}
    >
      <Feather name={icon} size={15} color={onPress ? colors.accent : colors.fgMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    borderTopWidth: hairline,
    borderTopColor: colors.borderSoft,
    paddingBottom: space.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  header: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  chevron: { width: 16 },
  title: { ...type.label, color: colors.accent },
  summary: { ...type.meta, color: colors.fgMuted, flex: 1 },
  body: { paddingBottom: space.sm },

  moveGroup: { flexDirection: 'row', gap: space.xs },
  move: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
  },
  moveOff: { borderColor: colors.borderSoft },
  pressed: { opacity: 0.6 },
});
