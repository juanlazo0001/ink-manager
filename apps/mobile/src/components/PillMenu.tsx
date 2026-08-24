import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Eyebrow } from '@/components/ui';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * One filter or sort dimension: a pill that opens its options.
 *
 * This is apps/web's `PillMenu`, whose own comment explains why it
 * exists — "originally built once for Conversations (its own Filter and
 * Sort pills), extracted here so any other list view wanting the same
 * pattern (Tasks, Inquiries & Projects, …) reuses one implementation
 * instead of a second copy". Mobile had drifted the other way: chat grew
 * a sort toggle, tasks grew a row of sort pills, and the two looked
 * nothing alike. This is the shared implementation.
 *
 * **Single-select, because web's is.** The brief suggested multi-select
 * where filters aren't mutually exclusive, but neither of web's task
 * filters is multi — Studio Queue filters to one type, Assigned-to-Me
 * picks one of All / My tasks / Assigned by others / Overdue. Mirroring
 * web means one choice, and a control that behaved differently on the
 * phone would be a second product.
 *
 * `active` marks the trigger when the choice is not the default, which is
 * how web signals a list is narrowed without a separate badge.
 *
 * The options open as the sheet this app already uses everywhere else
 * (channel picker, attach, message actions) rather than web's absolute
 * dropdown: a 200px popover anchored under a pill is a desktop shape.
 */
export function PillMenu<T extends string>({
  label,
  icon,
  value,
  options,
  onChange,
  active = false,
}: {
  label: string;
  icon: 'filter' | 'bar-chart-2';
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  /** True when the current value is not the default — web's own cue. */
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? 'any'}`}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.trigger, active && styles.triggerActive, pressed && styles.pressed]}
      >
        <Feather name={icon} size={13} color={active ? colors.accent : colors.fgSecondary} />
        <Text
          style={[styles.triggerLabel, active && styles.triggerLabelActive]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
        >
          {label.toUpperCase()}
        </Text>
        <Feather name="chevron-down" size={13} color={colors.fgMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Eyebrow tone="accent">{label}</Eyebrow>
            <ScrollView style={styles.optionScroll}>
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                  >
                    <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                      {option.label}
                    </Text>
                    {/* Web marks the active option with a check, not a
                        highlighted row. */}
                    {selected ? <Feather name="check" size={16} color={colors.accent} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable onPress={() => setOpen(false)} style={styles.done}>
              <Text style={styles.doneLabel}>DONE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}


/** One group inside a grouped menu. */
export interface MenuGroup<T extends string> {
  title: string;
  /** `single` behaves like a scope — exactly one wins. `multi` toggles. */
  mode: 'single' | 'multi';
  options: ReadonlyArray<{ value: T; label: string; count?: number }>;
}

/**
 * A filter that holds more than one dimension.
 *
 * Same trigger and same checkmark interaction as `PillMenu` — this only
 * adds grouping, so the Tasks row can be exactly two controls: everything
 * that narrows the list lives in Filter, and Sort orders what is left.
 *
 * The scope group (Mine / Delegated / Queue) is single-select because
 * those are three different lists, not three overlapping conditions.
 * Status is multi, because being overdue is a property of a task rather
 * than a place to look. Counts ride on the rows they belong to, which is
 * where the segment badges went.
 */
export function GroupedPillMenu<T extends string>({
  label,
  icon,
  groups,
  isSelected,
  onSelect,
  triggerText,
  active = false,
}: {
  label: string;
  icon: 'filter' | 'bar-chart-2';
  groups: ReadonlyArray<MenuGroup<T>>;
  isSelected: (group: MenuGroup<T>, value: T) => boolean;
  onSelect: (group: MenuGroup<T>, value: T) => void;
  /** What the pill reads when something is chosen. */
  triggerText?: string;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${triggerText ?? 'all'}`}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.trigger, active && styles.triggerActive, pressed && styles.pressed]}
      >
        <Feather name={icon} size={13} color={active ? colors.accent : colors.fgSecondary} />
        <Text
          style={[styles.triggerLabel, active && styles.triggerLabelActive]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
        >
          {(triggerText ?? label).toUpperCase()}
        </Text>
        <Feather name="chevron-down" size={13} color={colors.fgMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView style={styles.optionScroll}>
              {groups.map((group) => (
                <View key={group.title}>
                  <Eyebrow tone="accent">{group.title}</Eyebrow>
                  {group.options.map((option) => {
                    const selected = isSelected(group, option.value);
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => {
                          onSelect(group, option.value);
                          // A scope switch is a navigation; a status
                          // toggle is a refinement you may want to stack.
                          if (group.mode === 'single') setOpen(false);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                      >
                        <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                          {option.label}
                        </Text>
                        {option.count !== undefined ? (
                          <Text style={styles.optionCount}>{option.count > 99 ? '99+' : option.count}</Text>
                        ) : null}
                        {selected ? <Feather name="check" size={16} color={colors.accent} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>

            <Pressable onPress={() => setOpen(false)} style={styles.done}>
              <Text style={styles.doneLabel}>DONE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  /* The Pill's own metrics, so a menu trigger and a plain pill are the
     same control at a glance. */
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
  },
  triggerActive: { borderColor: colors.accent, backgroundColor: 'rgba(201, 154, 91, 0.08)' },
  triggerLabel: {
    fontFamily: type.button.fontFamily,
    fontSize: 11.5,
    lineHeight: 14,
    letterSpacing: 1.61,
    color: colors.fgSecondary,
  },
  triggerLabelActive: { color: colors.fg },

  backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderTopWidth: hairline,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
  },
  optionScroll: { maxHeight: 340 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.md,
  },
  optionLabel: { ...type.body, color: colors.fgSecondary, flex: 1 },
  optionLabelSelected: { color: colors.fg },
  optionCount: { ...type.meta, color: colors.fgMuted },

  done: { marginTop: space.md, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.accent },
  pressed: { opacity: 0.6 },
});
