import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { buildMapsUrl } from '../lib/maps'
import { dateLocale } from '../i18n/locales'
import { LocaleProvider, useLocale, useTranslations } from '../i18n'
import { FacebookIcon, InstagramIcon, MapPinIcon } from '../components/icons'

// Artist public page v2 -- full rebuild against Juan's authoritative HTML
// spec (public/desktop/screenshots/artist-page-v12.html, saved to the repo
// as the reference of record). See index.css's own "Artist public page v2"
// section for the flattened CSS this component's classNames map onto, and
// REPORT.md for the 12-layer flattening method, the three approved deltas,
// and the color-mapping/background-layering decisions left for Juan's
// review. Publish gating, token behavior, and OG behavior are all
// untouched -- this is a visual rebuild of an already-working page.
//
// PLATFORM_BACKGROUND_LAYERING controls which of the two approved-pending
// background treatments renders when an artist HAS portfolio/flash images
// -- 'replace' shows only the artist's own texture, 'over' layers it above
// the platform fallback photo (multiply blend, 55% opacity) at reduced
// opacity. Both are fully built; screenshots of both ship in the review
// gallery for Juan to pick from. Currently set to 'over' -- live
// comparison showed 'replace' at the mercy of whatever brightness/color an
// individual artist's own portfolio photo happens to have (a bright/warm
// reference photo reads jarring against this page's otherwise dark,
// moody palette), while 'over' always grounds the composition in the
// platform photo's own pre-graded dark tone regardless. A one-line change
// to flip back to 'replace' if Juan prefers the simpler single-photo
// composite instead.
const PLATFORM_BACKGROUND_LAYERING: 'replace' | 'over' = 'over'
const PLATFORM_FALLBACK_BACKGROUND = '/branding/artist-page-ambient-fallback.jpg'

interface StudioSummary {
  id: string
  name: string
  slug: string
  address: string | null
  iconLogoUrl: string | null
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

