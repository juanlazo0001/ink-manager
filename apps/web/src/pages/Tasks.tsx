import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { formatDateTime, formatCompactDueDate } from '../lib/format'
import { uiSpringTransition } from '../lib/motion'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useUserProfile } from '../context/useUserProfile'
import { useViewAs } from '../context/useViewAs'
import { tasksQueryKey } from '../lib/queryKeys'
import { PlusIcon, CloseIcon, CheckIcon, FilterIcon, SortIcon } from '../components/icons'
import DatePickerField from '../components/DatePickerField'
import { toDateString } from '../components/DateAndTimeRangeFields'
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

// Mobile row redesign: shared "compact due date pill" look, used both by
// the editable DatePickerField trigger (Assigned to Me -- the creator/
// assignee can change it) and the plain read-only pill (Assigned by Me --
// the backend only lets the assignee edit dueAt, so the assigner only
// ever gets a static display; see PATCH /tasks/personal/:id's own scoping).
// No existing overdue treatment was found anywhere on these rows before
// this redesign (isOverdue was only ever used for the "Overdue" filter
// dropdown, never a visual cue) -- this is a new, minimal one, kept to
// the same "thin border + text color, never a fill" restraint every other
// danger-tone chip in this app already follows (see StatusPill).
function dueDatePillClass(overdue: boolean): string {
  return `shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-left text-xs transition ${
    overdue ? 'border-danger/40 text-danger' : 'border-border text-fg-secondary'
  }`
}

// Mobile row redesign, shared across every personal-task row shape in this
// file (Assigned to Me incomplete/completed, Assigned by Me incomplete/
// completed -- four near-identical layouts that had already diverged from
// each other before this fix; see REPORT.md for the full investigation).
// Line 1 is checkbox (optional) + title ONLY, wrapping up to 2 lines
// before ellipsis -- the title gets the whole line to itself now, rather
// than sharing it with a squeezed-in date input. Line 2 (mobile only, via
// `sm:contents` unwrapping back into the single desktop row) carries
// every other bit of metadata this row has: "Assigned by/to X" first,
// then the due-date pill, then delete, always pinned to the end via
// `ml-auto`. A row with neither (today, only the completed-assigned-by-Me
// list) skips line 2 entirely -- delete sits right after the title.
interface TaskRowContentProps {
  checkbox?: ReactNode
  title: ReactNode
  metaLeft?: ReactNode
  dueDate?: ReactNode
  onDelete: () => void
  deleteDisabled?: boolean
}

