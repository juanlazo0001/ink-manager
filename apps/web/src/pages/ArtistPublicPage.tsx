import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { buildMapsUrl } from '../lib/maps'
import { dateLocale } from '../i18n/locales'
import { LocaleProvider, useLocale, useTranslations } from '../i18n'
import LanguagePicker from '../i18n/LanguagePicker'
import {
  ArrowRightIcon,
  ChevronDownIcon,
  FacebookIcon,
  InstagramIcon,
  MapPinIcon,
  SparkleIcon,
  StudioMarkIcon,
} from '../components/icons'

// Artist public page v2: the artist's own public page, reached only via
// Artist.publicSlug -- never studio-themed (this is the ARTIST's page, not
// any one studio's), so the whole page wraps in .login-shell, the same
// "fixed platform identity regardless of the active studio preset" class
// Login/Signup/Deposit/Flash already establish. Rebuilt to match the v2
// mockup's structure (see REPORT.md for the design plan); publish gating,
// token behavior, and OG behavior are all untouched -- this is a visual
// rebuild of an already-working page, not new plumbing.
interface StudioSummary {
  id: string
  name: string
  slug: string
  // Best-effort, single-location-only resolution (server-side) -- null for
  // a multi-location studio with no unambiguous signal to pick one, same
  // "omit rather than guess wrong" rule the deposit confirmation card uses.
  address: string | null
  // Real fetchable URL via publicAssets, or null when the studio has no
  // logo on file -- StudioMarkIcon (a generic mark, never a hardcoded
  // stand-in) covers that case below.
  logoUrl: string | null
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
  instagramHandle: string | null
  facebookProfileUrl: string | null
  backgroundImageUrl: string | null
  resolvedLocale?: string
}

type PageState = 'loading' | 'not-found' | 'ready'

export default function ArtistPublicPage() {
  return (
    <LocaleProvider>
      <ArtistPublicPageContent />
    </LocaleProvider>
  )
}

