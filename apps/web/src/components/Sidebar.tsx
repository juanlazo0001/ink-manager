import { useState, type ComponentType } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AppointmentsIcon, ClientsIcon, DashboardIcon, DocumentIcon, MenuIcon, PhotoIcon, TeamIcon } from './icons'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useViewAs } from '../context/useViewAs'
import { useUserProfile } from '../context/useUserProfile'
import { useStudio } from '../context/useStudio'
import { apiFetch } from '../lib/api'
import { clientsQueryKey, inquiriesQueryKey } from '../lib/queryKeys'
import { useNavCounts, formatBubbleCount } from '../lib/useNavCounts'
import { Skeleton } from './Skeleton'
import { useThemePreset } from '../lib/useThemePreset'

type NavCountSection = 'inquiries' | 'appointments' | 'clients' | 'conversations'

interface NavItem {
  label: string
  to?: string
  icon: ComponentType<{ className?: string }>
  roles?: string[]
  // Checked against the effective user's granular permissions (respects a
  // studio's own Settings -> Permissions overrides, unlike the coarser
  // `roles` list above) -- use this over `roles` whenever the item maps
  // cleanly onto a single existing permission key.
  permission?: string
  section?: NavCountSection
  // UI simplification pass: hidden entirely (not shown-but-empty) when
  // profile.isSoloStudio -- a team of one has no team roster, artist
  // roster, or permissions matrix to show. Nothing else about the item's
  // own gating (roles/permission) changes; this is an additional filter.
  hideForSoloStudio?: boolean
}

// UI-1: consolidated to four items. Artists moved into Team's Artists tab;
// Appointments was renamed Calendar (same page); Tasks and Settings moved
// to the top-bar personal cluster / account menu.
const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: DashboardIcon },
  { label: 'Inquiries & Projects', to: '/inquiries', icon: DocumentIcon, roles: ['OWNER', 'FRONT_DESK'], section: 'inquiries' },
  { label: 'My Inquiries', to: '/my-inquiries', icon: DocumentIcon, roles: ['ARTIST'], section: 'inquiries' },
  { label: 'Calendar', to: '/calendar', icon: AppointmentsIcon, section: 'appointments' },
  // ARTIST has no clients.view permission by default -- the API 403s the
  // list/detail routes for a role lacking it, so showing the link
  // unconditionally led to a permanently-empty, silently-broken page for
  // any role a studio hasn't granted this to. Permission-gated (not a
  // hardcoded roles list) so it also follows a studio's own Settings ->
  // Permissions customization, e.g. an OWNER granting ARTIST clients.view.
  { label: 'Clients', to: '/clients', icon: ClientsIcon, permission: 'clients.view', section: 'clients' },
  { label: 'Team', to: '/team', icon: TeamIcon, roles: ['OWNER'], hideForSoloStudio: true },
  // Permission-gated, not roles -- an ARTIST always manages their OWN
  // pieces regardless of this key (flashGallery.manage's own "-own"
  // scoping, see permissions.ts), and this key defaults true for both
  // ARTIST and FRONT_DESK, so this link shows for every role by default,
  // same visibility pattern as Clients above.
  { label: 'Flash Gallery', to: '/flash', icon: PhotoIcon, permission: 'flashGallery.manage' },
]

