import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import Modal from './Modal'
import { PencilIcon, TrashIcon } from './icons'

// Package BJ, item 2: the reminders a studio adds itself, as opposed to the
// fixed built-in cadence edited in the card above this one. The two are
// deliberately separate: the built-ins live in two JSON columns on
// StudioSettings and are edited through PATCH /studio-settings, these are
// rows and have their own CRUD routes. See REPORT.md for why they were not
// unified in this package.

export type ReminderAudience = 'CLIENT' | 'ARTIST'
export type ReminderCondition = 'NONE' | 'WAIVER_UNSIGNED'

export interface StudioReminder {
  id: string
  label: string
  audience: ReminderAudience
  condition: ReminderCondition
  offsetDays: number
  sendTime: string
  body: string
  enabled: boolean
  isSystem: boolean
  systemKey: string | null
}

// Mirrors CLIENT_PLACEHOLDERS / ARTIST_PLACEHOLDERS in
// apps/api/src/lib/reminderRules.ts. The API validates against its own copy
// and rejects anything else, so a drift here shows up as a 400 with the real
// allowed list rather than as a literal "{{token}}" reaching a client.
const PLACEHOLDERS: Record<ReminderAudience, string[]> = {
  CLIENT: ['clientFirstName', 'appointmentDate', 'appointmentTime', 'artistName', 'waiverLink', 'studioName'],
  ARTIST: ['artistName', 'clientName', 'appointmentDate', 'appointmentTime', 'studioName'],
}

const CONDITION_LABELS: Record<ReminderCondition, string> = {
  NONE: 'Always send',
  WAIVER_UNSIGNED: 'Only if the waiver is still unsigned',
}

function offsetLabel(days: number): string {
  if (days === 0) return 'Day of'
  if (days === 1) return '1 day before'
  return `${days} days before`
}

