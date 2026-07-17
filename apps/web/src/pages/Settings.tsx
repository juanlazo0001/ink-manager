import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import { apiFetch } from '../lib/api'
import { formatPhoneInput, readFileAsDataUrl, MAX_IMAGE_FILE_BYTES } from '../lib/format'
import { navCountsQueryKey } from '../lib/queryKeys'
import { useStudio } from '../context/useStudio'
import { useUserProfile } from '../context/useUserProfile'
import { useEffectiveUser } from '../context/useEffectiveUser'

interface HealthQuestion {
  question: string
  type: 'yes_no' | 'yes_no_explain'
  explainPrompt?: string
}

interface MessageTemplate {
  id: string
  name: string
  body: string
}

interface StudioSettingsData {
  refundPolicy: string | null
  depositPolicy: string | null
  reschedulePolicy: string | null
  communicationPolicy: string | null
  estimateTerms: string | null
  estimateFollowUpHours: number
  giftCardDefaultExpirationDays: number | null
  calendarInviteTemplate: string | null
  waiverHealthQuestions: HealthQuestion[] | null
  waiverClauses: string[] | null
  waiverAcknowledgment: string | null
  waiverPhotoRelease: string | null
  messageTemplates: MessageTemplate[] | null
  showSidebarBadges: boolean
}

const EMPTY_POLICIES_FORM = {
  refundPolicy: '',
  depositPolicy: '',
  reschedulePolicy: '',
  communicationPolicy: '',
  estimateTerms: '',
  estimateFollowUpHours: '24',
  giftCardDefaultExpirationDays: '',
  calendarInviteTemplate: '',
}

const EMPTY_HEALTH_QUESTION: HealthQuestion = { question: '', type: 'yes_no', explainPrompt: '' }

const EMPTY_STUDIO_FORM = { name: '', website: '' }

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface LocationHoursDay {
  day: number
  closed: boolean
  open: string | null
  close: string | null
}

interface Location {
  id: string
  studioId: string
  name: string
  address: string | null
  phone: string | null
  email: string | null
  hours: LocationHoursDay[] | null
  createdAt: string
}

const EMPTY_LOCATION_FORM = { name: '', address: '', phone: '', email: '' }

function defaultHours(): LocationHoursDay[] {
  return Array.from({ length: 7 }, (_, day) => ({ day, closed: true, open: null, close: null }))
}

function googleMapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

function formatTime12h(value: string): string {
  const [hStr, mStr] = value.split(':')
  const hour = Number(hStr)
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  return `${displayHour}:${mStr} ${period}`
}

function hoursSummary(hours: LocationHoursDay[] | null) {
  if (!hours) return null
  return [...hours]
    .sort((a, b) => a.day - b.day)
    .map((day) => ({
      label: DAY_LABELS[day.day],
      text: day.closed || !day.open || !day.close ? 'Closed' : `${formatTime12h(day.open)} – ${formatTime12h(day.close)}`,
    }))
}

