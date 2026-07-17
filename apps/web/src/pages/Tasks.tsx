import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import { apiFetch } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { useAuth } from '../context/useAuth'
import { tasksQueryKey } from '../lib/queryKeys'
import { PlusIcon, CloseIcon, CheckIcon } from '../components/icons'

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
}

interface TasksResponse {
  system: SystemTask[]
  personal: PersonalTask[]
}

const TASK_TYPE_LABELS: Record<string, string> = {
  INQUIRY_UNANSWERED: 'Unanswered inquiries',
  ESTIMATE_FOLLOWUP: 'Estimates needing follow-up',
  DEPOSIT_UNPAID: 'Deposits signed but unpaid',
  READY_TO_SCHEDULE: 'Ready to schedule',
  WAIVER_TO_VERIFY: 'Waivers to verify',
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

const EMPTY_FORM = { title: '', dueAt: '' }

export default function Tasks() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const queryKey = tasksQueryKey(user!.userId)

  const [showCompleted, setShowCompleted] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => apiFetch<TasksResponse>('/tasks'),
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
        body: JSON.stringify({ title: payload.title, dueAt: payload.dueAt ? new Date(payload.dueAt).toISOString() : undefined }),
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

  const systemGroups = data ? groupByType(data.system) : []
  const incompletePersonal = data?.personal.filter((t) => !t.completedAt) ?? []
  const completedPersonal = data?.personal.filter((t) => t.completedAt) ?? []

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6 sm:px-10 sm:py-8">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Tasks</h1>
          <p className="mt-1 text-sm text-neutral-400">Everything needing attention, plus your own to-dos.</p>

          {isLoading && <p className="mt-6 text-sm text-neutral-400">Loading…</p>}
          {error && <p className="mt-6 text-sm text-red-400">{error instanceof Error ? error.message : 'Failed to load tasks'}</p>}

          {data && (
            <>
              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Needs attention</h2>

                {data.system.length === 0 && (
                  <p className="mt-4 text-sm text-neutral-400">Nothing needs attention right now.</p>
                )}

                {systemGroups.map(([type, tasks]) => (
                  <div key={type} className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                      {TASK_TYPE_LABELS[type] ?? type}
                    </p>
                    <ul className="mt-2 space-y-2">
                      {tasks.map((task) => (
                        <li
                          key={`${task.type}:${task.dismissalKey}`}
                          className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 p-3 text-sm"
                        >
                          <div className="min-w-0">
                            <Link to={task.deepLink} className="text-white hover:underline">
                              {task.title}
                            </Link>
                            <p className="mt-0.5 text-xs text-neutral-500">
                              Since {formatDateTime(task.actionableAt)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => dismissMutation.mutate(task)}
                            disabled={dismissMutation.isPending}
                            className="shrink-0 rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-60"
                          >
                            Dismiss
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">My tasks</h2>

                <form onSubmit={handleAddTask} className="mt-4 flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="Add a task…"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                  />
                  <input
                    type="date"
                    value={form.dueAt}
                    onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                  />
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add
                  </button>
                </form>
                {formError && <p className="mt-2 text-sm text-red-400">{formError}</p>}

                {incompletePersonal.length === 0 && completedPersonal.length === 0 && (
                  <p className="mt-4 text-sm text-neutral-400">No personal tasks yet — add one above.</p>
                )}

                {incompletePersonal.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {incompletePersonal.map((task) => (
                      <li key={task.id} className="flex items-center gap-3 rounded-lg border border-neutral-800 p-3 text-sm">
                        <button
                          type="button"
                          onClick={() => toggleComplete(task)}
                          aria-label="Mark complete"
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-neutral-600 text-transparent transition hover:border-neutral-400 hover:text-neutral-400"
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
                            className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-white focus:outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(task)}
                            className="min-w-0 flex-1 truncate text-left text-white hover:underline"
                          >
                            {task.title}
                          </button>
                        )}

                        {task.dueAt && (
                          <span className="shrink-0 text-xs text-neutral-500">
                            Due {new Date(task.dueAt).toLocaleDateString()}
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => deleteMutation.mutate(task.id)}
                          aria-label="Delete task"
                          className="shrink-0 rounded-full p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
                        >
                          <CloseIcon className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {completedPersonal.length > 0 && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setShowCompleted((v) => !v)}
                      className="text-xs font-medium text-neutral-500 hover:text-white"
                    >
                      {showCompleted ? 'Hide' : 'Show'} completed ({completedPersonal.length})
                    </button>

                    {showCompleted && (
                      <ul className="mt-2 space-y-2">
                        {completedPersonal.map((task) => (
                          <li
                            key={task.id}
                            className="flex items-center gap-3 rounded-lg border border-neutral-800 p-3 text-sm opacity-60"
                          >
                            <button
                              type="button"
                              onClick={() => toggleComplete(task)}
                              aria-label="Mark incomplete"
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-neutral-500 bg-neutral-700 text-white"
                            >
                              <CheckIcon className="h-3 w-3" />
                            </button>
                            <span className="min-w-0 flex-1 truncate text-neutral-300 line-through">{task.title}</span>
                            <button
                              type="button"
                              onClick={() => deleteMutation.mutate(task.id)}
                              aria-label="Delete task"
                              className="shrink-0 rounded-full p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