function TaskRowContent({ checkbox, title, metaLeft, dueDate, onDelete, deleteDisabled }: TaskRowContentProps) {
  const deleteButton = (
    <button
      type="button"
      onClick={onDelete}
      disabled={deleteDisabled}
      aria-label="Delete task"
      className="shrink-0 rounded-full p-1 text-fg-muted transition hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
    >
      <CloseIcon className="h-3.5 w-3.5" />
    </button>
  )

  if (!metaLeft && !dueDate) {
    return (
      <>
        {checkbox}
        <div className="min-w-0 flex-1">{title}</div>
        {deleteButton}
      </>
    )
  }

  return (
    <>
      {checkbox}
      <div className="min-w-0 flex-1">{title}</div>
      <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:contents">
        {metaLeft && <span className="min-w-0 flex-1 truncate text-xs text-fg-muted sm:order-1 sm:flex-none">{metaLeft}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:order-2 sm:ml-0">
          {dueDate}
          {deleteButton}
        </div>
      </div>
    </>
  )
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
  // UI simplification pass: also false for a solo studio -- there's no one
  // else to ever assign a task to, so the picker and the "Assigned by Me"
  // section below are hidden entirely rather than showing a permanently
  // single-option dropdown and a permanently-empty section.
  const canAssign = (profile?.permissions.includes('tasks.assignToOthers') ?? false) && !(profile?.isSoloStudio ?? false)
  // UI simplification pass: "Assigned by others" can never have any real
  // content for a solo studio -- there is no one else who could ever
  // assign a task to you -- so the filter option itself is dropped rather
  // than left selectable and permanently empty.
  const assignedToMeFilterOptions = profile?.isSoloStudio
    ? ASSIGNED_TO_ME_FILTER_OPTIONS.filter((option) => option.value !== 'others')
    : ASSIGNED_TO_ME_FILTER_OPTIONS

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
    const overdue = isOverdue(task)
    return (
      <motion.li
        key={task.id}
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={uiSpringTransition}
        className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-border p-3 text-sm sm:flex-nowrap sm:items-center"
      >
        <TaskRowContent
          checkbox={
            <button
              type="button"
              onClick={() => toggleComplete(task)}
              disabled={!!viewAsTarget}
              aria-label="Mark complete"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-transparent transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckIcon className="h-3 w-3" />
            </button>
          }
          title={
            editingId === task.id ? (
              <input
                type="text"
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => saveEdit(task.id)}
                onKeyDown={(e) => e.key === 'Enter' && saveEdit(task.id)}
                className="min-w-0 w-full rounded-xl border border-border bg-surface-inset px-2 py-1 text-sm text-fg focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => startEdit(task)}
                className="w-full line-clamp-2 text-left text-fg hover:underline sm:line-clamp-1"
              >
                {task.title}
              </button>
            )
          }
          metaLeft={
            task.createdBy?.id !== user?.userId
              ? `Assigned by ${task.createdBy ? (task.createdBy.name ?? task.createdBy.email) : 'a deleted user'}`
              : undefined
          }
          dueDate={
            <>
              <label htmlFor={`due-date-${task.id}`} className="sr-only">
                Due date
              </label>
              <DatePickerField
                id={`due-date-${task.id}`}
                // Pre-existing bug, fixed here since the new compact
                // "Today"/"Tomorrow" wording is far more exposed to it
                // than the old full-date format was: task.dueAt.slice(0, 10)
                // took the UTC calendar day directly from the stored ISO
                // timestamp, but DatePickerField's parseDateString/
                // toDateString pair always treats a Y-M-D string as LOCAL
                // components -- near a timezone boundary (e.g. any evening
                // hour in a negative-UTC-offset zone) those two calendar
                // days genuinely differ, so the picker showed the wrong
                // day entirely. toDateString(new Date(...)) matches the
                // LOCAL convention parseDateString expects. The onChange/
                // save path (updateDueDate) has its own separate, deeper
                // UTC-vs-local mismatch -- out of this fix's scope, see
                // REPORT.md.
                value={task.dueAt ? toDateString(new Date(task.dueAt)) : ''}
                onChange={(value) => updateDueDate(task.id, value)}
                disabled={!!viewAsTarget}
                placeholder="Due date"
                formatValue={(d) => formatCompactDueDate(d.toISOString())}
                buttonClassName={`${dueDatePillClass(overdue)} bg-surface-inset focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60`}
              />
            </>
          }
          onDelete={() => deleteMutation.mutate(task.id)}
          deleteDisabled={!!viewAsTarget}
        />
      </motion.li>
    )
  }

  // Pending artist invites are personal (addressed to this account's own
  // email, possibly from a studio they aren't even a member of), not
  // "front-desk work" -- rendered in their own always-visible section
  // below, never inside Studio Queue, which stays hidden for role ARTIST
  // regardless (see that section's own gate). Split out of `data.system`
  // before grouping so Studio Queue's own type-filter dropdown never
  // offers it as an option either.
  const artistInviteTasks = data?.system.filter((t) => t.type === 'ARTIST_INVITE_PENDING') ?? []
  const otherSystemTasks = data?.system.filter((t) => t.type !== 'ARTIST_INVITE_PENDING') ?? []

  const systemGroups = groupByType(otherSystemTasks)
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
              {/* Personal to this account's own email, from a studio they
                  may not even be a member of yet -- always visible
                  regardless of role, unlike Studio Queue below (which stays
                  hidden for role ARTIST). See lib/tasks/artistInvitePending.ts
                  on the backend for why this bypasses tasks.viewQueue entirely. */}
              {artistInviteTasks.length > 0 && (
                <div className="mt-6 rounded-2xl border border-accent/30 bg-accent/5 p-5">
                  <h2 className={isEditorial ? 'sc text-[20px]' : 'text-base font-semibold text-fg'}>
                    Studio invites
                  </h2>
                  <p className="mt-1 text-sm text-fg-secondary">Waiting on your response.</p>

                  <ul className="mt-4 space-y-2">
                    <AnimatePresence initial={false}>
                      {artistInviteTasks.map((task) => (
                        <motion.li
                          key={`${task.type}:${task.dismissalKey}`}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={uiSpringTransition}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="text-fg">{task.title}</p>
                            <p className="mt-0.5 text-xs text-fg-muted">Since {formatDateTime(task.actionableAt)}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Link
                              to={task.deepLink}
                              className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-bg transition hover:bg-accent-hover"
                            >
                              Respond
                            </Link>
                            <button
                              type="button"
                              onClick={() => dismissMutation.mutate(task)}
                              disabled={dismissMutation.isPending || !!viewAsTarget}
                              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface hover:text-fg disabled:opacity-60"
                            >
                              Dismiss
                            </button>
                          </div>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </div>
              )}

              {user?.role !== 'ARTIST' && (
              // No .card-surface here, deliberately -- dense list content
              // (same category as Conversations' thread list / Calendar's
              // grid / the Clients & Team tables), not a glass-treatment
              // candidate. Removed the marker that was here.
              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    {/* UI simplification pass: "Studio" reads as a separate
                        entity for a solo artist -- the content underneath
                        (unanswered inquiries, unpaid deposits, etc.) is
                        still fully theirs to handle either way, just
                        relabeled. */}
                    <h2 className={isEditorial ? 'sc text-[20px]' : 'text-base font-semibold text-fg'}>
                      {profile?.isSoloStudio ? 'Queue' : 'Studio Queue'}
                    </h2>
                    <p className="mt-1 text-sm text-fg-secondary">
                      {profile?.isSoloStudio
                        ? 'Needs your attention; it disappears once resolved.'
                        : "Shared and unassigned -- anyone can act on an item; it disappears once resolved."}
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

                {otherSystemTasks.length === 0 && (
                  <p className="mt-4 text-sm text-fg-secondary">Nothing needs attention right now.</p>
                )}

                {otherSystemTasks.length > 0 && visibleSystemGroups.length === 0 && (
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
                  <h2 className={isEditorial ? 'sc text-[20px]' : 'text-base font-semibold text-fg'}>
                    {profile?.isSoloStudio ? 'Personal' : 'Assigned to Me'}
                  </h2>
                  {incompletePersonal.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <PillMenu
                        label="Filter"
                        icon={<FilterIcon className="h-3.5 w-3.5" />}
                        value={assignedToMeFilter}
                        options={assignedToMeFilterOptions}
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
                    // basis-full: found live while verifying the composer's
                    // mobile stacking -- shrinking the due-date field to a
                    // compact pill (below) freed up just enough row width
                    // that flex-wrap started packing this input onto the
                    // same line as the assignee <select> instead of
                    // wrapping, squeezing it down to ~29px wide and
                    // effectively unusable. Forcing this input onto its own
                    // full-width row is robust regardless of how much room
                    // its siblings need, rather than relying on flex-wrap
                    // arithmetic that a future sibling-width change could
                    // silently break again.
                    className="min-w-0 grow basis-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent sm:basis-auto"
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
                  <div>
                    <label htmlFor="new-task-due-date" className="sr-only">
                      Due date
                    </label>
                    <DatePickerField
                      id="new-task-due-date"
                      value={form.dueAt}
                      onChange={(value) => setForm({ ...form, dueAt: value })}
                      placeholder="Due date"
                      formatValue={(d) => formatCompactDueDate(d.toISOString())}
                      buttonClassName="rounded-full border border-border bg-surface-inset px-3 py-2 text-left text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
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
                            className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"
                          >
                            <TaskRowContent
                              checkbox={
                                <button
                                  type="button"
                                  onClick={() => toggleComplete(task)}
                                  disabled={!!viewAsTarget}
                                  aria-label="Mark incomplete"
                                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent bg-accent text-bg disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <CheckIcon className="h-3 w-3" />
                                </button>
                              }
                              title={
                                <span className="w-full line-clamp-2 text-fg-secondary line-through">{task.title}</span>
                              }
                              onDelete={() => deleteMutation.mutate(task.id)}
                            />
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
                          className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-border p-3 text-sm sm:flex-nowrap sm:items-center"
                        >
                          <TaskRowContent
                            title={<p className="line-clamp-2 text-fg sm:line-clamp-1">{task.title}</p>}
                            metaLeft={`Assigned to ${task.user.name ?? task.user.email}`}
                            dueDate={
                              task.dueAt ? (
                                <span className={dueDatePillClass(isOverdue(task))}>{formatCompactDueDate(task.dueAt)}</span>
                              ) : undefined
                            }
                            onDelete={() => deleteMutation.mutate(task.id)}
                            deleteDisabled={!!viewAsTarget}
                          />
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
                              className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-border p-3 text-sm sm:flex-nowrap sm:items-center"
                            >
                              <TaskRowContent
                                title={<p className="line-clamp-2 text-fg-secondary line-through">{task.title}</p>}
                                metaLeft={`Assigned to ${task.user.name ?? task.user.email}`}
                                onDelete={() => deleteMutation.mutate(task.id)}
                              />
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
  )
}
