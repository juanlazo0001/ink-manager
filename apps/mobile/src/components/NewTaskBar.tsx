import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { shiftDateKey, todayKey, zonedTimeToUtc } from '@/lib/studioTime';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Inline task creation, the way web puts it: first thing inside the list,
 * a title field and one tap to add.
 *
 * The due date is a set of relative choices rather than a date picker.
 * `PersonalTask.dueAt` is a plain CALENDAR DATE stored at UTC midnight —
 * web writes it with `parseDateString(...).toISOString()` — and a native
 * date picker hands back an instant in the device's zone, which is the
 * exact conversion this repo has got wrong four separate times. Today /
 * Tomorrow / This week covers what a task on a phone is actually for, and
 * nothing here ever becomes a local `Date`.
 */

const DUE_CHOICES = [
  { key: 'none', label: 'No date', offset: null },
  { key: 'today', label: 'Today', offset: 0 },
  { key: 'tomorrow', label: 'Tomorrow', offset: 1 },
  { key: 'week', label: 'In a week', offset: 7 },
] as const;

type DueKey = (typeof DUE_CHOICES)[number]['key'];

/**
 * A date key → the instant the API stores for it.
 *
 * Midnight IN THE STUDIO'S ZONE, not UTC midnight. Web writes this field
 * as `parseDateString(value).toISOString()`, and `parseDateString` builds
 * `new Date(y, m - 1, d)` — local midnight of the browser that created
 * it. Writing UTC midnight instead (this function's first version) would
 * put a mobile-created task a day earlier than web renders it for every
 * studio behind UTC.
 *
 * Going through `zonedTimeToUtc` makes what this app writes byte-identical
 * to what web writes from a browser sitting in the studio's own zone.
 */
function dateKeyToDueAt(dateKey: string, timeZone: string): string {
  return zonedTimeToUtc(dateKey, '00:00', timeZone).toISOString();
}

export function NewTaskBar({
  timeZone,
  onCreate,
  busy,
  error,
}: {
  /** The studio's zone — "today" is the studio's today, not the phone's. */
  timeZone: string;
  onCreate: (input: { title: string; dueAt: string | null }) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<DueKey>('none');
  const [expanded, setExpanded] = useState(false);

  const canAdd = title.trim().length > 0 && !busy;

  function submit() {
    if (!canAdd) return;
    const choice = DUE_CHOICES.find((c) => c.key === due)!;
    const dueAt =
      choice.offset === null
        ? null
        : dateKeyToDueAt(shiftDateKey(todayKey(timeZone), choice.offset), timeZone);
    onCreate({ title: title.trim(), dueAt });
    setTitle('');
    setDue('none');
    setExpanded(false);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={(next) => {
            setTitle(next);
            // The date choices stay out of the way until there is
            // something to date. An empty bar is one line, not four.
            if (next.trim() && !expanded) setExpanded(true);
          }}
          onSubmitEditing={submit}
          placeholder="Add a task…"
          placeholderTextColor={colors.fgMuted}
          accessibilityLabel="New task title"
          returnKeyType="done"
          editable={!busy}
        />
        <Pressable
          onPress={submit}
          disabled={!canAdd}
          accessibilityRole="button"
          accessibilityLabel="Add task"
          accessibilityState={{ disabled: !canAdd, busy: !!busy }}
          style={({ pressed }) => [styles.add, !canAdd && styles.addOff, pressed && canAdd && styles.pressed]}
        >
          {busy ? (
            <ActivityIndicator color={colors.accentFg} size="small" />
          ) : (
            <Feather name="plus" size={18} color={canAdd ? colors.accentFg : colors.fgMuted} />
          )}
        </Pressable>
      </View>

      {expanded ? (
        <View style={styles.dueRow}>
          {DUE_CHOICES.map((choice) => {
            const on = choice.key === due;
            return (
              <Pressable
                key={choice.key}
                onPress={() => setDue(choice.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [styles.due, on && styles.dueOn, pressed && styles.pressed]}
              >
                <Text style={[styles.dueLabel, on && styles.dueLabelOn]}>{choice.label.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    flex: 1,
    ...type.body,
    fontSize: 15,
    color: colors.fg,
    backgroundColor: colors.inputBg,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  add: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentButton,
    borderRadius: radius.input,
  },
  addOff: { backgroundColor: colors.surfaceInset },

  dueRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  due: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  dueOn: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },
  dueLabel: { ...type.label, color: colors.fgMuted },
  dueLabelOn: { color: colors.accent },

  error: { ...type.meta, color: colors.danger },
  pressed: { opacity: 0.6 },
});
