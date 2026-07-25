import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { dollarsToCents, formatCents } from '../lib/money'
import Modal from './Modal'

type PricingModel = 'RANGE' | 'FLAT'
type DepositModel = 'TIER_BASED' | 'FLAT'

export interface ServiceSummary {
  id: string
  name: string
  slug: string
  pricingModel: PricingModel
  depositModel: DepositModel
  flatPriceCents: number | null
  flatDepositCents: number | null
  depositBreakdownNote: string | null
  requiresCandidacyReview: boolean
  isActive: boolean
  intakeFormId: string
}

interface IntakeFormOption {
  id: string
  name: string
}

const EMPTY_FORM = {
  name: '',
  pricingModel: 'RANGE' as PricingModel,
  depositModel: 'TIER_BASED' as DepositModel,
  flatPriceDollars: '',
  flatDepositDollars: '',
  depositBreakdownNote: '',
  requiresCandidacyReview: false,
  intakeFormId: '',
}

// Settings -> a studio's service lines (Package: multi-service support) --
// same list + modal-form shape as IntakeFormsManager.tsx, since a service
// is a similarly small, occasionally-edited studio-config list. Every
// service points at one of the studio's existing intake forms (built
// separately via IntakeFormsManager/IntakeFormFieldsEditor); this manager
// only lets an OWNER pick which one, not edit its fields.
export default function ServicesManager({ canEdit }: { canEdit: boolean }) {
  const [services, setServices] = useState<ServiceSummary[] | null>(null)
  const [servicesError, setServicesError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [intakeForms, setIntakeForms] = useState<IntakeFormOption[]>([])

  const [editingService, setEditingService] = useState<ServiceSummary | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState<ServiceSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [togglingId, setTogglingId] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    apiFetch<ServiceSummary[]>('/services')
      .then((data) => {
        if (!ignore) setServices(data)
      })
      .catch((err) => {
        if (!ignore) setServicesError(err instanceof Error ? err.message : 'Failed to load services')
      })
    return () => {
      ignore = true
    }
  }, [refreshIndex])

  useEffect(() => {
    if (!canEdit) return
    let ignore = false
    apiFetch<IntakeFormOption[]>('/intake-forms')
      .then((data) => {
        if (!ignore) setIntakeForms(data)
      })
      .catch(() => {
        /* The form picker just stays empty if this fails -- not critical page content. */
      })
    return () => {
      ignore = true
    }
  }, [canEdit])

  function openModal(service: ServiceSummary | 'new') {
    setSaveError(null)
    if (service === 'new') {
      setForm({ ...EMPTY_FORM, intakeFormId: intakeForms[0]?.id ?? '' })
    } else {
      setForm({
        name: service.name,
        pricingModel: service.pricingModel,
        depositModel: service.depositModel,
        flatPriceDollars: service.flatPriceCents !== null ? (service.flatPriceCents / 100).toString() : '',
        flatDepositDollars: service.flatDepositCents !== null ? (service.flatDepositCents / 100).toString() : '',
        depositBreakdownNote: service.depositBreakdownNote ?? '',
        requiresCandidacyReview: service.requiresCandidacyReview,
        intakeFormId: service.intakeFormId,
      })
    }
    setEditingService(service)
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    if (!editingService) return

    setSaving(true)
    setSaveError(null)

    const payload = {
      name: form.name.trim(),
      pricingModel: form.pricingModel,
      depositModel: form.depositModel,
      flatPriceCents: form.pricingModel === 'FLAT' ? dollarsToCents(Number(form.flatPriceDollars) || 0) : null,
      flatDepositCents: form.depositModel === 'FLAT' ? dollarsToCents(Number(form.flatDepositDollars) || 0) : null,
      depositBreakdownNote: form.depositBreakdownNote.trim() || null,
      requiresCandidacyReview: form.requiresCandidacyReview,
      intakeFormId: form.intakeFormId,
    }

    try {
      if (editingService === 'new') {
        await apiFetch('/services', { method: 'POST', body: JSON.stringify(payload) })
      } else {
        await apiFetch(`/services/${editingService.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      }
      setEditingService(null)
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(service: ServiceSummary) {
    setTogglingId(service.id)
    setServicesError(null)
    try {
      await apiFetch(`/services/${service.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !service.isActive }) })
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setServicesError(err instanceof Error ? err.message : 'Failed to update service')
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete() {
    if (!showDeleteConfirm) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await apiFetch(`/services/${showDeleteConfirm.id}`, { method: 'DELETE' })
      setShowDeleteConfirm(null)
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Failed to delete service')
    } finally {
      setDeleting(false)
    }
  }

  if (services === null) return null

  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-fg">Services</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            {services.length} service{services.length === 1 ? '' : 's'} &middot; what this studio offers, each with
            its own pricing, deposit, and intake form
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => openModal('new')}
            className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
          >
            + New service
          </button>
        )}
      </div>

      {servicesError && <p className="mt-3 text-sm text-danger">{servicesError}</p>}

      <div className="mt-4 space-y-2">
        {services.length === 0 && <p className="text-sm text-fg-secondary">No services yet.</p>}

        {services.map((service) => (
          <div
            key={service.id}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${
              service.isActive ? 'border-border' : 'border-border opacity-60'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium text-fg">{service.name}</p>
                {!service.isActive && (
                  <span className="shrink-0 rounded-full bg-surface-inset px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                    Inactive
                  </span>
                )}
                {service.requiresCandidacyReview && (
                  <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                    Candidacy review
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-fg-muted">
                {service.pricingModel === 'FLAT'
                  ? `Flat price${service.flatPriceCents !== null ? ` (${formatCents(service.flatPriceCents)})` : ''}`
                  : 'Price range'}
                {' · '}
                {service.depositModel === 'FLAT'
                  ? `Flat deposit${service.flatDepositCents !== null ? ` (${formatCents(service.flatDepositCents)})` : ''}`
                  : 'Tier-based deposit'}
              </p>
              {service.depositBreakdownNote && (
                <p className="mt-0.5 text-xs text-fg-muted">{service.depositBreakdownNote}</p>
              )}
            </div>

            {canEdit && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => openModal(service)}
                  className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-fg transition hover:bg-surface"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleActive(service)}
                  disabled={togglingId === service.id}
                  className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                >
                  {togglingId === service.id ? 'Saving…' : service.isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null)
                    setShowDeleteConfirm(service)
                  }}
                  className="rounded-full border border-danger/40 px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger/10"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editingService && (
        <Modal
          title={editingService === 'new' ? 'New Service' : `Edit "${editingService.name}"`}
          onClose={() => setEditingService(null)}
        >
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-fg-secondary">Name</label>
              <input
                type="text"
                required
                autoFocus
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Powder Brows"
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg-secondary">Pricing</label>
                <select
                  value={form.pricingModel}
                  onChange={(e) => setForm((f) => ({ ...f, pricingModel: e.target.value as PricingModel }))}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="RANGE">Price range (estimate)</option>
                  <option value="FLAT">Flat price</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg-secondary">Deposit</label>
                <select
                  value={form.depositModel}
                  onChange={(e) => setForm((f) => ({ ...f, depositModel: e.target.value as DepositModel }))}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="TIER_BASED">Tier-based (from estimate)</option>
                  <option value="FLAT">Flat deposit</option>
                </select>
              </div>
            </div>

            {form.pricingModel === 'FLAT' && (
              <div>
                <label className="mb-1 block text-sm font-medium text-fg-secondary">Flat price ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.flatPriceDollars}
                  onChange={(e) => setForm((f) => ({ ...f, flatPriceDollars: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            )}

            {form.depositModel === 'FLAT' && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Flat deposit ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.flatDepositDollars}
                    onChange={(e) => setForm((f) => ({ ...f, flatDepositDollars: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">
                    Deposit breakdown note (optional)
                  </label>
                  <input
                    type="text"
                    value={form.depositBreakdownNote}
                    onChange={(e) => setForm((f) => ({ ...f, depositBreakdownNote: e.target.value }))}
                    placeholder="e.g. $50 deposit + $10 processing fee"
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <p className="mt-1 text-xs text-fg-muted">Shown to the client alongside the total on the deposit page.</p>
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-fg-secondary">Intake form</label>
              <select
                required
                value={form.intakeFormId}
                onChange={(e) => setForm((f) => ({ ...f, intakeFormId: e.target.value }))}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="" disabled>
                  Select a form…
                </option>
                {intakeForms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-fg-muted">
                Manage forms and their fields under Policies &amp; Templates → Intake Forms.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm font-medium text-fg-secondary">
              <input
                type="checkbox"
                checked={form.requiresCandidacyReview}
                onChange={(e) => setForm((f) => ({ ...f, requiresCandidacyReview: e.target.checked }))}
                className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
              />
              Requires candidacy review before pricing
            </label>

            {saveError && <p className="text-sm text-danger">{saveError}</p>}

            <button
              type="submit"
              disabled={saving || !form.intakeFormId}
              className="w-full rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {saving ? 'Saving…' : editingService === 'new' ? 'Create' : 'Save changes'}
            </button>
          </form>
        </Modal>
      )}

      {showDeleteConfirm && (
        <Modal title={`Delete "${showDeleteConfirm.name}"`} onClose={() => setShowDeleteConfirm(null)}>
          <p className="text-sm text-fg-secondary">
            This can't be undone. A service with any inquiries ever attached can't be deleted -- deactivate it
            instead.
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
              className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
