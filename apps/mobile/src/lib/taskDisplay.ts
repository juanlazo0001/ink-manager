import type { PersonalTask, SystemTask, TasksResponse } from '@ink-manager/shared-types';

import { civilDateKey, formatDateKey, shiftDateKey, todayKey } from './studioTime';

/**
 * Which segments the Tasks tab shows, and what goes in each.
 *
 * Three for staff, one for an artist — and the difference is not a
 * cosmetic choice, it follows what the API will actually return. An
 * ARTIST holds `tasks.manageOwn` but not `tasks.viewQueue` or
 * `tasks.assignToOthers` by default, so their `system` array is empty by
 * permission and their `assignedByMe` array is empty by construction (the
 * route skips the query for that role entirely). Two permanently empty
 * segments would be worse than none.
 *
 * Derived from the permissions the caller actually has rather than from
 * their role name, so a studio that grants an artist `tasks.viewQueue`
 * gets the segment, and one that revokes it from front desk loses it.
 * Kept pure so the rule is checkable without rendering anything.
 */
export type TaskSegment = 'assignedToMe' | 'assignedByMe' | 'queue';

export interface TaskSegmentDef {
  key: TaskSegment;
  label: string;
}

const ALL_SEGMENTS: Record<TaskSegment, string> = {
  assignedToMe: 'MINE',
  assignedByMe: 'DELEGATED',
  queue: 'QUEUE',
};

export function taskSegmentsFor(permissions: string[]): TaskSegmentDef[] {
  const segments: TaskSegmentDef[] = [{ key: 'assignedToMe', label: ALL_SEGMENTS.assignedToMe }];
  // `assignedByMe` can only ever contain rows this person created for
  // someone else, which requires the permission to assign in the first
  // place.
  if (permissions.includes('tasks.assignToOthers')) {
    segments.push({ key: 'assignedByMe', label: ALL_SEGMENTS.assignedByMe });
  }
  if (permissions.includes('tasks.viewQueue')) {
    segments.push({ key: 'queue', label: ALL_SEGMENTS.queue });
  }
  return segments;
}

/**
 * The calendar date a task is due, as a `"YYYY-MM-DD"` key.
 *
 * `dueAt` is a due DATE, not an instant, but it is NOT stored at UTC
 * midnight. Web writes it with `parseDateString(value).toISOString()`,
 * and `parseDateString` builds `new Date(y, m - 1, d)` — LOCAL midnight
 * of the browser that created it. So a task due 2026-08-25 is stored as:
 *
 *   New_York   2026-08-25T04:00:00.000Z
 *   Berlin     2026-08-24T22:00:00.000Z
 *   Tokyo      2026-08-24T15:00:00.000Z
 *
 * Which means `dueAt.slice(0, 10)` — this function's first version, and
 * the reason for this comment — reads the right day only for a studio at
 * or behind UTC, and is a day early for every European, Asian and Pacific
 * studio.
 *
 * Resolving the instant in the STUDIO's zone gives the right day whenever
 * the browser that wrote it was in the studio's zone, which is what staff
 * at a studio actually are. It is also the same day web itself renders,
 * since web reads back through the matching local `toDateString`.
 */
export function dueDateKey(dueAt: string, timeZone: string): string {
  return civilDateKey(new Date(dueAt), timeZone);
}

/**
 * Past its due date and not yet done.
 *
 * A CALENDAR-DAY comparison against the studio's today, not an instant
 * comparison against "right now". That is a deliberate difference from
 * the web app, which does `new Date(dueAt) < new Date()` — with dueAt at
 * UTC midnight, that marks a task due today as overdue from 8pm the
 * evening BEFORE in New York, and the row then reads "Yesterday ·
 * OVERDUE" for a task that is not yet due at all. Flagged for web too;
 * mobile is not going to reproduce it to match.
 */
export function isOverdue(
  task: Pick<PersonalTask, 'dueAt' | 'completedAt'>,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (!task.dueAt || task.completedAt) return false;
  return dueDateKey(task.dueAt, timeZone) < todayKey(timeZone, now);
}

/**
 * `Today` / `Tomorrow` / `Yesterday` / `3 Apr`, relative to the STUDIO's
 * today. Same convention and same reasoning as `isOverdue` above.
 */
export function dueLabel(dueAt: string, timeZone: string, now: Date = new Date()): string {
  const key = dueDateKey(dueAt, timeZone);
  const today = todayKey(timeZone, now);
  if (key === today) return 'Today';
  if (key === shiftDateKey(today, 1)) return 'Tomorrow';
  if (key === shiftDateKey(today, -1)) return 'Yesterday';
  return formatDateKey(key, { day: 'numeric', month: 'short' });
}

export function isComplete(task: Pick<PersonalTask, 'completedAt'>): boolean {
  return task.completedAt !== null;
}

/**
 * Web's task sort options, same three and same order.
 *
 * `dueSoonest` puts undated tasks LAST rather than first: a task with no
 * date is not urgent, and sorting nulls to the top would bury everything
 * that actually has a deadline.
 */
export type TaskSort = 'newest' | 'dueSoonest' | 'name';

export const TASK_SORTS: { key: TaskSort; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'dueSoonest', label: 'Due soonest' },
  { key: 'name', label: 'Name A–Z' },
];

