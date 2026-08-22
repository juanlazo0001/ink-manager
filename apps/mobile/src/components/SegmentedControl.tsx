import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, hairline, radius, space, type } from '@/theme';

export interface Segment<T extends string> {
  key: T;
  label: string;
  /** Omitted or 0 renders no badge, rather than a "0". */
  count?: number;
}

/**
 * The tab-level view switcher.
 *
 * Renders nothing at all when there is only one segment — a control with
 * a single permanently-selected option is noise, and on this app that is
 * the normal case for an artist, not an edge case.
 *
 * Horizontally scrollable because segment labels are role-dependent and
 * counts can push them wide; a fixed row would clip on a small phone
 * rather than degrade.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  if (segments.length < 2) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      accessibilityRole="tablist"
    >
      {segments.map((segment) => {
        const active = segment.key === value;
        return (
          <Pressable
            key={segment.key}
            onPress={() => onChange(segment.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && styles.pressed]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{segment.label}</Text>
            {segment.count ? (
              <View style={[styles.badge, active && styles.badgeActive]}>
                <Text style={[styles.badgeLabel, active && styles.badgeLabelActive]}>
                  {segment.count > 99 ? '99+' : segment.count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.xs },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  segmentActive: { borderColor: colors.accent, backgroundColor: colors.surface },
  pressed: { opacity: 0.6 },
  label: { ...type.label, color: colors.fgMuted },
  labelActive: { color: colors.accent },
  badge: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
  },
  badgeActive: { backgroundColor: colors.accent },
  badgeLabel: { ...type.label, fontSize: 10, color: colors.fgMuted },
  badgeLabelActive: { color: colors.accentFg },
});
