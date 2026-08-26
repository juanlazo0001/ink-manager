import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { formatRelativeTime } from '../lib/format'
import { formatBubbleCount } from '../lib/useNavCounts'
import { BellIcon } from './icons'

// The bell was a hardcoded sentence -- "No mentions yet — internal
// mentions are coming to Conversations." -- with no model and no endpoint
// behind it. This is the real feed over GET /notifications.
//
// Live updates arrive through the existing socket path, with no listener
// of its own: lib/notifications.ts calls emitUserInvalidation into the
// recipient's personal `user:<id>` room with these two key prefixes, and
// SocketContext's single `invalidate` handler turns that into
// invalidateQueries. Same mechanism every other live-updating query in the
// app already uses.

export type NotificationType = 'MESSAGE_CREATED' | 'INQUIRY_ASSIGNED' | 'TASK_ASSIGNED'

export interface NotificationItem {
  id: string
  type: NotificationType
  title: string
  body: string
  entityType: string
  entityId: string
  payload: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
  actor: { id: string; name: string | null; email: string; avatarUrl: string | null } | null
}

interface NotificationFeed {
  items: NotificationItem[]
  unreadCount: number
  nextCursor: string | null
}

// The deep link. The API sends entityType/entityId as two plain columns
// precisely so this is a lookup rather than a parse, and so a new
// notification type does not need a new field to be routable.
//
// An Inquiry has TWO detail pages and the right one depends on the
// viewer, not on the record: /inquiries/:id is the staff page, backed by
// a route that is requireRole(OWNER, FRONT_DESK) server-side, so sending
// an artist there produces a guaranteed 403. Their equivalent is
// /my-inquiries/:id, backed by GET /inquiries/assigned-to-me/:id. This is
// the one place the routing has to know who is looking.
//
// PersonalTask has no detail page at all -- the Tasks page IS the view of
// one -- so it routes to the list rather than to a URL that does not
// exist. Returning null instead would leave the row un-clickable, which
// reads as broken rather than as deliberate.
function linkFor(item: NotificationItem, role: string | undefined): string {
  switch (item.entityType) {
    case 'Conversation':
      return `/conversations/${item.entityId}`
    case 'Inquiry':
      return role === 'ARTIST' ? `/my-inquiries/${item.entityId}` : `/inquiries/${item.entityId}`
    case 'PersonalTask':
      return '/tasks'
    default:
      return '/'
  }
}

export default function NotificationBell({
  buttonClass,
  panelClass,
  badgeClass,
  onOpenChange,
  open,
}: {
  buttonClass: string
  panelClass: string
  badgeClass: string
  /** Owned by TopBar so opening this closes the account menu, and vice versa. */
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // useEffectiveUser, not the raw auth user, so an admin using View As
  // gets routed the way the person they are viewing as would be.
  const user = useEffectiveUser()
  const [showAll, setShowAll] = useState(false)

  // The badge is its own query, and a deliberately cheap one: it renders
  // on every authenticated page, so it must not have to load a page of
  // rows to draw a number. The feed below only runs while the panel is
  // actually open.
  const { data: badge } = useQuery({
    queryKey: ['notification-unread'],
    queryFn: () => apiFetch<{ unreadCount: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  })

  const { data: feed, isLoading } = useQuery({
    queryKey: ['notifications', showAll ? 'all' : 'unread'],
    queryFn: () => apiFetch<NotificationFeed>(`/notifications?limit=20${showAll ? '' : '&unreadOnly=true'}`),
    enabled: open,
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
    queryClient.invalidateQueries({ queryKey: ['notification-unread'] })
  }

  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch('/notifications/mark-read', { method: 'POST', body: JSON.stringify({ id }) }),
    onSuccess: refresh,
  })

  const markAllRead = useMutation({
    mutationFn: () => apiFetch('/notifications/mark-all-read', { method: 'POST' }),
    onSuccess: refresh,
  })

  // The badge query is the authority even while the panel is open: the
  // feed's own unreadCount is a snapshot from whenever it last ran, and
  // the two would visibly disagree after marking one row read.
  const unreadCount = badge?.unreadCount ?? 0
  const items = feed?.items ?? []

  function handleOpen(item: NotificationItem) {
    // Navigate first, mark read second, and do not await: opening a
    // notification is the read receipt, and making the navigation wait on
    // a POST would add a stall to the one interaction that must feel
    // instant. A failed mark just leaves it unread, which is recoverable.
    onOpenChange(false)
    navigate(linkFor(item, user?.role))
    if (!item.readAt) markRead.mutate(item.id)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        className={`relative ${buttonClass}`}
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && <span className={badgeClass}>{formatBubbleCount(unreadCount)}</span>}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => onOpenChange(false)} aria-hidden="true" />
          <div className={`absolute right-0 top-12 z-20 w-80 overflow-hidden ${panelClass}`}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-fg">Notifications</span>
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="text-xs text-fg-muted underline-offset-2 transition hover:text-fg hover:underline"
                >
                  {showAll ? 'Unread only' : 'Show all'}
                </button>
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead.mutate()}
                  disabled={markAllRead.isPending}
                  className="text-xs text-accent transition hover:underline disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {isLoading && <p className="px-4 py-6 text-sm text-fg-secondary">Loading…</p>}

              {!isLoading && items.length === 0 && (
                <p className="px-4 py-6 text-sm text-fg-secondary">
                  {showAll ? 'Nothing here yet.' : "You're all caught up."}
                </p>
              )}

              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleOpen(item)}
                  className="flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition last:border-b-0 hover:bg-surface/60"
                >
                  {/* Unread is carried by a dot, not by a tinted row:
                      the panel is short and a block of coloured rows
                      reads as an alert state rather than as a list. */}
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? 'bg-transparent' : 'bg-accent'}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${item.readAt ? 'text-fg-secondary' : 'font-medium text-fg'}`}>
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-fg-secondary">{item.body}</span>
                    <span className="mt-1 block text-xs text-fg-muted">{formatRelativeTime(item.createdAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
