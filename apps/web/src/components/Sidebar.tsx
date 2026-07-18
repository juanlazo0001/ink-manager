import { useState, type ComponentType } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AppointmentsIcon, ClientsIcon, DashboardIcon, DocumentIcon, MenuIcon, SearchIcon, TeamIcon } from './icons'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useViewAs } from '../context/useViewAs'
import { useStudio } from '../context/useStudio'
import { apiFetch } from '../lib/api'
import { appointmentsQueryKey, clientsQueryKey, inquiriesQueryKey } from '../lib/queryKeys'
import { useNavCounts, formatBubbleCount } from '../lib/useNavCounts'
import { Skeleton } from './Skeleton'

type NavCountSection = 'inquiries' | 'appointments' | 'clients' | 'conversations'

interface NavItem {
  label: string
  to?: string
  icon: ComponentType<{ className?: string }>
  roles?: string[]
  section?: NavCountSection
}

// UI-1: consolidated to four items. Artists moved into Team's Artists tab;
// Appointments was renamed Calendar (same page); Tasks and Settings moved
// to the top-bar personal cluster / account menu.
const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: DashboardIcon },
  { label: 'Inquiries & Projects', to: '/inquiries', icon: DocumentIcon, roles: ['OWNER', 'FRONT_DESK'], section: 'inquiries' },
  { label: 'My Inquiries', to: '/my-inquiries', icon: DocumentIcon, roles: ['ARTIST'], section: 'inquiries' },
  { label: 'Calendar', to: '/calendar', icon: AppointmentsIcon, section: 'appointments' },
  { label: 'Clients', to: '/clients', icon: ClientsIcon, section: 'clients' },
  { label: 'Team', to: '/team', icon: TeamIcon, roles: ['OWNER'] },
]

export default function Sidebar() {
  const location = useLocation()
  const user = useEffectiveUser()
  const { target: viewAsTarget } = useViewAs()
  const { studio, loading: studioLoading } = useStudio()
  const queryClient = useQueryClient()
  const [mobileOpen, setMobileOpen] = useState(false)

  const { data: navCounts } = useNavCounts()
  const showBadges = navCounts?.showSidebarBadges ?? false

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
    const queries: Record<string, { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> }> = {
      '/clients': { queryKey: clientsQueryKey(studioId), queryFn: () => apiFetch('/clients') },
      '/calendar': { queryKey: appointmentsQueryKey(studioId), queryFn: () => apiFetch('/appointments') },
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
          className={`fixed left-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-fg shadow-lg md:hidden ${viewAsTarget ? 'top-14' : 'top-4'}`}
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
          'fixed inset-y-0 left-0 z-50 flex w-[80vw] shrink-0 flex-col overflow-y-auto border-r border-border bg-bg px-4 py-6 transition-transform duration-200 ease-in-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:w-64 md:translate-x-0',
        ].join(' ')}
      >
        <div className="px-2">
          {studioLoading ? (
            // Reserve the logo's space with a neutral placeholder rather
            // than the Ink Manager wordmark -- showing that while the
            // studio's own logo is still loading reads as a branding flash.
            <Skeleton className="h-16 w-full" />
          ) : studio?.logoUrl ? (
            <img src={studio.logoUrl} alt={studio.name} className="h-auto max-h-32 w-full object-contain" />
          ) : (
            <img
              src="/branding/logo-white-512.png"
              alt="Ink Manager"
              className="h-auto max-h-32 w-full object-contain"
            />
          )}
        </div>

        <div className="mt-6 flex items-center gap-2 rounded-xl border border-border bg-surface-inset px-3 py-2 text-sm text-fg-secondary">
          <SearchIcon className="h-4 w-4" />
          <span className="flex-1">Search</span>
          <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium">⌘K</span>
        </div>

        <p className="mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">Main</p>

        <nav className="mt-2 flex flex-col gap-1">
          {NAV_ITEMS.filter((item) => !item.roles || (user?.role && item.roles.includes(user.role))).map(
            ({ label, to, icon: Icon, section }) => {
              const isActive = to != null && (location.pathname === to || location.pathname.startsWith(`${to}/`))
              const itemClassName = [
                'flex items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition',
                isActive ? 'bg-accent text-bg' : 'text-fg-secondary hover:bg-surface hover:text-fg',
              ].join(' ')

              const bubbleCount = showBadges && section ? navCounts?.[section] ?? 0 : 0

              const bubble =
                bubbleCount > 0 ? (
                  <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-bg">
                    {formatBubbleCount(bubbleCount)}
                  </span>
                ) : null

              if (to) {
                return (
                  <Link
                    key={label}
                    to={to}
                    className={itemClassName}
                    onMouseEnter={() => handlePrefetch(to)}
                    onFocus={() => handlePrefetch(to)}
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                    {bubble}
                  </Link>
                )
              }

              return (
                <span key={label} className={`${itemClassName} cursor-default opacity-60`}>
                  <Icon className="h-5 w-5" />
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