function formatTime(value: string): string {
  const [h, m] = value.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return value
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

interface Draft {
  label: string
  audience: ReminderAudience
  condition: ReminderCondition
  offsetDays: string
  sendTime: string
  body: string
  enabled: boolean
}

function emptyDraft(): Draft {
  return {
    label: '',
    audience: 'CLIENT',
    condition: 'NONE',
    offsetDays: '1',
    sendTime: '10:00',
    body: '',
    enabled: true,
  }
}

function draftFrom(reminder: StudioReminder): Draft {
  return {
    label: reminder.label,
    audience: reminder.audience,
    condition: reminder.condition,
    offsetDays: String(reminder.offsetDays),
    sendTime: reminder.sendTime,
    body: reminder.body,
    enabled: reminder.enabled,
  }
}

interface Props {
  canManage: boolean
  isEditorial: boolean
  timezoneLabel: string
}

export default function StudioRemindersCard({ canManage, isEditorial, timezoneLabel }: Props) {
  const [reminders, setReminders] = useState<StudioReminder[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // null = closed; 'new' = create; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ reminders: StudioReminder[] }>('/studio-reminders')
      setReminders(data.reminders)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load reminders')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openNew = () => {
    setDraft(emptyDraft())
    setFormError(null)
    setEditing('new')
  }

  const openEdit = (reminder: StudioReminder) => {
    setDraft(draftFrom(reminder))
    setFormError(null)
    setEditing(reminder.id)
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setFormError(null)

    const payload = {
      label: draft.label.trim(),
      audience: draft.audience,
      condition: draft.condition,
      offsetDays: Number(draft.offsetDays),
      sendTime: draft.sendTime,
      body: draft.body,
      enabled: draft.enabled,
    }

    try {
      if (editing === 'new') {
        await apiFetch('/studio-reminders', { method: 'POST', body: JSON.stringify(payload) })
      } else {
        await apiFetch(`/studio-reminders/${editing}`, { method: 'PATCH', body: JSON.stringify(payload) })
      }
      await load()
      setEditing(null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save this reminder')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (reminder: StudioReminder) => {
    if (deletingId) return
    setDeletingId(reminder.id)
    try {
      await apiFetch(`/studio-reminders/${reminder.id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not delete this reminder')
    } finally {
      setDeletingId(null)
    }
  }

  // Toggling enabled is a one-field PATCH rather than a trip through the
  // modal -- switching a reminder off is the thing a studio does in a hurry.
  const handleToggle = async (reminder: StudioReminder) => {
    try {
      await apiFetch(`/studio-reminders/${reminder.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !reminder.enabled }),
      })
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not update this reminder')
    }
  }

  const allowed = PLACEHOLDERS[draft.audience]
  const segments = Math.max(1, Math.ceil(draft.body.length / 160))

  // The Modal is a SIBLING of the card, never a child of it. `.card-surface`
  // applies backdrop-filter under the editorial theme, which makes it a
  // containing block for position:fixed descendants -- a modal rendered
  // inside the card gets clipped to the card's own box instead of covering
  // the viewport, leaving its buttons unclickable underneath page content.
  return (
    <>
    <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Your Reminders</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Reminders you set up yourself, on top of the built-in ones above. Each one goes out a set number of days
            before the appointment, at a time you choose.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openNew}
            className={
              isEditorial
                ? 'editorial-btn-secondary shrink-0 rounded-full border px-3 py-1.5 transition'
                : 'shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface'
            }
          >
            Add Reminder
          </button>
        )}
      </div>

      {loadError && <p className="mt-3 text-sm text-danger">{loadError}</p>}

      {reminders === null && !loadError && <p className="mt-4 text-sm text-fg-muted">Loading…</p>}

      {reminders !== null && reminders.length === 0 && (
        <p className="mt-4 text-sm text-fg-muted">
          No reminders of your own yet. Add one to text clients or artists on your own schedule.
        </p>
      )}

      {reminders !== null && reminders.length > 0 && (
        <div className="mt-4 divide-y divide-border">
          {reminders.map((reminder) => (
            <div key={reminder.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-fg">{reminder.label}</p>
                  {!reminder.enabled && (
                    <span className="rounded-full bg-surface-inset px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                      Off
                    </span>
                  )}
                  {reminder.condition === 'WAIVER_UNSIGNED' && (
                    <span className="rounded-full bg-surface-inset px-2 py-0.5 text-[11px] font-medium text-fg-secondary">
                      Waiver only
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-fg-secondary">
                  {offsetLabel(reminder.offsetDays)} at {formatTime(reminder.sendTime)} ·{' '}
                  {reminder.audience === 'ARTIST' ? 'To the artist' : 'To the client'}
                </p>
                <p className="mt-1 truncate text-xs text-fg-muted">{reminder.body}</p>
              </div>

              {canManage && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleToggle(reminder)}
                    className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-fg transition hover:bg-surface-inset"
                  >
                    {reminder.enabled ? 'Turn off' : 'Turn on'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(reminder)}
                    aria-label={`Edit ${reminder.label}`}
                    title={`Edit ${reminder.label}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(reminder)}
                    disabled={deletingId === reminder.id}
                    aria-label={`Delete ${reminder.label}`}
                    title={`Delete ${reminder.label}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-danger disabled:opacity-50"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-fg-muted">
        Times are in the studio's own timezone ({timezoneLabel}), checked every 15 minutes.
      </p>

    </div>

      {editing && (
        <Modal
          title={editing === 'new' ? 'Add Reminder' : 'Edit Reminder'}
          onClose={() => setEditing(null)}
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-fg-muted">Name</label>
              <input
                type="text"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="Aftercare check-in"
                className="mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="mt-1 text-xs text-fg-muted">Only you see this — it never appears in the text.</p>
            </div>

            {/* Audience and condition pair naturally; "when" gets its own full
                width row -- sharing a half-width column clipped the time input. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-fg-muted">Send to</label>
                <select
                  value={draft.audience}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, audience: e.target.value as ReminderAudience }))
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="CLIENT">The client</option>
                  <option value="ARTIST">The artist</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-fg-muted">Send it</label>
                <select
                  value={draft.condition}
                  onChange={(e) => setDraft((d) => ({ ...d, condition: e.target.value as ReminderCondition }))}
                  className="mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {(Object.keys(CONDITION_LABELS) as ReminderCondition[]).map((key) => (
                    <option key={key} value={key}>
                      {CONDITION_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {draft.condition === 'WAIVER_UNSIGNED' && (
              <p className="-mt-2 text-xs text-fg-muted">
                Skipped for anyone who has already signed, so nobody gets chased twice.
              </p>
            )}

            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-fg-muted">When</label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="365"
                  value={draft.offsetDays}
                  onChange={(e) => setDraft((d) => ({ ...d, offsetDays: e.target.value }))}
                  className="w-20 rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <span className="text-sm text-fg-secondary">days before the appointment, at</span>
                <input
                  type="time"
                  value={draft.sendTime}
                  onChange={(e) => setDraft((d) => ({ ...d, sendTime: e.target.value }))}
                  className="rounded-lg border border-border bg-surface-inset px-2 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                Use 0 for the day of the appointment.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-fg-muted">Message</label>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                rows={4}
                className="mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {allowed.map((token) => (
                  <button
                    key={token}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, body: `${d.body}{{${token}}}` }))}
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-fg-secondary transition hover:bg-surface-inset hover:text-fg"
                  >
                    {`{{${token}}}`}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                {draft.body.length} characters · {segments} SMS segment{segments === 1 ? '' : 's'}
                {draft.audience === 'ARTIST' && ' · artist messages cannot include the waiver link'}
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                className="h-4 w-4 rounded border-border"
              />
              Send this reminder
            </label>

            {formError && <p className="text-sm text-danger">{formError}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className={
                  isEditorial
                    ? 'editorial-btn-primary rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                    : 'rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                }
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={saving}
                className={
                  isEditorial
                    ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                    : 'rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60'
                }
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
