import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fonts, hairline, radius, space } from '@/theme';

/**
 * The one pill control, sized from apps/web's own.
 *
 * Web's `.editorial-btn-secondary` (index.css) plus the `rounded-full
 * border px-4 py-2` its callers add — `DateRangePresetFilter`'s trigger is
 * the canonical instance:
 *
 *   font           var(--font-jura), weight 400, 11.5px
 *   letter-spacing 0.14em  (= 1.61px at 11.5)
 *   text-transform uppercase
 *   padding        px-4 py-2   -> 16 horizontal, 8 vertical
 *   border         1px var(--color-border-strong)
 *   radius         rounded-full
 *   colour         var(--color-fg-secondary)
 *   selected       border var(--color-accent), text var(--color-fg),
 *                  background rgba(201, 154, 91, 0.08)
 *
 * Mobile had FIVE different sizings for the same control — segments at
 * 12/8 and 10px type, Tasks' sort chips at 12/4 and 9px, the thread
 * filters at 12/5, Flash's status filters and Home's range presets at
 * 12/6. Nothing was wrong individually; together they read as five
 * different products, which is what the device review caught.
 *
 * `tone` exists for the one control that legitimately differs: the Tasks
 * OVERDUE filter, where lateness is an alert and red is punctuation.
 */
export function Pill({
  label,
  selected = false,
  onPress,
  tone = 'default',
  count,
  leading,
  style,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** `alert` is red-outlined when selected. One caller: Tasks' OVERDUE. */
  tone?: 'default' | 'alert';
  /** A trailing bubble, as the Inquiries/Projects segments carry. */
  count?: number;
  /** A leading element — the status dot on Flash's filters. */
  leading?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const alert = tone === 'alert' && selected;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.pill,
        selected && styles.pillSelected,
        alert && styles.pillAlert,
        pressed && styles.pressed,
        style,
      ]}
    >
      {leading}
      <Text style={[styles.label, selected && styles.labelSelected, alert && styles.labelAlert]}>
        {label.toUpperCase()}
      </Text>
      {count && count > 0 ? (
        <View style={[styles.count, selected && styles.countSelected]}>
          <Text style={[styles.countLabel, selected && styles.countLabelSelected]}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The row a set of pills sits in. The gap is web's own `gap-2`.
 *
 * Horizontally scrollable, because at web's size four pills no longer fit
 * across a 414pt phone -- Tasks has exactly four and the last was clipped.
 * Scrolling rather than shrinking: the whole point of this component is
 * that a pill is the same size everywhere.
 *
 * `flexGrow: 0` on the ScrollView and `alignItems: center` on its content
 * are load-bearing -- without them the row takes all the height offered
 * and stretches its pills into ovals. Learned the hard way in session G.
 */
export function PillRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.rowScroll, style]}
      contentContainerStyle={styles.row}
    >
      {children}
    </ScrollView>
  );
}

/** Height of a pill, for callers that need to reserve space. */
export const PILL_HEIGHT = 32;

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    // px-4 py-2
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
  },
  pillSelected: { borderColor: colors.accent, backgroundColor: 'rgba(201, 154, 91, 0.08)' },
  pillAlert: { borderColor: colors.dangerStrong, backgroundColor: 'rgba(194, 64, 47, 0.08)' },

  label: {
    fontFamily: fonts.label,
    fontSize: 11.5,
    lineHeight: 14,
    letterSpacing: 1.61,
    color: colors.fgSecondary,
  },
  labelSelected: { color: colors.fg },
  labelAlert: { color: colors.danger },

  count: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
  },
  countSelected: { backgroundColor: colors.accent },
  countLabel: { fontFamily: fonts.label, fontSize: 10, lineHeight: 13, color: colors.fgMuted },
  countLabelSelected: { color: colors.accentFg },

  rowScroll: { flexGrow: 0 },
  // Horizontal padding lives on the CONTENT, not the ScrollView: on the
  // ScrollView it would clip the first and last pill when scrolled.
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg },
  pressed: { opacity: 0.6 },
});
