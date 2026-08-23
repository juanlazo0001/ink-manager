import { ScrollView, StyleSheet } from 'react-native';

import { Pill } from '@/components/Pill';
import { space } from '@/theme';

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
      // flexGrow 0 is load-bearing, not tidiness: a horizontal ScrollView
      // in a flex column takes all the height on offer, its content
      // container stretches the segments to fill it, and radius.pill (999)
      // then renders them as circles rather than pills. Seen on screen.
      style={styles.strip}
      contentContainerStyle={styles.stripContent}
      accessibilityRole="tablist"
    >
      {segments.map((segment) => (
        <Pill
          key={segment.key}
          label={segment.label}
          count={segment.count}
          selected={segment.key === value}
          onPress={() => onChange(segment.key)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { flexGrow: 0 },
  stripContent: {
    flexDirection: 'row',
    // Centred rather than stretched, so a segment is only ever as tall as
    // its own content. See the note on the ScrollView above.
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.sm,
  },
});