  // No re-fetch-on-locale-toggle effect -- see EstimateRevisionResponse.tsx's
  // identical comment. Nothing on this page besides the initial
  // resolvedLocale sync is server-resolved/locale-dependent; the artist's
  // own name/bio/specialties/studio names are never machine-translated.
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
        if (!ignore) setState('not-found')
      })
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicSlug])

  function bookAt(studio: StudioSummary) {
    if (!profile) return
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

  const hasArtistTexture = Boolean(profile.backgroundImageUrl)
  const showPlatformPhoto = !hasArtistTexture || PLATFORM_BACKGROUND_LAYERING === 'over'

  return (
    <div className="login-shell artist-profile-page relative text-fg">
      {createPortal(
        <>
          {showPlatformPhoto && <img src={PLATFORM_FALLBACK_BACKGROUND} alt="" aria-hidden="true" className="app-bg-photo" />}
          {hasArtistTexture && (
            <img
              src={profile.backgroundImageUrl!}
              alt=""
              aria-hidden="true"
              className={PLATFORM_BACKGROUND_LAYERING === 'over' ? 'artist-bg-texture-overlay' : 'app-bg-photo'}
            />
          )}
          <span className="artist-bg-wash" aria-hidden="true" />
        </>,
        document.body,
      )}

      <div className="relative z-10">
        <section className="artist-hero-shell">
          <div className="artist-ambient artist-ambient--one" aria-hidden="true" />
          <div className="artist-ambient artist-ambient--two" aria-hidden="true" />

          <div className="artist-hero-copy">
            <div className="artist-eyebrow">
              <span>{t('artistPublic.eyebrow')}</span>
              <b aria-hidden="true">+</b>
            </div>

            <h1 className="artist-h1">{profile.name}</h1>

            {profile.specialties.length > 0 && (
              <div className="artist-tags" aria-label="Styles">
                {profile.specialties.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
            )}

            {profile.bio && <p className="artist-intro">{profile.bio}</p>}
          </div>

          <div className="artist-portrait-stage" aria-label={profile.name}>
            <div className="artist-orbit artist-orbit--1" />
            <div className="artist-orbit artist-orbit--2" />
            <div className="artist-orbit artist-orbit--3" />
            <div className="artist-portrait-frame">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt={profile.name} />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-surface">
                  <span className="font-display text-6xl font-medium text-fg-muted">{profile.name.slice(0, 1).toUpperCase()}</span>
                </div>
              )}
            </div>
            <div className="artist-portrait-mark" aria-hidden="true">
              ✦
            </div>
            <div className="artist-orbit-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </div>
        </section>

        <section className="artist-content-shell">
          <div className="artist-section-title">
            <span />
            <b aria-hidden="true">+</b>
            <em>{t('artistPublic.whereToFindMe')}</em>
            <b aria-hidden="true">+</b>
            <span />
          </div>

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

          <div className="artist-actions">
            <button type="button" onClick={() => setShowBookPicker((v) => !v)} className="artist-btn btn-gold-gradient">
              {t('artistPublic.bookButton')}
              <span className="artist-btn-arrow" aria-hidden="true">
                →
              </span>
            </button>
            <a href={`/flash/${profile.homeStudio.slug}/${profile.id}`} className="artist-btn btn-outline-refined">
              {t('artistPublic.flashButton')}
              <span className="artist-btn-arrow" aria-hidden="true">
                →
              </span>
            </a>
          </div>

          {showBookPicker && (
            <div className="login-panel-surface mx-auto mt-4 w-full max-w-[790px] p-4">
              <p className="text-sm font-medium text-fg">{t('artistPublic.bookPickerPrompt')}</p>
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => bookAt(profile.homeStudio)}
                  className="w-full rounded-lg border border-border px-4 py-3 text-left text-sm text-fg transition hover:border-accent"
                >
                  {profile.homeStudio.name} <span className="text-fg-muted">{t('artistPublic.homeStudioSuffix')}</span>
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

          {socials.length > 0 && (
            <div className="artist-connect">
              <p>{t('artistPublic.letsConnect')}</p>
              <b aria-hidden="true">+</b>
              <div className="artist-socials">
                {socials.map(({ key, href, Icon, label }) => (
                  <a key={key} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
                    <Icon className="h-full w-full" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>
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
    // .artist-studio-card is a <div>, not the spec's own <a href="#"> --
    // this card is a real interactive expand/collapse control with a real
    // nested link (the maps address) once expanded, and anchors can't
    // nest inside anchors (invalid HTML, caught before it ever shipped).
    <div className="artist-studio-card">
      {/* display: contents -- a real interactive <button> for click
          handling/accessibility, but structurally invisible to the grid,
          so its icon/copy/arrow children lay out directly against
          .artist-studio-card's own 78px/1fr/40px column tracks exactly
          like the spec's own (non-interactive) markup does. Simpler and
          more broadly supported than reaching for grid-template-columns:
          subgrid just to get the same effect. */}
      <button
        type="button"
        onClick={hasAddress ? onToggle : undefined}
        aria-expanded={hasAddress ? expanded : undefined}
        disabled={!hasAddress}
        className={`contents text-left ${hasAddress ? '' : 'cursor-default'}`}
      >
        <span className="artist-studio-icon">
          {studio.iconLogoUrl ? <img src={studio.iconLogoUrl} alt="" /> : studio.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="artist-studio-copy">
          <strong>{studio.name}</strong>
          <span>{subtitle}</span>
        </span>
        {/* Chevron only if it does something -- omitted entirely for a
            studio with no resolvable single-location address, rather than
            one that expands to nothing. */}
        {hasAddress && (
          <span
            className="artist-arrow"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s ease' }}
            aria-hidden="true"
          >
            ›
          </span>
        )}
      </button>

      {expanded && studio.address && (
        <a
          href={buildMapsUrl(studio.address)}
          target="_blank"
          rel="noreferrer"
          aria-label={openInMapsLabel}
          className="col-span-3 -mt-1 inline-flex items-center gap-1.5 pt-3 text-xs text-fg-secondary underline decoration-fg-muted/50 underline-offset-2 transition hover:text-fg hover:decoration-fg"
        >
          <MapPinIcon className="h-3.5 w-3.5 shrink-0" />
          {studio.address}
        </a>
      )}
    </div>
  )
}
