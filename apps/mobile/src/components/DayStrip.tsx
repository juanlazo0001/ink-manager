import { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDateKey, shiftDateKey } from '@/lib/studioTime';
import { colors, hairline, radius, space, type } from '@/theme';

const DAYS_BEHIND = 7;
const DAYS_AHEAD = 21;
const ITEM_WIDTH = 52;
const ITEM_GAP = space.sm;

/**
 * A scrollable run of civil dates, centred on today.
 *
 * Every date here is a `"YYYY-MM-DD"` key in the STUDIO's timezone, never
 * a `Date` — which is the whole point. Building this out of `Date`
 * objects and local getters is exactly how a day picker ends up one day
 * off for anyone whose phone is not on the studio's clock.
 */
export function DayStrip({
  todayKey: today,
  selectedKey,
  onSelect,
  /** Date keys that have at least one appointment, for the dot marker. */
  markedKeys,
}: {
  todayKey: string;
  selectedKey: string;
  onSelect: (dateKey: string) => void;
  markedKeys: Set<string>;
}) {
  const scrollRef = useRef<ScrollView>(null);

  const keys = useMemo(
    () => Array.from({ length: DAYS_BEHIND + 1 + DAYS_AHEAD }, (_, i) => shiftDateKey(today, i - DAYS_BEHIND)),
    [today],
  );

  const selectedIndex = keys.indexOf(selectedKey);

  useEffect(() => {
    if (selectedIndex < 0) return;
    // Roughly centre the selection rather than just scrolling it into
    // view, so the days either side of it stay visible.
    scrollRef.current?.scrollTo({
      x: Math.max(0, selectedIndex * (ITEM_WIDTH + ITEM_GAP) - ITEM_WIDTH * 2),
      animated: true,
    });
  }, [selectedIndex]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      /*
       * `flexGrow: 0` is load-bearing, and this is the third place in
       * this app to need it — `Pill`'s row and `SegmentedControl` both
       * carry the same note. A horizontal ScrollView inside a flex column
       * takes ALL the height on offer, and its children stretch to fill:
       * on a day with nothing booked, the selected date rendered as a
       * ~300px tall gold column instead of a cell. Found while adding the
       * screen's title; the defect predates it and shows on any empty day.
       */
      style={styles.scroll}
      contentContainerStyle={styles.strip}
    >
      {keys.map((key) => {
        const selected = key === selectedKey;
        const isToday = key === today;
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={formatDateKey(key, { weekday: 'long', day: 'numeric', month: 'long' })}
            style={({ pressed }) => [styles.day, selected && styles.daySelected, pressed && styles.pressed]}
          >
            <Text style={[styles.weekday, selected && styles.weekdaySelected]}>
              {formatDateKey(key, { weekday: 'short' }).toUpperCase()}
            </Text>
            <Text style={[styles.date, selected && styles.dateSelected, isToday && !selected && styles.dateToday]}>
              {formatDateKey(key, { day: 'numeric' })}
            </Text>
            <View style={[styles.marker, markedKeys.has(key) && styles.markerOn, selected && styles.markerSelected]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  strip: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: ITEM_GAP },
  day: {
    width: ITEM_WIDTH,
    alignItems: 'center',
    gap: 3,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: 'transparent',
  },
  daySelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { opacity: 0.6 },
  weekday: { ...type.label, fontSize: 9, color: colors.fgMuted },
  weekdaySelected: { color: colors.accentFg },
  date: { ...type.heading, fontSize: 17, lineHeight: 21, color: colors.fgSecondary },
  dateSelected: { color: colors.accentFg },
  // Today is marked in gold when it is not the selection, so the strip
  // always shows where "now" is.
  dateToday: { color: colors.accent },
  marker: { width: 4, height: 4, borderRadius: radius.pill, backgroundColor: 'transparent' },
  markerOn: { backgroundColor: colors.fgMuted },
  markerSelected: { backgroundColor: colors.accentFg },
});
