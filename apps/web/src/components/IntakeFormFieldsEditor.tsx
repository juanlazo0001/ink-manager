import { useEffect, useState } from 'react'
import { DragDropProvider, type DragEndEvent } from '@dnd-kit/react'
import { useSortable, isSortable } from '@dnd-kit/react/sortable'
import { DragHandleIcon } from './icons'
import { apiFetch } from '../lib/api'

export type IntakeFieldKind = 'SYSTEM' | 'CUSTOM'
export type IntakeCustomQuestionType =
  | 'TEXT'
  | 'PARAGRAPH'
  | 'NUMBER'
  | 'DATE'
  | 'YES_NO'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'PHOTO_UPLOAD'

export interface IntakeFormField {
  id: string
  fieldKind: IntakeFieldKind
  systemFieldKey: string | null
  customQuestionType: IntakeCustomQuestionType | null
  label: string
  helpText: string | null
  required: boolean
  enabled: boolean
  options: string[] | null
  order: number
}

const CUSTOM_TYPE_LABELS: Record<IntakeCustomQuestionType, string> = {
  TEXT: 'Short text',
  PARAGRAPH: 'Paragraph',
  NUMBER: 'Number',
  DATE: 'Date',
  YES_NO: 'Yes/No',
  SELECT: 'Select one',
  MULTI_SELECT: 'Select multiple',
  PHOTO_UPLOAD: 'Photo upload',
}

const OPTION_TYPES: IntakeCustomQuestionType[] = ['SELECT', 'MULTI_SELECT']

// name and at least one of phone/email can never end up disabled -- the
// server enforces this authoritatively on every PUT (validateFieldListConstraint),
// this is just the same rule reflected in the UI so a studio can't even
// attempt to save a broken form: name's checkbox is permanently locked on,
// and whichever of phone/email is currently the SOLE enabled contact method
// gets locked on too (the other stays freely toggleable).
function isEnabledLocked(field: IntakeFormField, allFields: IntakeFormField[]): boolean {
  if (field.systemFieldKey === 'name') return true
  if (field.systemFieldKey !== 'email' && field.systemFieldKey !== 'phone') return false
  const email = allFields.find((f) => f.systemFieldKey === 'email')
  const phone = allFields.find((f) => f.systemFieldKey === 'phone')
  const otherEnabled = field.systemFieldKey === 'email' ? (phone?.enabled ?? false) : (email?.enabled ?? false)
  return field.enabled && !otherEnabled
}

