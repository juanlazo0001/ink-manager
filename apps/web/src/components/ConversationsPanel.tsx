import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import StatusPill, { getStatusTone, type Tone } from './StatusPill'
import InquiryPipeline from './InquiryPipeline'
import { formatDateTime, formatRelativeTime } from '../lib/format'
import { uploadImageToCloudinary } from '../lib/cloudinary'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useViewAs } from '../context/useViewAs'
import { useUserProfile } from '../context/useUserProfile'
import { useConversationPanel } from '../context/useConversationPanel'
import Modal from './Modal'
import { navCountsQueryKey } from '../lib/queryKeys'
import type { NavCounts } from '../lib/useNavCounts'
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  AttachmentIcon,
  CloseIcon,
  InfoIcon,
  MessageIcon,
  MoreIcon,
  PlusIcon,
  SendIcon,
  SparkleIcon,
  TagIcon,
} from './icons'

type Tab = 'CLIENT' | 'STAFF'

const TAGGABLE_ENTITY_TYPES = ['Inquiry', 'Appointment', 'GiftCard', 'DepositForm', 'LiabilityWaiver'] as const

const DRAFT_FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  description: 'Tattoo description',
  placement: 'Placement',
  estimatedSize: 'Estimated size',
  budget: 'Budget',
  desiredTiming: 'Desired timing',
}
const DRAFT_FIELD_ORDER = Object.keys(DRAFT_FIELD_LABELS)

interface PrimaryInquirySummary {
  id: string
  status: string
  description: string
  placement: string
  closedReason: string | null
}

interface ConversationSummary {
  id: string
  type: Tab
  clientId: string | null
  staffUserId: string | null
  lastMessageAt: string | null
  counterpart: { id: string; name: string } | null
  primaryInquiry: PrimaryInquirySummary | null
  lastMessage: { body: string; channel: string; direction: string; createdAt: string } | null
  unreadCount: number
}

interface StaffRosterEntry {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  role: string
  conversationId: string | null
}

interface NewChatClient {
  id: string
  firstName: string
  lastName: string
  email: string | null
}

interface ArtistFilterOption {
  id: string
  user: { name: string | null; email: string }
}

interface MessageMetadata {
  kind: 'shared_inquiry'
  inquiryId: string
}

interface MessageItem {
  id: string
  channel: string
  direction: 'INBOUND' | 'OUTBOUND'
  body: string
  attachments: string[] | null
  metadata: MessageMetadata | null
  createdAt: string
  authorUserId: string | null
  author: { id: string; name: string | null; email: string } | null
}

interface ConversationTag {
  id: string
  entityType: string
  entityId: string
  label: string
  deepLink: string
}

interface ThreadResponse {
  conversation: {
    id: string
    type: Tab
    clientId: string | null
    staffUserId: string | null
    counterpart: { id: string; name: string } | null
    primaryInquiry: PrimaryInquirySummary | null
    tags: ConversationTag[]
  }
  messages: MessageItem[]
  nextCursor: string | null
}

interface ContextInquiry {
  id: string
  description: string
  status: string
  closedReason: string | null
  placement: string
  colorOrBlackGrey: string
  estimatedSize: string
  budget: string | null
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  assignedArtist: { user: { name: string | null; email: string } } | null
  depositForm: { id: string; totalCharged: number; signedAt: string | null; paidManually: boolean } | null
}

interface ConversationContext {
  client: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null }
  inquiries: ContextInquiry[]
  giftCards: { id: string; amountCents: number; status: string; expiresAt: string | null }[]
  nextAppointment: {
    id: string
    startTime: string
    artistName: string
    waiverId: string | null
    waiverStatus: string | null
  } | null
}

// A client can have several inquiries over time; the panel only has room to
// feature one prominently. Mirrors the backend's own pick (most recent
// still-active one, else most recent overall) so the list pill, thread
// header, and context panel always agree on which inquiry is "the" one.
const CLOSED_INQUIRY_STATUSES = ['CLOSED_LOST', 'COLD_LEAD']
function pickPrimaryInquiry<T extends { status: string }>(inquiries: T[] | undefined): T | null {
  if (!inquiries || inquiries.length === 0) return null
  return inquiries.find((i) => !CLOSED_INQUIRY_STATUSES.includes(i.status)) ?? inquiries[0]
}

// What the single quick-action button in the context panel should say and
// where it should go, based on the featured inquiry's pipeline stage --
// always the real InquiryDetail page (single source of truth for the
// assign/estimate/deposit/schedule forms), just with a next-step label.
function clientRoleLabel(status: string): string {
  switch (status) {
    case 'SCHEDULING':
    case 'WAITLISTED':
    case 'CONFIRMED':
      return 'Active client'
    case 'CLOSED_LOST':
      return 'Past lead'
    case 'COLD_LEAD':
      return 'Cold lead'
    default:
      return 'Prospective client'
  }
}

function nextActionLabel(status: string): string {
  switch (status) {
    case 'NEW':
      return 'Assign artist'
    case 'ARTIST_ASSIGNED':
    case 'AWAITING_CLIENT_RESPONSE':
    case 'BUDGET_NEGOTIATION':
      return 'Manage estimate'
    case 'DEPOSIT_PENDING':
      return 'View deposit'
    case 'SCHEDULING':
    case 'WAITLISTED':
    case 'CONFIRMED':
      return 'View appointment'
    default:
      return 'View inquiry'
  }
}

interface MessageTemplate {
  id: string
  name: string
  body: string
}

interface ShareableLink {
  label: string
  url: string | null
  hint: string | null
}

interface ShareableLinksResponse {
  intakeFormUrl: string
  estimateLinks: (ShareableLink & { inquiryId: string })[]
  depositLinks: (ShareableLink & { inquiryId: string })[]
  waiverLinks: (ShareableLink & { appointmentId: string })[]
  giftCardLinks: (ShareableLink & { giftCardId: string })[]
}

const CLIENT_CHANNELS = ['SMS', 'EMAIL', 'INSTAGRAM', 'FACEBOOK', 'PHONE', 'OTHER'] as const

function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    IN_APP: 'In-app',
    SMS: 'SMS',
    EMAIL: 'Email',
    INSTAGRAM: 'Instagram',
    FACEBOOK: 'Facebook',
    PHONE: 'Phone',
    OTHER: 'Other',
  }
  return labels[channel] ?? channel
}

// Avatar-ring color per status tone, for the conversation list's colored
// rings (chat-example.png). Literal strings, not built from a template, so
// Tailwind's scanner can find them.
const TONE_RING_CLASSES: Record<Tone, string> = {
  success: 'ring-success/60',
  info: 'ring-info/60',
  warning: 'ring-warning/60',
  danger: 'ring-danger/60',
  neutral: 'ring-border-strong',
}

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString()
}

