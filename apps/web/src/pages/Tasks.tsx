import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import { apiFetch } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useViewAs } from '../context/useViewAs'
import { tasksQueryKey } from '../lib/queryKeys'
import { PlusIcon, CloseIcon, CheckIcon } from '../components/icons'
import DatePickerField from '../components/DatePickerField'

interface SystemTask {
  type: string
  title: string
  entityType: string
  entityId: string
  dismissalKey: string
  deepLink: string
  actionableAt: string
}

interface PersonalTask {
  id: string
  title: string
  notes: string | null
  dueAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  // Null once the staff member who created it (for someone else) has been
  // deleted from the studio -- the task itself survives for its assignee.
  createdBy: { id: string; name: string | null; email: string } | null
}

// The flip side of PersonalTask, from GET /tasks' new assignedByMe array --
// same row shape, but with the assignee (`user`) instead of the creator,
// since the creator is always the viewer themselves here.
interface AssignedByMeTask {
  id: string
  title: string
  notes: string | null
  dueAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  user: { id: string; name: string | null; email: string }
}

interface TasksResponse {
  system: SystemTask[]
  personal: PersonalTask[]
  assignedByMe: AssignedByMeTask[]
}

interface StaffRosterEntry {
  id: string
  name: string
  email: string
  role: string
}

const TASK_TYPE_LABELS: Record<string, string> = {
  INQUIRY_UNANSWERED: 'Unanswered inquiries',
  ESTIMATE_FOLLOWUP: 'Estimates needing follow-up',
  DEPOSIT_UNPAID: 'Deposits signed but unpaid',
  READY_TO_SCHEDULE: 'Ready to schedule',
  WAIVER_TO_VERIFY: 'Waivers to verify',
  NEW_CONVERSATION: 'New client messages',
  APPOINTMENT_NEEDS_CHECKOUT: 'Appointments needing checkout',
}

function groupByType(tasks: SystemTask[]): [string, SystemTask[]][] {
  const groups = new Map<string, SystemTask[]>()
  for (const task of tasks) {
    const group = groups.get(task.type) ?? []
    group.push(task)
    groups.set(task.type, group)
  }
  return [...groups.entries()]
}

const EMPTY_FORM = { title: '', dueAt: '', assigneeUserId: '' }

