import type { PersonalTask, SystemTask, TasksResponse } from '@ink-manager/shared-types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NewTaskBar } from '@/components/NewTaskBar';
import { PillMenu } from '@/components/PillMenu';
import { PillRow } from '@/components/Pill';
import { Card, Eyebrow, SectionHeader } from '@/components/editorial';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PersonalTaskRow, SystemTaskRow } from '@/components/TaskRow';
import { SkeletonList } from '@/components/Skeleton';
import { StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { screenErrorMessage } from '@/lib/screenError';
import { useStudioTimeZone } from '@/hooks/useStudioTimeZone';
import { createPersonalTask, dismissSystemTask, fetchTasks, setPersonalTaskCompleted } from '@/lib/tasks';
import { fetchTeamUsers } from '@/lib/team';
import {
  filterTasks,
  taskFiltersFor,
  type TaskFilter,
  mobileRouteForSystemTask,
  sortTasks,
  splitByCompletion,
  systemTaskLabel,
  TASK_SORTS,
  type TaskSort,
} from '@/lib/taskDisplay';
import { colors, space, type } from '@/theme';

/** Same cadence as the other tabs. */
const POLL_MS = 30_000;

export default function TasksScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const permissions = useMemo(() => session?.profile.permissions ?? [], [session?.profile.permissions]);

  /**
   * The MINE / DELEGATED / QUEUE scope filter is GONE (session Y). Each
   * card owns its own data now, which is web's structure: three stacked
   * cards on one scrolling page rather than three mutually exclusive
   * lists behind a control. Visibility is still permission-derived — see
   * `canSeeQueue` / `canAssign` below, the same two keys
   * the old scope filter used.
   */
  const [queueType, setQueueType] = useState<string>('all');
  const [teammates, setTeammates] = useState<{ id: string; name: string }[]>([]);
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

  /*
   * The assignee list for the composer. Only fetched for someone who can
   * actually assign — for everyone else the picker never renders, so the
   * request would be pure waste.
   */
  useEffect(() => {
    const studioId = session?.studio?.id;
    if (!token || !studioId || !permissions.includes('tasks.assignToOthers')) return;
    let cancelled = false;
    fetchTeamUsers(token, studioId)
      .then((rows) => {
        if (cancelled) return;
        // Active members only: assigning work to a deactivated account or
        // an unaccepted invite creates a task nobody will ever see.
        setTeammates(
          rows
            .filter((u) => u.isActive && !u.pending)
            .map((u) => ({ id: u.id, name: u.name?.trim() || u.email })),
        );
      })
      .catch(() => {
        // No picker rather than a broken one; the task still creates for
        // yourself, which is what the composer did before this existed.
      });
    return () => {
      cancelled = true;
    };
  }, [token, permissions, session?.studio?.id]);

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
    async (input: { title: string; dueAt: string | null; userId?: string }) => {
      if (!token) return;
      setCreating(true);
      setCreateError(null);
      try {
        const created = await createPersonalTask(token, {
          title: input.title,
          dueAt: input.dueAt,
          ...(input.userId ? { userId: input.userId } : {}),
        });
        // A task assigned to someone ELSE belongs in `assignedByMe`, not
        // `personal` — those are the two cards, and dropping it in the
        // wrong one would show it under "Assigned to me" with a checkbox
        // this person is not allowed to use.
        setData((current) =>
          current
            ? input.userId
              ? { ...current, assignedByMe: [created, ...current.assignedByMe] }
              : { ...current, personal: [created, ...current.personal] }
            : current,
        );
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

  /**
   * WEB'S GROUP HEADINGS for the Studio Queue, from `Tasks.tsx`'s own
   * `TASK_TYPE_LABELS` — plural, because each names a GROUP. Mobile's
   * `systemTaskLabel` is the singular form and stays where it is: it
   * labels a row, which is a different job.
   */
  const QUEUE_GROUP_LABELS: Record<string, string> = {
    INQUIRY_UNANSWERED: 'Unanswered inquiries',
    ESTIMATE_FOLLOWUP: 'Estimates needing follow-up',
    DEPOSIT_UNPAID: 'Deposits signed but unpaid',
    READY_TO_SCHEDULE: 'Ready to schedule',
    WAIVER_TO_VERIFY: 'Waivers to verify',
    NEW_CONVERSATION: 'New client messages',
    APPOINTMENT_NEEDS_CHECKOUT: 'Appointments needing checkout',
  };

  const solo = !!session?.profile.isSoloStudio;
  const canSeeQueue = permissions.includes('tasks.viewQueue');
  const canAssign = permissions.includes('tasks.assignToOthers');

  /**
   * The queue, grouped by type — DERIVED from the tasks present, never a
   * hardcoded list of sections. A type with nothing in it produces no
   * heading, which is why web's own filter only appears past one group.
   */
  const systemGroups = useMemo(() => {
    const groups = new Map<string, SystemTask[]>();
    for (const task of data?.system ?? []) {
      const held = groups.get(task.type);
      if (held) held.push(task);
      else groups.set(task.type, [task]);
    }
    return [...groups.entries()];
  }, [data]);

  const visibleSystemGroups = useMemo(
    () => (queueType === 'all' ? systemGroups : systemGroups.filter(([t]) => t === queueType)),
    [systemGroups, queueType],
  );

  /** Mine, split and sorted by this card's own two controls. */
  const mine = useMemo(() => {
    const { open, done } = splitByCompletion(data?.personal ?? []);
    return {
      open: sortTasks(filterTasks(open, filter, viewerUserId, timeZone), sort),
      // The done pile hides under the overdue filter: a finished task that
      // was once late is not overdue, it is done.
      done: filter === 'overdue' ? [] : done,
    };
  }, [data, filter, sort, viewerUserId, timeZone]);

  const byMe = useMemo(() => sortTasks(data?.assignedByMe ?? [], sort), [data, sort]);

  if (error && !data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Tasks" onBack={() => router.back()} right={<View style={styles.headSpacer} />} />
        <StateMessage
          eyebrow="Not loaded"
          title="Your tasks didn't load"
          body={error}
          action={{ label: 'Try again', onPress: () => void load('initial') }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/*
        ITEM 1 (session X) — Notifications' anatomy: back chevron, serif
        title, and `right` overridden to an empty spacer so the top-right
        cluster does not appear on a screen reached FROM that cluster.
      */}
      <ScreenHeader title="Tasks" onBack={() => router.back()} right={<View style={styles.headSpacer} />} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.fgMuted} />
        }
      >
        {/*
          Web leads the page with this line and then its own `h1`. The
          serif title is already in the header above, so this is the
          eyebrow alone — saying "Tasks" twice on one screen is what
          session U took off the client detail.
        */}
        <Eyebrow>Everything needing attention, plus your own to-dos.</Eyebrow>

        {!data ? (
          <SkeletonList rows={4} avatar={false} />
        ) : (
          <>
            {/* ─── a. STUDIO QUEUE ─────────────────────────────── */}
            {canSeeQueue ? (
              <Card>
                <SectionHeader>{solo ? 'Queue' : 'Studio queue'}</SectionHeader>
                <Text style={styles.explainer}>
                  {solo
                    ? 'Needs your attention; it disappears once resolved.'
                    : 'Shared and unassigned — anyone can act on an item; it disappears once resolved.'}
                </Text>

                {/* Web shows this filter only past one group, and for the
                    same reason: a filter over a single group narrows
                    nothing. */}
                {systemGroups.length > 1 ? (
                  <PillRow style={styles.cardControls}>
                    <PillMenu
                      label="Filter"
                      icon="filter"
                      value={queueType}
                      active={queueType !== 'all'}
                      onChange={setQueueType}
                      options={[
                        { value: 'all', label: 'All types' },
                        ...systemGroups.map(([t]) => ({
                          value: t,
                          label: QUEUE_GROUP_LABELS[t] ?? systemTaskLabel(t),
                        })),
                      ]}
                    />
                  </PillRow>
                ) : null}

                {visibleSystemGroups.length === 0 ? (
                  <Text style={styles.empty}>Nothing in the queue.</Text>
                ) : (
                  visibleSystemGroups.map(([groupType, tasks]) => (
                    <View key={groupType} style={styles.group}>
                      <Text style={styles.groupHead}>
                        {(QUEUE_GROUP_LABELS[groupType] ?? systemTaskLabel(groupType)).toUpperCase()}
                      </Text>
                      {tasks.map((task) => {
                        const key = `${task.type}:${task.dismissalKey}`;
                        const route = mobileRouteForSystemTask(task);
                        return (
                          <SystemTaskRow
                            key={key}
                            task={task}
                            busy={busyIds.has(key)}
                            onDismiss={() => void dismiss(task)}
                            onPress={route ? () => router.push(route as never) : undefined}
                          />
                        );
                      })}
                    </View>
                  ))
                )}
              </Card>
            ) : null}

            {/* ─── b. ASSIGNED TO ME ───────────────────────────── */}
            <Card>
              <SectionHeader>{solo ? 'Personal' : 'Assigned to me'}</SectionHeader>

              <PillRow style={styles.cardControls}>
                <PillMenu
                  label="Filter"
                  icon="filter"
                  value={filter}
                  active={filter !== 'all'}
                  onChange={setFilter}
                  options={taskFiltersFor({ segment: 'assignedToMe', isSoloStudio: solo })}
                />
                <PillMenu
                  label="Sort"
                  icon="bar-chart-2"
                  value={sort}
                  active={sort !== 'newest'}
                  onChange={setSort}
                  options={TASK_SORTS.map((s) => ({ value: s.key, label: s.label }))}
                />
              </PillRow>

              <NewTaskBar
                timeZone={timeZone}
                onCreate={addTask}
                busy={creating}
                error={createError}
                assignees={canAssign ? teammates : undefined}
              />

              {mine.open.length === 0 && mine.done.length === 0 ? (
                <Text style={styles.empty}>
                  {filter === 'all' ? 'Nothing on your list.' : 'Nothing matches that filter.'}
                </Text>
              ) : null}

              {mine.open.map((task) => (
                <PersonalTaskRow
                  key={task.id}
                  task={task}
                  canComplete
                  busy={busyIds.has(task.id)}
                  onToggleComplete={() => void toggleComplete(task)}
                  timeZone={timeZone}
                />
              ))}

              {mine.done.length > 0 ? (
                <>
                  <Text style={styles.groupHead}>DONE ({mine.done.length})</Text>
                  {mine.done.map((task) => (
                    <PersonalTaskRow
                      key={task.id}
                      task={task}
                      canComplete
                      busy={busyIds.has(task.id)}
                      onToggleComplete={() => void toggleComplete(task)}
                      timeZone={timeZone}
                    />
                  ))}
                </>
              ) : null}
            </Card>

            {/* ─── c. ASSIGNED BY ME ───────────────────────────── */}
            {canAssign ? (
              <Card>
                <SectionHeader>Assigned by me</SectionHeader>
                <Text style={styles.explainer}>
                  Tasks you&apos;ve handed to someone else — only they can mark these complete.
                </Text>

                {byMe.length === 0 ? (
                  <Text style={styles.empty}>You haven&apos;t assigned any tasks to teammates yet.</Text>
                ) : (
                  byMe.map((task) => (
                    /* No checkbox: the API's PATCH is assignee-only, which
                       session 5 established and web states in the line
                       above. A tick you cannot honour is worse than none. */
                    <PersonalTaskRow key={task.id} task={task} canComplete={false} timeZone={timeZone} />
                  ))
                )}
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  /* Balances the back chevron so the title stays centred, as Notifications does. */
  headSpacer: { width: 44 },

  /*
   * ITEM 1: the content inset the Filter/Sort row was missing — it sat
   * flush against the header. One page-level padding now, and the cards
   * inside it carry their own.
   */
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },

  explainer: { ...type.small, color: colors.fgMuted, marginTop: space.xs },
  cardControls: { marginTop: space.md },

  group: { marginTop: space.md },
  groupHead: { ...type.meta, color: colors.accent, marginTop: space.md, marginBottom: space.xs },

  empty: { ...type.small, color: colors.fgMuted, marginTop: space.md },
  pressed: { opacity: 0.6 },
});