export default function Sidebar() {
  const location = useLocation()
  const user = useEffectiveUser()
  const { profile } = useUserProfile()
  const { target: viewAsTarget } = useViewAs()
  const { studio, loading: studioLoading } = useStudio()
  const queryClient = useQueryClient()
  const [mobileOpen, setMobileOpen] = useState(false)

  const { data: navCounts } = useNavCounts()
  const showBadges = navCounts?.showSidebarBadges ?? false
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'

  // Closing on route change covers both nav-link clicks and logout's
  // redirect, so the drawer never stays open covering the next page. Adjusted
  // during render (not an effect) per React's guidance for resetting state
  // when a prop/param changes: https://react.dev/learn/you-might-not-need-an-effect
  const [lastPathname, setLastPathname] = useState(location.pathname)
  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname)
    setMobileOpen(false)
  }

  // Only nav targets converted to react-query have a cache worth warming;
  // Team/My Inquiries/Settings still fetch their own way, so this no-ops for them.
  function handlePrefetch(to: string) {
    if (!user) return

    const studioId = user.studioId
    // The Calendar page's own query key is range-scoped (Phase UI-5) and
    // depends on the view/date it lands on, which isn't known here -- so
    // there's nothing worth warming for '/calendar' anymore.
    const queries: Record<string, { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> }> = {
      '/clients': { queryKey: clientsQueryKey(studioId), queryFn: () => apiFetch('/clients') },
      '/inquiries': { queryKey: inquiriesQueryKey(studioId), queryFn: () => apiFetch('/inquiries') },
    }

    const query = queries[to]
    if (query) queryClient.prefetchQuery(query)
  }

  return (
    <>
      {!mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className={`fixed left-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border shadow-lg md:hidden ${isEditorial ? 'border-border-soft bg-surface-inset text-fg-muted transition-colors hover:text-fg hover:border-border-strong' : 'border-border bg-surface text-fg'} ${viewAsTarget ? 'top-14' : 'top-4'}`}
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      )}

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-[80vw] shrink-0 flex-col overflow-y-auto transition-transform duration-200 ease-in-out',
          // Same background every card/widget box in the app uses, so the
          // sidebar reads as part of the same surface system instead of a
          // separately-toned rail. Under editorial-gold that's the glass
          // treatment's own base color (sidebar-panel-bg, index.css) since
          // .card-surface overrides plain bg-surface there; every other
          // preset's cards never get that override, so bg-surface itself
          // (unconditional fallback here) already matches them exactly.
          isEditorial ? 'border-r border-border-soft bg-surface sidebar-panel-bg px-4 py-6' : 'border-r border-border bg-surface px-4 py-6',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:w-64 md:translate-x-0',
        ].join(' ')}
      >
        <div className={isEditorial ? 'flex justify-center px-2' : 'px-2'}>
          {studioLoading ? (
            // Reserve the logo's space with a neutral placeholder rather
            // than the Ink Manager wordmark -- showing that while the
            // studio's own logo is still loading reads as a branding flash.
            <Skeleton className="h-16 w-full" />
          ) : studio?.logoUrl ? (
            <img
              src={studio.logoUrl}
              alt={studio.name}
              className={isEditorial ? 'h-auto max-h-28 w-full object-contain' : 'h-auto max-h-32 w-full object-contain'}
            />
          ) : (
            <img
              src="/branding/logo-white-512.png"
              alt="Ink Manager"
              className={isEditorial ? 'h-auto max-h-28 w-full object-contain' : 'h-auto max-h-32 w-full object-contain'}
            />
          )}
        </div>

        {/* Dual themes: the sidebar's ornamental divider is a genuinely new
            DOM element the 'default' shape never had -- only mounted for
            'editorial', not just hidden via CSS, so its absence under every
            other preset is unambiguous. */}
        {isEditorial && (
          <div className="mx-3 mt-2">
            <div className="ornament" aria-hidden="true" />
          </div>
        )}

        <p
          className={
            isEditorial
              ? 'mt-3 px-3 font-jura text-[10px] font-semibold uppercase tracking-[0.34em] text-fg-muted'
              : 'mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-fg-muted'
          }
        >
          Main
        </p>

        <nav className={isEditorial ? 'mt-2 flex flex-col gap-1 px-1' : 'mt-2 flex flex-col gap-1'}>
          {NAV_ITEMS.filter(
            (item) =>
              (!item.roles || (user?.role && item.roles.includes(user.role))) &&
              (!item.permission || (profile?.permissions.includes(item.permission) ?? false)) &&
              (!item.hideForSoloStudio || !(profile?.isSoloStudio ?? false)),
          ).map(
            ({ label, to, icon: Icon, section }) => {
              const isActive = to != null && (location.pathname === to || location.pathname.startsWith(`${to}/`))
              const itemClassName = isEditorial
                ? [
                    'side-nav-link flex items-center gap-3 rounded-btn px-3 py-2.5 text-[15px] font-normal transition-colors',
                    isActive ? 'on text-fg' : 'text-fg-muted hover:text-fg',
                  ].join(' ')
                : [
                    'flex items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition',
                    isActive ? 'bg-accent text-bg' : 'text-fg-secondary hover:bg-surface hover:text-fg',
                  ].join(' ')

              const bubbleCount = showBadges && section ? navCounts?.[section] ?? 0 : 0

              const bubble =
                bubbleCount > 0 ? (
                  <span
                    className={
                      isEditorial
                        ? // Same bg-fg/text-accent-fg pairing as TopBar's
                          // Tasks badge and the Conversations FAB's own --
                          // matches the Welcome header's "Welcome," text
                          // color specifically, not the italic name.
                          'ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-fg px-1.5 text-[11px] font-medium text-accent-fg'
                        : 'ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-bg'
                    }
                  >
                    {formatBubbleCount(bubbleCount)}
                  </span>
                ) : null

              const iconClassName = isEditorial ? 'h-[17px] w-[17px] shrink-0 opacity-85' : 'h-5 w-5'

              if (to) {
                return (
                  <Link
                    key={label}
                    to={to}
                    className={itemClassName}
                    onMouseEnter={() => handlePrefetch(to)}
                    onFocus={() => handlePrefetch(to)}
                  >
                    <Icon className={iconClassName} />
                    {label}
                    {bubble}
                  </Link>
                )
              }

              return (
                <span key={label} className={`${itemClassName} cursor-default opacity-60`}>
                  <Icon className={iconClassName} />
                  {label}
                  {bubble}
                </span>
              )
            },
          )}
        </nav>
      </aside>
    </>
  )
}