export default function Settings() {
  const { studio, loading, refresh } = useStudio()
  const { profile } = useUserProfile()
  const user = useEffectiveUser()
  const canManageStudio = profile?.permissions.includes('studio.manage') ?? false
  const canManageLocations = profile?.permissions.includes('locations.manage') ?? false
  const canViewPolicies = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'
  const canEditPolicies = user?.role === 'OWNER'
  const queryClient = useQueryClient()

  const [policies, setPolicies] = useState<StudioSettingsData | null>(null)
  const [policiesForm, setPoliciesForm] = useState(EMPTY_POLICIES_FORM)
  const [policiesError, setPoliciesError] = useState<string | null>(null)
  const [policiesSuccess, setPoliciesSuccess] = useState(false)
  const [policiesSubmitting, setPoliciesSubmitting] = useState(false)
  const [editingPolicies, setEditingPolicies] = useState(false)
  const [showSidebarBadges, setShowSidebarBadges] = useState(false)

  const [waiverHealthQuestions, setWaiverHealthQuestions] = useState<HealthQuestion[]>([])
  const [waiverClauses, setWaiverClauses] = useState<string[]>([])
  const [waiverAcknowledgment, setWaiverAcknowledgment] = useState('')
  const [waiverPhotoRelease, setWaiverPhotoRelease] = useState('')
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([])

  useEffect(() => {
    if (!canViewPolicies) return

    let ignore = false

    apiFetch<StudioSettingsData>('/studio-settings')
      .then((data) => {
        if (ignore) return
        setPolicies(data)
        setPoliciesForm({
          refundPolicy: data.refundPolicy ?? '',
          depositPolicy: data.depositPolicy ?? '',
          reschedulePolicy: data.reschedulePolicy ?? '',
          communicationPolicy: data.communicationPolicy ?? '',
          estimateTerms: data.estimateTerms ?? '',
          estimateFollowUpHours: String(data.estimateFollowUpHours),
          giftCardDefaultExpirationDays: data.giftCardDefaultExpirationDays?.toString() ?? '',
          calendarInviteTemplate: data.calendarInviteTemplate ?? '',
        })
        setWaiverHealthQuestions(data.waiverHealthQuestions ?? [])
        setWaiverClauses(data.waiverClauses ?? [])
        setWaiverAcknowledgment(data.waiverAcknowledgment ?? '')
        setWaiverPhotoRelease(data.waiverPhotoRelease ?? '')
        setMessageTemplates(data.messageTemplates ?? [])
        setShowSidebarBadges(data.showSidebarBadges)
      })
      .catch(() => {
        // Section just stays empty if this fails; not critical page content.
      })

    return () => {
      ignore = true
    }
  }, [canViewPolicies])

  async function handlePoliciesSubmit(event: FormEvent) {
    event.preventDefault()
    setPoliciesSubmitting(true)
    setPoliciesError(null)
    setPoliciesSuccess(false)

    const cleanedQuestions = waiverHealthQuestions
      .filter((q) => q.question.trim().length > 0)
      .map((q) => ({
        question: q.question.trim(),
        type: q.type,
        ...(q.type === 'yes_no_explain' ? { explainPrompt: q.explainPrompt?.trim() || undefined } : {}),
      }))

    const cleanedClauses = waiverClauses.map((c) => c.trim()).filter((c) => c.length > 0)

    if (cleanedClauses.length === 0) {
      setPoliciesError('At least one waiver clause is required.')
      setPoliciesSubmitting(false)
      return
    }

    const cleanedTemplates = messageTemplates
      .map((t) => ({ id: t.id, name: t.name.trim(), body: t.body.trim() }))
      .filter((t) => t.name.length > 0 && t.body.length > 0)

    try {
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          refundPolicy: policiesForm.refundPolicy || null,
          depositPolicy: policiesForm.depositPolicy || null,
          reschedulePolicy: policiesForm.reschedulePolicy || null,
          communicationPolicy: policiesForm.communicationPolicy || null,
          estimateTerms: policiesForm.estimateTerms || null,
          estimateFollowUpHours: Number(policiesForm.estimateFollowUpHours) || 0,
          giftCardDefaultExpirationDays: policiesForm.giftCardDefaultExpirationDays
            ? Number(policiesForm.giftCardDefaultExpirationDays)
            : null,
          calendarInviteTemplate: policiesForm.calendarInviteTemplate || null,
          waiverHealthQuestions: cleanedQuestions,
          waiverClauses: cleanedClauses,
          waiverAcknowledgment: waiverAcknowledgment || null,
          waiverPhotoRelease: waiverPhotoRelease || null,
          messageTemplates: cleanedTemplates,
          showSidebarBadges,
        }),
      })

      setPolicies(updated)
      setWaiverHealthQuestions(updated.waiverHealthQuestions ?? [])
      setWaiverClauses(updated.waiverClauses ?? [])
      setMessageTemplates(updated.messageTemplates ?? [])
      setShowSidebarBadges(updated.showSidebarBadges)
      setEditingPolicies(false)
      setPoliciesSuccess(true)
      setTimeout(() => setPoliciesSuccess(false), 2000)
      // The sidebar/badge behavior everywhere reads this off /nav-counts
      // (see useNavCounts) -- invalidate so it picks up the new value
      // immediately instead of waiting for the next poll.
      if (user) queryClient.invalidateQueries({ queryKey: navCountsQueryKey(user.userId) })
    } catch (err) {
      setPoliciesError(err instanceof Error ? err.message : 'Failed to update policies')
    } finally {
      setPoliciesSubmitting(false)
    }
  }

  function updateHealthQuestion(index: number, patch: Partial<HealthQuestion>) {
    setWaiverHealthQuestions((current) => current.map((q, i) => (i === index ? { ...q, ...patch } : q)))
  }

  function addHealthQuestion() {
    setWaiverHealthQuestions((current) => [...current, { ...EMPTY_HEALTH_QUESTION }])
  }

  function removeHealthQuestion(index: number) {
    setWaiverHealthQuestions((current) => current.filter((_, i) => i !== index))
  }

  function updateClause(index: number, value: string) {
    setWaiverClauses((current) => current.map((c, i) => (i === index ? value : c)))
  }

  function addClause() {
    setWaiverClauses((current) => [...current, ''])
  }

  function removeClause(index: number) {
    setWaiverClauses((current) => current.filter((_, i) => i !== index))
  }

  function updateTemplate(index: number, patch: Partial<MessageTemplate>) {
    setMessageTemplates((current) => current.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  }

  function addTemplate() {
    setMessageTemplates((current) => [...current, { id: crypto.randomUUID(), name: '', body: '' }])
  }

  function removeTemplate(index: number) {
    setMessageTemplates((current) => current.filter((_, i) => i !== index))
  }

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(EMPTY_STUDIO_FORM)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [locations, setLocations] = useState<Location[] | null>(null)
  const [locationsError, setLocationsError] = useState<string | null>(null)
  const [editingLocationId, setEditingLocationId] = useState<string | 'new' | null>(null)
  const [locationForm, setLocationForm] = useState({ ...EMPTY_LOCATION_FORM, hours: defaultHours() })
  const [locationError, setLocationError] = useState<string | null>(null)
  const [locationSubmitting, setLocationSubmitting] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (studio) {
      setForm({ name: studio.name, website: studio.website ?? '' })
      setLogoUrl(studio.logoUrl)
    }
  }, [studio])

  useEffect(() => {
    if (!studio) return
    let ignore = false

    async function loadLocations() {
      setLocationsError(null)

      try {
        const data = await apiFetch<Location[]>(`/studios/${studio!.id}/locations`)
        if (!ignore) setLocations(data)
      } catch (err) {
        if (!ignore) setLocationsError(err instanceof Error ? err.message : 'Failed to load locations')
      }
    }

    loadLocations()

    return () => {
      ignore = true
    }
  }, [studio])

  async function refreshLocations() {
    if (!studio) return
    const data = await apiFetch<Location[]>(`/studios/${studio.id}/locations`)
    setLocations(data)
  }

  function updateField(field: keyof typeof EMPTY_STUDIO_FORM) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }))
    }
  }

  function handleEdit() {
    setError(null)
    setSuccess(false)
    setEditing(true)
  }

  function handleCancel() {
    if (studio) {
      setForm({ name: studio.name, website: studio.website ?? '' })
      setLogoUrl(studio.logoUrl)
    }
    setError(null)
    setEditing(false)
  }

  async function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)
    setSuccess(false)

    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }

    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setError('Logo image must be under 5MB.')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setLogoUrl(dataUrl)
    } catch {
      setError('Could not read that image. Please try a different file.')
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!studio) return

    setError(null)
    setSuccess(false)
    setSubmitting(true)

    try {
      await apiFetch(`/studios/${studio.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: form.name, website: form.website, logoUrl }),
      })
      await refresh()
      setSuccess(true)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update studio')
    } finally {
      setSubmitting(false)
    }
  }

  function handleAddLocation() {
    setLocationError(null)
    setLocationForm({ ...EMPTY_LOCATION_FORM, hours: defaultHours() })
    setEditingLocationId('new')
  }

  function handleEditLocation(location: Location) {
    setLocationError(null)
    setLocationForm({
      name: location.name,
      address: location.address ?? '',
      phone: location.phone ?? '',
      email: location.email ?? '',
      hours: location.hours ?? defaultHours(),
    })
    setEditingLocationId(location.id)
  }

  function handleCancelLocationEdit() {
    setLocationError(null)
    setEditingLocationId(null)
  }

  function updateLocationField(field: 'name' | 'address' | 'phone' | 'email') {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setLocationForm((current) => ({ ...current, [field]: event.target.value }))
    }
  }

  function updateLocationHoursDay(day: number, patch: Partial<LocationHoursDay>) {
    setLocationForm((current) => ({
      ...current,
      hours: current.hours.map((entry) => (entry.day === day ? { ...entry, ...patch } : entry)),
    }))
  }

  async function handleLocationSubmit(event: FormEvent) {
    event.preventDefault()
    if (!studio || !editingLocationId) return

    if (locationForm.name.trim().length === 0) {
      setLocationError('Location name is required.')
      return
    }

    const incompleteDay = locationForm.hours.find((day) => !day.closed && (!day.open || !day.close))
    if (incompleteDay) {
      setLocationError(`Set both open and close times for ${DAY_LABELS[incompleteDay.day]}, or mark it closed.`)
      return
    }

    setLocationError(null)
    setLocationSubmitting(true)

    const payload = {
      name: locationForm.name,
      address: locationForm.address,
      phone: locationForm.phone,
      email: locationForm.email,
      hours: locationForm.hours,
    }

    try {
      if (editingLocationId === 'new') {
        await apiFetch(`/studios/${studio.id}/locations`, { method: 'POST', body: JSON.stringify(payload) })
      } else {
        await apiFetch(`/studios/${studio.id}/locations/${editingLocationId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      }
      await refreshLocations()
      setEditingLocationId(null)
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : 'Failed to save location')
    } finally {
      setLocationSubmitting(false)
    }
  }

  async function handleDeleteLocation(locationId: string) {
    if (!studio) return

    try {
      await apiFetch(`/studios/${studio.id}/locations/${locationId}`, { method: 'DELETE' })
      await refreshLocations()
    } catch (err) {
      setLocationsError(err instanceof Error ? err.message : 'Failed to delete location')
    } finally {
      setConfirmDeleteId(null)
    }
  }

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6 sm:px-10 sm:py-8">
          <h1 className="text-2xl font-bold text-fg sm:text-3xl">Studio account</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            {canManageStudio ? 'Manage your studio profile and branding.' : 'Your studio profile.'}
          </p>

          <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
            {loading && !studio && <p className="text-sm text-fg-secondary">Loading studio…</p>}

            {!loading && !studio && <p className="text-sm text-danger">Could not load studio information.</p>}

            {success && (
              <div className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                Studio profile updated.
              </div>
            )}

            {studio && !editing && (
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  {studio.logoUrl ? (
                    <img src={studio.logoUrl} alt={studio.name} className="h-14 w-auto rounded-lg" />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-border text-xs text-fg-muted">
                      No logo
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-fg">{studio.name}</p>
                    {studio.website && <p className="mt-1 text-xs text-fg-secondary">{studio.website}</p>}
                    {!canManageStudio && (
                      <p className="mt-2 text-xs text-fg-muted">You don't have permission to edit this.</p>
                    )}
                  </div>
                </div>

                {canManageStudio && (
                  <button
                    type="button"
                    onClick={handleEdit}
                    className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                  >
                    Edit
                  </button>
                )}
              </div>
            )}

            {studio && canManageStudio && editing && (
              <form onSubmit={handleSubmit}>
                {error && (
                  <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                  </div>
                )}

                <div className="mb-5">
                  <label htmlFor="studioName" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Studio name
                  </label>
                  <input
                    id="studioName"
                    type="text"
                    required
                    value={form.name}
                    onChange={updateField('name')}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mb-5">
                  <label htmlFor="studioWebsite" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Website
                  </label>
                  <input
                    id="studioWebsite"
                    type="text"
                    placeholder="https://yourstudio.com"
                    value={form.website}
                    onChange={updateField('website')}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mb-5">
                  <span className="mb-1 block text-sm font-medium text-fg-secondary">Logo</span>
                  <p className="mb-3 text-xs text-fg-muted">
                    Shown at the top of your studio's portal in place of the Ink Manager logo.
                  </p>

                  <div className="flex items-center gap-4">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Studio logo preview" className="h-14 w-auto rounded-lg" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-border text-xs text-fg-muted">
                        No logo
                      </div>
                    )}

                    <label className="cursor-pointer rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface">
                      {logoUrl ? 'Change logo' : 'Upload logo'}
                      <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
                    </label>

                    {logoUrl && (
                      <button
                        type="button"
                        onClick={() => setLogoUrl(null)}
                        className="text-sm font-medium text-fg-secondary transition hover:text-fg"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    {submitting ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={submitting}
                    className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          {studio && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-fg">Locations</h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    {canManageLocations ? 'Every shop location, its hours, and how to reach it.' : 'Where to find us.'}
                  </p>
                </div>

                {canManageLocations && editingLocationId === null && (
                  <button
                    type="button"
                    onClick={handleAddLocation}
                    className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                  >
                    Add location
                  </button>
                )}
              </div>

              {locationsError && (
                <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {locationsError}
                </div>
              )}

              {locations === null && !locationsError && (
                <p className="mt-4 text-sm text-fg-secondary">Loading locations…</p>
              )}

              {locations !== null && locations.length === 0 && editingLocationId !== 'new' && (
                <p className="mt-4 text-sm text-fg-secondary">
                  {canManageLocations ? 'No locations yet. Add your first one.' : 'No locations yet.'}
                </p>
              )}

              <div className="mt-4 space-y-4">
                {locations?.map((location) =>
                  editingLocationId === location.id ? (
                    <LocationForm
                      key={location.id}
                      form={locationForm}
                      error={locationError}
                      submitting={locationSubmitting}
                      onFieldChange={updateLocationField}
                      onPhoneChange={(value) =>
                        setLocationForm((current) => ({ ...current, phone: formatPhoneInput(value) }))
                      }
                      onHoursChange={updateLocationHoursDay}
                      onSubmit={handleLocationSubmit}
                      onCancel={handleCancelLocationEdit}
                    />
                  ) : (
                    <LocationCard
                      key={location.id}
                      location={location}
                      canManage={canManageLocations}
                      confirmingDelete={confirmDeleteId === location.id}
                      onEdit={() => handleEditLocation(location)}
                      onDeleteClick={() => setConfirmDeleteId(location.id)}
                      onDeleteCancel={() => setConfirmDeleteId(null)}
                      onDeleteConfirm={() => handleDeleteLocation(location.id)}
                    />
                  ),
                )}

                {editingLocationId === 'new' && (
                  <LocationForm
                    form={locationForm}
                    error={locationError}
                    submitting={locationSubmitting}
                    onFieldChange={updateLocationField}
                    onPhoneChange={(value) =>
                      setLocationForm((current) => ({ ...current, phone: formatPhoneInput(value) }))
                    }
                    onHoursChange={updateLocationHoursDay}
                    onSubmit={handleLocationSubmit}
                    onCancel={handleCancelLocationEdit}
                  />
                )}
              </div>
            </div>
          )}

          {canViewPolicies && policies && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-fg">Policies &amp; Defaults</h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Wording and defaults used across estimates, deposits, and gift cards.
                  </p>
                </div>

                {canEditPolicies && !editingPolicies && (
                  <button
                    type="button"
                    onClick={() => setEditingPolicies(true)}
                    className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                  >
                    Edit
                  </button>
                )}
              </div>

              {editingPolicies ? (
                <form onSubmit={handlePoliciesSubmit} className="mt-4 space-y-4">
                  {(
                    [
                      ['refundPolicy', 'Refund policy'],
                      ['depositPolicy', 'Deposit policy'],
                      ['reschedulePolicy', 'Reschedule policy'],
                      ['communicationPolicy', 'Communication policy'],
                      ['estimateTerms', 'Estimate Terms & Conditions'],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field}>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">{label}</label>
                      <textarea
                        rows={3}
                        value={policiesForm[field]}
                        onChange={(e) => setPoliciesForm({ ...policiesForm, [field]: e.target.value })}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  ))}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">
                        Estimate follow-up (hours)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={policiesForm.estimateFollowUpHours}
                        onChange={(e) => setPoliciesForm({ ...policiesForm, estimateFollowUpHours: e.target.value })}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">
                        Gift card expiration (days, blank = never)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={policiesForm.giftCardDefaultExpirationDays}
                        onChange={(e) =>
                          setPoliciesForm({ ...policiesForm, giftCardDefaultExpirationDays: e.target.value })
                        }
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">Calendar invite template</label>
                    <textarea
                      rows={3}
                      value={policiesForm.calendarInviteTemplate}
                      onChange={(e) => setPoliciesForm({ ...policiesForm, calendarInviteTemplate: e.target.value })}
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  <div className="border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-fg-secondary">Waiver health screening questions</label>
                      <button
                        type="button"
                        onClick={addHealthQuestion}
                        className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg transition hover:bg-surface"
                      >
                        Add question
                      </button>
                    </div>

                    <div className="mt-3 space-y-3">
                      {waiverHealthQuestions.map((q, i) => (
                        <div key={i} className="rounded-lg border border-border p-3">
                          <div className="flex items-start gap-2">
                            <textarea
                              rows={2}
                              value={q.question}
                              onChange={(e) => updateHealthQuestion(i, { question: e.target.value })}
                              placeholder="Question text"
                              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            <button
                              type="button"
                              onClick={() => removeHealthQuestion(i)}
                              className="shrink-0 rounded-full border border-border px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface hover:text-fg"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <select
                              value={q.type}
                              onChange={(e) =>
                                updateHealthQuestion(i, { type: e.target.value as HealthQuestion['type'] })
                              }
                              className="rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                            >
                              <option value="yes_no">Yes/No</option>
                              <option value="yes_no_explain">Yes/No + explain if yes</option>
                            </select>
                            {q.type === 'yes_no_explain' && (
                              <input
                                type="text"
                                placeholder="Explain prompt (e.g. 'If yes, please explain')"
                                value={q.explainPrompt ?? ''}
                                onChange={(e) => updateHealthQuestion(i, { explainPrompt: e.target.value })}
                                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                              />
                            )}
                          </div>
                        </div>
                      ))}
                      {waiverHealthQuestions.length === 0 && (
                        <p className="text-sm text-fg-secondary">No health questions yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-fg-secondary">Waiver clauses (initialed individually)</label>
                      <button
                        type="button"
                        onClick={addClause}
                        className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg transition hover:bg-surface"
                      >
                        Add clause
                      </button>
                    </div>

                    <div className="mt-3 space-y-3">
                      {waiverClauses.map((clause, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="mt-2 text-xs text-fg-muted">{i + 1}.</span>
                          <textarea
                            rows={2}
                            value={clause}
                            onChange={(e) => updateClause(i, e.target.value)}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                          <button
                            type="button"
                            onClick={() => removeClause(i)}
                            className="mt-1 shrink-0 rounded-full border border-border px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface hover:text-fg"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      {waiverClauses.length === 0 && <p className="text-sm text-fg-secondary">No clauses yet.</p>}
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">Waiver acknowledgment</label>
                    <textarea
                      rows={3}
                      value={waiverAcknowledgment}
                      onChange={(e) => setWaiverAcknowledgment(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">
                      Photo/video release text (optional section)
                    </label>
                    <textarea
                      rows={3}
                      value={waiverPhotoRelease}
                      onChange={(e) => setWaiverPhotoRelease(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  <div className="border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-fg-secondary">Message templates</label>
                      <button
                        type="button"
                        onClick={addTemplate}
                        className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg transition hover:bg-surface"
                      >
                        Add template
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-fg-muted">
                      Available in the conversation composer's template picker.
                    </p>

                    <div className="mt-3 space-y-3">
                      {messageTemplates.map((template, i) => (
                        <div key={template.id} className="rounded-lg border border-border p-3">
                          <div className="flex items-start gap-2">
                            <input
                              type="text"
                              placeholder="Template name (e.g. 'Booking confirmation')"
                              value={template.name}
                              onChange={(e) => updateTemplate(i, { name: e.target.value })}
                              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            <button
                              type="button"
                              onClick={() => removeTemplate(i)}
                              className="shrink-0 rounded-full border border-border px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface hover:text-fg"
                            >
                              Remove
                            </button>
                          </div>
                          <textarea
                            rows={3}
                            placeholder="Template body"
                            value={template.body}
                            onChange={(e) => updateTemplate(i, { body: e.target.value })}
                            className="mt-2 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                      ))}
                      {messageTemplates.length === 0 && (
                        <p className="text-sm text-fg-secondary">No templates yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <label className="text-sm font-medium text-fg-secondary">Interface</label>
                    <label className="mt-2 flex items-center gap-2 text-sm text-fg-secondary">
                      <input
                        type="checkbox"
                        checked={showSidebarBadges}
                        onChange={(e) => setShowSidebarBadges(e.target.checked)}
                        className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                      />
                      Show new-item count badges on sidebar navigation
                    </label>
                    <p className="mt-1 text-xs text-fg-muted">
                      Off by default. Doesn't affect the conversations unread badge or the Tasks icon's count, both
                      of which always show.
                    </p>
                  </div>

                  {policiesError && <p className="text-sm text-danger">{policiesError}</p>}

                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={policiesSubmitting}
                      className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      {policiesSubmitting ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingPolicies(false)}
                      className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Refund policy</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-fg-secondary">
                      {policies.refundPolicy || 'Not set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Deposit policy</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-fg-secondary">
                      {policies.depositPolicy || 'Not set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Reschedule policy</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-fg-secondary">
                      {policies.reschedulePolicy || 'Not set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                      Communication policy
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-fg-secondary">
                      {policies.communicationPolicy || 'Not set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                      Estimate Terms &amp; Conditions
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-fg-secondary">
                      {policies.estimateTerms || 'Not set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                      Estimate follow-up
                    </p>
                    <p className="mt-1 text-sm text-fg-secondary">{policies.estimateFollowUpHours} hours</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                      Gift card expiration
                    </p>
                    <p className="mt-1 text-sm text-fg-secondary">
                      {policies.giftCardDefaultExpirationDays
                        ? `${policies.giftCardDefaultExpirationDays} days`
                        : 'Never expires'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Waiver template</p>
                    <p className="mt-1 text-sm text-fg-secondary">
                      {waiverHealthQuestions.length} health question{waiverHealthQuestions.length === 1 ? '' : 's'},{' '}
                      {waiverClauses.length} clause{waiverClauses.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                      Message templates
                    </p>
                    <p className="mt-1 text-sm text-fg-secondary">
                      {messageTemplates.length} template{messageTemplates.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                      Sidebar badges
                    </p>
                    <p className="mt-1 text-sm text-fg-secondary">{showSidebarBadges ? 'On' : 'Off'}</p>
                  </div>
                </div>
              )}

              {policiesSuccess && <p className="mt-3 text-sm text-success">Saved.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LocationCard({
  location,
  canManage,
  confirmingDelete,
  onEdit,
  onDeleteClick,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  location: Location
  canManage: boolean
  confirmingDelete: boolean
  onEdit: () => void
  onDeleteClick: () => void
  onDeleteCancel: () => void
  onDeleteConfirm: () => void
}) {
  const summary = hoursSummary(location.hours)

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-fg">{location.name}</p>
          {location.address && (
            <a
              href={googleMapsUrl(location.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block text-xs text-fg-secondary underline decoration-border-strong underline-offset-2 hover:text-fg"
            >
              {location.address}
            </a>
          )}
          {location.phone && <p className="mt-1 text-xs text-fg-secondary">{location.phone}</p>}
          {location.email && <p className="mt-1 text-xs text-fg-secondary">{location.email}</p>}
        </div>

        {canManage && !confirmingDelete && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDeleteClick}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface hover:text-fg"
            >
              Delete
            </button>
          </div>
        )}

        {canManage && confirmingDelete && (
          <div className="flex shrink-0 items-center gap-2 text-xs">
            <span className="text-fg-secondary">Delete this location?</span>
            <button
              type="button"
              onClick={onDeleteConfirm}
              className="rounded-full border border-danger/40 bg-danger/10 px-3 py-1.5 font-medium text-danger transition hover:bg-danger/20"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onDeleteCancel}
              className="rounded-full border border-border px-3 py-1.5 font-medium text-fg transition hover:bg-surface"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {summary && (
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-border pt-3 sm:grid-cols-4">
          {summary.map((day) => (
            <div key={day.label} className="text-xs">
              <span className="text-fg-muted">{day.label} </span>
              <span className="text-fg-secondary">{day.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LocationForm({
  form,
  error,
  submitting,
  onFieldChange,
  onPhoneChange,
  onHoursChange,
  onSubmit,
  onCancel,
}: {
  form: { name: string; address: string; phone: string; email: string; hours: LocationHoursDay[] }
  error: string | null
  submitting: boolean
  onFieldChange: (field: 'name' | 'address' | 'phone' | 'email') => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onPhoneChange: (value: string) => void
  onHoursChange: (day: number, patch: Partial<LocationHoursDay>) => void
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-bg p-4">
      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="locationName" className="mb-1 block text-sm font-medium text-fg-secondary">
          Location name
        </label>
        <input
          id="locationName"
          type="text"
          required
          placeholder="Downtown"
          value={form.name}
          onChange={onFieldChange('name')}
          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div className="mb-4">
        <label htmlFor="locationAddress" className="mb-1 block text-sm font-medium text-fg-secondary">
          Address
        </label>
        <textarea
          id="locationAddress"
          rows={2}
          placeholder="123 Main St, Suite 2, Portland, OR 97201"
          value={form.address}
          onChange={onFieldChange('address')}
          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="locationPhone" className="mb-1 block text-sm font-medium text-fg-secondary">
            Phone
          </label>
          <input
            id="locationPhone"
            type="tel"
            inputMode="numeric"
            placeholder="(555) 123-4567"
            maxLength={14}
            value={form.phone}
            onChange={(event) => onPhoneChange(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div>
          <label htmlFor="locationEmail" className="mb-1 block text-sm font-medium text-fg-secondary">
            Contact email
          </label>
          <input
            id="locationEmail"
            type="email"
            placeholder="hello@yourstudio.com"
            value={form.email}
            onChange={onFieldChange('email')}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      <div className="mb-4">
        <span className="mb-2 block text-sm font-medium text-fg-secondary">Hours</span>
        <div className="space-y-2">
          {form.hours.map((day) => (
            <div key={day.day} className="flex flex-wrap items-center gap-2">
              <span className="w-9 text-xs font-medium text-fg-secondary">{DAY_LABELS[day.day]}</span>
              <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
                <input
                  type="checkbox"
                  checked={day.closed}
                  onChange={(event) => onHoursChange(day.day, { closed: event.target.checked })}
                  className="h-3.5 w-3.5 rounded border-border bg-surface-inset accent-accent"
                />
                Closed
              </label>
              <input
                type="time"
                value={day.open ?? ''}
                disabled={day.closed}
                onChange={(event) => onHoursChange(day.day, { open: event.target.value })}
                className="rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-40"
              />
              <span className="text-xs text-fg-muted">to</span>
              <input
                type="time"
                value={day.close ?? ''}
                disabled={day.closed}
                onChange={(event) => onHoursChange(day.day, { close: event.target.value })}
                className="rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-40"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save location'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