export function sortTasks(tasks: PersonalTask[], sort: TaskSort): PersonalTask[] {
  const out = [...tasks];
  switch (sort) {
    case 'dueSoonest':
      return out.sort((a, b) => {
        if (!a.dueAt && !b.dueAt) return 0;
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        // The raw instants, compared as strings. Every dueAt is a
        // UTC-normalised ISO-8601 string, so lexical order IS chronological
        // order — and unlike the display helpers above, ORDERING two due
        // dates needs no timezone at all: whichever instant is earlier is
        // the earlier day in every zone.
        return a.dueAt.localeCompare(b.dueAt);
      });
    case 'name':
      return out.sort((a, b) => a.title.localeCompare(b.title));
    case 'newest':
    default:
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

/**
 * Open tasks first, then completed — matching the API's own
 * `completedAt asc, dueAt asc, createdAt asc`, which this preserves
 * rather than re-sorts. Split into two lists instead of one so the UI can
 * put a divider between them and let the done pile recede.
 */
export function splitByCompletion(tasks: PersonalTask[]): { open: PersonalTask[]; done: PersonalTask[] } {
  return {
    open: tasks.filter((t) => !t.completedAt),
    done: tasks.filter((t) => t.completedAt),
  };
}

/** How many items a segment would show, for the segmented control's badge. */
export function segmentCount(data: TasksResponse | null, segment: TaskSegment): number {
  if (!data) return 0;
  switch (segment) {
    case 'assignedToMe':
      // Open only. A badge counting finished work would never go down.
      return data.personal.filter((t) => !t.completedAt).length;
    case 'assignedByMe':
      return data.assignedByMe.filter((t) => !t.completedAt).length;
    case 'queue':
      return data.system.length;
  }
}

/**
 * System task types, turned into something readable.
 *
 * The API sends a screaming-snake type alongside an already-human
 * `title`, so this labels the KIND of work rather than restating the
 * title. Unknown types fall back to a de-snaked version rather than being
 * hidden — a new source added server-side should appear as itself, not
 * vanish from mobile until someone updates a map here.
 */
const SYSTEM_TASK_LABELS: Record<string, string> = {
  INQUIRY_UNANSWERED: 'Unanswered inquiry',
  ESTIMATE_FOLLOWUP: 'Estimate follow-up',
  DEPOSIT_UNPAID: 'Deposit unpaid',
  READY_TO_SCHEDULE: 'Ready to schedule',
  SCHEDULING_CONFLICT: 'Scheduling conflict',
  WAIVER_TO_VERIFY: 'Waiver to verify',
  NEW_CONVERSATION: 'New message',
  REMINDERS_NOT_SENT: 'Reminders not sent',
  APPOINTMENT_NEEDS_CHECKOUT: 'Needs checkout',
  SELF_SCHEDULED_PENDING: 'Self-scheduled, pending',
  FLASH_REQUEST_PENDING: 'Flash request',
  ARTIST_ESTIMATE_NEEDS_REVIEW: 'Estimate to review',
  ARTIST_INVITE_PENDING: 'Invitation pending',
  ARTIST_TRANSFER_PENDING: 'Transfer pending',
  FLASH_REQUEST_ARTIST_PENDING: 'Flash request for you',
};

export function systemTaskLabel(type: string): string {
  return (
    SYSTEM_TASK_LABELS[type] ??
    type
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}

/**
 * A system task's `deepLink` is a WEB path. Some have a mobile screen
 * behind them now and some do not, so this maps only what genuinely
 * exists rather than routing people at a dead end.
 *
 * Returns null when there is nowhere to go, and the row renders
 * un-tappable rather than tappable-and-broken.
 */
export function mobileRouteForSystemTask(task: Pick<SystemTask, 'entityType' | 'entityId'>):
  | { pathname: '/appointment/[id]' | '/conversation/[id]'; params: { id: string } }
  | null {
  switch (task.entityType) {
    case 'Appointment':
      return { pathname: '/appointment/[id]', params: { id: task.entityId } };
    case 'Conversation':
      return { pathname: '/conversation/[id]', params: { id: task.entityId } };
    default:
      // Inquiry, LiabilityWaiver, DepositForm, FlashRequest, ArtistInvite…
      // none of which has a mobile destination yet.
      return null;
  }
}

/**
 * The filter dimension, mirroring apps/web's own
 * `ASSIGNED_TO_ME_FILTER_OPTIONS` exactly — All / My tasks / Assigned by
 * others / Overdue.
 *
 * SINGLE-select, as web's is. It replaced a standing OVERDUE toggle plus
 * a row of sort pills, which together were most of the screen above the
 * list.
 */
export type TaskFilter = 'all' | 'mine' | 'others' | 'overdue';

export const TASK_FILTERS: { value: TaskFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'My tasks' },
  { value: 'others', label: 'Assigned by others' },
  { value: 'overdue', label: 'Overdue' },
];

/**
 * Which of those options make sense for a given scope.
 *
 * Web drops "Assigned by others" for a solo studio — there is nobody else
 * to have assigned it — and this drops it on the DELEGATED scope too,
 * where every row is by definition one this person assigned, so the
 * mine/others split would offer a choice with one answer.
 */
export function taskFiltersFor(options: {
  segment: TaskSegment;
  isSoloStudio: boolean;
}): { value: TaskFilter; label: string }[] {
  const dropOthers = options.isSoloStudio || options.segment === 'assignedByMe';
  return TASK_FILTERS.filter((f) => !(dropOthers && (f.value === 'others' || f.value === 'mine')));
}

/**
 * Applies the filter. `viewerUserId` decides mine-vs-others: a personal
 * task carries `createdById`, and a row this person created for
 * themselves has it equal to their own id.
 */
export function filterTasks(
  tasks: PersonalTask[],
  filter: TaskFilter,
  viewerUserId: string,
  timeZone: string,
  now: Date = new Date(),
): PersonalTask[] {
  switch (filter) {
    case 'mine':
      return tasks.filter((t) => !t.createdById || t.createdById === viewerUserId);
    case 'others':
      return tasks.filter((t) => !!t.createdById && t.createdById !== viewerUserId);
    case 'overdue':
      return tasks.filter((t) => isOverdue(t, timeZone, now));
    default:
      return tasks;
  }
}
