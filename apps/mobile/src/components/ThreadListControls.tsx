import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  THREAD_FILTERS,
  THREAD_SORTS,
  type ThreadFilter,
  type ThreadSort,
} from '@/lib/conversationListControls';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Search, filter and sort for the thread list — the three controls web
 * has and mobile didn't.
 *
 * Search is a server round trip, so it gets a busy state; the other two
 * are instant because they only reorder what is already here. Sort lives
 * behind a toggle rather than a second permanent row of chips: it is
 * changed far less often than the filter, and two chip rows above a list
 * on a phone is most of the screen.
 */
export function ThreadListControls({
  search,
  onSearchChange,
  searching,
  filter,
  onFilterChange,
  sort,
  onSortChange,
}: {
  search: string;
  onSearchChange: (next: string) => void;
  /** A search request is in flight. */
  searching?: boolean;
  filter: ThreadFilter;
  onFilterChange: (next: ThreadFilter) => void;
  sort: ThreadSort;
  onSortChange: (next: ThreadSort) => void;
}) {
  const [showSort, setShowSort] = useState(false);
  const sortLabel = THREAD_SORTS.find((s) => s.key === sort)?.label ?? '';

  return (
    <View style={styles.wrap}>
      <View style={styles.searchRow}>
        <Feather name="search" size={15} color={colors.fgMuted} />
        <TextInput
          style={styles.input}
          value={search}
          onChangeText={onSearchChange}
          placeholder="Search team or messages…"
          placeholderTextColor={colors.fgMuted}
          accessibilityLabel="Search conversations"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {searching ? <ActivityIndicator size="small" color={colors.fgMuted} /> : null}
        {/* Android has no clearButtonMode, so the explicit control stays
            for both rather than being platform-conditional. */}
        {search.length > 0 && !searching ? (
          <Pressable
            onPress={() => onSearchChange('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
          >
            <Feather name="x" size={15} color={colors.fgMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.chipRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {THREAD_FILTERS.map((option) => {
            const on = option.key === filter;
            return (
              <Pressable
                key={option.key}
                onPress={() => onFilterChange(option.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
              >
                <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{option.label.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          onPress={() => setShowSort((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`Sort: ${sortLabel}`}
          accessibilityState={{ expanded: showSort }}
          hitSlop={6}
          style={({ pressed }) => [styles.sortToggle, pressed && styles.pressed]}
        >
          <Feather name={showSort ? 'chevron-up' : 'chevron-down'} size={13} color={colors.fgMuted} />
          <Text style={styles.sortToggleLabel}>SORT</Text>
        </Pressable>
      </View>

      {showSort ? (
        <View style={styles.sortList}>
          {THREAD_SORTS.map((option) => {
            const on = option.key === sort;
            return (
              <Pressable
                key={option.key}
                onPress={() => {
                  onSortChange(option.key);
                  setShowSort(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [styles.sortRow, pressed && styles.pressed]}
              >
                <Text style={[styles.sortLabel, on && styles.sortLabelOn]}>{option.label}</Text>
                {on ? <Feather name="check" size={14} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
    backgroundColor: 'transparent',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.inputBg,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: space.md,
  },
  input: { flex: 1, ...type.body, fontSize: 15, color: colors.fg, paddingVertical: space.md },

  chipRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  chips: { flexDirection: 'row', gap: space.sm, paddingRight: space.sm },
  chip: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },
  chipLabel: { ...type.label, color: colors.fgMuted },
  chipLabelOn: { color: colors.accent },

  sortToggle: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  sortToggleLabel: { ...type.label, color: colors.fgMuted },

  sortList: {
    gap: space.xs,
    borderTopWidth: hairline,
    borderTopColor: colors.borderSoft,
    paddingTop: space.sm,
  },
  sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.sm },
  sortLabel: { ...type.body, fontSize: 14, color: colors.fgSecondary },
  sortLabelOn: { color: colors.fg },

  pressed: { opacity: 0.6 },
});
