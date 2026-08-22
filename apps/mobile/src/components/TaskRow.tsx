import type { PersonalTask, SystemTask } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { isOverdue, systemTaskLabel } from '@/lib/taskDisplay';
import { colors, hairline, radius, space, type } from '@/theme';

/** `Today` / `Tomorrow` / `3 Apr`, plus a bare `Overdue` prefix when it is. */
function dueLabel(dueAt: string, now: Date = new Date()): string {
  const due = new Date(dueAt);
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const diffDays = Math.round((dueDay - startOfToday) / dayMs);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  return due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * A personal task — a real row, so it can be completed.
 *
 * `canComplete` is not cosmetic: the API's PATCH is assignee-only and
 * 404s for anyone else, so a delegated task shown on the DELEGATED
 * segment must not offer a checkbox. Offering one would guarantee a 404
 * on tap.
 */
export function PersonalTaskRow({
  task,
  canComplete,
  busy,
  onToggleComplete,
}: {
  task: PersonalTask;
  canComplete: boolean;
  busy?: boolean;
  onToggleComplete?: () => void;
}) {
  const complete = task.completedAt !== null;
  const overdue = isOverdue(task);
  // Who this involves: on MINE it is who assigned it, on DELEGATED it is
  // who it went to. Both come off the same row from different includes.
  const counterpart = task.createdBy ?? task.user ?? null;
  const counterpartName = counterpart ? (counterpart.name ?? counterpart.email) : null;

  return (
    <View style={[styles.row, complete && styles.rowComplete]}>
      {canComplete ? (
        <Pressable
          onPress={onToggleComplete}
          disabled={busy}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: complete, busy: !!busy }}
          accessibilityLabel={complete ? `Reopen ${task.title}` : `Complete ${task.title}`}
          hitSlop={10}
          style={({ pressed }) => [styles.check, complete && styles.checkOn, pressed && styles.pressed]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : complete ? (
            <Feather name="check" size={14} color={colors.accentFg} />
          ) : null}
        </Pressable>
      ) : (
        // A read-only marker in the checkbox's place, so delegated rows
        // still line up with the rest of the list.
        <View style={styles.checkPlaceholder}>
          <Feather name={complete ? 'check' : 'clock'} size={13} color={colors.fgMuted} />
        </View>
      )}

      <View style={styles.body}>
        <Text style={[styles.title, complete && styles.titleComplete]} numberOfLines={2}>
          {task.title}
        </Text>

        {task.notes ? (
          <Text style={styles.notes} numberOfLines={2}>
            {task.notes}
          </Text>
        ) : null}

        <View style={styles.metaLine}>
          {task.dueAt ? (
            // Red belongs here. An overdue task is a genuine alert, which
            // is exactly what this palette reserves red for.
            <View style={[styles.duePill, overdue && styles.duePillOverdue]}>
              <Text style={[styles.dueLabel, overdue && styles.dueLabelOverdue]}>
                {overdue ? `OVERDUE · ${dueLabel(task.dueAt).toUpperCase()}` : dueLabel(task.dueAt).toUpperCase()}
              </Text>
            </View>
          ) : null}

          {counterpartName ? (
            <Text style={styles.counterpart} numberOfLines={1}>
              {task.createdBy ? `from ${counterpartName}` : `for ${counterpartName}`}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * A system task — computed, never persisted, so there is nothing to
 * complete. Dismissing is the only write, and it hides the item for this
 * user alone rather than for the studio; the wording says so.
 */
export function SystemTaskRow({
  task,
  busy,
  onDismiss,
  onPress,
}: {
  task: SystemTask;
  busy?: boolean;
  onDismiss?: () => void;
  /** Omitted where no mobile screen exists for this entity yet. */
  onPress?: () => void;
}) {
  return (
    // Two SIBLING pressables, never nested. Putting the dismiss button
    // inside the row's own Pressable is invalid on web (a <button> inside
    // a <button>) and ambiguous on native, where the outer press target
    // can swallow or double-fire with the inner one. Caught by rendering
    // this in a browser rather than reasoning about it.
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={task.title}
        style={({ pressed }) => [styles.systemMain, pressed && onPress && styles.rowPressed]}
      >
        <View style={styles.systemMark}>
          <View style={styles.systemDot} />
        </View>

        <View style={styles.body}>
          <Text style={styles.systemType}>{systemTaskLabel(task.type).toUpperCase()}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {task.title}
          </Text>
          {onPress ? null : <Text style={styles.noDestination}>Open on the web to action this</Text>}
        </View>
      </Pressable>

      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${task.title}`}
          hitSlop={10}
          style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.fgMuted} />
          ) : (
            <Feather name="x" size={16} color={colors.fgMuted} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  // The tappable half of a system row -- a sibling of the dismiss
  // button, not its parent. Negative insets let its pressed highlight
  // still span the row's own padding.
  systemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    marginVertical: -space.md,
    marginLeft: -space.lg,
    paddingVertical: space.md,
    paddingLeft: space.lg,
  },
  rowComplete: { opacity: 0.5 },
  rowPressed: { backgroundColor: colors.surface },
  pressed: { opacity: 0.6 },

  check: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkPlaceholder: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginTop: 2 },

  systemMark: { width: 22, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 7 },
  systemDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.accent },

  body: { flex: 1, gap: 3 },
  systemType: { ...type.label, color: colors.accent },
  title: { ...type.body, color: colors.fg },
  titleComplete: { textDecorationLine: 'line-through', color: colors.fgMuted },
  notes: { ...type.small, color: colors.fgMuted },
  noDestination: { ...type.meta, color: colors.fgMuted, marginTop: 2 },

  metaLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 3, flexWrap: 'wrap' },
  duePill: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  duePillOverdue: { borderColor: colors.dangerStrong },
  dueLabel: { ...type.label, fontSize: 9, color: colors.fgSecondary },
  dueLabelOverdue: { color: colors.danger },
  counterpart: { ...type.meta, color: colors.fgMuted, flexShrink: 1 },

  dismiss: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
