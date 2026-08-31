import type {
  CreatePersonalTaskRequest,
  DismissTaskRequest,
  PersonalTask,
  TasksResponse,
  UpdatePersonalTaskRequest,
} from '@ink-manager/shared-types';

import { apiFetch } from './api';

/**
 * `GET /tasks` -- one call, three lists. Which of them come back
 * populated is decided entirely server-side by the caller's permissions:
 * `system` is empty without `tasks.viewQueue`, and `assignedByMe` is
 * always empty for an ARTIST (the route skips that query for the role
 * rather than returning an empty result by coincidence).
 *
 * Nothing here re-sorts. The API returns personal tasks
 * `completedAt asc, dueAt asc, createdAt asc` and system tasks by
 * `actionableAt` ascending.
 */
export function fetchTasks(token: string, signal?: AbortSignal): Promise<TasksResponse> {
  return apiFetch<TasksResponse>('/tasks', { token, signal });
}

/**
 * Completing and reopening are the same call -- a timestamp completes,
 * `null` reopens.
 *
 * **Assignee-only.** The route 404s when `task.userId` is not the
 * caller, so a task someone delegated cannot be ticked off on the
 * assignee's behalf. A UI that offers the control on an `assignedByMe`
 * row is offering a guaranteed 404.
 */
export function setPersonalTaskCompleted(
  token: string,
  taskId: string,
  completed: boolean,
): Promise<PersonalTask> {
  const payload: UpdatePersonalTaskRequest = {
    completedAt: completed ? new Date().toISOString() : null,
  };
  return apiFetch<PersonalTask>(`/tasks/personal/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(payload),
  });
}

export function createPersonalTask(
  token: string,
  input: CreatePersonalTaskRequest,
): Promise<PersonalTask> {
  return apiFetch<PersonalTask>('/tasks/personal', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  });
}

/**
 * `DELETE /tasks/personal/:id` — remove a personal task outright.
 *
 * Mobile had no way to delete a task at all; web has had one on every
 * row (`Tasks.tsx`'s `deleteMutation`). Not new API surface: the route
 * has existed, gated on `tasks.manageOwn`.
 *
 * WHO MAY DELETE IS NARROWER THAN WHO MAY SEE, and the route decides it
 * rather than the caller guessing: it 404s unless the caller is the
 * task's OWNER or its CREATOR. So a task delegated TO you can be deleted
 * by you, and one delegated BY you can be deleted by you — but a row on
 * someone else's list that is neither is not yours to remove. The screen
 * offers the control on exactly the rows the route would accept.
 *
 * 204, so there is no body to read.
 */
export function deletePersonalTask(token: string, id: string): Promise<null> {
  return apiFetch<null>(`/tasks/personal/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token,
  });
}

/**
 * A system task cannot be completed -- it is computed from current data,
 * and stops appearing when the underlying situation resolves. Dismissing
 * is the only write, and it is per-user: it hides the item for the caller
 * alone, not for the studio. Requires `tasks.viewQueue`, which is the
 * same permission that made the item visible in the first place.
 */
export function dismissSystemTask(
  token: string,
  input: DismissTaskRequest,
): Promise<null> {
  return apiFetch<null>('/tasks/dismiss', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  });
}
