import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import SpecialtiesInput from '../components/SpecialtiesInput'
import { apiFetch, ApiError } from '../lib/api'
import { uploadPortfolioImage } from '../lib/cloudinary'
import { useUserProfile } from '../context/useUserProfile'
import { useAuth } from '../context/useAuth'
import { ArrowLeftIcon, CloseIcon } from '../components/icons'

interface ScheduleBlock {
  dayOfWeek: number
  startTime: string
  endTime: string
}

interface Artist {
  id: string
  bio: string | null
  specialties: string[]
  portfolioImages: string[]
  preferredSchedule: ScheduleBlock[] | null
  user: { id: string; email: string; name: string | null; phone: string | null; avatarUrl: string | null }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface UploadItem {
  id: string
  previewUrl: string
  status: 'uploading' | 'error'
  error?: string
}

// Every day disabled by default; enabling one seeds a sensible 9-5 block.
function defaultSchedule(): (ScheduleBlock | null)[] {
  return Array.from({ length: 7 }, () => null)
}

function scheduleToBlocks(days: (ScheduleBlock | null)[]): ScheduleBlock[] {
  return days.filter((day): day is ScheduleBlock => day !== null)
}

function blocksToDays(blocks: ScheduleBlock[] | null): (ScheduleBlock | null)[] {
  const days = defaultSchedule()
  for (const block of blocks ?? []) {
    if (block.dayOfWeek >= 0 && block.dayOfWeek <= 6) days[block.dayOfWeek] = block
  }
  return days
}

export default function ArtistDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const canManage = profile?.permissions.includes('artists.manage') ?? false

