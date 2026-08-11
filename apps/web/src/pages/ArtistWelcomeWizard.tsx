import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { apiFetch } from '../lib/api'
import { uploadPortfolioImage } from '../lib/cloudinary'
import { useUserProfile } from '../context/useUserProfile'
import SpecialtiesInput from '../components/SpecialtiesInput'
import ImageUploadSection, { type ImageUploadState } from '../components/ImageUploadSection'
import ScheduleEditor, {
  defaultScheduleDays,
  scheduleDaysToBlocks,
  scheduleBlocksToDays,
  type ScheduleBlock,
} from '../components/ScheduleEditor'
import { InstagramIcon, FacebookIcon, EmailIcon, SparkleIcon } from '../components/icons'
import { crossfadeVariants, uiSpringTransition } from '../lib/motion'

interface ServiceOption {
  id: string
  name: string
  isActive: boolean
}

interface ArtistFull {
  id: string
  bio: string | null
  specialties: string[]
  portfolioImages: string[]
  instagramHandle: string | null
  facebookProfileUrl: string | null
  publicContactEmail: string | null
  hourlyRateCents: number | null
  flatRateCents: number | null
  schedulingBufferMinutes: number | null
  preferredSchedule: ScheduleBlock[] | null
  artistServices: { serviceId: string }[]
}

// 'schedule' saves through PATCH /:id/preferred-schedule -- a separate,
// dedicated route (see that route's own comment: self-scoped for ARTIST
// regardless of allowsStudioProfileEdits, same self-service carve-out as
// the main PATCH /:id route's own profile fields), not the general
// PATCH /:id every other step uses. ArtistCreate.tsx already treats
// preferred schedule as part of "everything a new artist profile needs" --
// this step exists so the wizard doesn't leave that one field out.
const STEPS = ['bio', 'portfolio', 'schedule', 'business', 'done'] as const
type Step = (typeof STEPS)[number]

