import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import { apiFetch } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { uiSpringTransition } from '../lib/motion'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useUserProfile } from '../context/useUserProfile'
import { useViewAs } from '../context/useViewAs'
import { tasksQueryKey } from '../lib/queryKeys'
import { PlusIcon, CloseIcon, CheckIcon, FilterIcon, SortIcon } from '../components/icons'
import DatePickerField from '../components/DatePickerField'
import { useThemePreset } from '../lib/useThemePreset'
import Eyebrow from '../components/Eyebrow'
import PillMenu from '../components/PillMenu'

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

// "Assigned to Me" filter/sort dimensions -- derived entirely from data
// already on PersonalTask (dueAt, completedAt, createdBy), no schema
// change. "mine"/"others" mirror the section's own existing static
// My-tasks/Assigned-by-others split; "overdue" is new (a real past-due
// dueAt, on a task that isn't done yet).
const ASSIGNED_TO_ME_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'My tasks' },
  { value: 'others', label: 'Assigned by others' },
  { value: 'overdue', label: 'Overdue' },
] as const
type AssignedToMeFilter = (typeof ASSIGNED_TO_ME_FILTER_OPTIONS)[number]['value']

const ASSIGNED_TO_ME_SORT_OPTIONS = [
  { value: 'recent', label: 'Recently added' },
  { value: 'due-soonest', label: 'Due soonest' },
  { value: 'name', label: 'A–Z' },
] as const
type AssignedToMeSort = (typeof ASSIGNED_TO_ME_SORT_OPTIONS)[number]['value']

function isOverdue(task: { dueAt: string | null; completedAt: string | null }): boolean {
  return !!task.dueAt && !task.completedAt && new Date(task.dueAt) < new Date()
}

function sortPersonalTasks<T extends { title: string; dueAt: string | null; createdAt: string }>(
  tasks: T[],
  sort: AssignedToMeSort,
): T[] {
  const sorted = [...tasks]
  if (sort === 'name') {
    sorted.sort((a, b) => a.title.localeCompare(b.title))
  } else if (sort === 'due-soonest') {
    // No due date sorts last, not first -- an undated task isn't "due
    // sooner" than a dated one.
    sorted.sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0
      if (!a.dueAt) return 1
      if (!b.dueAt) return -1
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    })
  } else {
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }
  return sorted
}

