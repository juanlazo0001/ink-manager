import { useState, type ComponentType } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AppointmentsIcon,
  ArtistsIcon,
  ClientsIcon,
  DashboardIcon,
  DocumentIcon,
  LogoutIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  TasksIcon,
  TeamIcon,
} from './icons'
import { useAuth } from '../context/useAuth'
import { useStudio } from '../context/useStudio'
import { useUserProfile } from '../context/useUserProfile'
import { apiFetch } from '../lib/api'
import { appointmentsQueryKey, artistsQueryKey, clientsQueryKey, inquiriesQueryKey, tasksQueryKey } from '../lib/queryKeys'
import { useNavCounts, formatBubbleCount, type NavCounts } from '../lib/useNavCounts'

interface NavItem {
  label: string
  to?: string
  icon: ComponentType<{ className?: string }>
  roles?: string[]
  section?: keyof NavCounts
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: DashboardIcon },
  { label: 'Clients', to: '/clients', icon: ClientsIcon, section: 'clients' },
  { label: 'Appointments', to: '/appointments', icon: AppointmentsIcon, section: 'appointments' },
  { label: 'Artists', to: '/artists', icon: ArtistsIcon },
  { label: 'Inquiries', to: '/inquiries', icon: DocumentIcon, roles: ['OWNER', 'FRONT_DESK'], section: 'inquiries' },
  { label: 'My Inquiries', to: '/my-inquiries', icon: DocumentIcon, roles: ['ARTIST'], section: 'inquiries' },
  { label: 'Tasks', to: '/tasks', icon: TasksIcon, roles: ['OWNER', 'FRONT_DESK', 'ARTIST'] },
  { label: 'Team', to: '/team', icon: TeamIcon, roles: ['OWNER'] },
  { label: 'Settings', to: '/settings', icon: SettingsIcon },
]

interface TasksBadgeResponse {
  system: unknown[]
  personal: { completedAt: string | null }[]
}

export default function Sidebar() {
  const location = useLocation()
  const { user, logout } = useAuth()
  const { studio } = useStudio()
  const { profile } = useUserProfile()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mobileOpen, setMobileOpen] = useState(false)

  const { data: navCounts } = useNavCounts()

  const canSeeTasks = user?.role === 'OWNER' || user?.role === 'FRONT_DESK' || user?.role === 'ARTIST'
  const { data: tasksBadgeData } = useQuery({
    queryKey: user ? tasksQueryKey(user.userId) : ['tasks', 'anonymous'],
    queryFn: () => apiFetch<TasksBadgeResponse>('/tasks'),
    enabled: !!user && canSeeTasks,
    refetchInterval: 60_000,
  })
  const taskBadgeCount =
    (tasksBadgeData?.system.length ?? 0) + (tasksBadgeData?.personal.filter((t) => !t.completedAt).length ?? 0)

  // Closing on route change covers both nav-link clicks and logout's
  // redirect, so the drawer never stays open covering the next page. Adjusted
  // during render (not an effect) per React's guidance for resetting state
  // when a prop/param changes: https://react.dev/learn/you-might-not-need-an-effect
  const [lastPathname, setLastPathname] = useState(location.pathname)
  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname)
    setMobileOpen(false)
  }

  function handleLogout() {
    logout()
    navigate('/login')
  }

  // Only nav targets converted to react-query have a cache worth warming;
  // Team/My Inquiries/Settings still fetch their own way, so this no-ops for them.
  function handlePrefetch(to: string) {
    if (!user) return

    const studioId = user.studioId
    const queries: Record<string, { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> }> = {
      '/clients': { queryKey: clientsQueryKey(studioId), queryFn: () => apiFetch('/clients') },
      '/appointments': { queryKey: appointmentsQueryKey(studioId), queryFn: () => apiFetch('/appointments') },
      '/artists': { queryKey: artistsQueryKey(studioId), queryFn: () => apiFetch('/artists') },
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
          className="fixed left-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-white shadow-lg md:hidden"
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
          'fixed inset-y-0 left-0 z-50 flex w-[80vw] shrink-0 flex-col overflow-y-auto border-r border-neutral-800 bg-neutral-900 px-4 py-6 transition-transform duration-200 ease-in-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:w-64 md:translate-x-0',
        ].join(' ')}
      >
        <div className="px-2">
          {studio?.logoUrl ? (
            <img src={studio.logoUrl} alt={studio.name} className="h-auto max-h-32 w-full object-contain" />
          ) : (
            <img
              src="/branding/logo-white-512.png"
              alt="Ink Manager"
              className="h-auto max-h-32 w-full object-contain"
            />
          )}
        </div>

        <div className="mt-6 flex items-center gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-400">
          <SearchIcon className="h-4 w-4" />
          <span className="flex-1">Search</span>
          <span className="rounded-md border border-neutral-800 px-1.5 py-0.5 text-[10px] font-medium">⌘K</span>
        </div>

        <p className="mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">Main</p>

        <nav className="mt-2 flex flex-col gap-1">
          {NAV_ITEMS.filter((item) => !item.roles || (user?.role && item.roles.includes(user.role))).map(
            ({ label, to, icon: Icon, section }) => {
              const isActive = to != null && (location.pathname === to || location.pathname.startsWith(`${to}/`))
              const itemClassName = [
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-white',
              ].join(' ')

              const bubbleCount = section ? navCounts?.[section] ?? 0 : label === 'Tasks' ? taskBadgeCount : 0

              const bubble =
                bubbleCount > 0 ? (
                  <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">
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

        <div className="mt-auto flex items-center gap-3 rounded-xl border border-neutral-800 p-3">
          <Link to="/profile" className="flex min-w-0 flex-1 items-center gap-3">
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.name ?? profile.role}
                className="h-9 w-9 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-sm font-semibold text-white">
                {(profile?.name ?? user?.role ?? 'U').slice(0, 1)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{profile?.name || user?.role}</p>
              <p className="truncate text-xs text-neutral-500">Studio account</p>
            </div>
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Log out"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
          >
            <LogoutIcon className="h-4 w-4" />
          </button>
        </div>
      </aside>
    </>
  )
}
