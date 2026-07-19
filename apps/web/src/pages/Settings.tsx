import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import RichTextEditor from '../components/RichTextEditor'
import { CheckIcon, ClockIcon, CloseIcon, PencilIcon, SpinnerIcon } from '../components/icons'
import { apiFetch } from '../lib/api'
import {
  formatDateTime,
  formatPhoneInput,
  formatRelativeDateTime,
  readFileAsDataUrl,
  MAX_IMAGE_FILE_BYTES,
} from '../lib/format'
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

// Phase 7A: Settings -> System section (job scheduler observability).
interface JobRunInfo {
  id: string
  scheduledFor: string
  startedAt: string
  finishedAt: string | null
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  details: Record<string, unknown> | null
  error: string | null
}

interface JobInfo {
  jobName: string
  description: string
  schedule: string
  lastRun: JobRunInfo | null
}

interface StudioSettingsData {
  refundPolicy: string | null
  depositPolicy: string | null
  reschedulePolicy: string | null
  communicationPolicy: string | null
  estimateTerms: string | null
  estimateFollowUpHours: number
  giftCardDefaultExpirationDays: number | null
  coldLeadDays: number
  timezone: string
  calendarInviteTemplate: string | null
  waiverHealthQuestions: HealthQuestion[] | null
  waiverClauses: string[] | null
  waiverAcknowledgment: string | null
  waiverPhotoRelease: string | null
  messageTemplates: MessageTemplate[] | null
  showSidebarBadges: boolean
}

// Phase UI-3: one row + edit-icon per field, each opening only its own
// WYSIWYG modal (RichTextEditor.tsx). Kept as a plain array (not a Record)
// so display order is explicit and matches the page.
const POLICY_HTML_FIELDS: { key: keyof StudioSettingsData; label: string }[] = [
  { key: 'refundPolicy', label: 'Refund Policy' },
  { key: 'depositPolicy', label: 'Deposit Policy' },
  { key: 'reschedulePolicy', label: 'Reschedule Policy' },
  { key: 'communicationPolicy', label: 'Communication Policy' },
  { key: 'estimateTerms', label: 'Estimate Terms & Conditions' },
  { key: 'waiverAcknowledgment', label: 'Waiver Acknowledgment' },
  { key: 'waiverPhotoRelease', label: 'Photo/Video Release' },
  { key: 'calendarInviteTemplate', label: 'Calendar Invite Template' },
]

// Strips tags for the compact row preview (plain text only, never rendered
// as HTML -- React text interpolation escapes it same as any other string,
// so this needs no sanitizer of its own; it's the modal editor and the
// public-facing render sites that handle real HTML and need one).
function stripHtmlPreview(html: string | null, maxLen = 140): string {
  if (!html) return 'No content yet'
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 'No content yet'
  return text.length > maxLen ? `${text.slice(0, maxLen).trimEnd()}…` : text
}

// Mirrors apps/api/src/routes/studioSettings.ts's VALID_TIMEZONES -- kept
// as a literal list for the same reason other backend/frontend mirrored
// lists in this codebase are (separate compilation units, no shared
// import). Plain-language labels per the standing design mandate: a raw
// IANA identifier is exactly the kind of thing a non-technical owner
// shouldn't have to parse.
const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Eastern Time' },
  { value: 'America/Chicago', label: 'Central Time' },
  { value: 'America/Denver', label: 'Mountain Time' },
  { value: 'America/Phoenix', label: 'Mountain Time (no DST, Arizona)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time' },
  { value: 'America/Anchorage', label: 'Alaska Time' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time' },
]

function timezoneLabel(value: string): string {
  return TIMEZONE_OPTIONS.find((tz) => tz.value === value)?.label ?? value
}

const EMPTY_DEFAULTS_FORM = {
  estimateFollowUpHours: '24',
  giftCardDefaultExpirationDays: '',
  coldLeadDays: '90',
  timezone: 'America/New_York',
  showSidebarBadges: false,
}

