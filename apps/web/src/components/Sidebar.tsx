import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { ComponentType } from 'react'
import {
  AppointmentsIcon,
  ArtistsIcon,
  ClientsIcon,
  DashboardIcon,
  DocumentIcon,
  LogoutIcon,
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

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 px-4 py-6">
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
  )
}
