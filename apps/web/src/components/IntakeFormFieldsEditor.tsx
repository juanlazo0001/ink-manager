import { useEffect, useState } from 'react'
import { DragDropProvider, type DragEndEvent } from '@dnd-kit/react'
import { useSortable, isSortable } from '@dnd-kit/react/sortable'
import { DragHandleIcon } from './icons'
import { apiFetch } from '../lib/api'
import { LOCALE_LABELS, type Locale } from '../i18n/locales'

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
  // Multi-language public forms, Part 6: keyed by locale -- options here
  // is index-aligned to this same row's own `options` array above, not an
  // independent list (a Spanish option list has to be exactly as long,
  // since the public form renders them paired by index).
  translations?: Record<string, { label: string | null; helpText: string | null; options: string[] | null }>
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
  formLocale,
  onUpdate,
  onRemove,
}: {
  field: IntakeFormField
  index: number
  allFields: IntakeFormField[]
  formLocale: Locale
  onUpdate: (id: string, patch: Partial<IntakeFormField>) => void
  onRemove: (id: string) => void
}) {
  const { ref, handleRef, isDragging } = useSortable({ id: field.id, index, group: 'intake-fields' })
  const enabledLocked = isEnabledLocked(field, allFields)
  const isSystem = field.fieldKind === 'SYSTEM'
  const showOptions = field.customQuestionType && OPTION_TYPES.includes(field.customQuestionType)

  function updateEs(patch: Partial<{ label: string | null; helpText: string | null; options: string[] | null }>) {
    const current = field.translations?.es ?? { label: null, helpText: null, options: null }
    onUpdate(field.id, { translations: { ...field.translations, es: { ...current, ...patch } } })
  }

  if (formLocale === 'es') {
    const es = field.translations?.es
    return (
      <div ref={ref} className="rounded-lg card-surface border border-border bg-surface p-3">
        <p className="mb-1 text-xs text-fg-muted">{field.label || (isSystem ? field.systemFieldKey : 'Untitled question')}</p>
        <input
          type="text"
          value={es?.label ?? ''}
          onChange={(e) => updateEs({ label: e.target.value })}
          placeholder={field.label || 'Label (Español)'}
          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <input
          type="text"
          value={es?.helpText ?? ''}
          onChange={(e) => updateEs({ helpText: e.target.value || null })}
          placeholder={field.helpText || 'Help text (Español, optional)'}
          className="mt-2 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-xs text-fg-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {showOptions && (field.options ?? []).length > 0 && (
          <div className="mt-2 space-y-2 rounded-lg border border-border p-2">
            {(field.options ?? []).map((option, oi) => (
              <input
                key={oi}
                type="text"
                value={es?.options?.[oi] ?? ''}
                placeholder={option || `Option ${oi + 1} (Español)`}
                onChange={(e) => {
                  const nextOptions = [...(es?.options ?? (field.options ?? []).map(() => ''))]
                  nextOptions[oi] = e.target.value
                  updateEs({ options: nextOptions })
                }}
                className="w-full rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            ))}
          </div>
        )}
        <p className="mt-1 text-xs text-fg-muted">Falls back to English until filled in. Reorder/add/remove on the English tab.</p>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className="rounded-lg card-surface border border-border bg-surface p-3"
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

export default function IntakeFormFieldsEditor({
  intakeFormId,
  canEdit,
}: {
  intakeFormId: string
  canEdit: boolean
}) {
  const [saved, setSaved] = useState<IntakeFormField[] | null>(null)
  const [draft, setDraft] = useState<IntakeFormField[]>([])
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formLocale, setFormLocale] = useState<Locale>('en')

  // Re-fetches (and resets any in-progress edit) whenever the selected
  // form changes -- this component is parameterized by intakeFormId now
  // that a studio can have more than one form, but stays otherwise
  // identical to its original studio-wide-list self.
  useEffect(() => {
    let ignore = false
    setSaved(null)
    setEditing(false)
    apiFetch<IntakeFormField[]>(`/intake-forms/${intakeFormId}/fields`)
      .then((data) => {
        if (!ignore) setSaved(data)
      })
      .catch(() => {
        /* Section just stays empty if this fails; not critical page content. */
      })
    return () => {
      ignore = true
    }
  }, [intakeFormId])

  function startEditing() {
    setDraft(saved ?? [])
    setError(null)
    setFormLocale('en')
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

    const cleaned = draft.map((f, i) => {
      const hasOptions = f.customQuestionType && OPTION_TYPES.includes(f.customQuestionType)
      // Kept indices tracked so the Spanish options list below stays
      // aligned to the SAME positions after empty English options are
      // dropped -- same alignment concern as Settings.tsx's waiver clauses.
      const keptOptionIndices = hasOptions
        ? (f.options ?? []).map((o, oi) => (o.trim().length > 0 ? oi : -1)).filter((oi) => oi !== -1)
        : []
      const cleanedOptions = hasOptions ? keptOptionIndices.map((oi) => f.options![oi].trim()) : null

      const esLabel = f.translations?.es?.label?.trim() || null
      const esHelpText = f.translations?.es?.helpText?.trim() || null
      const esOptions = hasOptions ? keptOptionIndices.map((oi) => f.translations?.es?.options?.[oi]?.trim() || '') : null

      return {
        ...f,
        label: f.label.trim(),
        helpText: f.helpText?.trim() || null,
        options: cleanedOptions,
        order: i,
        // Fix pass: always send translations.es, even when every field in
        // it is null -- an emptied Spanish tab must actually clear the
        // stale IntakeFormFieldTranslation row (PUT /:id/fields upserts
        // per-field only when the key is present at all; omitting the
        // whole object here used to leave a removed translation silently
        // in place forever).
        translations: { es: { label: esLabel, helpText: esHelpText, options: esOptions && esOptions.length > 0 ? esOptions : null } },
      }
    })

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
      const updated = await apiFetch<IntakeFormField[]>(`/intake-forms/${intakeFormId}/fields`, {
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
    <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-fg">Intake Form Fields</h2>
          <p className="mt-1 text-sm text-fg-secondary">
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
          <div className="flex gap-1 border-b border-border">
            {(Object.keys(LOCALE_LABELS) as Locale[]).map((locale) => (
              <button
                key={locale}
                type="button"
                onClick={() => setFormLocale(locale)}
                className={[
                  'shrink-0 border-b-2 px-3 py-1.5 text-xs font-medium transition',
                  formLocale === locale ? 'border-accent text-fg' : 'border-transparent text-fg-secondary hover:text-fg',
                ].join(' ')}
              >
                {LOCALE_LABELS[locale]}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-fg-secondary">
              {formLocale === 'en'
                ? 'Every field a client sees on the public intake form, in this order'
                : 'Spanish translation for each field -- reorder/add/remove on the English tab'}
            </label>
            {formLocale === 'en' && (
              <button
                type="button"
                onClick={addCustomQuestion}
                className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg transition hover:bg-surface"
              >
                + Add custom question
              </button>
            )}
          </div>

          <DragDropProvider onDragEnd={handleDragEnd}>
            <div className="space-y-2">
              {draft.map((field, i) => (
                <Row
                  key={field.id}
                  field={field}
                  index={i}
                  allFields={draft}
                  formLocale={formLocale}
                  onUpdate={update}
                  onRemove={remove}
                />
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