function ArtistPublicPageContent() {
  const { t } = useTranslations()
  const { locale, setLocale } = useLocale()
  const { publicSlug } = useParams<{ publicSlug: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<PageState>('loading')
  const [profile, setProfile] = useState<ArtistPublicProfile | null>(null)
  const [showBookPicker, setShowBookPicker] = useState(false)
  const [expandedStudioId, setExpandedStudioId] = useState<string | null>(null)

  // No re-fetch-on-locale-toggle effect here, deliberately -- unlike
  // Estimate/Deposit/Waiver, this page has no server-resolved,
  // locale-dependent content beyond the initial resolvedLocale sync below
  // (the artist's own name/bio/specialties/studio names are never
  // machine-translated, same as every other page's studio-authored
  // content), so there's nothing a second fetch would actually change --
  // same reasoning as EstimateRevisionResponse.tsx's identical comment.
  useEffect(() => {
    if (!publicSlug) return
    let ignore = false
    apiFetch<ArtistPublicProfile>(`/artists/public/${publicSlug}`)
      .then((data) => {
        if (ignore) return
        setProfile(data)
        setState('ready')
        if (data.resolvedLocale && data.resolvedLocale !== locale) setLocale(data.resolvedLocale as typeof locale)
      })
      .catch(() => {
        // Unpublished, missing slug, or any other failure all read
        // identically here -- never leak WHY, same as the API's own 404.
        if (!ignore) setState('not-found')
      })
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicSlug])

  function bookAt(studio: StudioSummary) {
    if (!profile) return
    // Location-first: everything downstream belongs to THIS studio -- its
    // own intake form, pipeline, policies, payments. Reuses the existing
    // public intake route entirely; bookingArtistId (read by IntakeForm.tsx)
    // is the one new piece of glue, not a new pipeline. Same destination
    // this page has always used -- restyle only, per this task's own scope.
    navigate(`/inquiry/${studio.slug}?bookingArtistId=${encodeURIComponent(profile.id)}`)
  }

  function formatDateRange(startIso: string, endIso: string): string {
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString(dateLocale(locale), { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    return `${fmt(startIso)} – ${fmt(endIso)}`
  }

  if (state === 'loading') {
    return (
      <div className="login-shell flex min-h-screen items-center justify-center text-fg">
        <p className="text-sm text-fg-muted">{t('common.loading')}</p>
      </div>
    )
  }

  if (state === 'not-found' || !profile) {
    return (
      <div className="login-shell flex min-h-screen items-center justify-center px-4 text-fg">
        <div className="login-panel-surface max-w-sm px-4 py-8 text-center sm:p-8">
          <h1 className="login-jura text-lg font-semibold text-fg">{t('artistPublic.notFoundHeading')}</h1>
          <p className="mt-2 text-sm text-fg-muted">{t('artistPublic.notFoundBody')}</p>
        </div>
      </div>
    )
  }

  const socials: { key: string; href: string; Icon: typeof InstagramIcon; label: string }[] = []
  if (profile.instagramHandle) {
    socials.push({
      key: 'instagram',
      href: `https://instagram.com/${profile.instagramHandle.replace(/^@/, '')}`,
      Icon: InstagramIcon,
      label: 'Instagram',
    })
  }
  if (profile.facebookProfileUrl) {
    socials.push({ key: 'facebook', href: profile.facebookProfileUrl, Icon: FacebookIcon, label: 'Facebook' })
  }

  return (
    <div className="login-shell relative min-h-screen text-fg">
      {/* Ambient background: the artist's own portfolio/flash imagery,
          pre-processed server-side (heavy blur via a Cloudinary transform --
          see publicAssets.ts's own ARTIST_AMBIENT_BACKGROUND_TRANSFORM
          comment) rather than a live CSS filter, then portaled to
          document.body -- backdrop-filter/transform ancestors elsewhere in
          the tree would otherwise clip a `position: fixed` layer to their
          own box instead of the viewport (see PaymentConfirmationStage's
          identical comment). .payment-bg-wash (not .app-bg-wash) for the
          heavier 80% scrim -- see that class's own comment for why an
          entire page's worth of live text on top needs the photo to read
          as pure texture, not the app-shell's lighter ambient treatment.
          Absent entirely (not swapped for a stand-in photo) when the
          artist has no portfolio/flash images -- the plain --color-bg
          ink-black IS the platform editorial background in that case, same
          as Login/Deposit's own no-personalization default. */}
      {profile.backgroundImageUrl &&
        createPortal(
          <>
            <img src={profile.backgroundImageUrl} alt="" aria-hidden="true" className="app-bg-photo" />
            <span className="payment-bg-wash" aria-hidden="true" />
          </>,
          document.body,
        )}

      <div className="relative z-10 mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16 lg:max-w-5xl lg:py-20">
        <div className="flex justify-end">
          <LanguagePicker />
        </div>

        {/* Header: name/pills/bio stack beside the portrait from the sm
            breakpoint up -- at true 390px this stacks (portrait first,
            centered) rather than cramming a ~240px portrait next to
            Fraunces display type, which the mockup's own wider reference
            frame doesn't have to solve for. */}
        <div className="mt-6 flex flex-col-reverse items-center gap-8 sm:mt-4 sm:flex-row sm:items-start sm:justify-between sm:gap-10 lg:gap-16">
          <div className="w-full text-center sm:text-left">
            <p className="login-jura inline-flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.32em] text-accent">
              {t('artistPublic.eyebrow')}
              <span className="text-danger-strong" aria-hidden="true">
                +
              </span>
            </p>

            <h1 className="font-display mt-3 text-5xl font-medium leading-[0.95] text-fg sm:text-6xl lg:text-7xl">
              {profile.name}
            </h1>

            {profile.specialties.length > 0 && (
              <div className="mt-5 flex flex-wrap justify-center gap-2.5 sm:justify-start">
                {profile.specialties.map((s) => (
                  <span
                    key={s}
                    className="login-jura rounded-full border border-border-strong px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-secondary"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}

            {profile.bio && (
              <div className="mx-auto mt-5 max-w-md sm:mx-0">
                <span className="text-danger-strong text-sm" aria-hidden="true">
                  +
                </span>
                <p className="mt-1 text-sm leading-relaxed text-fg-secondary">{profile.bio}</p>
              </div>
            )}
          </div>

          {/* Arch portrait: rounded-t-full + a modest bottom radius reads
              as the mockup's stadium/arch shape at any size, no fixed-px
              border-radius hack needed. Double ring (a wide, very faint
              outer line + a tighter, brighter inner one) rather than one
              border, matching the mockup's own layered-frame look. */}
          <div className="relative shrink-0">
            <div className="absolute -inset-3 rounded-t-full rounded-b-[2.5rem] border border-accent/25" aria-hidden="true" />
            <div className="relative h-72 w-56 overflow-hidden rounded-t-full rounded-b-[2.25rem] border border-accent/70 sm:h-80 sm:w-60 lg:h-96 lg:w-72">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt={profile.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-surface">
                  <span className="font-display text-6xl font-medium text-fg-muted">{profile.name.slice(0, 1).toUpperCase()}</span>
                </div>
              )}
            </div>
            <span
              className="absolute -bottom-3 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full bg-danger-strong text-fg shadow-lg"
              aria-hidden="true"
            >
              <SparkleIcon className="h-4 w-4" />
            </span>
          </div>
        </div>

        {/* + WHERE TO FIND ME + -- a centered rule flanked by red "+" and
            hairlines, distinct from Eyebrow.tsx's own component: that one
            is gated on useThemePreset() (the currently-VIEWED studio's own
            cached preset), which this login-shell-locked page must never
            read from -- a visitor arriving here straight from some other
            studio's own [data-theme] would get Eyebrow's plain non-
            editorial fallback instead of this page's own fixed identity.
            Hand-rolled here for that reason, not because the shared
            component couldn't otherwise fit. */}
        <div className="mt-14 flex items-center justify-center gap-3 sm:mt-16">
          <span className="h-px w-10 bg-border-strong sm:w-16" aria-hidden="true" />
          <p className="login-jura flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-accent">
            <span className="text-danger-strong" aria-hidden="true">
              +
            </span>
            {t('artistPublic.whereToFindMe')}
            <span className="text-danger-strong" aria-hidden="true">
              +
            </span>
          </p>
          <span className="h-px w-10 bg-border-strong sm:w-16" aria-hidden="true" />
        </div>

        <div className="mx-auto mt-6 max-w-lg space-y-3 sm:mx-0 sm:max-w-none">
          <StudioCard
            studio={profile.homeStudio}
            subtitle={t('artistPublic.homeStudio')}
            expanded={expandedStudioId === profile.homeStudio.id}
            onToggle={() => setExpandedStudioId((id) => (id === profile.homeStudio.id ? null : profile.homeStudio.id))}
            openInMapsLabel={t('artistPublic.openInMaps')}
          />
          {profile.upcomingResidencies.map((r) => (
            <StudioCard
              key={`${r.studio.id}-${r.startDate}`}
              studio={r.studio}
              subtitle={`${t('artistPublic.guestResidency')} · ${formatDateRange(r.startDate, r.endDate)}`}
              expanded={expandedStudioId === r.studio.id}
              onToggle={() => setExpandedStudioId((id) => (id === r.studio.id ? null : r.studio.id))}
              openInMapsLabel={t('artistPublic.openInMaps')}
            />
          ))}
        </div>

        <div className="mx-auto mt-8 max-w-lg sm:mx-0 sm:max-w-none">
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setShowBookPicker((v) => !v)}
              className="btn-gold-gradient login-jura flex flex-1 items-center justify-center gap-2 px-6 py-3.5 text-sm font-bold uppercase tracking-[0.14em]"
            >
              {t('artistPublic.bookButton')}
              <ArrowRightIcon className="h-4 w-4" />
            </button>
            <a
              href={`/flash/${profile.homeStudio.slug}/${profile.id}`}
              className="btn-outline-refined login-jura flex flex-1 items-center justify-center gap-2 px-6 py-3.5 text-sm font-bold uppercase tracking-[0.14em]"
            >
              {t('artistPublic.flashButton')}
              <ArrowRightIcon className="h-4 w-4" />
            </a>
          </div>

          {showBookPicker && (
            <div className="login-panel-surface mt-4 p-4">
              <p className="text-sm font-medium text-fg">{t('artistPublic.bookPickerPrompt')}</p>
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => bookAt(profile.homeStudio)}
                  className="w-full rounded-lg border border-border px-4 py-3 text-left text-sm text-fg transition hover:border-accent"
                >
                  {profile.homeStudio.name}{' '}
                  <span className="text-fg-muted">{t('artistPublic.homeStudioSuffix')}</span>
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

        {/* LET'S CONNECT -- entirely absent when the artist has neither
            social link on file, not just an empty section shell. */}
        {socials.length > 0 && (
          <div className="mt-10 text-center">
            <p className="login-jura text-[11px] font-semibold uppercase tracking-[0.28em] text-accent">
              {t('artistPublic.letsConnect')}
            </p>
            <p className="text-danger-strong mt-1 text-sm" aria-hidden="true">
              +
            </p>
            <div className="mt-3 flex justify-center gap-3">
              {socials.map(({ key, href, Icon, label }) => (
                <a
                  key={key}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-border-strong text-fg-secondary transition hover:border-accent hover:text-accent"
                >
                  <Icon className="h-5 w-5" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StudioCard({
  studio,
  subtitle,
  expanded,
  onToggle,
  openInMapsLabel,
}: {
  studio: StudioSummary
  subtitle: string
  expanded: boolean
  onToggle: () => void
  openInMapsLabel: string
}) {
  const hasAddress = Boolean(studio.address)

  return (
    <div className="rounded-2xl border border-border bg-surface/70 px-4 py-3.5">
      <button
        type="button"
        onClick={hasAddress ? onToggle : undefined}
        aria-expanded={hasAddress ? expanded : undefined}
        className={`flex w-full items-center gap-3.5 text-left ${hasAddress ? '' : 'cursor-default'}`}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-accent/50 text-accent">
          {studio.logoUrl ? (
            <img src={studio.logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <StudioMarkIcon className="h-5 w-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-fg">{studio.name}</span>
          <span className="login-jura block text-[10.5px] font-semibold uppercase tracking-[0.16em] text-accent/80">
            {subtitle}
          </span>
        </span>
        {/* Chevron only if it does something -- omitted entirely for a
            studio with no resolvable single-location address, rather than
            a chevron that expands to nothing. */}
        {hasAddress && (
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 text-fg-muted transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`}
          />
        )}
      </button>

      {expanded && studio.address && (
        <a
          href={buildMapsUrl(studio.address)}
          target="_blank"
          rel="noreferrer"
          aria-label={openInMapsLabel}
          className="mt-3 inline-flex items-center gap-1.5 pl-[3.375rem] text-xs text-fg-secondary underline decoration-fg-muted/50 underline-offset-2 transition hover:text-fg hover:decoration-fg"
        >
          <MapPinIcon className="h-3.5 w-3.5 shrink-0" />
          {studio.address}
        </a>
      )}
    </div>
  )
}
