import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'

// 6a Epic Part 4: the artist's own public page, reached only via
// Artist.publicSlug -- never studio-themed (this is the ARTIST's page, not
// any one studio's), so the whole page wraps in .login-shell, the same
// "fixed platform identity regardless of the active studio preset" class
// Login/Signup already establish (see index.css's own .login-shell
// comment) -- a visiting browser stuck on some studio's own [data-theme]
// from an earlier session never leaks through here.
interface StudioSummary {
  id: string
  name: string
  slug: string
}

interface UpcomingResidency {
  studio: StudioSummary
  startDate: string
  endDate: string
}

interface ArtistPublicProfile {
  id: string
  name: string
  avatarUrl: string | null
  bio: string | null
  specialties: string[]
  publicSlug: string
  homeStudio: StudioSummary
  upcomingResidencies: UpcomingResidency[]
}

type PageState = 'loading' | 'not-found' | 'ready'

function formatDateRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return `${fmt(startIso)} – ${fmt(endIso)}`
}

export default function ArtistPublicPage() {
  const { publicSlug } = useParams<{ publicSlug: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<PageState>('loading')
  const [profile, setProfile] = useState<ArtistPublicProfile | null>(null)
  const [showBookPicker, setShowBookPicker] = useState(false)

  useEffect(() => {
    if (!publicSlug) return
    let ignore = false
    apiFetch<ArtistPublicProfile>(`/artists/public/${publicSlug}`)
      .then((data) => {
        if (!ignore) {
          setProfile(data)
          setState('ready')
        }
      })
      .catch(() => {
        // Unpublished, missing slug, or any other failure all read
        // identically here -- never leak WHY, same as the API's own 404.
        if (!ignore) setState('not-found')
      })
    return () => {
      ignore = true
    }
  }, [publicSlug])

  function bookAt(studio: StudioSummary) {
    if (!profile) return
    // Location-first: everything downstream belongs to THIS studio -- its
    // own intake form, pipeline, policies, payments. Reuses the existing
    // public intake route entirely; bookingArtistId (read by IntakeForm.tsx)
    // is the one new piece of glue, not a new pipeline.
    navigate(`/inquiry/${studio.slug}?bookingArtistId=${encodeURIComponent(profile.id)}`)
  }

  if (state === 'loading') {
    return (
      <div className="login-shell flex min-h-screen items-center justify-center bg-bg">
        <p className="text-sm text-fg-muted">Loading…</p>
      </div>
    )
  }

  if (state === 'not-found' || !profile) {
    return (
      <div className="login-shell flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="login-panel-surface max-w-sm p-8 text-center">
          <p className="text-lg font-semibold text-fg">This page isn't available.</p>
          <p className="mt-2 text-sm text-fg-muted">
            The artist may not have published a page here, or the link is out of date.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="login-shell min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:py-24">
        <div className="flex flex-col items-center text-center">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={profile.name}
              className="h-32 w-32 rounded-full border border-border-strong object-cover"
            />
          ) : (
            <div className="flex h-32 w-32 items-center justify-center rounded-full border border-border-strong bg-surface text-4xl font-semibold text-fg">
              {profile.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <h1 className="login-jura mt-6 text-2xl font-bold tracking-wide text-fg sm:text-3xl">{profile.name}</h1>

          {profile.specialties.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {profile.specialties.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-wide text-fg-secondary"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {profile.bio && <p className="mt-6 max-w-lg text-sm leading-relaxed text-fg-secondary">{profile.bio}</p>}
        </div>

        <div className="login-panel-surface mt-12 p-6">
          <p className="login-jura text-xs font-bold uppercase tracking-[0.14em] text-fg-muted">Where to find me</p>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-fg">{profile.homeStudio.name}</p>
                <p className="text-xs text-fg-muted">Home studio</p>
              </div>
            </div>
            {profile.upcomingResidencies.map((r) => (
              <div
                key={`${r.studio.id}-${r.startDate}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-fg">{r.studio.name}</p>
                  <p className="text-xs text-fg-muted">Guest residency · {formatDateRange(r.startDate, r.endDate)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setShowBookPicker(true)}
            className="login-button login-jura flex-1 px-6 py-3 text-sm font-bold uppercase"
          >
            Book
          </button>
          <a
            href={`/flash/${profile.homeStudio.slug}/${profile.id}`}
            className="login-jura flex-1 rounded-none border border-border-strong px-6 py-3 text-center text-sm font-bold uppercase tracking-wide text-fg transition hover:bg-surface"
          >
            Flash
          </a>
        </div>

        {showBookPicker && (
          <div className="login-panel-surface mt-6 p-5">
            <p className="text-sm font-medium text-fg">Where would you like to book?</p>
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => bookAt(profile.homeStudio)}
                className="w-full rounded-lg border border-border px-4 py-3 text-left text-sm text-fg transition hover:border-accent"
              >
                {profile.homeStudio.name} <span className="text-fg-muted">(home studio)</span>
              </button>
              {profile.upcomingResidencies.map((r) => (
                <button
                  key={`${r.studio.id}-${r.startDate}`}
                  type="button"
                  onClick={() => bookAt(r.studio)}
                  className="w-full rounded-lg border border-border px-4 py-3 text-left text-sm text-fg transition hover:border-accent"
                >
                  {r.studio.name} <span className="text-fg-muted">· {formatDateRange(r.startDate, r.endDate)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
