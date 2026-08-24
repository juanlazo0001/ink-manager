import type { PersonalTask, SystemTask, TasksResponse } from '@ink-manager/shared-types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NewTaskBar } from '@/components/NewTaskBar';
import { GroupedPillMenu, PillMenu, type MenuGroup } from '@/components/PillMenu';
import { PillRow } from '@/components/Pill';
import { TopBar } from '@/components/TopBar';
import { PersonalTaskRow, SystemTaskRow } from '@/components/TaskRow';
import { SkeletonList } from '@/components/Skeleton';
import { StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { screenErrorMessage } from '@/lib/screenError';
import { useStudioTimeZone } from '@/hooks/useStudioTimeZone';
import { createPersonalTask, dismissSystemTask, fetchTasks, setPersonalTaskCompleted } from '@/lib/tasks';
import {
  filterTasks,
  isOverdue,
  taskFiltersFor,
  TASK_FILTERS,
  type TaskFilter,
  mobileRouteForSystemTask,
  segmentCount,
  sortTasks,
  splitByCompletion,
  TASK_SORTS,
  taskSegmentsFor,
  type TaskSegment,
  type TaskSort,
} from '@/lib/taskDisplay';
import { colors, hairline, radius, space, type } from '@/theme';

/** Same cadence as the other tabs. */
const POLL_MS = 30_000;

type Row =
  | { kind: 'personal'; task: PersonalTask; canComplete: boolean }
  | { kind: 'system'; task: SystemTask };

export default function TasksScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const permissions = useMemo(() => session?.profile.permissions ?? [], [session?.profile.permissions]);

  const segments = useMemo(() => taskSegmentsFor(permissions), [permissions]);
  const [segment, setSegment] = useState<TaskSegment>('assignedToMe');
  const [data, setData] = useState<TasksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** Ids currently mid-write, so a row shows a spinner rather than lying. */
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<TaskSort>('newest');
  const [filter, setFilter] = useState<TaskFilter>('all');
  // Decides mine-vs-others on a personal task: a row this person created
  // for themselves carries their own id in createdById.
  const viewerUserId = session?.profile.id ?? '';
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const { timeZone } = useStudioTimeZone();

  const requestRef = useRef(0);

  // If a permission changes under a signed-in session, a segment that no
  // longer exists must not stay selected.
  useEffect(() => {
    if (!segments.some((s) => s.key === segment)) setSegment('assignedToMe');
  }, [segments, segment]);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'poll') => {
      if (!token) return;
      const seq = ++requestRef.current;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const next = await fetchTasks(token);
        if (seq !== requestRef.current) return;
        setData(next);
        setError(null);
      } catch (err) {
        if (seq !== requestRef.current) return;
        // A failed poll must not clear a list already on screen.
        if (mode === 'poll' && data !== null) return;
        setError(screenErrorMessage(err, 'tasks'));
      } finally {
        if (seq === requestRef.current && mode === 'refresh') setRefreshing(false);
      }
    },
    [token, data],
  );

  useEffect(() => {
    load('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load('poll');
      const timer = setInterval(() => load('poll'), POLL_MS);
      return () => clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]),
  );

  useEffect(() => () => void ++requestRef.current, []);

  function markBusy(id: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const toggleComplete = useCallback(
    async (task: PersonalTask) => {
      if (!token) return;
      const completing = task.completedAt === null;
      markBusy(task.id, true);
      // Optimistic, then reconciled with the server's own row. A failure
      // puts the task back exactly as it was rather than leaving a tick
      // that did not happen.
      setData((current) =>
        current
          ? {
              ...current,
              personal: current.personal.map((t) =>
                t.id === task.id ? { ...t, completedAt: completing ? new Date().toISOString() : null } : t,
              ),
            }
          : current,
      );
      try {
        const updated = await setPersonalTaskCompleted(token, task.id, completing);
        setData((current) =>
          current ? { ...current, personal: current.personal.map((t) => (t.id === task.id ? updated : t)) } : current,
        );
      } catch (err) {
        setData((current) =>
          current ? { ...current, personal: current.personal.map((t) => (t.id === task.id ? task : t)) } : current,
        );
        setError(screenErrorMessage(err, 'tasks'));
      } finally {
        markBusy(task.id, false);
      }
    },
    [token],
  );

  /**
   * Creating is deliberately NOT optimistic, unlike completing.
   *
   * A tick has an obvious rollback — put it back. A created row has no id
   * until the server gives it one, and inventing a placeholder means
   * either a row that can't be completed for a moment or a temporary id
   * leaking into the list's keys. The write is fast and the spinner is
   * honest.
   */
  const addTask = useCallback(
    async (input: { title: string; dueAt: string | null }) => {
      if (!token) return;
      setCreating(true);
      setCreateError(null);
      try {
        const created = await createPersonalTask(token, { title: input.title, dueAt: input.dueAt });
        setData((current) => (current ? { ...current, personal: [created, ...current.personal] } : current));
      } catch (err) {
        setCreateError(screenErrorMessage(err, 'tasks'));
      } finally {
        setCreating(false);
      }
    },
    [token],
  );

  const dismiss = useCallback(
    async (task: SystemTask) => {
      if (!token) return;
      const key = `${task.type}:${task.dismissalKey}`;
      markBusy(key, true);
      const previous = data;
      setData((current) =>
        current ? { ...current, system: current.system.filter((t) => `${t.type}:${t.dismissalKey}` !== key) } : current,
      );
      try {
        await dismissSystemTask(token, { taskType: task.type, entityId: task.dismissalKey });
      } catch (err) {
        // Put it back. A dismissal that silently failed would look done
        // until the next poll brought it back with no explanation.
        setData(previous);
        setError(screenErrorMessage(err, 'tasks'));
      } finally {
        markBusy(key, false);
      }
    },
    [token, data],
  );

  /*
   * Everything that narrows the list, in one control. The scope group is
   * the old MINE / DELEGATED / QUEUE segments, counts and all — they were
   * a whole row of chrome for three mutually exclusive lists, which a
   * dropdown states just as clearly. Status is a separate group because
   * "overdue" refines a scope rather than replacing it.
   */
  const filterGroups = useMemo<MenuGroup<string>[]>(() => {
    const out: MenuGroup<string>[] = [
      {
        title: 'Scope',
        mode: 'single',
        options: segments.map((seg) => ({
          value: seg.key,
          label: seg.label,
          count: segmentCount(data, seg.key),
        })),
      },
    ];
    // The queue is computed work with no due date, so nothing there can
    // be late — the status group would offer a filter that never matches.
    if (segment !== 'queue') {
      out.push({
        title: 'Status',
        mode: 'multi',
        options: taskFiltersFor({
          segment,
          isSoloStudio: session?.profile.isSoloStudio ?? false,
        })
          .filter((f) => f.value !== 'all')
          .map((f) => ({ value: f.value, label: f.label })),
      });
    }
    return out;
  }, [segments, data, segment, session?.profile.isSoloStudio]);

  /** What the Filter pill reads: the scope, plus a status when set. */
  const triggerText = useMemo(() => {
    const scope = segments.find((seg) => seg.key === segment)?.label ?? 'Filter';
    if (filter === 'all') return scope;
    const status = TASK_FILTERS.find((f) => f.value === filter)?.label;
    return status ? `${scope} · ${status}` : scope;
  }, [segments, segment, filter]);

  const sections = useMemo(() => {
    if (!data) return [];
    if (segment === 'queue') {
      return data.system.length > 0
        ? [{ title: null, data: data.system.map((task): Row => ({ kind: 'system', task })) }]
        : [];
    }
    const source = segment === 'assignedToMe' ? data.personal : data.assignedByMe;
    // Only the assignee may complete — the API's PATCH is assignee-only.
    const canComplete = segment === 'assignedToMe';
    const { open: allOpen, done } = splitByCompletion(source);
    // The overdue filter applies to open work only. A completed task that
    // was once late is not "overdue" — it is done.
    const filtered = filterTasks(allOpen, filter, viewerUserId, timeZone);
    const open = sortTasks(filtered, sort);
    const out: { title: string | null; data: Row[] }[] = [];
    if (open.length > 0) out.push({ title: null, data: open.map((task): Row => ({ kind: 'personal', task, canComplete })) });
    // The done pile is hidden while OVERDUE is on. The filter is about
    // open work by definition — a completed task that was once late is
    // not overdue, it is finished — and leaving the pile visible under an
    // active filter reads as "these are the overdue ones".
    if (done.length > 0 && filter !== 'overdue') {
      out.push({ title: `DONE (${done.length})`, data: done.map((task): Row => ({ kind: 'personal', task, canComplete })) });
    }
    return out;
  }, [data, segment, sort, filter, timeZone, viewerUserId]);

  const emptyCopy = useMemo(() => {
    // The filter's own empty state comes first: "nothing on your list" is
    // a different and wrong statement when the list is merely filtered.
    if (filter === 'overdue' && segment !== 'queue') {
      return {
        eyebrow: 'Nothing late',
        title: 'Nothing is overdue',
        body: 'Turn off the Overdue filter to see everything on your list.',
      };
    }
    switch (segment) {
      case 'queue':
        return { eyebrow: 'Clear', title: 'Nothing needs attention', body: 'The studio queue is empty right now.' };
      case 'assignedByMe':
        return {
          eyebrow: 'Nothing out',
          title: "You haven't delegated anything",
          body: 'Tasks you assign to someone else appear here so you can follow them.',
        };
      default:
        return { eyebrow: 'Clear', title: 'Nothing on your list', body: 'Tasks assigned to you will show up here.' };
    }
  }, [segment, filter]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <TopBar />

      {/* One Filter, one Sort — web's own two controls, via the PillMenu
          it extracted for exactly this. Previously a standing OVERDUE
          toggle plus four sort pills, which with the scope segments above
          them was most of the screen before any task.

          Not shown on QUEUE: system tasks are computed, have no title to
          sort by and no due date to be late against. */}
      {segment !== 'queue' ? (
        <PillRow style={styles.controls}>
          <GroupedPillMenu
            label="Filter"
            icon="filter"
            groups={filterGroups}
            isSelected={(group, value) =>
              group.mode === 'single' ? value === segment : filter === value
            }
            onSelect={(group, value) => {
              if (group.mode === 'single') setSegment(value as TaskSegment);
              // A status toggles off when tapped again, so the same row
              // both applies and clears it.
              else setFilter((current) => (current === value ? 'all' : (value as TaskFilter)));
            }}
            triggerText={triggerText}
            active={segment !== 'assignedToMe' || filter !== 'all'}
          />
          <PillMenu
            label="Sort"
            icon="bar-chart-2"
            value={sort}
            options={TASK_SORTS.map((o) => ({ value: o.key, label: o.label }))}
            onChange={setSort}
            active={sort !== 'newest'}
          />
        </PillRow>
      ) : null}

      {data === null && error === null ? (
        <SkeletonList rows={6} avatar={false} />
      ) : (
        <SectionList
          sections={sections}
          ListHeaderComponent={
            // Only on MINE. A new task is always created for yourself
            // (assigning to someone else needs tasks.assignToOthers, which
            // an artist doesn't have), so offering it above the delegated
            // or queue lists would put the result somewhere else.
            segment === 'assignedToMe' ? (
              <NewTaskBar timeZone={timeZone} onCreate={addTask} busy={creating} error={createError} />
            ) : null
          }
          keyExtractor={(row) => (row.kind === 'personal' ? row.task.id : `${row.task.type}:${row.task.dismissalKey}`)}
          renderItem={({ item }) =>
            item.kind === 'personal' ? (
              <PersonalTaskRow
                task={item.task}
                timeZone={timeZone}
                canComplete={item.canComplete}
                busy={busyIds.has(item.task.id)}
                onToggleComplete={() => toggleComplete(item.task)}
              />
            ) : (
              <SystemTaskRow
                task={item.task}
                busy={busyIds.has(`${item.task.type}:${item.task.dismissalKey}`)}
                onDismiss={() => dismiss(item.task)}
                onPress={(() => {
                  const route = mobileRouteForSystemTask(item.task);
                  return route ? () => router.push(route) : undefined;
                })()}
              />
            )
          }
          renderSectionHeader={({ section }) =>
            section.title ? (
              <View style={styles.sectionHeader}>
                <View style={styles.sectionRule} />
                <Text style={styles.sectionLabel}>{section.title}</Text>
                <View style={styles.sectionRule} />
              </View>
            ) : null
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          stickySectionHeadersEnabled={false}
          // Centering only applies when there is no header. With the add
          // bar present, `flexGrow: 1` + centering would float it into the
          // middle of an otherwise blank screen.
          contentContainerStyle={
            sections.length === 0 && segment !== 'assignedToMe' ? styles.emptyContainer : styles.listContent
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListEmptyComponent={
            error ? (
              <StateMessage
                eyebrow="Not loaded"
                tone="alert"
                title={error}
                body="Nothing has been lost — this is only what this device could fetch."
                action={{ label: 'Try again', onPress: () => load('refresh') }}
              />
            ) : (
              <StateMessage eyebrow={emptyCopy.eyebrow} title={emptyCopy.title} body={emptyCopy.body} />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  listContent: { paddingTop: space.sm, paddingBottom: space.xxl },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  separator: { height: hairline, backgroundColor: colors.borderSoft, marginLeft: space.lg + 22 + space.md },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  sectionRule: { flex: 1, height: hairline, backgroundColor: colors.borderSoft },
  sectionLabel: { ...type.label, color: colors.fgMuted },

  controls: { paddingBottom: space.md },
  pressed: { opacity: 0.6 },
});
