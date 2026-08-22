import type { PersonalTask, SystemTask, TasksResponse } from '@ink-manager/shared-types';

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
 * Past its due date and not yet done.
 *
 * An instant comparison against "right now", deliberately — not a
 * calendar-day question, so unlike the Schedule tab this needs no studio
 * timezone. A task due at 17:00 is overdue at 17:01 wherever anyone is
 * standing. The web app derives it identically.
 */
export function isOverdue(task: Pick<PersonalTask, 'dueAt' | 'completedAt'>, now: Date = new Date()): boolean {
  return !!task.dueAt && !task.completedAt && new Date(task.dueAt) < now;
}

export function isComplete(task: Pick<PersonalTask, 'completedAt'>): boolean {
  return task.completedAt !== null;
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