export default function Tasks() {
  const user = useEffectiveUser()
  const { target: viewAsTarget } = useViewAs()
  const queryClient = useQueryClient()
  const queryKey = tasksQueryKey(user!.userId)
  const canAssign = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'

  const [showCompleted, setShowCompleted] = useState(false)
  const [showCompletedAssignedByMe, setShowCompletedAssignedByMe] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => apiFetch<TasksResponse>('/tasks'),
  })

  // Reuses the same OWNER/FRONT_DESK staff roster the conversations panel
  // uses to start a new Team thread -- no dedicated endpoint needed for
  // the "Assign to" picker.
  const { data: staffRoster } = useQuery({
    queryKey: ['conversations-staff-roster'],
    queryFn: () => apiFetch<StaffRosterEntry[]>('/conversations/staff'),
    enabled: canAssign,
  })

  const dismissMutation = useMutation({
    mutationFn: (task: SystemTask) =>
      apiFetch('/tasks/dismiss', { method: 'POST', body: JSON.stringify({ taskType: task.type, dismissalKey: task.dismissalKey }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      apiFetch('/tasks/personal', {
        method: 'POST',
        body: JSON.stringify({
          title: payload.title,
          dueAt: payload.dueAt ? new Date(payload.dueAt).toISOString() : undefined,
          userId: payload.assigneeUserId || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setForm(EMPTY_FORM)
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : 'Failed to add task'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiFetch(`/tasks/personal/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/tasks/personal/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  function handleAddTask(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (form.title.trim().length === 0) {
      setFormError('Title is required.')
      return
    }
    createMutation.mutate(form)
  }

  function toggleComplete(task: PersonalTask) {
    updateMutation.mutate({ id: task.id, data: { completedAt: task.completedAt ? null : new Date().toISOString() } })
  }

  function startEdit(task: PersonalTask) {
    setEditingId(task.id)
    setEditTitle(task.title)
  }

  function saveEdit(id: string) {
    if (editTitle.trim().length === 0) return
    updateMutation.mutate({ id, data: { title: editTitle.trim() } })
    setEditingId(null)
  }

  function updateDueDate(id: string, value: string) {
    updateMutation.mutate({ id, data: { dueAt: value ? new Date(value).toISOString() : null } })
  }

  function renderPersonalTaskItem(task: PersonalTask) {
    return (
      <li key={task.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
        <button
          type="button"
          onClick={() => toggleComplete(task)}
          disabled={!!viewAsTarget}
          aria-label="Mark complete"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-transparent transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckIcon className="h-3 w-3" />
        </button>

        {editingId === task.id ? (
          <input
            type="text"
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => saveEdit(task.id)}
            onKeyDown={(e) => e.key === 'Enter' && saveEdit(task.id)}
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-inset px-2 py-1 text-sm text-fg focus:outline-none"
          />
        ) : (
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => startEdit(task)}
              className="block w-full truncate text-left text-fg hover:underline"
            >
              {task.title}
            </button>
            {task.createdBy?.id !== user?.userId && (
              <p className="mt-0.5 text-xs text-fg-muted">
                Assigned by {task.createdBy ? (task.createdBy.name ?? task.createdBy.email) : 'a deleted user'}
              </p>
            )}
          </div>
        )}

        <div className="w-[9.5rem] shrink-0 text-xs [&_button]:px-2 [&_button]:py-1">
          <label htmlFor={`due-date-${task.id}`} className="sr-only">
            Due date
          </label>
          <DatePickerField
            id={`due-date-${task.id}`}
            value={task.dueAt ? task.dueAt.slice(0, 10) : ''}
            onChange={(value) => updateDueDate(task.id, value)}
            disabled={!!viewAsTarget}
            placeholder="Due date"
          />
        </div>

        <button
          type="button"
          onClick={() => deleteMutation.mutate(task.id)}
          disabled={!!viewAsTarget}
          aria-label="Delete task"
          className="shrink-0 rounded-full p-1 text-fg-muted transition hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </li>
    )
  }

  const systemGroups = data ? groupByType(data.system) : []
  const incompletePersonal = data?.personal.filter((t) => !t.completedAt) ?? []
  const completedPersonal = data?.personal.filter((t) => t.completedAt) ?? []
  // "Assigned to Me" groups into what's actually mine to plan vs. what
  // someone else handed me -- same flat list from the API, split client-
  // side purely on who created each row.
  const myOwnIncomplete = incompletePersonal.filter((t) => t.createdBy?.id === user?.userId)
  const assignedByOthersIncomplete = incompletePersonal.filter((t) => t.createdBy?.id !== user?.userId)

  const assignedByMe = data?.assignedByMe ?? []
  const incompleteAssignedByMe = assignedByMe.filter((t) => !t.completedAt)
  const completedAssignedByMe = assignedByMe.filter((t) => t.completedAt)

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6 sm:px-10 sm:py-8">
          <h1 className="text-2xl font-bold text-fg sm:text-3xl">Tasks</h1>
          <p className="mt-1 text-sm text-fg-secondary">Everything needing attention, plus your own to-dos.</p>

          {isLoading && <p className="mt-6 text-sm text-fg-secondary">Loading…</p>}
          {error && <p className="mt-6 text-sm text-danger">{error instanceof Error ? error.message : 'Failed to load tasks'}</p>}

          {data && (
            <>
              {user?.role !== 'ARTIST' && (
              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Studio Queue</h2>
                <p className="mt-1 text-sm text-fg-secondary">
                  Shared and unassigned -- anyone can act on an item; it disappears once resolved.
                </p>

                {data.system.length === 0 && (
                  <p className="mt-4 text-sm text-fg-secondary">Nothing needs attention right now.</p>
                )}

                {systemGroups.map(([type, tasks]) => (
                  <div key={type} className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                      {TASK_TYPE_LABELS[type] ?? type}
                    </p>
                    <ul className="mt-2 space-y-2">
                      {tasks.map((task) => (
                        <li
                          key={`${task.type}:${task.dismissalKey}`}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
                        >
                          <div className="min-w-0">
                            <Link to={task.deepLink} className="text-fg hover:underline">
                              {task.title}
                            </Link>
                            <p className="mt-0.5 text-xs text-fg-muted">
                              Since {formatDateTime(task.actionableAt)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => dismissMutation.mutate(task)}
                            disabled={dismissMutation.isPending || !!viewAsTarget}
                            className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface hover:text-fg disabled:opacity-60"
                          >
                            Dismiss
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              )}

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Assigned to Me</h2>

                <form onSubmit={handleAddTask} className="mt-4 flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="Add a task…"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  {canAssign && (
                    <select
                      value={form.assigneeUserId}
                      onChange={(e) => setForm({ ...form, assigneeUserId: e.target.value })}
                      className="rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="">Assign to myself</option>
                      {staffRoster
                        ?.filter((member) => member.id !== user?.userId)
                        .map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                    </select>
                  )}
                  <div className="w-40">
                    <label htmlFor="new-task-due-date" className="sr-only">
                      Due date
                    </label>
                    <DatePickerField
                      id="new-task-due-date"
                      value={form.dueAt}
                      onChange={(value) => setForm({ ...form, dueAt: value })}
                      placeholder="Due date"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={createMutation.isPending || !!viewAsTarget}
                    className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add
                  </button>
                </form>
                {formError && <p className="mt-2 text-sm text-danger">{formError}</p>}

                {incompletePersonal.length === 0 && completedPersonal.length === 0 && (
                  <p className="mt-4 text-sm text-fg-secondary">No personal tasks yet — add one above.</p>
                )}

                {myOwnIncomplete.length > 0 && (
                  <div className="mt-4">
                    {assignedByOthersIncomplete.length > 0 && (
                      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">My tasks</p>
                    )}
                    <ul className={assignedByOthersIncomplete.length > 0 ? 'mt-2 space-y-2' : 'space-y-2'}>
                      {myOwnIncomplete.map(renderPersonalTaskItem)}
                    </ul>
                  </div>
                )}

                {assignedByOthersIncomplete.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Assigned by others</p>
                    <ul className="mt-2 space-y-2">{assignedByOthersIncomplete.map(renderPersonalTaskItem)}</ul>
                  </div>
                )}

                {completedPersonal.length > 0 && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setShowCompleted((v) => !v)}
                      className="text-xs font-medium text-fg-muted hover:text-fg"
                    >
                      {showCompleted ? 'Hide' : 'Show'} completed ({completedPersonal.length})
                    </button>

                    {showCompleted && (
                      <ul className="mt-2 space-y-2">
                        {completedPersonal.map((task) => (
                          <li
                            key={task.id}
                            className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm opacity-60"
                          >
                            <button
                              type="button"
                              onClick={() => toggleComplete(task)}
                              disabled={!!viewAsTarget}
                              aria-label="Mark incomplete"
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent bg-accent text-bg disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <CheckIcon className="h-3 w-3" />
                            </button>
                            <span className="min-w-0 flex-1 truncate text-fg-secondary line-through">{task.title}</span>
                            <button
                              type="button"
                              onClick={() => deleteMutation.mutate(task.id)}
                              aria-label="Delete task"
                              className="shrink-0 rounded-full p-1 text-fg-muted transition hover:bg-surface hover:text-fg"
                            >
                              <CloseIcon className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {canAssign && (
                <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                  <h2 className="text-base font-semibold text-fg">Assigned by Me</h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Tasks you've handed to someone else -- only they can mark these complete.
                  </p>

                  {assignedByMe.length === 0 && (
                    <p className="mt-4 text-sm text-fg-secondary">You haven't assigned any tasks to teammates yet.</p>
                  )}

                  {incompleteAssignedByMe.length > 0 && (
                    <ul className="mt-4 space-y-2">
                      {incompleteAssignedByMe.map((task) => (
                        <li key={task.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-fg">{task.title}</p>
                            <p className="mt-0.5 text-xs text-fg-muted">
                              Assigned to {task.user.name ?? task.user.email}
                            </p>
                          </div>

                          {task.dueAt && (
                            <span className="shrink-0 text-xs text-fg-muted">
                              Due {new Date(task.dueAt).toLocaleDateString()}
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => deleteMutation.mutate(task.id)}
                            disabled={!!viewAsTarget}
                            aria-label="Delete task"
                            className="shrink-0 rounded-full p-1 text-fg-muted transition hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <CloseIcon className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {completedAssignedByMe.length > 0 && (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => setShowCompletedAssignedByMe((v) => !v)}
                        className="text-xs font-medium text-fg-muted hover:text-fg"
                      >
                        {showCompletedAssignedByMe ? 'Hide' : 'Show'} completed ({completedAssignedByMe.length})
                      </button>

                      {showCompletedAssignedByMe && (
                        <ul className="mt-2 space-y-2">
                          {completedAssignedByMe.map((task) => (
                            <li
                              key={task.id}
                              className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm opacity-60"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-fg-secondary line-through">{task.title}</p>
                                <p className="mt-0.5 text-xs text-fg-muted">
                                  Assigned to {task.user.name ?? task.user.email}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => deleteMutation.mutate(task.id)}
                                aria-label="Delete task"
                                className="shrink-0 rounded-full p-1 text-fg-muted transition hover:bg-surface hover:text-fg"
                              >
                                <CloseIcon className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
