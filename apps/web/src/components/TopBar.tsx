import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/useAuth'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useViewAs } from '../context/useViewAs'
import { useUserProfile } from '../context/useUserProfile'
import { formatStatus } from '../lib/format'
import { tasksQueryKey } from '../lib/queryKeys'
import { formatBubbleCount } from '../lib/useNavCounts'
import { BellIcon, ChevronDownIcon, LogoutIcon, SettingsIcon, TasksIcon, ViewIcon } from './icons'
import ViewAsPicker from './ViewAsPicker'

interface TasksBadgeResponse {
  system: unknown[]
  personal: { completedAt: string | null }[]
}

// Rendered once at the app root (like ConversationsPanel's floating
// trigger) rather than per-page, so every authenticated page gets the
// personal cluster without each page needing to include it. Fixed
// top-right, independent of each page's own in-flow header content.
export default function TopBar() {
  const { user: realUser, logout } = useAuth()
  const user = useEffectiveUser()
  const { target: viewAsTarget } = useViewAs()
  const { profile } = useUserProfile()
  const navigate = useNavigate()
  const [showMentions, setShowMentions] = useState(false)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [showViewAsPicker, setShowViewAsPicker] = useState(false)

  const canSeeTasks = user?.role === 'OWNER' || user?.role === 'FRONT_DESK' || user?.role === 'ARTIST'
  // The entry point itself must reflect who's REALLY logged in (not the
  // impersonated target) -- and is hidden entirely while already viewing
  // as someone, since switching targets mid-session isn't a supported flow
  // (exit first).
  const canUseViewAs = realUser?.role === 'OWNER' && !viewAsTarget

  // Same combined-count math the sidebar used to show on its Tasks item:
  // open Assigned-to-Me items + undismissed Studio Queue items visible to
  // this user (zero system tasks for ARTIST, enforced server-side).
  const { data: tasksBadgeData } = useQuery({
    queryKey: user ? tasksQueryKey(user.userId) : ['tasks', 'anonymous'],
    queryFn: () => apiFetch<TasksBadgeResponse>('/tasks'),
    enabled: !!user && canSeeTasks,
    refetchInterval: 60_000,
  })
  const taskBadgeCount =
    (tasksBadgeData?.system.length ?? 0) + (tasksBadgeData?.personal.filter((t) => !t.completedAt).length ?? 0)

  function handleLogout() {
    logout()
    navigate('/login')
  }

  function closeMenus() {
    setShowMentions(false)
    setShowAccountMenu(false)
  }

  if (!user) return null

  return (
    <div className={`fixed right-4 z-30 flex items-center gap-2 ${viewAsTarget ? 'top-14' : 'top-4'}`}>
      {canSeeTasks && (
        <Link
          to="/tasks"
          onClick={closeMenus}
          aria-label="My Tasks"
          className="relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-fg-secondary shadow-lg transition hover:text-fg"
        >
          <TasksIcon className="h-5 w-5" />
          {taskBadgeCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold text-bg">
              {formatBubbleCount(taskBadgeCount)}
            </span>
          )}
        </Link>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setShowMentions((v) => !v)
            setShowAccountMenu(false)
          }}
          aria-label="Mentions"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-fg-secondary shadow-lg transition hover:text-fg"
        >
          <BellIcon className="h-5 w-5" />
        </button>

        {showMentions && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowMentions(false)} aria-hidden="true" />
            <div className="absolute right-0 top-12 z-20 w-64 rounded-2xl border border-border bg-surface-raised p-4 shadow-xl">
              <p className="text-sm text-fg-secondary">
                No mentions yet — internal mentions are coming to Conversations.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setShowAccountMenu((v) => !v)
            setShowMentions(false)
          }}
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 shadow-lg transition hover:border-border-strong"
        >
          {profile?.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised text-xs font-semibold text-fg">
              {(profile?.name ?? user.role ?? 'U').slice(0, 1)}
            </span>
          )}
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span className="text-sm font-medium text-fg">{profile?.name ?? formatStatus(user.role)}</span>
            <span className="text-xs text-fg-muted">{formatStatus(user.role)}</span>
          </span>
          <ChevronDownIcon className="h-3.5 w-3.5 text-fg-muted" />
        </button>

        {showAccountMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowAccountMenu(false)} aria-hidden="true" />
            <div className="absolute right-0 top-12 z-20 w-48 rounded-2xl border border-border bg-surface-raised p-1 shadow-xl">
              <Link
                to="/profile"
                onClick={() => setShowAccountMenu(false)}
                className="block rounded-xl px-3 py-2 text-sm text-fg-secondary transition hover:bg-surface hover:text-fg"
              >
                Profile
              </Link>
              <Link
                to="/settings"
                onClick={() => setShowAccountMenu(false)}
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-fg-secondary transition hover:bg-surface hover:text-fg"
              >
                <SettingsIcon className="h-3.5 w-3.5" />
                Settings
              </Link>
              {canUseViewAs && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAccountMenu(false)
                    setShowViewAsPicker(true)
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-fg-secondary transition hover:bg-surface hover:text-fg"
                >
                  <ViewIcon className="h-3.5 w-3.5" />
                  View portal as...
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-fg-secondary transition hover:bg-surface hover:text-fg"
              >
                <LogoutIcon className="h-3.5 w-3.5" />
                Log out
              </button>
            </div>
          </>
        )}
      </div>

      {showViewAsPicker && <ViewAsPicker onClose={() => setShowViewAsPicker(false)} />}
    </div>
  )
}
