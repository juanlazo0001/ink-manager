import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import Sidebar from '../components/Sidebar'
import { apiFetch } from '../lib/api'
import { formatPhoneInput, readFileAsDataUrl, MAX_IMAGE_FILE_BYTES } from '../lib/format'
import { useStudio } from '../context/useStudio'
import { useUserProfile } from '../context/useUserProfile'

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
  const canManageStudio = profile?.permissions.includes('studio.manage') ?? false
  const canManageLocations = profile?.permissions.includes('locations.manage') ?? false

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
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6 sm:px-10 sm:py-8">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Studio account</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {canManageStudio ? 'Manage your studio profile and branding.' : 'Your studio profile.'}
          </p>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            {loading && !studio && <p className="text-sm text-neutral-400">Loading studio…</p>}

            {!loading && !studio && <p className="text-sm text-red-400">Could not load studio information.</p>}

            {success && (
              <div className="mb-4 rounded-lg border border-green-900 bg-green-950/40 px-3 py-2 text-sm text-green-400">
                Studio profile updated.
              </div>
            )}

            {studio && !editing && (
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  {studio.logoUrl ? (
                    <img src={studio.logoUrl} alt={studio.name} className="h-14 w-auto rounded-lg" />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-neutral-800 text-xs text-neutral-500">
                      No logo
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-white">{studio.name}</p>
                    {studio.website && <p className="mt-1 text-xs text-neutral-400">{studio.website}</p>}
                    {!canManageStudio && (
                      <p className="mt-2 text-xs text-neutral-500">You don't have permission to edit this.</p>
                    )}
                  </div>
                </div>

                {canManageStudio && (
                  <button
                    type="button"
                    onClick={handleEdit}
                    className="shrink-0 rounded-full border border-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
                  >
                    Edit
                  </button>
                )}
              </div>
            )}

            {studio && canManageStudio && editing && (
              <form onSubmit={handleSubmit}>
                {error && (
                  <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                    {error}
                  </div>
                )}

                <div className="mb-5">
                  <label htmlFor="studioName" className="mb-1 block text-sm font-medium text-neutral-300">
                    Studio name
                  </label>
                  <input
                    id="studioName"
                    type="text"
                    required
                    value={form.name}
                    onChange={updateField('name')}
                    className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                  />
                </div>

                <div className="mb-5">
                  <label htmlFor="studioWebsite" className="mb-1 block text-sm font-medium text-neutral-300">
                    Website
                  </label>
                  <input
                    id="studioWebsite"
                    type="text"
                    placeholder="https://yourstudio.com"
                    value={form.website}
                    onChange={updateField('website')}
                    className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                  />
                </div>

                <div className="mb-5">
                  <span className="mb-1 block text-sm font-medium text-neutral-300">Logo</span>
                  <p className="mb-3 text-xs text-neutral-500">
                    Shown at the top of your studio's portal in place of the Ink Manager logo.
                  </p>

                  <div className="flex items-center gap-4">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Studio logo preview" className="h-14 w-auto rounded-lg" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-neutral-800 text-xs text-neutral-500">
                        No logo
                      </div>
                    )}

                    <label className="cursor-pointer rounded-full border border-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800">
                      {logoUrl ? 'Change logo' : 'Upload logo'}
                      <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
                    </label>

                    {logoUrl && (
                      <button
                        type="button"
                        onClick={() => setLogoUrl(null)}
                        className="text-sm font-medium text-neutral-400 transition hover:text-white"
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
                    className="flex-1 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
                  >
                    {submitting ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={submitting}
                    className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          {studio && (
            <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Locations</h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    {canManageLocations ? 'Every shop location, its hours, and how to reach it.' : 'Where to find us.'}
                  </p>
                </div>

                {canManageLocations && editingLocationId === null && (
                  <button
                    type="button"
                    onClick={handleAddLocation}
                    className="shrink-0 rounded-full border border-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
                  >
                    Add location
                  </button>
                )}
              </div>

              {locationsError && (
                <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                  {locationsError}
                </div>
              )}

              {locations === null && !locationsError && (
                <p className="mt-4 text-sm text-neutral-400">Loading locations…</p>
              )}

              {locations !== null && locations.length === 0 && editingLocationId !== 'new' && (
                <p className="mt-4 text-sm text-neutral-400">
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
    <div className="rounded-xl border border-neutral-800 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-white">{location.name}</p>
          {location.address && (
            <a
              href={googleMapsUrl(location.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block text-xs text-neutral-400 underline decoration-neutral-600 underline-offset-2 hover:text-white"
            >
              {location.address}
            </a>
          )}
          {location.phone && <p className="mt-1 text-xs text-neutral-400">{location.phone}</p>}
          {location.email && <p className="mt-1 text-xs text-neutral-400">{location.email}</p>}
        </div>

        {canManage && !confirmingDelete && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDeleteClick}
              className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
            >
              Delete
            </button>
          </div>
        )}

        {canManage && confirmingDelete && (
          <div className="flex shrink-0 items-center gap-2 text-xs">
            <span className="text-neutral-400">Delete this location?</span>
            <button
              type="button"
              onClick={onDeleteConfirm}
              className="rounded-full border border-red-900 bg-red-950/40 px-3 py-1.5 font-medium text-red-400 transition hover:bg-red-950/70"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onDeleteCancel}
              className="rounded-full border border-neutral-700 px-3 py-1.5 font-medium text-white transition hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {summary && (
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-neutral-800 pt-3 sm:grid-cols-4">
          {summary.map((day) => (
            <div key={day.label} className="text-xs">
              <span className="text-neutral-500">{day.label} </span>
              <span className="text-neutral-300">{day.text}</span>
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
    <form onSubmit={onSubmit} className="rounded-xl border border-neutral-700 bg-neutral-900 p-4">
      {error && (
        <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="locationName" className="mb-1 block text-sm font-medium text-neutral-300">
          Location name
        </label>
        <input
          id="locationName"
          type="text"
          required
          placeholder="Downtown"
          value={form.name}
          onChange={onFieldChange('name')}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
        />
      </div>

      <div className="mb-4">
        <label htmlFor="locationAddress" className="mb-1 block text-sm font-medium text-neutral-300">
          Address
        </label>
        <textarea
          id="locationAddress"
          rows={2}
          placeholder="123 Main St, Suite 2, Portland, OR 97201"
          value={form.address}
          onChange={onFieldChange('address')}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="locationPhone" className="mb-1 block text-sm font-medium text-neutral-300">
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
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
          />
        </div>

        <div>
          <label htmlFor="locationEmail" className="mb-1 block text-sm font-medium text-neutral-300">
            Contact email
          </label>
          <input
            id="locationEmail"
            type="email"
            placeholder="hello@yourstudio.com"
            value={form.email}
            onChange={onFieldChange('email')}
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
          />
        </div>
      </div>

      <div className="mb-4">
        <span className="mb-2 block text-sm font-medium text-neutral-300">Hours</span>
        <div className="space-y-2">
          {form.hours.map((day) => (
            <div key={day.day} className="flex flex-wrap items-center gap-2">
              <span className="w-9 text-xs font-medium text-neutral-400">{DAY_LABELS[day.day]}</span>
              <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  checked={day.closed}
                  onChange={(event) => onHoursChange(day.day, { closed: event.target.checked })}
                  className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-900"
                />
                Closed
              </label>
              <input
                type="time"
                value={day.open ?? ''}
                disabled={day.closed}
                onChange={(event) => onHoursChange(day.day, { open: event.target.value })}
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600 disabled:opacity-40"
              />
              <span className="text-xs text-neutral-500">to</span>
              <input
                type="time"
                value={day.close ?? ''}
                disabled={day.closed}
                onChange={(event) => onHoursChange(day.day, { close: event.target.value })}
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600 disabled:opacity-40"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save location'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
