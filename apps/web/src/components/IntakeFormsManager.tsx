import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../lib/api'
import IntakeFormFieldsEditor from './IntakeFormFieldsEditor'
import Modal from './Modal'
import { useThemePreset } from '../lib/useThemePreset'

export interface IntakeFormSummary {
  id: string
  name: string
  slug: string
  isDefault: boolean
  createdAt: string
}

// Settings -> Policies & Templates: the studio's list of named intake
// forms (most studios have exactly one -- "Standard Inquiry," created by
// the multiple-forms migration's backfill) plus the exact same drag-and-
// drop field builder (IntakeFormFieldsEditor) already built, just
// parameterized by whichever form is currently selected instead of one
// studio-wide list.
export default function IntakeFormsManager({ canEdit }: { canEdit: boolean }) {
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'
  const [forms, setForms] = useState<IntakeFormSummary[] | null>(null)
  const [formsError, setFormsError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState<IntakeFormSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    apiFetch<IntakeFormSummary[]>('/intake-forms')
      .then((data) => {
        if (ignore) return
        setForms(data)
        // Keeps whatever's currently selected if it still exists (e.g.
        // after a rename); otherwise falls back to the default form --
        // never leaves the field editor pointed at a form that was just
        // deleted.
        setSelectedId((current) => {
          if (current && data.some((f) => f.id === current)) return current
          return data.find((f) => f.isDefault)?.id ?? data[0]?.id ?? null
        })
      })
      .catch((err) => {
        if (!ignore) setFormsError(err instanceof Error ? err.message : 'Failed to load intake forms')
      })
    return () => {
      ignore = true
    }
  }, [refreshIndex])

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      const created = await apiFetch<IntakeFormSummary>('/intake-forms', {
        method: 'POST',
        body: JSON.stringify({ name: createName.trim() }),
      })
      setShowCreate(false)
      setCreateName('')
      setSelectedId(created.id)
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create form')
    } finally {
      setCreating(false)
    }
  }

  async function handleSetDefault(form: IntakeFormSummary) {
    setSettingDefaultId(form.id)
    setFormsError(null)
    try {
      await apiFetch(`/intake-forms/${form.id}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) })
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setFormsError(err instanceof Error ? err.message : 'Failed to set default form')
    } finally {
      setSettingDefaultId(null)
    }
  }

  async function handleDelete() {
    if (!showDeleteConfirm) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await apiFetch(`/intake-forms/${showDeleteConfirm.id}`, { method: 'DELETE' })
      setShowDeleteConfirm(null)
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete form')
    } finally {
      setDeleting(false)
    }
  }

  if (forms === null) return null

  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Intake Forms</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            {forms.length} form{forms.length === 1 ? '' : 's'} &middot; each has its own fields and its own public
            link
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setCreateError(null)
              setCreateName('')
              setShowCreate(true)
            }}
            className={
              isEditorial
                ? 'editorial-btn-secondary shrink-0 rounded-full border px-3 py-1.5 transition'
                : 'shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface'
            }
          >
            + New form
          </button>
        )}
      </div>

      {formsError && <p className="mt-3 text-sm text-danger">{formsError}</p>}

      <div className="mt-4 space-y-2">
        {forms.map((form) => (
          <div
            key={form.id}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${
              form.id === selectedId ? 'border-accent bg-accent/5' : 'border-border'
            }`}
          >
            <button type="button" onClick={() => setSelectedId(form.id)} className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-fg">{form.name}</p>
                {form.isDefault && (
                  <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                    Default
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-fg-muted">/inquiry/&hellip;/{form.slug}</p>
            </button>

            {canEdit && (
              <div className="flex shrink-0 items-center gap-2">
                {!form.isDefault && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleSetDefault(form)}
                      disabled={settingDefaultId === form.id}
                      className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                    >
                      {settingDefaultId === form.id ? 'Setting…' : 'Set as default'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null)
                        setShowDeleteConfirm(form)
                      }}
                      className="rounded-full border border-danger/40 px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger/10"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {showCreate && (
        <Modal
          title="New Intake Form"
          onClose={() => {
            setShowCreate(false)
            setCreateError(null)
          }}
        >
          <form onSubmit={handleCreate}>
            <label htmlFor="newFormName" className="mb-1 block text-sm font-medium text-fg-secondary">
              Name
            </label>
            <input
              id="newFormName"
              type="text"
              required
              autoFocus
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. Cover-up Consultation"
              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <p className="mt-2 text-xs text-fg-muted">
              Starts with the same contact/tattoo-detail fields as any new form -- edit them below once created.
            </p>
            {createError && <p className="mt-3 text-sm text-danger">{createError}</p>}
            <button
              type="submit"
              disabled={creating || !createName.trim()}
              className={
                isEditorial
                  ? 'editorial-btn-primary mt-4 w-full rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                  : 'mt-4 w-full rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
              }
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </form>
        </Modal>
      )}

      {showDeleteConfirm && (
        <Modal title={`Delete "${showDeleteConfirm.name}"`} onClose={() => setShowDeleteConfirm(null)}>
          <p className="text-sm text-fg-secondary">
            Its fields will be removed. Any inquiries already submitted through this form keep their data -- they'll
            just no longer be linked to a specific form.
          </p>
          {deleteError && <p className="mt-3 text-sm text-danger">{deleteError}</p>}
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 rounded-full border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(null)}
              disabled={deleting}
              className={
                isEditorial
                  ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                  : 'rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60'
              }
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {selectedId && (
        <div className="mt-6">
          <IntakeFormFieldsEditor intakeFormId={selectedId} canEdit={canEdit} />
        </div>
      )}
    </div>
  )
}