function Row({
  field,
  index,
  allFields,
  onUpdate,
  onRemove,
}: {
  field: IntakeFormField
  index: number
  allFields: IntakeFormField[]
  onUpdate: (id: string, patch: Partial<IntakeFormField>) => void
  onRemove: (id: string) => void
}) {
  const { ref, handleRef, isDragging } = useSortable({ id: field.id, index, group: 'intake-fields' })
  const enabledLocked = isEnabledLocked(field, allFields)
  const isSystem = field.fieldKind === 'SYSTEM'
  const showOptions = field.customQuestionType && OPTION_TYPES.includes(field.customQuestionType)

  return (
    <div
      ref={ref}
      className="rounded-lg border border-border bg-surface p-3"
      style={{ opacity: isDragging ? 0.5 : 1 }}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          ref={handleRef}
          aria-label="Drag to reorder"
          title="Drag to reorder"
          className="mt-1 flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded text-fg-secondary hover:bg-surface-inset active:cursor-grabbing"
        >
          <DragHandleIcon className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                isSystem ? 'bg-surface-inset text-fg-secondary' : 'bg-accent/10 text-accent'
              }`}
            >
              {isSystem ? field.systemFieldKey : 'Custom'}
            </span>

            {!isSystem && (
              <select
                value={field.customQuestionType ?? 'TEXT'}
                onChange={(e) =>
                  onUpdate(field.id, {
                    customQuestionType: e.target.value as IntakeCustomQuestionType,
                    options: OPTION_TYPES.includes(e.target.value as IntakeCustomQuestionType) ? field.options ?? [''] : null,
                  })
                }
                className="rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {Object.entries(CUSTOM_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </div>

          <input
            type="text"
            value={field.label}
            onChange={(e) => onUpdate(field.id, { label: e.target.value })}
            placeholder={isSystem ? 'Label shown on the form' : 'Question text'}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />

          <input
            type="text"
            value={field.helpText ?? ''}
            onChange={(e) => onUpdate(field.id, { helpText: e.target.value || null })}
            placeholder="Help text (optional)"
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-xs text-fg-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />

          {showOptions && (
            <div className="space-y-2 rounded-lg border border-border p-2">
              {(field.options ?? []).map((option, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={option}
                    placeholder={`Option ${oi + 1}`}
                    onChange={(e) => {
                      const next = [...(field.options ?? [])]
                      next[oi] = e.target.value
                      onUpdate(field.id, { options: next })
                    }}
                    className="w-full rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    type="button"
                    onClick={() => onUpdate(field.id, { options: (field.options ?? []).filter((_, idx) => idx !== oi) })}
                    className="shrink-0 rounded-full border border-border px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface-inset hover:text-fg"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => onUpdate(field.id, { options: [...(field.options ?? []), ''] })}
                className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg transition hover:bg-surface-inset"
              >
                Add option
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) => onUpdate(field.id, { required: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-border bg-surface-inset accent-accent"
              />
              Required
            </label>
            <label
              className={`flex items-center gap-1.5 text-xs ${enabledLocked ? 'text-fg-secondary/50' : 'text-fg-secondary'}`}
              title={enabledLocked ? "Can't be disabled -- the studio needs some way to identify and reach a submitter" : undefined}
            >
              <input
                type="checkbox"
                checked={field.enabled}
                disabled={enabledLocked}
                onChange={(e) => onUpdate(field.id, { enabled: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-border bg-surface-inset accent-accent disabled:opacity-60"
              />
              Shown on form
            </label>
          </div>
        </div>

        {!isSystem && (
          <button
            type="button"
            onClick={() => onRemove(field.id)}
            className="shrink-0 rounded-full border border-border px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface-inset hover:text-fg"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

export default function IntakeFormFieldsEditor({ canEdit }: { canEdit: boolean }) {
  const [saved, setSaved] = useState<IntakeFormField[] | null>(null)
  const [draft, setDraft] = useState<IntakeFormField[]>([])
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    apiFetch<IntakeFormField[]>('/studio-settings/intake-form-fields')
      .then((data) => {
        if (!ignore) setSaved(data)
      })
      .catch(() => {
        /* Section just stays empty if this fails; not critical page content. */
      })
    return () => {
      ignore = true
    }
  }, [])

  function startEditing() {
    setDraft(saved ?? [])
    setError(null)
    setEditing(true)
  }

  function update(id: string, patch: Partial<IntakeFormField>) {
    setDraft((current) => current.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }

  function remove(id: string) {
    setDraft((current) => current.filter((f) => f.id !== id))
  }

  function addCustomQuestion() {
    setDraft((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        fieldKind: 'CUSTOM',
        systemFieldKey: null,
        customQuestionType: 'TEXT',
        label: '',
        helpText: null,
        required: false,
        enabled: true,
        options: null,
        order: current.length,
      },
    ])
  }

  // The default OptimisticSortingPlugin (dnd-kit's own, always-on unless
  // overridden) already reorders items live as you drag -- by drop time the
  // dragged item's OWN sortable index already equals wherever it's hovering,
  // so matching source/target BY ID here is unreliable (they're frequently
  // already equal). initialIndex (captured at drag start, untouched by the
  // live optimistic reorder) vs. the current index is the correct pair to
  // splice with.
  function handleDragEnd(event: DragEndEvent) {
    const { source } = event.operation
    if (!source || !isSortable(source)) return
    const fromIndex = source.initialIndex
    const toIndex = source.index
    if (fromIndex === toIndex) return
    setDraft((current) => {
      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    const cleaned = draft.map((f, i) => ({
      ...f,
      label: f.label.trim(),
      helpText: f.helpText?.trim() || null,
      options:
        f.customQuestionType && OPTION_TYPES.includes(f.customQuestionType)
          ? (f.options ?? []).map((o) => o.trim()).filter((o) => o.length > 0)
          : null,
      order: i,
    }))

    const emptyLabel = cleaned.find((f) => f.label.length === 0)
    if (emptyLabel) {
      setError(emptyLabel.fieldKind === 'SYSTEM' ? `"${emptyLabel.systemFieldKey}" needs a label.` : 'Every custom question needs its question text filled in.')
      setSaving(false)
      return
    }
    const invalidOptions = cleaned.find(
      (f) => f.customQuestionType && OPTION_TYPES.includes(f.customQuestionType) && (f.options ?? []).length === 0,
    )
    if (invalidOptions) {
      setError(`"${invalidOptions.label}" needs at least one option.`)
      setSaving(false)
      return
    }

    try {
      const updated = await apiFetch<IntakeFormField[]>('/studio-settings/intake-form-fields', {
        method: 'PUT',
        body: JSON.stringify(cleaned),
      })
      setSaved(updated)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (saved === null) return null

  return (
    <div className="mt-4 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg">Intake Form Fields</p>
          <p className="mt-0.5 text-xs text-fg-secondary">
            {saved.length} field{saved.length === 1 ? '' : 's'} &middot; drag to reorder, mix built-in and custom
            questions freely
          </p>
        </div>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={startEditing}
            className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
          >
            Edit
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-fg-secondary">
              Every field a client sees on the public intake form, in this order
            </label>
            <button
              type="button"
              onClick={addCustomQuestion}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg transition hover:bg-surface"
            >
              + Add custom question
            </button>
          </div>

          <DragDropProvider onDragEnd={handleDragEnd}>
            <div className="space-y-2">
              {draft.map((field, i) => (
                <Row key={field.id} field={field} index={i} allFields={draft} onUpdate={update} onRemove={remove} />
              ))}
            </div>
          </DragDropProvider>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setError(null)
              }}
              disabled={saving}
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