export default function Tasks() {
  const user = useEffectiveUser()
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'
  const { profile } = useUserProfile()
  const { target: viewAsTarget } = useViewAs()
  const queryClient = useQueryClient()
  const queryKey = tasksQueryKey(user!.userId)
  // Matches POST /tasks/personal's own tasks.assignToOthers check (only
  // enforced when assigneeUserId differs from the actor -- everyone with
  // tasks.manageOwn can always assign to themselves regardless).
  const canAssign = profile?.permissions.includes('tasks.assignToOthers') ?? false

  const [showCompleted, setShowCompleted] = useState(false)
  const [showCompletedAssignedByMe, setShowCompletedAssignedByMe] = useState(false)
  // Studio Queue's own filter: by task type, since that's the one
  // dimension already visually grouped there -- narrows down to a single
  // type's group instead of scrolling past every other type.
  const [queueTypeFilter, setQueueTypeFilter] = useState('')
  const [assignedToMeFilter, setAssignedToMeFilter] = useState<AssignedToMeFilter>('all')
  const [assignedToMeSort, setAssignedToMeSort] = useState<AssignedToMeSort>('recent')
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
      <motion.li
        key={task.id}
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={uiSpringTransition}
        className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm"
      >
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
      </motion.li>
    )
  }

  const systemGroups = data ? groupByType(data.system) : []
  const visibleSystemGroups = queueTypeFilter
    ? systemGroups.filter(([type]) => type === queueTypeFilter)
    : systemGroups
  const queueTypeFilterOptions = [
    { value: '', label: 'All types' },
    ...systemGroups.map(([type]) => ({ value: type, label: TASK_TYPE_LABELS[type] ?? type })),
  ]

  const incompletePersonal = data?.personal.filter((t) => !t.completedAt) ?? []
  const completedPersonal = data?.personal.filter((t) => t.completedAt) ?? []
  // "Assigned to Me" groups into what's actually mine to plan vs. what
  // someone else handed me -- same flat list from the API, split client-
  // side purely on who created each row. assignedToMeFilter narrows either
  // group down further (or empties the other one out for "mine"/"others");
  // assignedToMeSort applies within whichever groups remain visible.
  const myOwnIncomplete = incompletePersonal.filter((t) => t.createdBy?.id === user?.userId)
  const assignedByOthersIncomplete = incompletePersonal.filter((t) => t.createdBy?.id !== user?.userId)

  function applyAssignedToMeFilter(tasks: PersonalTask[]): PersonalTask[] {
    return assignedToMeFilter === 'overdue' ? tasks.filter(isOverdue) : tasks
  }
  const visibleMyOwnIncomplete =
    assignedToMeFilter === 'others' ? [] : sortPersonalTasks(applyAssignedToMeFilter(myOwnIncomplete), assignedToMeSort)
  const visibleAssignedByOthersIncomplete =
    assignedToMeFilter === 'mine' ? [] : sortPersonalTasks(applyAssignedToMeFilter(assignedByOthersIncomplete), assignedToMeSort)
  const assignedToMeFilterHidAllTasks =
    incompletePersonal.length > 0 && visibleMyOwnIncomplete.length === 0 && visibleAssignedByOthersIncomplete.length === 0

  const assignedByMe = data?.assignedByMe ?? []
  const incompleteAssignedByMe = assignedByMe.filter((t) => !t.completedAt)
  const completedAssignedByMe = assignedByMe.filter((t) => t.completedAt)

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6 sm:px-10 sm:py-8">
          {isEditorial && <Eyebrow>Everything needing attention, plus your own to-dos.</Eyebrow>}
          <h1
            className={
              isEditorial
                ? 'mt-1 font-display text-[clamp(28px,3.4vw,38px)] font-normal tracking-[-0.015em] text-fg'
                : 'text-2xl font-bold text-fg sm:text-3xl'
            }
          >
            Tasks
          </h1>
          {!isEditorial && <p className="mt-1 text-sm text-fg-secondary">Everything needing attention, plus your own to-dos.</p>}

          {isLoading && <p className="mt-6 text-sm text-fg-secondary">Loading…</p>}
          {error && <p className="mt-6 text-sm text-danger">{error instanceof Error ? error.message : 'Failed to load tasks'}</p>}

          {data && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={uiSpringTransition}>
              {user?.role !== 'ARTIST' && (
              // No .card-surface here, deliberately -- dense list content
              // (same category as Conversations' thread list / Calendar's
              // grid / the Clients & Team tables), not a glass-treatment
              // candidate. Removed the marker that was here.
              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className={isEditorial ? 'sc text-[20px]' : 'text-base font-semibold text-fg'}>Studio Queue</h2>
                    <p className="mt-1 text-sm text-fg-secondary">
                      Shared and unassigned -- anyone can act on an item; it disappears once resolved.
                    </p>
                  </div>
                  {systemGroups.length > 1 && (
                    <PillMenu
                      label="Filter"
                      icon={<FilterIcon className="h-3.5 w-3.5" />}
                      value={queueTypeFilter}
                      options={queueTypeFilterOptions}
                      onChange={setQueueTypeFilter}
                      isEditorial={isEditorial}
                      active={queueTypeFilter !== ''}
                    />
                  )}
                </div>

                {data.system.length === 0 && (
                  <p className="mt-4 text-sm text-fg-secondary">Nothing needs attention right now.</p>
                )}

                {data.system.length > 0 && visibleSystemGroups.length === 0 && (
                  <p className="mt-4 text-sm text-fg-secondary">No tasks match this filter.</p>
                )}

                {visibleSystemGroups.map(([type, tasks]) => (
                  <div key={type} className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                      {TASK_TYPE_LABELS[type] ?? type}
                    </p>
                    <ul className="mt-2 space-y-2">
                      <AnimatePresence initial={false}>
                      {tasks.map((task) => (
                        <motion.li
                          key={`${task.type}:${task.dismissalKey}`}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={uiSpringTransition}
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
                            className={
                              isEditorial
                                ? 'editorial-btn-secondary shrink-0 rounded-full border px-3 py-1 transition disabled:opacity-60'
                                : 'shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface hover:text-fg disabled:opacity-60'
                            }
                          >
                            Dismiss
                          </button>
                        </motion.li>
                      ))}
                      </AnimatePresence>
                    </ul>
                  </div>
                ))}
              </div>
              )}

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className={isEditorial ? 'sc text-[20px]' : 'text-base font-semibold text-fg'}>Assigned to Me</h2>
                  {incompletePersonal.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <PillMenu
                        label="Filter"
                        icon={<FilterIcon className="h-3.5 w-3.5" />}
                        value={assignedToMeFilter}
                        options={ASSIGNED_TO_ME_FILTER_OPTIONS}
                        onChange={setAssignedToMeFilter}
                        isEditorial={isEditorial}
                        active={assignedToMeFilter !== 'all'}
                      />
                      <PillMenu
                        label="Sort"
                        icon={<SortIcon className="h-3.5 w-3.5" />}
                        value={assignedToMeSort}
                        options={ASSIGNED_TO_ME_SORT_OPTIONS}
                        onChange={setAssignedToMeSort}
                        isEditorial={isEditorial}
                      />
                    </div>
                  )}
                </div>

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
                    className={
                      isEditorial
                        ? 'editorial-btn-primary flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                        : 'flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                    }
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add
                  </button>
                </form>
                {formError && <p className="mt-2 text-sm text-danger">{formError}</p>}

                {incompletePersonal.length === 0 && completedPersonal.length === 0 && (
                  <p className="mt-4 text-sm text-fg-secondary">No personal tasks yet — add one above.</p>
                )}

                {assignedToMeFilterHidAllTasks && (
                  <p className="mt-4 text-sm text-fg-secondary">No tasks match this filter.</p>
                )}

                {visibleMyOwnIncomplete.length > 0 && (
                  <div className="mt-4">
                    {visibleAssignedByOthersIncomplete.length > 0 && (
                      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">My tasks</p>
                    )}
                    <ul className={visibleAssignedByOthersIncomplete.length > 0 ? 'mt-2 space-y-2' : 'space-y-2'}>
                      <AnimatePresence initial={false}>{visibleMyOwnIncomplete.map(renderPersonalTaskItem)}</AnimatePresence>
                    </ul>
                  </div>
                )}

                {visibleAssignedByOthersIncomplete.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Assigned by others</p>
                    <ul className="mt-2 space-y-2">
                      <AnimatePresence initial={false}>{visibleAssignedByOthersIncomplete.map(renderPersonalTaskItem)}</AnimatePresence>
                    </ul>
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
                        <AnimatePresence initial={false}>
                        {completedPersonal.map((task) => (
                          <motion.li
                            key={task.id}
                            layout
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 0.6 }}
                            exit={{ opacity: 0 }}
                            transition={uiSpringTransition}
                            className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm"
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
                          </motion.li>
                        ))}
                        </AnimatePresence>
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {canAssign && (
                <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                  <h2 className={isEditorial ? 'sc text-[20px]' : 'text-base font-semibold text-fg'}>Assigned by Me</h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Tasks you've handed to someone else -- only they can mark these complete.
                  </p>

                  {assignedByMe.length === 0 && (
                    <p className="mt-4 text-sm text-fg-secondary">You haven't assigned any tasks to teammates yet.</p>
                  )}

                  {incompleteAssignedByMe.length > 0 && (
                    <ul className="mt-4 space-y-2">
                      <AnimatePresence initial={false}>
                      {incompleteAssignedByMe.map((task) => (
                        <motion.li
                          key={task.id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={uiSpringTransition}
                          className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm"
                        >
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
                        </motion.li>
                      ))}
                      </AnimatePresence>
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
                          <AnimatePresence initial={false}>
                          {completedAssignedByMe.map((task) => (
                            <motion.li
                              key={task.id}
                              layout
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 0.6 }}
                              exit={{ opacity: 0 }}
                              transition={uiSpringTransition}
                              className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm"
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
                            </motion.li>
                          ))}
                          </AnimatePresence>
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
