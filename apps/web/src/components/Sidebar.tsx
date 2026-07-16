import { useState, type ComponentType } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  AppointmentsIcon,
  ArtistsIcon,
  ClientsIcon,
  CloseIcon,
  DashboardIcon,
  DocumentIcon,
  LogoutIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  TeamIcon,
} from './icons'
import { useAuth } from '../context/useAuth'
import { useStudio } from '../context/useStudio'
import { useUserProfile } from '../context/useUserProfile'

interface NavItem {
  label: string
  to?: string
  icon: ComponentType<{ className?: string }>
  roles?: string[]
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: DashboardIcon },
  { label: 'Clients', to: '/clients', icon: ClientsIcon },
  { label: 'Appointments', to: '/appointments', icon: AppointmentsIcon },
  { label: 'Artists', to: '/artists', icon: ArtistsIcon },
  { label: 'Inquiries', to: '/inquiries', icon: DocumentIcon, roles: ['OWNER', 'FRONT_DESK'] },
  { label: 'My Inquiries', to: '/my-inquiries', icon: DocumentIcon, roles: ['ARTIST'] },
  { label: 'Team', to: '/team', icon: TeamIcon, roles: ['OWNER'] },
  { label: 'Settings', to: '/settings', icon: SettingsIcon },
]

export default function Sidebar() {
  const location = useLocation()
  const { user, logout } = useAuth()
  const { studio } = useStudio()
  const { profile } = useUserProfile()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

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
          'fixed inset-y-0 left-0 z-50 flex w-64 max-w-[80vw] shrink-0 flex-col overflow-y-auto border-r border-neutral-800 bg-neutral-900 px-4 py-6 transition-transform duration-200 ease-in-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:translate-x-0',
        ].join(' ')}
      >
        <div className="flex items-center gap-2 px-2">
          <div className="min-w-0 flex-1">
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
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-white md:hidden"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 flex items-center gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-400">
          <SearchIcon className="h-4 w-4" />
          <span className="flex-1">Search</span>
          <span className="rounded-md border border-neutral-800 px-1.5 py-0.5 text-[10px] font-medium">⌘K</span>
        </div>

        <p className="mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">Main</p>

        <nav className="mt-2 flex flex-col gap-1">
          {NAV_ITEMS.filter((item) => !item.roles || (user?.role && item.roles.includes(user.role))).map(
            ({ label, to, icon: Icon }) => {
              const isActive = to != null && (location.pathname === to || location.pathname.startsWith(`${to}/`))
              const itemClassName = [
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-white',
              ].join(' ')

              if (to) {
                return (
                  <Link key={label} to={to} className={itemClassName}>
                    <Icon className="h-5 w-5" />
                    {label}
                  </Link>
                )
              }

              return (
                <span key={label} className={`${itemClassName} cursor-default opacity-60`}>
                  <Icon className="h-5 w-5" />
                  {label}
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
