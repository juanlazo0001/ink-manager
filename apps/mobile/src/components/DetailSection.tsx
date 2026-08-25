import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Eyebrow } from '@/components/ui';
import { colors, hairline, radius, space, type } from '@/theme';

/** One titled block of the detail screen. */
export function DetailSection({
  title,
  children,
  accent,
}: {
  title: string;
  children: ReactNode;
  /** Gold title, for the one section that is the point of the screen. */
  accent?: boolean;
}) {
  return (
    <View style={styles.section}>
      <Eyebrow>{title}</Eyebrow>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

/**
 * A label/value pair. `value` may be null, in which case the row renders
 * a dash rather than disappearing — on a detail screen "we don't have
 * this" is information, and a silently absent row reads as a bug.
 */
export function DetailField({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string | null | undefined;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.fieldValue, multiline && styles.fieldValueMultiline]} numberOfLines={multiline ? 0 : 3}>
        {value && value.trim() ? value : '—'}
      </Text>
    </View>
  );
}

export function FieldDivider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  section: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.xl },
  titleAccent: { color: colors.accent },
  card: {
    backgroundColor: colors.cardGlass,
    borderWidth: hairline,
    borderColor: colors.cardBorder,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
  },
  field: { paddingVertical: space.md, gap: space.xs },
  fieldLabel: { ...type.label, color: colors.fgMuted },
  fieldValue: { ...type.body, color: colors.fg },
  fieldValueMultiline: { ...type.body, color: colors.fgSecondary },
  divider: { height: hairline, backgroundColor: colors.borderSoft },
});