// Phase 7A jobs are documented here in plain language; extend this
// dictionary as later phases register more jobs (see apps/api/src/lib/jobs).
const JOB_DISPLAY: Record<string, { friendlyName: string; plainDescription: string }> = {
  giftCardExpirationSweep: {
    friendlyName: 'Gift Card Expiration',
    plainDescription: 'Automatically marks gift cards as expired once their expiration date has passed.',
  },
  coldLeadSweep: {
    friendlyName: 'Cold Lead Detection',
    plainDescription: 'Automatically flags inquiries as cold leads after a period of no activity.',
  },
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
  // OWNER only, matching GET/POST /jobs's own requireRole(Role.OWNER) --
  // stricter than canViewPolicies above, which also lets FRONT_DESK in.
  const canViewSystem = user?.role === 'OWNER'
  const queryClient = useQueryClient()

  const [jobs, setJobs] = useState<JobInfo[] | null>(null)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [runningJob, setRunningJob] = useState<string | null>(null)

  useEffect(() => {
    if (!canViewSystem) return
    let ignore = false

    apiFetch<JobInfo[]>('/jobs')
      .then((data) => {
        if (!ignore) setJobs(data)
      })
      .catch((err) => {
        if (!ignore) setJobsError(err instanceof Error ? err.message : 'Failed to load jobs')
      })

    return () => {
      ignore = true
    }
  }, [canViewSystem])

  async function handleRunNow(jobName: string) {
    setRunningJob(jobName)
    setJobsError(null)
    try {
      await apiFetch(`/jobs/${jobName}/run-now`, { method: 'POST' })
      const refreshed = await apiFetch<JobInfo[]>('/jobs')
      setJobs(refreshed)
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : 'Failed to run job')
    } finally {
      setRunningJob(null)
    }
  }

  const [policies, setPolicies] = useState<StudioSettingsData | null>(null)

  // Phase UI-3: each of the 8 HTML policy fields edits through its own
  // modal -- editingField names which POLICY_HTML_FIELDS key is open (or
  // null), fieldDraft holds that one field's in-progress HTML.
  const [editingField, setEditingField] = useState<keyof StudioSettingsData | null>(null)
  const [fieldDraft, setFieldDraft] = useState('')
  const [fieldSaving, setFieldSaving] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  // The 5 non-HTML "Defaults" fields share one grouped modal instead.
  const [showDefaultsModal, setShowDefaultsModal] = useState(false)
  const [defaultsForm, setDefaultsForm] = useState(EMPTY_DEFAULTS_FORM)
  const [defaultsSaving, setDefaultsSaving] = useState(false)
  const [defaultsError, setDefaultsError] = useState<string | null>(null)

  // Waiver health-questions/clauses: unchanged dedicated list editor (out
  // of this phase's WYSIWYG scope), just re-homed under its own edit
  // toggle now that there's no single mega-form to nest it inside.
  const [waiverHealthQuestions, setWaiverHealthQuestions] = useState<HealthQuestion[]>([])
  const [waiverClauses, setWaiverClauses] = useState<string[]>([])
  const [editingWaiverList, setEditingWaiverList] = useState(false)
  const [waiverListSaving, setWaiverListSaving] = useState(false)
  const [waiverListError, setWaiverListError] = useState<string | null>(null)

  // Message templates: same treatment as the waiver list above.
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([])
  const [editingTemplates, setEditingTemplates] = useState(false)
  const [templatesSaving, setTemplatesSaving] = useState(false)
  const [templatesError, setTemplatesError] = useState<string | null>(null)

  useEffect(() => {
    if (!canViewPolicies) return

    let ignore = false

    apiFetch<StudioSettingsData>('/studio-settings')
      .then((data) => {
        if (ignore) return
        setPolicies(data)
        setWaiverHealthQuestions(data.waiverHealthQuestions ?? [])
        setWaiverClauses(data.waiverClauses ?? [])
        setMessageTemplates(data.messageTemplates ?? [])
      })
      .catch(() => {
        // Section just stays empty if this fails; not critical page content.
      })

    return () => {
      ignore = true
    }
  }, [canViewPolicies])

  function openFieldModal(key: keyof StudioSettingsData) {
    setEditingField(key)
    setFieldDraft((policies?.[key] as string | null) ?? '')
    setFieldError(null)
  }

  async function handleFieldSave() {
    if (!editingField) return
    setFieldSaving(true)
    setFieldError(null)
    try {
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({ [editingField]: fieldDraft }),
      })
      setPolicies(updated)
      setEditingField(null)
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setFieldSaving(false)
    }
  }

  function openDefaultsModal() {
    if (!policies) return
    setDefaultsForm({
      estimateFollowUpHours: String(policies.estimateFollowUpHours),
      giftCardDefaultExpirationDays: policies.giftCardDefaultExpirationDays?.toString() ?? '',
      coldLeadDays: String(policies.coldLeadDays),
      timezone: policies.timezone,
      showSidebarBadges: policies.showSidebarBadges,
    })
    setDefaultsError(null)
    setShowDefaultsModal(true)
  }

  async function handleDefaultsSave() {
    setDefaultsSaving(true)
    setDefaultsError(null)
    try {
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          estimateFollowUpHours: Number(defaultsForm.estimateFollowUpHours) || 0,
          giftCardDefaultExpirationDays: defaultsForm.giftCardDefaultExpirationDays
            ? Number(defaultsForm.giftCardDefaultExpirationDays)
            : null,
          coldLeadDays: Number(defaultsForm.coldLeadDays) || 90,
          timezone: defaultsForm.timezone,
          showSidebarBadges: defaultsForm.showSidebarBadges,
        }),
      })
      setPolicies(updated)
      setShowDefaultsModal(false)
      // The sidebar/badge behavior everywhere reads this off /nav-counts
      // (see useNavCounts) -- invalidate so it picks up the new value
      // immediately instead of waiting for the next poll.
      if (user) queryClient.invalidateQueries({ queryKey: navCountsQueryKey(user.userId) })
    } catch (err) {
      setDefaultsError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setDefaultsSaving(false)
    }
  }

  async function handleWaiverListSave() {
    setWaiverListSaving(true)
    setWaiverListError(null)

    const cleanedQuestions = waiverHealthQuestions
      .filter((q) => q.question.trim().length > 0)
      .map((q) => ({
        question: q.question.trim(),
        type: q.type,
        ...(q.type === 'yes_no_explain' ? { explainPrompt: q.explainPrompt?.trim() || undefined } : {}),
      }))

    const cleanedClauses = waiverClauses.map((c) => c.trim()).filter((c) => c.length > 0)

    if (cleanedClauses.length === 0) {
      setWaiverListError('At least one waiver clause is required.')
      setWaiverListSaving(false)
      return
    }

    try {
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({ waiverHealthQuestions: cleanedQuestions, waiverClauses: cleanedClauses }),
      })
      setPolicies(updated)
      setWaiverHealthQuestions(updated.waiverHealthQuestions ?? [])
      setWaiverClauses(updated.waiverClauses ?? [])
      setEditingWaiverList(false)
    } catch (err) {
      setWaiverListError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setWaiverListSaving(false)
    }
  }

  async function handleTemplatesSave() {
    setTemplatesSaving(true)
    setTemplatesError(null)

    const cleanedTemplates = messageTemplates
      .map((t) => ({ id: t.id, name: t.name.trim(), body: t.body.trim() }))
      .filter((t) => t.name.length > 0 && t.body.length > 0)

    try {
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({ messageTemplates: cleanedTemplates }),
      })
      setPolicies(updated)
      setMessageTemplates(updated.messageTemplates ?? [])
      setEditingTemplates(false)
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setTemplatesSaving(false)
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
              <div>
                <h2 className="text-lg font-semibold text-fg">Policies &amp; Defaults</h2>
                <p className="mt-1 text-sm text-fg-secondary">
                  Wording and defaults used across estimates, deposits, and gift cards.
                </p>
              </div>

              <div className="mt-4 divide-y divide-border">
                {POLICY_HTML_FIELDS.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">{label}</p>
                      <p className="mt-0.5 truncate text-xs text-fg-secondary">
                        {stripHtmlPreview(policies[key] as string | null)}
                      </p>
                    </div>
                    {canEditPolicies && (
                      <button
                        type="button"
                        onClick={() => openFieldModal(key)}
                        aria-label={`Edit ${label}`}
                        title={`Edit ${label}`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-fg">Defaults</p>
                  {canEditPolicies && (
                    <button
                      type="button"
                      onClick={openDefaultsModal}
                      aria-label="Edit defaults"
                      title="Edit defaults"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Estimate follow-up</p>
                    <p className="mt-1 text-sm text-fg-secondary">{policies.estimateFollowUpHours} hours</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Gift card expiration</p>
                    <p className="mt-1 text-sm text-fg-secondary">
                      {policies.giftCardDefaultExpirationDays
                        ? `${policies.giftCardDefaultExpirationDays} days`
                        : 'Never expires'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Cold lead after</p>
                    <p className="mt-1 text-sm text-fg-secondary">{policies.coldLeadDays} days of no activity</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Timezone</p>
                    <p className="mt-1 text-sm text-fg-secondary">{timezoneLabel(policies.timezone)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Sidebar badges</p>
                    <p className="mt-1 text-sm text-fg-secondary">{policies.showSidebarBadges ? 'On' : 'Off'}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-fg">Waiver Questions &amp; Clauses</p>
                    <p className="mt-0.5 text-xs text-fg-secondary">
                      {waiverHealthQuestions.length} health question{waiverHealthQuestions.length === 1 ? '' : 's'},{' '}
                      {waiverClauses.length} clause{waiverClauses.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  {canEditPolicies && !editingWaiverList && (
                    <button
                      type="button"
                      onClick={() => setEditingWaiverList(true)}
                      className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {editingWaiverList && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-fg-secondary">Health screening questions</label>
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
                        <label className="text-sm font-medium text-fg-secondary">
                          Clauses (initialed individually)
                        </label>
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

                    {waiverListError && <p className="text-sm text-danger">{waiverListError}</p>}

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleWaiverListSave}
                        disabled={waiverListSaving}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {waiverListSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingWaiverList(false)
                          setWaiverHealthQuestions(policies.waiverHealthQuestions ?? [])
                          setWaiverClauses(policies.waiverClauses ?? [])
                          setWaiverListError(null)
                        }}
                        disabled={waiverListSaving}
                        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-fg">Message Templates</p>
                    <p className="mt-0.5 text-xs text-fg-secondary">
                      {messageTemplates.length} template{messageTemplates.length === 1 ? '' : 's'} &middot; available
                      in the conversation composer
                    </p>
                  </div>
                  {canEditPolicies && !editingTemplates && (
                    <button
                      type="button"
                      onClick={() => setEditingTemplates(true)}
                      className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {editingTemplates && (
                  <div className="mt-4 space-y-4">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={addTemplate}
                        className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg transition hover:bg-surface"
                      >
                        Add template
                      </button>
                    </div>

                    <div className="space-y-3">
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

                    {templatesError && <p className="text-sm text-danger">{templatesError}</p>}

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleTemplatesSave}
                        disabled={templatesSaving}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {templatesSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTemplates(false)
                          setMessageTemplates(policies.messageTemplates ?? [])
                          setTemplatesError(null)
                        }}
                        disabled={templatesSaving}
                        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {editingField && (
            <Modal
              title={`Edit ${POLICY_HTML_FIELDS.find((f) => f.key === editingField)?.label ?? ''}`}
              onClose={() => setEditingField(null)}
            >
              <RichTextEditor value={fieldDraft} onChange={setFieldDraft} />
              {fieldError && <p className="mt-3 text-sm text-danger">{fieldError}</p>}
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={handleFieldSave}
                  disabled={fieldSaving}
                  className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                >
                  {fieldSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingField(null)}
                  disabled={fieldSaving}
                  className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </Modal>
          )}

          {showDefaultsModal && (
            <Modal title="Edit Defaults" onClose={() => setShowDefaultsModal(false)}>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">
                    Estimate follow-up (hours)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={defaultsForm.estimateFollowUpHours}
                    onChange={(e) => setDefaultsForm({ ...defaultsForm, estimateFollowUpHours: e.target.value })}
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
                    value={defaultsForm.giftCardDefaultExpirationDays}
                    onChange={(e) =>
                      setDefaultsForm({ ...defaultsForm, giftCardDefaultExpirationDays: e.target.value })
                    }
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">
                    Cold lead after (days of no activity)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={defaultsForm.coldLeadDays}
                    onChange={(e) => setDefaultsForm({ ...defaultsForm, coldLeadDays: e.target.value })}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Timezone</label>
                  <select
                    value={defaultsForm.timezone}
                    onChange={(e) => setDefaultsForm({ ...defaultsForm, timezone: e.target.value })}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm text-fg-secondary">
                    <input
                      type="checkbox"
                      checked={defaultsForm.showSidebarBadges}
                      onChange={(e) => setDefaultsForm({ ...defaultsForm, showSidebarBadges: e.target.checked })}
                      className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                    />
                    Show new-item count badges on sidebar navigation
                  </label>
                  <p className="mt-1 text-xs text-fg-muted">
                    Off by default. Doesn't affect the conversations unread badge or the Tasks icon's count, both of
                    which always show.
                  </p>
                </div>

                {defaultsError && <p className="text-sm text-danger">{defaultsError}</p>}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleDefaultsSave}
                    disabled={defaultsSaving}
                    className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    {defaultsSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDefaultsModal(false)}
                    disabled={defaultsSaving}
                    className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Modal>
          )}

          {canViewSystem && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
              <h2 className="text-lg font-semibold text-fg">System</h2>
              <p className="mt-1 text-sm text-fg-secondary">
                These are automatic tasks that run every night to keep your data up to date.
              </p>

              {jobsError && <p className="mt-4 text-sm text-danger">{jobsError}</p>}
              {!jobsError && jobs === null && <p className="mt-4 text-sm text-fg-secondary">Loading…</p>}
              {!jobsError && jobs !== null && jobs.length === 0 && (
                <p className="mt-4 text-sm text-fg-secondary">No automatic tasks yet.</p>
              )}

              {jobs && jobs.length > 0 && (
                <ul className="mt-4 space-y-3">
                  {jobs.map((job) => {
                    const display = JOB_DISPLAY[job.jobName] ?? {
                      friendlyName: job.jobName,
                      plainDescription: job.description,
                    }
                    return (
                      <li key={job.jobName} className="rounded-xl border border-border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-fg">{display.friendlyName}</p>
                            <p className="mt-0.5 text-xs text-fg-secondary">{display.plainDescription}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRunNow(job.jobName)}
                            disabled={runningJob === job.jobName}
                            className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                          >
                            {runningJob === job.jobName ? 'Running…' : 'Run Now'}
                          </button>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <JobStatusDisplay lastRun={job.lastRun} />
                          {job.lastRun && (
                            <span
                              className="text-xs text-fg-muted"
                              title={formatDateTime(job.lastRun.startedAt)}
                            >
                              {formatRelativeDateTime(job.lastRun.startedAt, policies?.timezone ?? 'America/New_York')}
                            </span>
                          )}
                        </div>

                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg-secondary">
                            Advanced
                          </summary>
                          <p className="mt-1 text-xs text-fg-muted">
                            Internal name: {job.jobName} &middot; Schedule: {job.schedule}
                          </p>
                          {job.lastRun?.details && Object.keys(job.lastRun.details).length > 0 && (
                            <p className="mt-1 text-xs text-fg-muted">
                              Last run details: {JSON.stringify(job.lastRun.details)}
                            </p>
                          )}
                        </details>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function JobStatusDisplay({ lastRun }: { lastRun: JobRunInfo | null }) {
  if (!lastRun) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
        <ClockIcon className="h-4 w-4" />
        Not run yet
      </span>
    )
  }
  if (lastRun.status === 'RUNNING') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-info">
        <SpinnerIcon className="h-4 w-4 animate-spin" />
        Running…
      </span>
    )
  }
  if (lastRun.status === 'FAILED') {
    const reason = lastRun.error ? (lastRun.error.length > 80 ? `${lastRun.error.slice(0, 80)}…` : lastRun.error) : null
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-danger">
        <CloseIcon className="h-4 w-4" />
        Failed{reason ? ` — ${reason}` : ''}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-success">
      <CheckIcon className="h-4 w-4" />
      Succeeded
    </span>
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