// Full-screen, first-run wizard for a brand new artist profile -- eligibility
// (Artist.profileSetupCompletedAt null) and the redirect into this page both
// live in ProtectedRoute, not here. Every step is optional and saves
// immediately on Continue via the SAME route ArtistDetail.tsx's own self-edit
// already uses (PATCH /artists/:id) -- no parallel wizard-only mutation path.
// Only an explicit "I'll do this later"/"Go to my dashboard" stamps
// profileSetupCompletedAt; navigating away mid-wizard (closed tab, back
// button) leaves it null so the redirect brings them right back here next
// login, resuming with whatever was already saved.
export default function ArtistWelcomeWizard() {
  const { profile, refresh } = useUserProfile()
  const navigate = useNavigate()
  const artistId = profile?.artist?.id

  const [stepIndex, setStepIndex] = useState(0)
  const step = STEPS[stepIndex]

  const [loaded, setLoaded] = useState(false)
  const [bio, setBio] = useState('')
  const [specialties, setSpecialties] = useState<string[]>([])
  const [portfolioImages, setPortfolioImages] = useState<string[]>([])
  const [portfolioUploading, setPortfolioUploading] = useState(false)
  const [instagramHandle, setInstagramHandle] = useState('')
  const [facebookProfileUrl, setFacebookProfileUrl] = useState('')
  const [publicContactEmail, setPublicContactEmail] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [flatRate, setFlatRate] = useState('')
  const [schedulingBufferMinutes, setSchedulingBufferMinutes] = useState('')
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([])
  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [scheduleDays, setScheduleDays] = useState(defaultScheduleDays())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seeded from GET /artists/:id (the full record), not the trimmed
  // GET /users/me shape UserProfile carries -- that only has bio/specialties,
  // not portfolio/social/rates/buffer/services, so resuming a partially-
  // completed wizard needs its own fetch to prefill everything already saved.
  useEffect(() => {
    if (!artistId) return
    let ignore = false

    Promise.all([apiFetch<ArtistFull>(`/artists/${artistId}`), apiFetch<ServiceOption[]>('/services')])
      .then(([artist, services]) => {
        if (ignore) return
        setBio(artist.bio ?? '')
        setSpecialties(artist.specialties)
        setPortfolioImages(artist.portfolioImages)
        setInstagramHandle(artist.instagramHandle ?? '')
        setFacebookProfileUrl(artist.facebookProfileUrl ?? '')
        setPublicContactEmail(artist.publicContactEmail ?? '')
        setHourlyRate(artist.hourlyRateCents != null ? (artist.hourlyRateCents / 100).toString() : '')
        setFlatRate(artist.flatRateCents != null ? (artist.flatRateCents / 100).toString() : '')
        setSchedulingBufferMinutes(
          artist.schedulingBufferMinutes != null ? artist.schedulingBufferMinutes.toString() : '',
        )
        setServiceOptions(services)
        setServiceIds(artist.artistServices.map((s) => s.serviceId))
        setScheduleDays(scheduleBlocksToDays(artist.preferredSchedule))
        setLoaded(true)
      })
      .catch(() => {
        // Nothing saved yet to prefill -- the wizard still works fine empty.
        if (!ignore) setLoaded(true)
      })

    return () => {
      ignore = true
    }
  }, [artistId])

  function toggleService(id: string) {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  function fieldsForStep(currentStep: Step): Record<string, unknown> {
    switch (currentStep) {
      case 'bio':
        return { bio: bio.trim() || null, specialties }
      case 'portfolio':
        return {
          portfolioImages,
          instagramHandle: instagramHandle.trim() || null,
          facebookProfileUrl: facebookProfileUrl.trim() || null,
          publicContactEmail: publicContactEmail.trim() || null,
        }
      case 'business':
        return {
          hourlyRateCents: hourlyRate ? Math.round(Number(hourlyRate) * 100) : null,
          flatRateCents: flatRate ? Math.round(Number(flatRate) * 100) : null,
          schedulingBufferMinutes: schedulingBufferMinutes ? Math.round(Number(schedulingBufferMinutes)) : null,
          serviceIds,
        }
      default:
        return {}
    }
  }

  async function patchArtist(data: Record<string, unknown>) {
    if (!artistId) return
    await apiFetch(`/artists/${artistId}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  // 'schedule' is the one step that doesn't go through the general
  // PATCH /:id -- that route doesn't accept preferredSchedule at all (see
  // ArtistFull/STEPS' own comment), it's PATCH /:id/preferred-schedule.
  async function saveStep(currentStep: Step) {
    if (!artistId) return
    if (currentStep === 'schedule') {
      const blocks = scheduleDaysToBlocks(scheduleDays)
      await apiFetch(`/artists/${artistId}/preferred-schedule`, {
        method: 'PATCH',
        body: JSON.stringify({ preferredSchedule: blocks.length > 0 ? blocks : null }),
      })
      return
    }
    const fields = fieldsForStep(currentStep)
    if (Object.keys(fields).length > 0) await patchArtist(fields)
  }

  async function handleContinue() {
    setError(null)
    setSaving(true)
    try {
      await saveStep(step)
      setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save -- try again.')
    } finally {
      setSaving(false)
    }
  }

  async function finishWizard(includeCurrentStepFields: boolean) {
    setError(null)
    setSaving(true)
    try {
      if (includeCurrentStepFields) await saveStep(step)
      await patchArtist({ profileSetupCompletedAt: true })
      await refresh()
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish setup -- try again.')
      setSaving(false)
    }
  }

  if (!profile?.artist || !loaded) {
    return <div className="min-h-screen bg-bg" />
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4 py-12">
      <div className="relative z-10 w-full max-w-xl">
        <div className="mb-6 flex items-center justify-center gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={[
                'h-1.5 rounded-full transition-all',
                i === stepIndex ? 'w-8 bg-accent' : i < stepIndex ? 'w-1.5 bg-accent/60' : 'w-1.5 bg-border',
              ].join(' ')}
            />
          ))}
        </div>

        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={step}
            variants={crossfadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={uiSpringTransition}
            className="rounded-2xl card-surface border border-border bg-surface p-8"
          >
            {step === 'bio' && (
              <div>
                <SparkleIcon className="h-6 w-6 text-accent" />
                <h1 className="mt-3 text-xl font-bold text-fg">Welcome! Let's set up your artist profile.</h1>
                <p className="mt-1 text-sm text-fg-secondary">
                  A bio and a few specialties help clients (and your studio) get to know your work. Every step here
                  is optional -- fill in what you'd like, skip the rest for now.
                </p>

                <div className="mt-6">
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Bio</label>
                  <textarea
                    rows={4}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="A short bio about you and your work…"
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mt-4">
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Specialties</label>
                  <SpecialtiesInput value={specialties} onChange={setSpecialties} />
                </div>
              </div>
            )}

            {step === 'portfolio' && (
              <div>
                <h1 className="text-xl font-bold text-fg">Portfolio & social</h1>
                <p className="mt-1 text-sm text-fg-secondary">
                  A few pieces of your work go a long way. Add your socials so clients can find more.
                </p>

                <div className="mt-6">
                  <ImageUploadSection
                    label="Portfolio"
                    hint="Upload a few photos of your work."
                    initialUrls={portfolioImages}
                    uploadFn={uploadPortfolioImage}
                    onChange={(state: ImageUploadState) => {
                      setPortfolioImages(state.urls)
                      setPortfolioUploading(state.uploading)
                    }}
                  />
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">Instagram handle</label>
                    <div className="flex items-center gap-2">
                      <InstagramIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                      <input
                        type="text"
                        value={instagramHandle}
                        onChange={(e) => setInstagramHandle(e.target.value)}
                        placeholder="yourhandle"
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">Facebook profile URL</label>
                    <div className="flex items-center gap-2">
                      <FacebookIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                      <input
                        type="text"
                        value={facebookProfileUrl}
                        onChange={(e) => setFacebookProfileUrl(e.target.value)}
                        placeholder="https://facebook.com/yourname"
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">Public contact email</label>
                    <p className="mb-1 text-xs text-fg-muted">
                      Optional -- shown to clients on your public page. Separate from your login email, which is
                      never shown publicly.
                    </p>
                    <div className="flex items-center gap-2">
                      <EmailIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                      <input
                        type="email"
                        value={publicContactEmail}
                        onChange={(e) => setPublicContactEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 'schedule' && (
              <div>
                <h1 className="text-xl font-bold text-fg">Working hours</h1>
                <p className="mt-1 text-sm text-fg-secondary">
                  Advisory availability only -- doesn't block scheduling, just informs staff.
                </p>

                <div className="mt-6">
                  <ScheduleEditor days={scheduleDays} onChange={setScheduleDays} editable />
                </div>
              </div>
            )}

            {step === 'business' && (
              <div>
                <h1 className="text-xl font-bold text-fg">Rates & services</h1>
                <p className="mt-1 text-sm text-fg-secondary">
                  Set your rates, scheduling buffer, and which of your studio's services you offer.
                </p>

                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">Hourly rate</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">
                        $
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={hourlyRate}
                        onChange={(e) => setHourlyRate(e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded-lg border border-border bg-surface-inset py-2 pl-7 pr-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-muted">
                        /hr
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">Flat rate</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">
                        $
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={flatRate}
                        onChange={(e) => setFlatRate(e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded-lg border border-border bg-surface-inset py-2 pl-7 pr-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 max-w-[12rem]">
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Buffer (minutes)</label>
                  <input
                    type="number"
                    min="0"
                    value={schedulingBufferMinutes}
                    onChange={(e) => setSchedulingBufferMinutes(e.target.value)}
                    placeholder="Studio default"
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mt-4">
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Services offered</label>
                  {serviceOptions.length > 0 ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {serviceOptions
                        .filter((s) => s.isActive || serviceIds.includes(s.id))
                        .map((s) => (
                          <label key={s.id} className="flex items-center gap-2 text-sm text-fg-secondary">
                            <input
                              type="checkbox"
                              checked={serviceIds.includes(s.id)}
                              onChange={() => toggleService(s.id)}
                              className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                            />
                            {s.name}
                            {!s.isActive && <span className="text-xs text-fg-muted">(inactive)</span>}
                          </label>
                        ))}
                    </div>
                  ) : (
                    <p className="text-sm text-fg-secondary">No services configured yet.</p>
                  )}
                </div>
              </div>
            )}

            {step === 'done' && (
              <div className="text-center">
                <SparkleIcon className="mx-auto h-6 w-6 text-accent" />
                <h1 className="mt-3 text-xl font-bold text-fg">You're all set.</h1>
                <p className="mt-1 text-sm text-fg-secondary">
                  Your profile is ready. You can always come back and update it from your artist profile page.
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {error && <p className="mt-4 text-center text-sm text-danger">{error}</p>}

        {step !== 'done' ? (
          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => finishWizard(true)}
              disabled={saving}
              className="text-sm font-medium text-fg-secondary transition hover:text-fg disabled:opacity-60"
            >
              I'll do this later
            </button>
            <button
              type="button"
              onClick={handleContinue}
              disabled={saving || portfolioUploading}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Continue'}
            </button>
          </div>
        ) : (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => finishWizard(false)}
              disabled={saving}
              className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {saving ? 'Finishing…' : 'Go to my dashboard'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