  const [artist, setArtist] = useState<Artist | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [bio, setBio] = useState('')
  const [specialties, setSpecialties] = useState<string[]>([])
  const [portfolioImages, setPortfolioImages] = useState<string[]>([])
  const [uploadingItems, setUploadingItems] = useState<UploadItem[]>([])

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [scheduleDays, setScheduleDays] = useState<(ScheduleBlock | null)[]>(defaultSchedule())
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleSuccess, setScheduleSuccess] = useState(false)

  useEffect(() => {
    if (!id) return

    let ignore = false

    async function load() {
      setArtist(null)
      setError(null)

      try {
        const data = await apiFetch<Artist>(`/artists/${id}`)
        if (!ignore) setArtist(data)
      } catch (err) {
        if (ignore) return

        if (err instanceof ApiError && err.status === 404) {
          setError('Artist not found.')
        } else if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view this artist.")
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load artist')
        }
      }
    }

    load()

    return () => {
      ignore = true
    }
  }, [id, refreshIndex])

  // Seeds the editable fields once per artist id (not on every refetch), so
  // an in-progress edit doesn't get clobbered. Adjusted during render per
  // React's guidance for resetting state when a prop changes.
  const [seededForId, setSeededForId] = useState<string | null>(null)
  if (artist && artist.id !== seededForId) {
    setSeededForId(artist.id)
    setBio(artist.bio ?? '')
    setSpecialties(artist.specialties)
    setPortfolioImages(artist.portfolioImages)
    setScheduleDays(blocksToDays(artist.preferredSchedule))
  }

  const canEditSchedule =
    !!artist && (user?.role === 'OWNER' || user?.role === 'FRONT_DESK' || artist.user.id === user?.userId)

  function toggleScheduleDay(dayOfWeek: number, enabled: boolean) {
    setScheduleDays((prev) => {
      const next = [...prev]
      next[dayOfWeek] = enabled ? { dayOfWeek, startTime: '09:00', endTime: '17:00' } : null
      return next
    })
  }

  function updateScheduleTime(dayOfWeek: number, field: 'startTime' | 'endTime', value: string) {
    setScheduleDays((prev) => {
      const next = [...prev]
      const day = next[dayOfWeek]
      if (day) next[dayOfWeek] = { ...day, [field]: value }
      return next
    })
  }

  async function handleSaveSchedule() {
    if (!id) return

    setScheduleSaving(true)
    setScheduleError(null)
    setScheduleSuccess(false)

    const blocks = scheduleToBlocks(scheduleDays)

    try {
      await apiFetch(`/artists/${id}/preferred-schedule`, {
        method: 'PATCH',
        body: JSON.stringify({ preferredSchedule: blocks.length > 0 ? blocks : null }),
      })

      setScheduleSuccess(true)
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Failed to save schedule')
    } finally {
      setScheduleSaving(false)
    }
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return

    const files = Array.from(fileList)
    const items = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }))

    setUploadingItems((prev) => [...prev, ...items.map(({ id, previewUrl }) => ({ id, previewUrl, status: 'uploading' as const }))])

    items.forEach(async ({ id: itemId, file }) => {
      try {
        const url = await uploadPortfolioImage(file)
        setPortfolioImages((prev) => [...prev, url])
        setUploadingItems((prev) => prev.filter((i) => i.id !== itemId))
      } catch (err) {
        setUploadingItems((prev) =>
          prev.map((i) =>
            i.id === itemId ? { ...i, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' } : i,
          ),
        )
      }
    })
  }

  function removeUploadingItem(itemId: string) {
    setUploadingItems((prev) => {
      const item = prev.find((i) => i.id === itemId)
      if (item) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((i) => i.id !== itemId)
    })
  }

  function removePortfolioImage(url: string) {
    setPortfolioImages((prev) => prev.filter((u) => u !== url))
  }

  async function handleSave() {
    if (!id) return

    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      await apiFetch(`/artists/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ bio: bio || null, specialties, portfolioImages }),
      })

      setSaveSuccess(true)
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  const isUploading = uploadingItems.some((i) => i.status === 'uploading')

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6 sm:px-10 sm:py-8">
          <Link
            to="/team?tab=artists"
            className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Artists
          </Link>

          {error && (
            <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {!error && !artist && <p className="mt-6 text-sm text-neutral-400">Loading artist…</p>}

          {!error && artist && (
            <>
              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <div className="flex items-center gap-4">
                  {artist.user.avatarUrl ? (
                    <img
                      src={artist.user.avatarUrl}
                      alt={artist.user.name ?? artist.user.email}
                      className="h-16 w-16 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xl font-semibold text-white">
                      {(artist.user.name ?? artist.user.email).slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <h1 className="text-xl font-bold text-white">{artist.user.name || artist.user.email}</h1>
                    <p className="mt-1 text-sm text-neutral-400">{artist.user.email}</p>
                    {artist.user.phone && <p className="text-sm text-neutral-400">{artist.user.phone}</p>}
                  </div>
                </div>
                {canManage && (
                  <p className="mt-3 text-xs text-neutral-500">
                    Profile picture is managed from{' '}
                    <Link to="/team" className="underline hover:text-neutral-300">
                      Team
                    </Link>
                    .
                  </p>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Bio</h2>
                {canManage ? (
                  <textarea
                    rows={4}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="A short bio about this artist…"
                    className="mt-3 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                  />
                ) : (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-300">{artist.bio || 'No bio yet.'}</p>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Specialties</h2>
                <div className="mt-3">
                  {canManage ? (
                    <SpecialtiesInput value={specialties} onChange={setSpecialties} />
                  ) : specialties.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {specialties.map((specialty) => (
                        <span
                          key={specialty}
                          className="inline-flex items-center rounded-full border border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-300"
                        >
                          {specialty}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-neutral-400">No specialties listed.</p>
                  )}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Preferred Schedule</h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Advisory availability only — doesn't block scheduling, just informs staff.
                </p>

                <div className="mt-4 space-y-2">
                  {DAY_NAMES.map((dayName, dayOfWeek) => {
                    const day = scheduleDays[dayOfWeek]
                    return (
                      <div
                        key={dayOfWeek}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 px-3 py-2"
                      >
                        <label className="flex w-32 shrink-0 items-center gap-2 text-sm text-neutral-300">
                          {canEditSchedule ? (
                            <input
                              type="checkbox"
                              checked={day !== null}
                              onChange={(e) => toggleScheduleDay(dayOfWeek, e.target.checked)}
                              className="h-4 w-4 rounded border-neutral-700 bg-neutral-900"
                            />
                          ) : null}
                          {dayName}
                        </label>

                        {day ? (
                          canEditSchedule ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="time"
                                value={day.startTime}
                                onChange={(e) => updateScheduleTime(dayOfWeek, 'startTime', e.target.value)}
                                className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                              />
                              <span className="text-neutral-500">to</span>
                              <input
                                type="time"
                                value={day.endTime}
                                onChange={(e) => updateScheduleTime(dayOfWeek, 'endTime', e.target.value)}
                                className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                              />
                            </div>
                          ) : (
                            <span className="text-sm text-neutral-400">
                              {day.startTime} – {day.endTime}
                            </span>
                          )
                        ) : (
                          <span className="text-sm text-neutral-500">Not available</span>
                        )}
                      </div>
                    )
                  })}
                </div>

                {canEditSchedule && (
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSaveSchedule}
                      disabled={scheduleSaving}
                      className="rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                    >
                      {scheduleSaving ? 'Saving…' : 'Save schedule'}
                    </button>
                    {scheduleError && <p className="text-sm text-red-400">{scheduleError}</p>}
                    {scheduleSuccess && !scheduleError && <p className="text-sm text-green-400">Saved.</p>}
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Portfolio</h2>

                {canManage && (
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      handleFiles(e.target.files)
                      e.target.value = ''
                    }}
                    className="mt-3 block w-full text-sm text-neutral-400 file:mr-3 file:rounded-full file:border file:border-neutral-700 file:bg-neutral-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-600"
                  />
                )}

                {portfolioImages.length === 0 && uploadingItems.length === 0 && (
                  <p className="mt-3 text-sm text-neutral-400">No portfolio images yet.</p>
                )}

                {(portfolioImages.length > 0 || uploadingItems.length > 0) && (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {portfolioImages.map((url) => (
                      <div key={url} className="group relative aspect-square overflow-hidden rounded-lg border border-neutral-800">
                        <img src={url} alt="" className="h-full w-full object-cover" />
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => removePortfolioImage(url)}
                            aria-label="Remove image"
                            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100 hover:bg-black/80"
                          >
                            <CloseIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {uploadingItems.map((item) => (
                      <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg border border-neutral-800">
                        <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                        {item.status === 'uploading' && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white">
                            Uploading…
                          </div>
                        )}
                        {item.status === 'error' && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-950/80 p-1 text-center text-[10px] text-red-300">
                            {item.error ?? 'Upload failed'}
                            <button
                              type="button"
                              onClick={() => removeUploadingItem(item.id)}
                              className="rounded-full border border-red-800 px-2 py-0.5 text-[10px] text-red-200 hover:bg-red-900"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canManage && (
                <div className="mt-6 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || isUploading}
                    className="rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  {saveError && <p className="text-sm text-red-400">{saveError}</p>}
                  {saveSuccess && !saveError && <p className="text-sm text-green-400">Saved.</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
