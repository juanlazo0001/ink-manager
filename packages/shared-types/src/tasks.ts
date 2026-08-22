/**
 * `GET /tasks`.
 *
 * Worth knowing before building anything against this: it is ONE call
 * returning THREE differently-shaped lists, and the split is not
 * "mine vs the studio's" — it is by relationship:
 *
 *   personal      real PersonalTask rows assigned TO the caller
 *   assignedByMe  PersonalTask rows the caller created FOR someone else
 *   system        computed, never-persisted work items for the studio
 *
 * The two kinds behave differently in a way any UI has to respect. A
 * personal task is a row and can be completed or reopened. A system task
 * is derived from current data by one of a dozen sources — there is
 * nothing to complete, and the only write available is dismissing it.
 */

export interface PersonalTask {
  id: string;
  title: string;
  notes: string | null;
  /** Null for an undated task. Overdue is derived from this — see the mobile client's taskDisplay. */
  dueAt: string | null;
  /** Null while open. Setting it completes; clearing it reopens. */
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  studioId: string;
  /** The ASSIGNEE. Only this person may complete or reopen the task. */
  userId: string;
  createdById: string | null;
  /** Present on `personal` rows — who assigned it. */
  createdBy?: { id: string; name: string | null; email: string } | null;
  /** Present on `assignedByMe` rows — who it was assigned to. */
  user?: { id: string; name: string | null; email: string } | null;
}

/**
 * A computed work item. Pure function of current data — nothing here is a
 * database row, which is why it has no id of its own and cannot be
 * completed.
 */
export interface SystemTask {
  /** e.g. `INQUIRY_UNANSWERED`, `WAIVER_TO_VERIFY`, `APPOINTMENT_NEEDS_CHECKOUT`. */
  type: string;
  title: string;
  entityType: string;
  /** The underlying record's real id — what a deep link targets. */
  entityId: string;
  /**
   * What `POST /tasks/dismiss` stores. Usually equal to `entityId`, but a
   * few sources fold an event timestamp in so a fresh business event
   * (resending an estimate, say) produces a new, undismissed key against
   * the same underlying record.
   */
  dismissalKey: string;
  /** A web path. Not all of these have a mobile equivalent yet. */
  deepLink: string;
  /** What the list is sorted by, ascending. */
  actionableAt: string;
}

export interface TasksResponse {
  /** Empty unless the caller holds `tasks.viewQueue` (ARTIST: false by default). */
  system: SystemTask[];
  personal: PersonalTask[];
  /** Always empty for an ARTIST — the route skips the query entirely for that role. */
  assignedByMe: PersonalTask[];
}

/**
 * `POST /tasks/personal`. Returns 201 with the created task.
 * Requires `tasks.manageOwn`; supplying a `userId` other than your own
 * additionally requires `tasks.assignToOthers`.
 */
export interface CreatePersonalTaskRequest {
  title: string;
  notes?: string | null;
  dueAt?: string | null;
  /** The assignee. Omit to create one for yourself. */
  userId?: string;
}

/**
 * `PATCH /tasks/personal/:id`. Every field optional; only what is sent
 * changes.
 *
 * **Assignee-only** — the route 404s if `task.userId !== caller`, so
 * someone who delegated a task cannot complete it on the assignee's
 * behalf. Completing and reopening are the same call: a timestamp
 * completes, `null` reopens.
 */
export interface UpdatePersonalTaskRequest {
  title?: string;
  notes?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
}

/** `POST /tasks/dismiss`. Requires `tasks.viewQueue`. */
export interface DismissTaskRequest {
  taskType: string;
  entityId: string;
}
