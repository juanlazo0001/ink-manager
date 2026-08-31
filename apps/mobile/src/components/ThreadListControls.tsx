import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  THREAD_FILTERS,
  THREAD_SORTS,
  type ThreadFilter,
  type ThreadSort,
} from '@/lib/conversationListControls';
import { LIST_INSET } from '@/theme/listMetrics';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * §8's screen furniture: a search field, then a controls row with the
 * FILTER dropdown left and the SORT dropdown right.
 *
 * ─── WHY DROPDOWNS AND NOT CHIPS ────────────────────────────────────
 *
 * The shipped version put filters in a horizontally scrolling chip row
 * and hid sort behind a toggle below it. Three filters never needed to
 * scroll, and the asymmetry said the two controls were different kinds
 * of thing when they are the same kind: pick one from a short list. Two
 * matching dropdowns on one line say that, and give the list back the
 * vertical space the second row was spending.
 *
 * ─── THE ACTIVE STATE ───────────────────────────────────────────────
 *
 * §8: a non-default filter shows its selection in gold. That is the
 * active-state language the chips used, kept — the whole point of a
 * filter control is being able to tell at a glance that the list you are
 * looking at is not the whole list. Sort has no wrong value, so it never
 * goes gold; it just says what the order is.
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
  // At most one menu is open: two open dropdowns on a phone is a pair of
  // overlapping lists and no way to tell which one a tap belongs to.
  const [open, setOpen] = useState<'filter' | 'sort' | null>(null);

  const filterLabel = THREAD_FILTERS.find((f) => f.key === filter)?.label ?? '';
  const sortLabel = THREAD_SORTS.find((s) => s.key === sort)?.label ?? '';
  const filtered = filter !== 'all';

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

      <View style={styles.controlsRow}>
        <Dropdown
          label={filtered ? filterLabel : 'Filter'}
          active={filtered}
          expanded={open === 'filter'}
          accessibilityLabel={`Filter: ${filterLabel}`}
          onPress={() => setOpen((o) => (o === 'filter' ? null : 'filter'))}
        />
        <Dropdown
          label={sortLabel}
          active={false}
          expanded={open === 'sort'}
          accessibilityLabel={`Sort: ${sortLabel}`}
          onPress={() => setOpen((o) => (o === 'sort' ? null : 'sort'))}
        />
      </View>

      {open === 'filter' ? (
        <Menu
          options={THREAD_FILTERS}
          selected={filter}
          onSelect={(key) => {
            onFilterChange(key);
            setOpen(null);
          }}
        />
      ) : null}

      {open === 'sort' ? (
        <Menu
          options={THREAD_SORTS}
          selected={sort}
          onSelect={(key) => {
            onSortChange(key);
            setOpen(null);
          }}
        />
      ) : null}
    </View>
  );
}

/** The chevron + Jura-caps control §8 asks both of these to be. */
function Dropdown({
  label,
  active,
  expanded,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  active: boolean;
  expanded: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded }}
      hitSlop={8}
      style={({ pressed }) => [styles.dropdown, pressed && styles.pressed]}
    >
      <Text style={[styles.dropdownLabel, active && styles.dropdownLabelActive]} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
      <Feather
        name={expanded ? 'chevron-up' : 'chevron-down'}
        size={13}
        color={active ? colors.accent : colors.fgMuted}
      />
    </Pressable>
  );
}

function Menu<K extends string>({
  options,
  selected,
  onSelect,
}: {
  options: readonly { key: K; label: string }[];
  selected: K;
  onSelect: (key: K) => void;
}) {
  return (
    <View style={styles.menu}>
      {options.map((option) => {
        const on = option.key === selected;
        return (
          <Pressable
            key={option.key}
            onPress={() => onSelect(option.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
          >
            <Text style={[styles.menuLabel, on && styles.menuLabelOn]}>{option.label}</Text>
            {on ? <Feather name="check" size={14} color={colors.accent} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.md,
    // §8: 20pt, the same inset the rows use — the controls and the list
    // they control read as one column rather than two.
    paddingHorizontal: LIST_INSET,
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

  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdown: { flexDirection: 'row', alignItems: 'center', gap: space.xs, maxWidth: '48%' },
  dropdownLabel: { ...type.label, color: colors.fgMuted },
  dropdownLabelActive: { color: colors.accent },

  menu: {
    gap: space.xs,
    borderTopWidth: hairline,
    borderTopColor: colors.borderSoft,
    paddingTop: space.sm,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
  },
  menuLabel: { ...type.body, fontSize: 14, color: colors.fgSecondary },
  menuLabelOn: { color: colors.fg },

  pressed: { opacity: 0.6 },
});