function dayLabel(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

// Consecutive same-side messages within the same minute are treated as one
// visual "burst" -- grouped under a single meta row instead of each bubble
// repeating its own timestamp/channel line.
function sameMinute(a: string, b: string): boolean {
  return Math.floor(new Date(a).getTime() / 60_000) === Math.floor(new Date(b).getTime() / 60_000)
}

// Per-channel dot colors for the thread's meta row and the composer's
// channel switcher. Instagram is its brand gradient; everything else is a
// flat swatch -- literal classes (not built from a template) so Tailwind's
// scanner can find them.
const CHANNEL_DOT_CLASSES: Record<string, string> = {
  INSTAGRAM: 'bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]',
  SMS: 'bg-[#2fb35c]',
  EMAIL: 'bg-[#4a90d9]',
  FACEBOOK: 'bg-[#1877f2]',
  PHONE: 'bg-[#8a8a92]',
  OTHER: 'bg-[#5a5a62]',
}

function ChannelDot({ channel, className = '' }: { channel: string; className?: string }) {
  return (
    <span
      className={`h-3.5 w-3.5 shrink-0 rounded-[4px] ${CHANNEL_DOT_CLASSES[channel] ?? CHANNEL_DOT_CLASSES.OTHER} ${className}`}
      aria-hidden="true"
    />
  )
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function ConversationsPanel() {
  const user = useEffectiveUser()
  const queryClient = useQueryClient()
  const { isOpen, activeConversationId, openPanel, closePanel } = useConversationPanel()
  const panelRef = useRef<HTMLDivElement>(null)

  const isArtist = user?.role === 'ARTIST'
  const [tab, setTab] = useState<Tab>(isArtist ? 'STAFF' : 'CLIENT')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Widens the whole slide-over (rather than squeezing the thread) when the
  // client-details panel opens, so opening it doesn't cramp the message
  // list -- panel grows to the left since the slide-over is right-anchored.
  const [contextOpen, setContextOpen] = useState(false)
  // Mounted lazily on first open (so a panel never opened at all never
  // fetches anything), then kept mounted forever after -- closing just
  // slides it off-screen. That's what lets the thread/list remember its
  // draft text, scroll position, and open popovers exactly as the user left
  // them; each side still pauses its own polling via the `isOpen` prop while
  // hidden instead of relying on unmount to stop background fetches.
  const [hasOpenedOnce, setHasOpenedOnce] = useState(isOpen)
  useEffect(() => {
    if (isOpen) setHasOpenedOnce(true)
  }, [isOpen])

  // Artists only ever have their own single Team thread -- no tab UI, no
  // list, just resolve it and go straight there. Resolve-only GET, never a
  // get-or-create POST: this effect fires on every open, not from an
  // explicit user action, so it must never silently create a Conversation
  // row (and under View As, a GET here doesn't trip the read-only block a
  // POST would). If none exists yet (their first message hasn't landed),
  // selectedId just stays null and the empty STAFF-tab list state shows.
  useEffect(() => {
    if (!isOpen || !isArtist || !user) return
    apiFetch<ConversationSummary>(`/conversations/resolve?staffUserId=${user.userId}`)
      .then((conversation) => setSelectedId(conversation.id))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isArtist])

  useEffect(() => {
    if (activeConversationId) setSelectedId(activeConversationId)
  }, [activeConversationId])

  // Don't carry the widened layout into a different thread or the list view.
  useEffect(() => {
    setContextOpen(false)
  }, [selectedId])

  // UI-1 §8: Esc dismisses the slide-over, same as the scrim/close button.
  // UI-2 accessibility floor: Tab/Shift+Tab wrap within the panel instead of
  // escaping to the page behind the scrim while it's open.
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closePanel()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return

      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closePanel])

  // Conversations bubble uses unread-logic (see navCounts.ts); refetch it
  // whenever something here might have changed it. Shares its cache key
  // with useNavCounts (Sidebar) so the two never double-fetch.
  function refreshNavCounts() {
    if (user) queryClient.invalidateQueries({ queryKey: navCountsQueryKey(user.userId) })
  }

  const { data: badgeCounts } = useQuery({
    queryKey: user ? navCountsQueryKey(user.userId) : ['nav-counts', 'anonymous'],
    queryFn: () => apiFetch<NavCounts>('/nav-counts'),
    enabled: !!user,
    refetchInterval: 60_000,
  })

  if (!user) return null

  return (
    <>
      <button
        type="button"
        onClick={() => openPanel()}
        aria-label="Open conversations"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-bg shadow-xl transition hover:bg-accent-hover"
      >
        <MessageIcon className="h-6 w-6" />
        {!!badgeCounts?.conversations && badgeCounts.conversations > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold text-bg">
            {badgeCounts.conversations > 99 ? '99+' : badgeCounts.conversations}
          </span>
        )}
      </button>

      {/* Scrim -- always mounted (even closed) so its opacity can transition
          instead of popping; pointer-events-none while closed so it never
          blocks the rest of the page. */}
      <div
        className={[
          'fixed inset-0 z-50 bg-black/60 transition-opacity duration-200 ease-in-out',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
        onClick={closePanel}
        aria-hidden="true"
      />

      {/* Full-height right-side slide-over. Always mounted (translated
          off-screen when closed) so the open/close transform actually
          animates. Desktop gets real working width (~560px) rather than a
          cramped floating card; mobile is a full-screen takeover. Rendered
          once at the app root (see App.tsx), so it -- and whichever thread
          is open -- survives route changes while open. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Conversations"
        className={[
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-surface-raised shadow-2xl transition-[transform,width] duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
          contextOpen ? 'sm:w-[848px]' : 'sm:w-[560px]',
        ].join(' ')}
        aria-hidden={!isOpen}
      >
        {hasOpenedOnce &&
          (selectedId ? (
            <ThreadView
              conversationId={selectedId}
              isOpen={isOpen}
              canGoBack={!isArtist}
              onBack={() => setSelectedId(null)}
              onClose={closePanel}
              onMessageSent={refreshNavCounts}
              onContextOpenChange={setContextOpen}
            />
          ) : (
            <ConversationListView
              tab={tab}
              isOpen={isOpen}
              onTabChange={setTab}
              showTabs={!isArtist}
              onSelect={(id) => setSelectedId(id)}
              onClose={closePanel}
            />
          ))}
      </div>
    </>
  )
}

function ConversationListView({
  tab,
  isOpen,
  onTabChange,
  showTabs,
  onSelect,
  onClose,
}: {
  tab: Tab
  isOpen: boolean
  onTabChange: (tab: Tab) => void
  showTabs: boolean
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const [entityTypeFilter, setEntityTypeFilter] = useState('')
  const [artistIdFilter, setArtistIdFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [quickFilter, setQuickFilter] = useState<'all' | 'unread' | 'needs-action'>('all')
  const [showNewChat, setShowNewChat] = useState(false)
  const [newChatSearch, setNewChatSearch] = useState('')
  const [newChatError, setNewChatError] = useState<string | null>(null)
  const [showAddClientModal, setShowAddClientModal] = useState(false)
  const [newClientForm, setNewClientForm] = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [newClientError, setNewClientError] = useState<string | null>(null)
  const [addingClient, setAddingClient] = useState(false)

  const { profile } = useUserProfile()
  const { target: viewAsTarget } = useViewAs()
  const canAddClients = (profile?.permissions.includes('clients.manage') ?? false) && !viewAsTarget
  const queryClient = useQueryClient()

  const params = new URLSearchParams({ type: tab })
  if (tab === 'CLIENT' && entityTypeFilter) params.set('entityType', entityTypeFilter)
  if (tab === 'CLIENT' && artistIdFilter) params.set('artistId', artistIdFilter)
  if (tab === 'CLIENT' && search.trim()) params.set('search', search.trim())

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['conversations', tab, entityTypeFilter, artistIdFilter, search.trim()],
    queryFn: () => apiFetch<ConversationSummary[]>(`/conversations?${params.toString()}`),
    refetchInterval: 30_000,
    enabled: isOpen,
  })

  const { data: roster } = useQuery({
    queryKey: ['conversations-staff-roster'],
    queryFn: () => apiFetch<StaffRosterEntry[]>('/conversations/staff'),
    enabled: isOpen && tab === 'STAFF',
  })

  const { data: artistOptions } = useQuery({
    queryKey: ['artists-for-conversation-filter'],
    queryFn: () => apiFetch<ArtistFilterOption[]>('/artists'),
    enabled: isOpen && tab === 'CLIENT' && showFilters,
  })

  // Only fetched once "New chat" is actually opened on the Clients tab --
  // lazy like the other on-demand pickers in this panel. POST /conversations
  // {clientId} is get-or-create, so picking any client here (not just ones
  // without a thread yet) safely resolves to their existing conversation.
  const { data: allClients } = useQuery({
    queryKey: ['clients-for-new-chat'],
    queryFn: () => apiFetch<NewChatClient[]>('/clients'),
    enabled: isOpen && tab === 'CLIENT' && showNewChat,
  })

  const rosterWithoutThread = (roster ?? []).filter((member) => !member.conversationId)
  const hasActiveFilter = !!(entityTypeFilter || artistIdFilter || search.trim())

  const newChatClientResults = (allClients ?? [])
    .filter((client) => `${client.firstName} ${client.lastName}`.toLowerCase().includes(newChatSearch.toLowerCase()))
    .slice(0, 20)
  const newChatStaffResults = rosterWithoutThread.filter((member) =>
    member.name.toLowerCase().includes(newChatSearch.toLowerCase()),
  )

  async function startClientChat(clientId: string) {
    setNewChatError(null)
    try {
      const conversation = await apiFetch<ConversationSummary>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ clientId }),
      })
      onSelect(conversation.id)
      setShowNewChat(false)
      setNewChatSearch('')
    } catch (err) {
      setNewChatError(err instanceof Error ? err.message : 'Failed to start conversation')
    }
  }

  async function startStaffChat(staffUserId: string) {
    setNewChatError(null)
    try {
      const conversation = await apiFetch<ConversationSummary>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ staffUserId }),
      })
      onSelect(conversation.id)
      setShowNewChat(false)
      setNewChatSearch('')
    } catch (err) {
      setNewChatError(err instanceof Error ? err.message : 'Failed to start conversation')
    }
  }

  async function handleAddNewClient(event: React.FormEvent) {
    event.preventDefault()
    setNewClientError(null)
    setAddingClient(true)
    try {
      const client = await apiFetch<{ id: string }>('/clients', {
        method: 'POST',
        body: JSON.stringify({
          firstName: newClientForm.firstName,
          lastName: newClientForm.lastName,
          email: newClientForm.email || undefined,
          phone: newClientForm.phone || undefined,
        }),
      })
      setShowAddClientModal(false)
      setNewClientForm({ firstName: '', lastName: '', email: '', phone: '' })
      queryClient.invalidateQueries({ queryKey: ['clients-for-new-chat'] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      await startClientChat(client.id)
    } catch (err) {
      setNewClientError(err instanceof Error ? err.message : 'Failed to create client')
    } finally {
      setAddingClient(false)
    }
  }

  // "Needs action" = something's waiting on the studio: an unread message,
  // or the featured inquiry sitting in a stage where the studio (not the
  // client) is the one expected to move it forward next.
  const NEEDS_ACTION_STATUSES = ['NEW', 'BUDGET_NEGOTIATION']
  const visibleConversations = (conversations ?? []).filter((conversation) => {
    if (quickFilter === 'unread') return conversation.unreadCount > 0
    if (quickFilter === 'needs-action') {
      return (
        conversation.unreadCount > 0 ||
        (conversation.primaryInquiry != null && NEEDS_ACTION_STATUSES.includes(conversation.primaryInquiry.status))
      )
    }
    return true
  })

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">Conversations</h2>
        <div className="flex items-center gap-1">
          {/* Artists only ever have their own single Team thread (see the
              staffUserId auto-resolve effect above) -- no roster to browse,
              so starting a new chat isn't a meaningful action for them. */}
          {showTabs && (
            <button
              type="button"
              onClick={() => {
                setShowNewChat((v) => !v)
                setNewChatSearch('')
                setNewChatError(null)
              }}
              aria-pressed={showNewChat}
              className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-hover"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              New Chat
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface hover:text-fg"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showNewChat && (
        <div className="border-b border-border px-3 py-3">
          <input
            type="text"
            autoFocus
            value={newChatSearch}
            onChange={(e) => setNewChatSearch(e.target.value)}
            placeholder={tab === 'CLIENT' ? 'Search clients…' : 'Search teammates…'}
            className="w-full rounded-lg border border-border bg-surface-inset px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
          />
          {newChatError && <p className="mt-1.5 text-xs text-danger">{newChatError}</p>}
          <ul className="mt-2 max-h-48 overflow-y-auto">
            {tab === 'CLIENT' &&
              newChatClientResults.map((client) => (
                <li key={client.id}>
                  <button
                    type="button"
                    onClick={() => startClientChat(client.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-fg-secondary hover:bg-surface"
                  >
                    <span className="truncate">
                      {client.firstName} {client.lastName}
                    </span>
                  </button>
                </li>
              ))}
            {tab === 'CLIENT' && newChatClientResults.length === 0 && (
              <li className="px-2.5 py-2 text-xs text-fg-muted">No clients match.</li>
            )}
            {tab === 'CLIENT' && canAddClients && (
              <li className="mt-1 border-t border-border pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const [firstName = '', ...rest] = newChatSearch.trim().split(/\s+/)
                    setNewClientForm({ firstName, lastName: rest.join(' '), email: '', phone: '' })
                    setNewClientError(null)
                    setShowAddClientModal(true)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-accent hover:bg-surface"
                >
                  <PlusIcon className="h-3.5 w-3.5 shrink-0" />
                  Add new client
                </button>
              </li>
            )}
            {tab === 'STAFF' &&
              newChatStaffResults.map((member) => (
                <li key={member.id}>
                  <button
                    type="button"
                    onClick={() => startStaffChat(member.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-fg-secondary hover:bg-surface"
                  >
                    <span className="truncate">{member.name}</span>
                  </button>
                </li>
              ))}
            {tab === 'STAFF' && newChatStaffResults.length === 0 && (
              <li className="px-2.5 py-2 text-xs text-fg-muted">
                Everyone already has a conversation with you.
              </li>
            )}
          </ul>
        </div>
      )}

      {showTabs && (
        <div className="flex gap-1 border-b border-border px-3 pt-2">
          {(['CLIENT', 'STAFF'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTabChange(t)}
              className={[
                'rounded-t-lg px-4 py-2 text-sm font-medium transition',
                tab === t ? 'bg-surface text-fg' : 'text-fg-muted hover:text-fg',
              ].join(' ')}
            >
              {t === 'CLIENT' ? 'Clients' : 'Team'}
            </button>
          ))}
        </div>
      )}

      {tab === 'CLIENT' && (
        <div className="border-b border-border px-3 pt-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search inquiries…"
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
          />
        </div>
      )}

      {/* Kept lightweight on purpose -- neither iMessage nor WhatsApp puts
          filter chips this prominently above the chat list, so these are
          plain text toggles tucked next to search rather than a bordered,
          filled-pill row competing with it. */}
      <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        {(
          [
            ['all', 'All'],
            ['unread', 'Unread'],
            ['needs-action', 'Needs action'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setQuickFilter(value)}
            className={[
              'rounded-md px-1.5 py-1 text-xs font-medium transition',
              quickFilter === value ? 'text-accent' : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            {label}
          </button>
        ))}

        {tab === 'CLIENT' && (
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-label="More filters"
            aria-pressed={showFilters}
            className={[
              'ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition hover:bg-surface hover:text-fg',
              hasActiveFilter ? 'text-accent' : 'text-fg-muted',
            ].join(' ')}
          >
            <TagIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {tab === 'CLIENT' && showFilters && (
        <div className="space-y-2 border-b border-border px-3 py-3">
          <div className="flex gap-2">
            <select
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-inset px-2.5 py-2 text-sm text-fg focus:border-accent focus:outline-none"
            >
              <option value="">Any tagged type</option>
              {TAGGABLE_ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={artistIdFilter}
              onChange={(e) => setArtistIdFilter(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-inset px-2.5 py-2 text-sm text-fg focus:border-accent focus:outline-none"
            >
              <option value="">Any artist</option>
              {artistOptions?.map((artist) => (
                <option key={artist.id} value={artist.id}>
                  {artist.user.name ?? artist.user.email}
                </option>
              ))}
            </select>
          </div>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => {
                setEntityTypeFilter('')
                setArtistIdFilter('')
                setSearch('')
              }}
              className="text-xs text-fg-muted underline hover:text-fg"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <p className="p-4 text-sm text-fg-secondary">Loading…</p>}

        {!isLoading && visibleConversations.length === 0 && rosterWithoutThread.length === 0 && (
          <p className="p-4 text-sm text-fg-secondary">
            {conversations && conversations.length > 0
              ? 'Nothing matches this filter.'
              : tab === 'CLIENT'
                ? 'No client conversations yet.'
                : 'No team conversations yet.'}
          </p>
        )}

        <ul className="divide-y divide-border">
          {visibleConversations.map((conversation) => {
            const tone = conversation.primaryInquiry ? getStatusTone(conversation.primaryInquiry.status) : null
            const name = conversation.counterpart?.name ?? 'Unknown'
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className="flex w-full items-center gap-3.5 px-4 py-4 text-left transition hover:bg-surface/60"
                >
                  <span
                    className={[
                      'relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-raised text-base font-semibold text-fg ring-2',
                      tone ? TONE_RING_CLASSES[tone] : 'ring-border-strong',
                    ].join(' ')}
                  >
                    {initials(name)}
                    {conversation.unreadCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full bg-warning ring-2 ring-surface-raised" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-base font-medium text-fg">{name}</p>
                      {conversation.lastMessageAt && (
                        <span className="shrink-0 text-xs text-fg-muted">
                          {formatRelativeTime(conversation.lastMessageAt)}
                        </span>
                      )}
                    </div>
                    {conversation.lastMessage && (
                      <p className="mt-1 truncate text-sm text-fg-secondary">
                        {conversation.lastMessage.direction === 'OUTBOUND' ? 'You: ' : ''}
                        {conversation.lastMessage.body || '📷 Image'}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-1.5">
                      {conversation.primaryInquiry && (
                        <StatusPill status={conversation.primaryInquiry.status} className="px-2 py-0.5 text-[11px]" />
                      )}
                      {conversation.unreadCount > 0 && (
                        <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-bg">
                          {conversation.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}

          {tab === 'STAFF' &&
            rosterWithoutThread.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={async () => {
                    const conversation = await apiFetch<ConversationSummary>('/conversations', {
                      method: 'POST',
                      body: JSON.stringify({ staffUserId: member.id }),
                    })
                    onSelect(conversation.id)
                  }}
                  className="flex w-full items-center justify-between gap-2 px-4 py-4 text-left transition hover:bg-surface/60"
                >
                  <span className="truncate text-base text-fg-secondary">{member.name}</span>
                  <span className="shrink-0 text-xs text-fg-muted">Start</span>
                </button>
              </li>
            ))}
        </ul>
      </div>

      {showAddClientModal && (
        <Modal title="Add Client" onClose={() => setShowAddClientModal(false)}>
          <form onSubmit={handleAddNewClient}>
            {newClientError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {newClientError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="new-chat-firstName" className="mb-1 block text-sm font-medium text-fg-secondary">
                  First Name
                </label>
                <input
                  id="new-chat-firstName"
                  type="text"
                  required
                  value={newClientForm.firstName}
                  onChange={(e) => setNewClientForm((f) => ({ ...f, firstName: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label htmlFor="new-chat-lastName" className="mb-1 block text-sm font-medium text-fg-secondary">
                  Last Name
                </label>
                <input
                  id="new-chat-lastName"
                  type="text"
                  required
                  value={newClientForm.lastName}
                  onChange={(e) => setNewClientForm((f) => ({ ...f, lastName: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            <div className="mt-3">
              <label htmlFor="new-chat-email" className="mb-1 block text-sm font-medium text-fg-secondary">
                Email
              </label>
              <input
                id="new-chat-email"
                type="email"
                value={newClientForm.email}
                onChange={(e) => setNewClientForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="mt-3">
              <label htmlFor="new-chat-phone" className="mb-1 block text-sm font-medium text-fg-secondary">
                Phone
              </label>
              <input
                id="new-chat-phone"
                type="tel"
                value={newClientForm.phone}
                onChange={(e) => setNewClientForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <button
              type="submit"
              disabled={addingClient}
              className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {addingClient ? 'Adding…' : 'Add Client & Start Chat'}
            </button>
          </form>
        </Modal>
      )}
    </>
  )
}

function ThreadView({
  conversationId,
  isOpen,
  canGoBack,
  onBack,
  onClose,
  onMessageSent,
  onContextOpenChange,
}: {
  conversationId: string
  isOpen: boolean
  canGoBack: boolean
  onBack: () => void
  onClose: () => void
  onMessageSent: () => void
  onContextOpenChange: (open: boolean) => void
}) {
  const user = useEffectiveUser()
  const { target: viewAsTarget } = useViewAs()
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['conversation-thread', conversationId],
    queryFn: () => apiFetch<ThreadResponse>(`/conversations/${conversationId}/messages`),
    refetchInterval: 15_000,
    enabled: isOpen,
  })

  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [channel, setChannel] = useState<string>('INSTAGRAM')
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND'>('OUTBOUND')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showLinkMenu, setShowLinkMenu] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [tagError, setTagError] = useState<string | null>(null)
  const [imagePickerFor, setImagePickerFor] = useState<string | null>(null)
  const [imageAttachError, setImageAttachError] = useState<string | null>(null)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showDraftModal, setShowDraftModal] = useState(false)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [draftFields, setDraftFields] = useState<Record<string, string>>({})
  const [creatingPrefillLink, setCreatingPrefillLink] = useState(false)
  // @-mention autocomplete: mentionQuery is the text typed after "@" (null
  // when no mention is in progress); mentionStart is the index of the "@"
  // itself, used to splice the picked name back into `body`.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  // "/" tag shortcut: same trigger/splice mechanics as "@" mentions above,
  // but picking a candidate calls handleAddTag (a conversation-level action)
  // instead of inserting text, so the "/query" is removed rather than
  // replaced -- it's a command, not something to leave visible in the message.
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [slashStart, setSlashStart] = useState<number | null>(null)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const bodyInputRef = useRef<HTMLTextAreaElement>(null)

  const isClientThread = data?.conversation.type === 'CLIENT'

  useEffect(() => {
    onContextOpenChange(isClientThread && showContext)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClientThread, showContext])

  useEffect(() => {
    // Marking read is itself a mutation (ConversationRead.lastReadAt) that
    // fires just from opening a thread, not an explicit user action -- and
    // while viewing as someone, it would incorrectly mark *their* real
    // thread read because the admin happened to look at it. Read-only mode
    // already blocks it server-side (403); skip the call entirely here so
    // opening a thread while impersonating doesn't spam blocked requests.
    if (!isOpen || viewAsTarget) return

    apiFetch(`/conversations/${conversationId}/read`, { method: 'POST' })
      .then(onMessageSent)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, isOpen, viewAsTarget])

  useEffect(() => {
    if (data?.messages.length) {
      const last = data.messages[data.messages.length - 1]
      setChannel(last.channel === 'IN_APP' ? 'INSTAGRAM' : last.channel)
    }
  }, [data?.messages])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [data?.messages])

  const { data: templatesData } = useQuery({
    queryKey: ['studio-settings-templates'],
    queryFn: () => apiFetch<{ messageTemplates: MessageTemplate[] | null }>('/studio-settings'),
    enabled: isOpen && isClientThread && showTemplates,
  })

  const { data: linksData } = useQuery({
    queryKey: ['client-shareable-links', data?.conversation.clientId],
    queryFn: () => apiFetch<ShareableLinksResponse>(`/clients/${data!.conversation.clientId}/shareable-links`),
    enabled: isOpen && isClientThread && showLinkMenu && !!data?.conversation.clientId,
  })

  // Only fetched once the user actually types "@" -- lazy like the other
  // composer popovers above, and shares its cache key with the roster query
  // in ConversationListView. /conversations/staff is OWNER/FRONT_DESK only
  // (artists only ever have their single Team thread, per that route's own
  // comment), so mention autocomplete is simply unavailable for artists --
  // they can still type "@name" by hand.
  const { data: mentionRoster } = useQuery({
    queryKey: ['conversations-staff-roster'],
    queryFn: () => apiFetch<StaffRosterEntry[]>('/conversations/staff'),
    enabled: isOpen && mentionQuery !== null && user?.role !== 'ARTIST',
  })

  const mentionCandidates =
    mentionQuery === null
      ? []
      : (mentionRoster ?? [])
          .filter((u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase()))
          .slice(0, 6)

  // Backs both the quick-details drawer and the "add tag" / "add to inquiry"
  // pickers -- all three need the same "what does this client have going on"
  // summary, so they share one query.
  const { data: context } = useQuery({
    queryKey: ['conversation-context', conversationId],
    queryFn: () => apiFetch<ConversationContext>(`/conversations/${conversationId}/context`),
    enabled: isOpen && isClientThread && (showContext || showTagPicker || imagePickerFor !== null || slashQuery !== null),
  })

  // Only relevant for a STAFF thread being viewed by an artist: used to
  // decide whether a "shared inquiry" card should deep-link to My Inquiries
  // (only if it's actually assigned to this artist -- never a staff-only view).
  const { data: assignedInquiries } = useQuery({
    queryKey: ['inquiries-assigned-to-me'],
    queryFn: () => apiFetch<{ id: string }[]>('/inquiries/assigned-to-me'),
    enabled: !isClientThread && user?.role === 'ARTIST',
  })
  const assignedInquiryIds = new Set((assignedInquiries ?? []).map((i) => i.id))

  const existingTagKeys = new Set((data?.conversation.tags ?? []).map((t) => `${t.entityType}:${t.entityId}`))

  // Same taggable-entity set as the tag picker below (context.inquiries /
  // giftCards / depositForms / nextAppointment / waiver), flattened into one
  // list for the "/" composer shortcut and filtered down to whatever's
  // typed after the slash. Already-tagged items are left out entirely --
  // nothing useful to do with them from a quick command palette.
  const slashCandidates =
    slashQuery === null || !context
      ? []
      : [
          ...context.inquiries.map((inquiry) => ({
            key: `Inquiry:${inquiry.id}`,
            entityType: 'Inquiry',
            entityId: inquiry.id,
            label: `Inquiry: ${inquiry.description}`,
          })),
          ...context.giftCards.map((card) => ({
            key: `GiftCard:${card.id}`,
            entityType: 'GiftCard',
            entityId: card.id,
            label: `Gift card: $${(card.amountCents / 100).toFixed(2)}`,
          })),
          ...context.inquiries
            .filter((i) => i.depositForm)
            .map((inquiry) => ({
              key: `DepositForm:${inquiry.depositForm!.id}`,
              entityType: 'DepositForm',
              entityId: inquiry.depositForm!.id,
              label: `Deposit: $${inquiry.depositForm!.totalCharged}`,
            })),
          ...(context.nextAppointment
            ? [
                {
                  key: `Appointment:${context.nextAppointment.id}`,
                  entityType: 'Appointment',
                  entityId: context.nextAppointment.id,
                  label: `Appointment: ${formatDateTime(context.nextAppointment.startTime)}`,
                },
              ]
            : []),
          ...(context.nextAppointment?.waiverId
            ? [
                {
                  key: `LiabilityWaiver:${context.nextAppointment.waiverId}`,
                  entityType: 'LiabilityWaiver',
                  entityId: context.nextAppointment.waiverId,
                  label: `Waiver: ${context.nextAppointment.waiverStatus}`,
                },
              ]
            : []),
        ]
          .filter((candidate) => !existingTagKeys.has(candidate.key))
          .filter((candidate) => candidate.label.toLowerCase().includes(slashQuery.toLowerCase()))
          .slice(0, 6)

  // The context drawer only has room to feature one inquiry prominently
  // (pipeline + detail grid); everything else surfaces as a "+N other" link
  // through to the client's full profile instead of being silently dropped.
  const featuredInquiry = pickPrimaryInquiry(context?.inquiries)
  const otherInquiries = (context?.inquiries ?? []).filter((i) => i.id !== featuredInquiry?.id)

  async function handleAddTag(entityType: string, entityId: string) {
    setTagError(null)
    try {
      await apiFetch(`/conversations/${conversationId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ entityType, entityId }),
      })
      queryClient.invalidateQueries({ queryKey: ['conversation-thread', conversationId] })
    } catch (err) {
      setTagError(err instanceof Error ? err.message : 'Failed to add tag')
    }
  }

  function selectSlashTag(candidate: { entityType: string; entityId: string }) {
    if (slashStart === null) return
    const caret = bodyInputRef.current?.selectionStart ?? body.length
    const nextBody = `${body.slice(0, slashStart)}${body.slice(caret)}`
    setBody(nextBody)
    setSlashQuery(null)
    setSlashStart(null)
    handleAddTag(candidate.entityType, candidate.entityId)

    requestAnimationFrame(() => {
      bodyInputRef.current?.focus()
      bodyInputRef.current?.setSelectionRange(slashStart, slashStart)
    })
  }

  async function handleRemoveTag(tagId: string) {
    setTagError(null)
    try {
      await apiFetch(`/conversations/${conversationId}/tags/${tagId}`, { method: 'DELETE' })
      queryClient.invalidateQueries({ queryKey: ['conversation-thread', conversationId] })
    } catch (err) {
      setTagError(err instanceof Error ? err.message : 'Failed to remove tag')
    }
  }

  async function handleAttachImageToInquiry(imageUrl: string, inquiryId: string) {
    setImageAttachError(null)
    try {
      await apiFetch(`/conversations/${conversationId}/attach-image`, {
        method: 'POST',
        body: JSON.stringify({ imageUrl, inquiryId }),
      })
      setImagePickerFor(null)
    } catch (err) {
      setImageAttachError(err instanceof Error ? err.message : 'Failed to add image to inquiry')
    }
  }

  async function handleOpenDraftModal() {
    setShowMoreMenu(false)
    setShowDraftModal(true)
    setDraftLoading(true)
    setDraftError(null)
    setDraftFields({})
    try {
      const result = await apiFetch<{ fields: Record<string, string> }>(`/conversations/${conversationId}/draft-inquiry`, {
        method: 'POST',
      })
      setDraftFields(result.fields)
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'AI drafting is temporarily unavailable.')
    } finally {
      setDraftLoading(false)
    }
  }

  async function handleCreatePrefillLink() {
    setCreatingPrefillLink(true)
    setDraftError(null)
    try {
      const result = await apiFetch<{ prefillUrl: string }>('/prefill-drafts', {
        method: 'POST',
        body: JSON.stringify({ payload: draftFields, conversationId }),
      })
      setBody((current) => (current ? `${current}\n${result.prefillUrl}` : result.prefillUrl))
      setShowDraftModal(false)
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Failed to create prefill link')
    } finally {
      setCreatingPrefillLink(false)
    }
  }

  async function handleAttach(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploading(true)
    setSendError(null)
    try {
      const url = await uploadImageToCloudinary(file)
      setAttachments((current) => [...current, url])
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Image upload failed')
    } finally {
      setUploading(false)
    }
  }

  function handleBodyChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value
    setBody(value)

    const caret = event.target.selectionStart ?? value.length
    const uptoCaret = value.slice(0, caret)

    // Allows one extra space-separated word so "First Last" names keep
    // matching after the space, without letting the query run away and
    // swallow the rest of the message.
    const mentionMatch = uptoCaret.match(/(?:^|\s)@(\w*(?:\s\w*)?)$/)
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1])
      setMentionStart(caret - mentionMatch[1].length - 1)
      setMentionActiveIndex(0)
      setSlashQuery(null)
      setSlashStart(null)
      return
    }
    setMentionQuery(null)
    setMentionStart(null)

    // "/" tagging shortcut only makes sense for client threads -- staff
    // threads have no inquiry/gift-card/appointment context to tag.
    const slashMatch = isClientThread ? uptoCaret.match(/(?:^|\s)\/(\w*(?:\s\w*)?)$/) : null
    if (slashMatch) {
      setSlashQuery(slashMatch[1])
      setSlashStart(caret - slashMatch[1].length - 1)
      setSlashActiveIndex(0)
    } else {
      setSlashQuery(null)
      setSlashStart(null)
    }
  }

  function selectMention(candidate: StaffRosterEntry) {
    if (mentionStart === null) return
    const caret = bodyInputRef.current?.selectionStart ?? body.length
    const insertion = `@${candidate.name} `
    const nextBody = `${body.slice(0, mentionStart)}${insertion}${body.slice(caret)}`
    setBody(nextBody)
    setMentionQuery(null)
    setMentionStart(null)

    const nextCaret = mentionStart + insertion.length
    requestAnimationFrame(() => {
      bodyInputRef.current?.focus()
      bodyInputRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionActiveIndex((i) => (i + 1) % mentionCandidates.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionActiveIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        selectMention(mentionCandidates[mentionActiveIndex])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setMentionQuery(null)
        setMentionStart(null)
      }
      return
    }

    if (slashQuery !== null && slashCandidates.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlashActiveIndex((i) => (i + 1) % slashCandidates.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashActiveIndex((i) => (i - 1 + slashCandidates.length) % slashCandidates.length)
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        selectSlashTag(slashCandidates[slashActiveIndex])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setSlashQuery(null)
        setSlashStart(null)
      }
    }
  }

  async function handleSend() {
    if (body.trim().length === 0 && attachments.length === 0) return

    setSending(true)
    setSendError(null)

    try {
      await apiFetch(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: body.trim(),
          attachments: attachments.length > 0 ? attachments : undefined,
          ...(isClientThread ? { channel, direction } : {}),
        }),
      })
      setBody('')
      setAttachments([])
      queryClient.invalidateQueries({ queryKey: ['conversation-thread', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      onMessageSent()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const counterpartName = data?.conversation.counterpart?.name ?? 'Conversation'
  const primaryInquiry = data?.conversation.primaryInquiry ?? null
  const headerTone = primaryInquiry ? getStatusTone(primaryInquiry.status) : null

  // Precomputed once per render (not derived during JSX evaluation) so a
  // "group" -- a burst of consecutive same-side messages within the same
  // minute -- is a single render unit with one meta row, instead of
  // recomputing lookback/lookahead state inline per bubble. Shared-inquiry
  // cards never join a group; they're a distinct one-off card, not a chat
  // bubble.
  const messageGroups: { messages: MessageItem[]; isOutboundSide: boolean; showDaySeparator: boolean }[] = []
  {
    let lastDayForGrouping = ''
    for (const message of data?.messages ?? []) {
      const isOutboundSide = isClientThread
        ? message.direction === 'OUTBOUND'
        : message.authorUserId === user?.userId
      const isSharedInquiry = message.metadata?.kind === 'shared_inquiry'
      const showDaySeparator = dayKey(message.createdAt) !== lastDayForGrouping
      lastDayForGrouping = dayKey(message.createdAt)

      const prevGroup = messageGroups[messageGroups.length - 1]
      const prevMessage = prevGroup?.messages[prevGroup.messages.length - 1]
      const canJoinPrevGroup =
        !showDaySeparator &&
        !isSharedInquiry &&
        prevGroup != null &&
        prevMessage != null &&
        prevMessage.metadata?.kind !== 'shared_inquiry' &&
        prevGroup.isOutboundSide === isOutboundSide &&
        sameMinute(prevMessage.createdAt, message.createdAt)

      if (canJoinPrevGroup && prevGroup) {
        prevGroup.messages.push(message)
      } else {
        messageGroups.push({ messages: [message], isOutboundSide, showDaySeparator })
      }
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        {canGoBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface hover:text-fg"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
        )}
        {isClientThread && (
          <span
            className={[
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs font-semibold text-fg ring-2',
              headerTone ? TONE_RING_CLASSES[headerTone] : 'ring-border-strong',
            ].join(' ')}
          >
            {initials(counterpartName)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-fg">{counterpartName}</h2>
            {primaryInquiry && <StatusPill status={primaryInquiry.status} className="px-2 py-0.5 text-[11px]" />}
          </div>
          {primaryInquiry && (
            <p className="truncate text-xs text-fg-muted">
              {truncateText(primaryInquiry.description, 40)} · {primaryInquiry.placement}
            </p>
          )}
        </div>
        {isClientThread && (
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={() => {
                setShowTagPicker((v) => !v)
                setShowContext(false)
              }}
              aria-label="Add tag"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface hover:text-fg"
            >
              <TagIcon className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowContext((v) => !v)
                setShowTagPicker(false)
              }}
              aria-label="Client details"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface hover:text-fg"
            >
              <InfoIcon className="h-[18px] w-[18px]" />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMoreMenu((v) => !v)}
                aria-label="More actions"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface hover:text-fg"
              >
                <MoreIcon className="h-[18px] w-[18px]" />
              </button>
              {showMoreMenu && (
                <div className="absolute right-0 top-9 z-20 w-56 rounded-xl border border-border bg-surface-raised p-1 shadow-xl">
                  <button
                    type="button"
                    onClick={handleOpenDraftModal}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface"
                  >
                    <SparkleIcon className="h-3.5 w-3.5" />
                    Draft inquiry from conversation
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {isClientThread && data.conversation.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
          {data.conversation.tags.map((tag) => (
            <span
              key={tag.id}
              className="flex items-center gap-1 rounded-full border border-border bg-surface/60 px-2 py-0.5 text-[11px] text-fg-secondary"
            >
              <Link to={tag.deepLink} onClick={onClose} className="hover:text-fg">
                {tag.entityType}: {tag.label}
              </Link>
              <button
                type="button"
                onClick={() => handleRemoveTag(tag.id)}
                aria-label={`Remove ${tag.entityType} tag`}
                className="text-fg-muted hover:text-fg"
              >
                <CloseIcon className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {isClientThread && showTagPicker && (
        <div className="max-h-48 overflow-y-auto border-b border-border px-3 py-2">
          {tagError && <p className="mb-1 text-xs text-danger">{tagError}</p>}
          {!context && <p className="text-xs text-fg-muted">Loading…</p>}
          {context && (
            <div className="space-y-1">
              {context.inquiries.map((inquiry) => {
                const key = `Inquiry:${inquiry.id}`
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={existingTagKeys.has(key)}
                    onClick={() => handleAddTag('Inquiry', inquiry.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="truncate">Inquiry: {inquiry.description}</span>
                    {!existingTagKeys.has(key) && <PlusIcon className="h-3 w-3 shrink-0" />}
                  </button>
                )
              })}
              {context.giftCards.map((card) => {
                const key = `GiftCard:${card.id}`
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={existingTagKeys.has(key)}
                    onClick={() => handleAddTag('GiftCard', card.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="truncate">Gift card: ${(card.amountCents / 100).toFixed(2)}</span>
                    {!existingTagKeys.has(key) && <PlusIcon className="h-3 w-3 shrink-0" />}
                  </button>
                )
              })}
              {context.inquiries
                .filter((i) => i.depositForm)
                .map((inquiry) => {
                  const key = `DepositForm:${inquiry.depositForm!.id}`
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={existingTagKeys.has(key)}
                      onClick={() => handleAddTag('DepositForm', inquiry.depositForm!.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="truncate">Deposit: ${inquiry.depositForm!.totalCharged}</span>
                      {!existingTagKeys.has(key) && <PlusIcon className="h-3 w-3 shrink-0" />}
                    </button>
                  )
                })}
              {context.nextAppointment && (
                <button
                  type="button"
                  disabled={existingTagKeys.has(`Appointment:${context.nextAppointment.id}`)}
                  onClick={() => handleAddTag('Appointment', context.nextAppointment!.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-fg-secondary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="truncate">Appointment: {formatDateTime(context.nextAppointment.startTime)}</span>
                  {!existingTagKeys.has(`Appointment:${context.nextAppointment.id}`) && <PlusIcon className="h-3 w-3 shrink-0" />}
                </button>
              )}
              {context.nextAppointment?.waiverId && (
                <button
                  type="button"
                  disabled={existingTagKeys.has(`LiabilityWaiver:${context.nextAppointment.waiverId}`)}
                  onClick={() => handleAddTag('LiabilityWaiver', context.nextAppointment!.waiverId!)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-fg-secondary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="truncate">Waiver: {context.nextAppointment.waiverStatus}</span>
                  {!existingTagKeys.has(`LiabilityWaiver:${context.nextAppointment.waiverId}`) && (
                    <PlusIcon className="h-3 w-3 shrink-0" />
                  )}
                </button>
              )}
              {context.inquiries.length === 0 && context.giftCards.length === 0 && !context.nextAppointment && (
                <p className="px-2 py-1 text-xs text-fg-muted">Nothing to tag yet for this client.</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {isClientThread && showContext && (
          // Mobile: full overlay covering the thread (absolute inset-0) --
          // there's no spare width to dock into, so it stays an overlay.
          // Desktop (sm:): docks as a second column instead -- sm:order-last
          // visually places it after the thread without needing to move it
          // in the DOM, sm:static drops it out of the overlay positioning.
          // The slide-over itself grows wider (see onContextOpenChange) so
          // this column adds new space rather than squeezing the thread.
          <div className="absolute inset-0 z-20 flex min-h-0 flex-col bg-bg sm:static sm:z-auto sm:order-last sm:w-72 sm:shrink-0 sm:border-l sm:border-border">
            {!context && <p className="p-4 text-sm text-fg-secondary">Loading…</p>}
            {context && (
              <>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
                  <div>
                    <p className="text-lg font-bold text-fg">
                      {context.client.firstName} {context.client.lastName}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {featuredInquiry ? clientRoleLabel(featuredInquiry.status) : 'Client'}
                    </p>
                  </div>

                  <dl className="space-y-2.5 border-t border-border pt-4">
                    {[
                      ['Phone', context.client.phone ?? 'Not provided'],
                      ['Email', context.client.email ?? 'Not provided'],
                      ...(featuredInquiry
                        ? [
                            ['Placement', featuredInquiry.placement],
                            ['Size', featuredInquiry.estimatedSize],
                            ['Style', featuredInquiry.colorOrBlackGrey],
                            [
                              'Budget',
                              featuredInquiry.budget ??
                                (featuredInquiry.priceEstimateLow != null && featuredInquiry.priceEstimateHigh != null
                                  ? `$${featuredInquiry.priceEstimateLow}-$${featuredInquiry.priceEstimateHigh}`
                                  : 'Not provided'),
                            ],
                            [
                              'Artist',
                              featuredInquiry.assignedArtist?.user.name ??
                                featuredInquiry.assignedArtist?.user.email ??
                                'Unassigned',
                            ],
                          ]
                        : []),
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-3">
                        <dt className="shrink-0 text-xs text-fg-muted">{label}</dt>
                        <dd className="truncate text-right text-xs font-medium text-fg">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  {featuredInquiry && (
                    <div className="border-t border-border pt-4">
                      <InquiryPipeline
                        status={featuredInquiry.status}
                        closedReason={featuredInquiry.closedReason}
                        orientation="vertical"
                      />
                    </div>
                  )}

                  {otherInquiries.length > 0 && (
                    <Link
                      to={`/clients/${context.client.id}`}
                      onClick={onClose}
                      className="block text-xs font-medium text-fg-secondary hover:text-fg"
                    >
                      + {otherInquiries.length} other {otherInquiries.length === 1 ? 'inquiry' : 'inquiries'}
                    </Link>
                  )}

                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Next appointment</p>
                    {!context.nextAppointment && <p className="mt-1 text-xs text-fg-muted">None scheduled</p>}
                    {context.nextAppointment && (
                      <Link
                        to={`/appointments/${context.nextAppointment.id}`}
                        onClick={onClose}
                        className="mt-1 block rounded-lg border border-border px-2.5 py-2 hover:bg-surface/60"
                      >
                        <p className="text-xs text-fg">{formatDateTime(context.nextAppointment.startTime)}</p>
                        <p className="mt-0.5 text-[11px] text-fg-muted">
                          with {context.nextAppointment.artistName}
                          {context.nextAppointment.waiverStatus
                            ? ` · Waiver: ${context.nextAppointment.waiverStatus}`
                            : ''}
                        </p>
                      </Link>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Gift cards</p>
                    {context.giftCards.length === 0 && <p className="mt-1 text-xs text-fg-muted">None</p>}
                    {context.giftCards.map((card) => (
                      <Link
                        key={card.id}
                        to={`/gift-cards/${card.id}`}
                        onClick={onClose}
                        className="mt-1 block rounded-lg border border-border px-2.5 py-2 hover:bg-surface/60"
                      >
                        <p className="text-xs text-fg">${(card.amountCents / 100).toFixed(2)}</p>
                        <div className="mt-1">
                          <StatusPill status={card.status} />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 border-t border-border p-4">
                  {featuredInquiry && (
                    <Link
                      to={`/inquiries/${featuredInquiry.id}`}
                      onClick={onClose}
                      className="block w-full rounded-full bg-accent px-4 py-2 text-center text-sm font-semibold text-bg transition hover:bg-accent-hover"
                    >
                      {nextActionLabel(featuredInquiry.status)}
                    </Link>
                  )}
                  <Link
                    to={`/clients/${context.client.id}`}
                    onClick={onClose}
                    className="block w-full rounded-full border border-border px-4 py-2 text-center text-sm font-medium text-fg transition hover:bg-surface"
                  >
                    View client profile
                  </Link>
                </div>
              </>
            )}
          </div>
        )}

        <div ref={scrollRef} className="h-full min-w-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {isLoading && <p className="text-sm text-fg-secondary">Loading…</p>}

          {messageGroups.map((group) => {
            const firstMessage = group.messages[0]
            const lastMessage = group.messages[group.messages.length - 1]
            const sharedInquiryId =
              firstMessage.metadata?.kind === 'shared_inquiry' ? firstMessage.metadata.inquiryId : null
            const sharedInquiryLink =
              sharedInquiryId && user?.role === 'ARTIST' && assignedInquiryIds.has(sharedInquiryId)
                ? '/my-inquiries'
                : null

            return (
              <div key={firstMessage.id}>
                {group.showDaySeparator && (
                  <p className="my-2 text-center text-[11px] uppercase tracking-wider text-fg-muted">
                    {dayLabel(firstMessage.createdAt)}
                  </p>
                )}

                <div className={`flex ${group.isOutboundSide ? 'justify-end' : 'justify-start'}`}>
                  <div className="flex max-w-[75%] items-end gap-2">
                    {!group.isOutboundSide && (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[10px] font-semibold text-fg">
                        {initials(counterpartName)}
                      </span>
                    )}

                    <div className={`flex min-w-0 flex-col ${group.isOutboundSide ? 'items-end' : 'items-start'}`}>
                      {!isClientThread && (
                        <p className="mb-1 px-1 text-[11px] font-medium text-fg-secondary">
                          {firstMessage.author?.name ?? firstMessage.author?.email ?? 'Unknown'}
                        </p>
                      )}

                      {group.messages.map((message, i) => {
                        const isLastInGroup = i === group.messages.length - 1
                        const cornerClass = sharedInquiryId
                          ? 'rounded-[1.25rem]'
                          : !isLastInGroup
                            ? 'rounded-[18px]'
                            : group.isOutboundSide
                              ? 'rounded-tl-[18px] rounded-tr-[18px] rounded-bl-[18px] rounded-br-[5px]'
                              : 'rounded-tl-[18px] rounded-tr-[18px] rounded-br-[18px] rounded-bl-[5px]'

                        return (
                          <div
                            key={message.id}
                            className={[
                              i === 0 ? '' : 'mt-[3px]',
                              'max-w-full px-4 py-2.5 text-sm text-[#f2f2f0]',
                              cornerClass,
                              sharedInquiryId
                                ? 'border border-border bg-surface-raised/80'
                                : group.isOutboundSide
                                  ? 'border border-[#3d461f] bg-[#23281a]'
                                  : 'border border-[#26262c] bg-[#1c1c21]',
                            ].join(' ')}
                          >
                            {sharedInquiryId && i === 0 && (
                              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
                                Shared inquiry
                              </p>
                            )}
                            {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
                            {message.attachments && message.attachments.length > 0 && (
                              <div className={sharedInquiryId ? 'mt-1.5 grid grid-cols-2 gap-1' : 'mt-1.5 space-y-1.5'}>
                                {message.attachments.map((url) => (
                                  <div key={url} className="group relative">
                                    <img
                                      src={url}
                                      alt="Attachment"
                                      className={sharedInquiryId ? 'max-h-48 rounded-lg' : 'w-full rounded-[12px]'}
                                    />
                                    {isClientThread && !sharedInquiryId && (
                                      <button
                                        type="button"
                                        onClick={() => setImagePickerFor(imagePickerFor === url ? null : url)}
                                        className="absolute bottom-1 right-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-fg opacity-0 transition group-hover:opacity-100"
                                      >
                                        Add to inquiry
                                      </button>
                                    )}
                                    {imagePickerFor === url && (
                                      <div className="absolute bottom-full right-0 z-10 mb-1 w-48 rounded-xl border border-border bg-surface-raised p-1.5 shadow-xl">
                                        {imageAttachError && (
                                          <p className="px-1 pb-1 text-[10px] text-danger">{imageAttachError}</p>
                                        )}
                                        {!context && <p className="px-1 py-1 text-[10px] text-fg-muted">Loading…</p>}
                                        {context && context.inquiries.length === 0 && (
                                          <p className="px-1 py-1 text-[10px] text-fg-muted">
                                            No inquiries for this client.
                                          </p>
                                        )}
                                        {context?.inquiries.map((inquiry) => (
                                          <button
                                            key={inquiry.id}
                                            type="button"
                                            onClick={() => handleAttachImageToInquiry(url, inquiry.id)}
                                            className="block w-full truncate rounded-md px-2 py-1 text-left text-[11px] text-fg-secondary hover:bg-surface"
                                          >
                                            {inquiry.description}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {sharedInquiryLink && isLastInGroup && (
                              <Link
                                to={sharedInquiryLink}
                                onClick={onClose}
                                className="mt-1 flex items-center gap-1 text-[11px] font-medium text-fg-secondary hover:text-fg"
                              >
                                View in My Inquiries <ArrowUpRightIcon className="h-3 w-3" />
                              </Link>
                            )}
                          </div>
                        )
                      })}

                      {isClientThread ? (
                        <div className="mt-1 flex items-center gap-1.5 px-1 text-[10.5px] text-[#8a8a92]">
                          <ChannelDot channel={lastMessage.channel} />
                          <span>{channelLabel(lastMessage.channel)}</span>
                          <span>{formatDateTime(lastMessage.createdAt)}</span>
                        </div>
                      ) : (
                        <p className="mt-1 px-1 text-[10.5px] text-[#8a8a92]">{formatDateTime(lastMessage.createdAt)}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="border-t border-border p-3">
        {isClientThread && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {CLIENT_CHANNELS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  aria-pressed={channel === c}
                  className={[
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition',
                    channel === c
                      ? 'border-[#c8e04a] bg-[#3a4118] text-[#c8e04a]'
                      : 'border-border text-fg-secondary hover:bg-surface hover:text-fg',
                  ].join(' ')}
                >
                  <ChannelDot channel={c} />
                  {channelLabel(c)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-full border border-border p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setDirection('INBOUND')}
                className={`rounded-full px-2.5 py-1 ${direction === 'INBOUND' ? 'bg-accent text-bg' : 'text-fg-muted'}`}
              >
                Their message
              </button>
              <button
                type="button"
                onClick={() => setDirection('OUTBOUND')}
                className={`rounded-full px-2.5 py-1 ${direction === 'OUTBOUND' ? 'bg-accent text-bg' : 'text-fg-muted'}`}
              >
                Our reply
              </button>
            </div>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((url) => (
              <div key={url} className="relative h-14 w-14 overflow-hidden rounded-lg border border-border">
                <img src={url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((a) => a !== url))}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-fg"
                >
                  <CloseIcon className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {showTemplates && isClientThread && (
          <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-border p-2">
            {(templatesData?.messageTemplates ?? []).length === 0 && (
              <p className="p-1 text-xs text-fg-muted">No templates configured (Settings → Policies &amp; Defaults).</p>
            )}
            {templatesData?.messageTemplates?.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => {
                  setBody((current) => (current ? `${current}\n${template.body}` : template.body))
                  setShowTemplates(false)
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface"
              >
                <span className="font-medium text-fg">{template.name}</span>
              </button>
            ))}
          </div>
        )}

        {showLinkMenu && isClientThread && (
          <div className="mb-2 max-h-48 overflow-y-auto rounded-lg border border-border p-2 text-sm">
            {[
              { label: 'Intake form', url: linksData?.intakeFormUrl ?? null, hint: null },
              ...(linksData?.estimateLinks ?? []),
              ...(linksData?.depositLinks ?? []),
              ...(linksData?.waiverLinks ?? []),
              ...(linksData?.giftCardLinks ?? []),
            ].map((link, i) => (
              <button
                key={i}
                type="button"
                disabled={!link.url}
                onClick={() => {
                  const url = link.url
                  if (!url) return
                  setBody((current) => (current ? `${current}\n${url}` : url))
                  setShowLinkMenu(false)
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-fg-secondary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>{link.label}</span>
                {link.hint && <span className="shrink-0 text-fg-muted">{link.hint}</span>}
              </button>
            ))}
          </div>
        )}

        {sendError && <p className="mb-2 text-xs text-danger">{sendError}</p>}

        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-border p-1">
            {mentionCandidates.map((candidate, index) => (
              <button
                key={candidate.id}
                type="button"
                onMouseDown={(e) => {
                  // Prevent the textarea from losing focus/selection before
                  // selectMention reads its caret position.
                  e.preventDefault()
                  selectMention(candidate)
                }}
                className={[
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                  index === mentionActiveIndex ? 'bg-surface text-fg' : 'text-fg-secondary hover:bg-surface',
                ].join(' ')}
              >
                {candidate.avatarUrl ? (
                  <img src={candidate.avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[11px] font-semibold text-fg">
                    {candidate.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{candidate.name}</span>
                  <span className="ml-1.5 text-fg-muted">{candidate.email}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {slashQuery !== null && slashCandidates.length > 0 && (
          <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-border p-1">
            {slashCandidates.map((candidate, index) => (
              <button
                key={candidate.key}
                type="button"
                onMouseDown={(e) => {
                  // Prevent the textarea from losing focus/selection before
                  // selectSlashTag reads its caret position.
                  e.preventDefault()
                  selectSlashTag(candidate)
                }}
                className={[
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                  index === slashActiveIndex ? 'bg-surface text-fg' : 'text-fg-secondary hover:bg-surface',
                ].join(' ')}
              >
                <TagIcon className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
              </button>
            ))}
          </div>
        )}

        {isClientThread && (
          <div className="mb-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setShowTemplates((v) => !v)
                setShowLinkMenu(false)
              }}
              aria-label="Templates"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-xs font-semibold text-fg-secondary transition hover:bg-surface hover:text-fg"
            >
              T
            </button>
            <button
              type="button"
              onClick={() => {
                setShowLinkMenu((v) => !v)
                setShowTemplates(false)
              }}
              aria-label="Insert link"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-fg-secondary transition hover:bg-surface hover:text-fg"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2.5">
          <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent text-fg-muted transition hover:bg-surface hover:text-fg">
            <AttachmentIcon className="h-[18px] w-[18px]" />
            <input type="file" accept="image/*" onChange={handleAttach} className="hidden" disabled={uploading} />
          </label>

          <textarea
            ref={bodyInputRef}
            rows={1}
            value={body}
            onChange={handleBodyChange}
            onKeyDown={handleComposerKeyDown}
            placeholder={isClientThread ? 'Type a message… (@ to mention, / to tag)' : 'Type a message… (@ to mention)'}
            className="h-10 min-w-0 flex-1 resize-none rounded-full border border-border bg-surface-inset px-4 py-2.5 text-sm leading-5 text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />

          <button
            type="button"
            onClick={handleSend}
            disabled={sending || uploading || !!viewAsTarget || (body.trim().length === 0 && attachments.length === 0)}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-bg transition hover:bg-accent-hover disabled:opacity-60"
          >
            <SendIcon className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {showDraftModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
          onClick={() => setShowDraftModal(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-fg">Draft inquiry from conversation</h2>
              <button
                type="button"
                onClick={() => setShowDraftModal(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface hover:text-fg"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-3 text-xs text-fg-muted">
              AI-drafted from this conversation — review before sending.
            </p>

            {draftLoading && <p className="mt-4 text-sm text-fg-secondary">Extracting fields…</p>}
            {draftError && <p className="mt-4 text-sm text-danger">{draftError}</p>}

            {!draftLoading && (
              <div className="mt-4 space-y-3">
                {DRAFT_FIELD_ORDER.map((field) => (
                  <div key={field}>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">{DRAFT_FIELD_LABELS[field]}</label>
                    {field === 'description' ? (
                      <textarea
                        rows={3}
                        value={draftFields[field] ?? ''}
                        onChange={(e) => setDraftFields((current) => ({ ...current, [field]: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    ) : (
                      <input
                        type="text"
                        value={draftFields[field] ?? ''}
                        onChange={(e) => setDraftFields((current) => ({ ...current, [field]: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    )}
                  </div>
                ))}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleCreatePrefillLink}
                    disabled={creatingPrefillLink || Object.values(draftFields).every((v) => !v)}
                    className="flex-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    {creatingPrefillLink ? 'Creating…' : 'Create prefill link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDraftModal(false)}
                    className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
