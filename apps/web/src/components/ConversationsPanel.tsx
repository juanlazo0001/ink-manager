import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { formatDateTime, formatRelativeTime, formatStatus } from '../lib/format'
import { uploadImageToCloudinary } from '../lib/cloudinary'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useViewAs } from '../context/useViewAs'
import { useConversationPanel } from '../context/useConversationPanel'
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

interface ConversationSummary {
  id: string
  type: Tab
  clientId: string | null
  staffUserId: string | null
  lastMessageAt: string | null
  counterpart: { id: string; name: string } | null
  lastMessage: { body: string; channel: string; direction: string; createdAt: string } | null
  unreadCount: number
}

interface StaffRosterEntry {
  id: string
  name: string
  email: string
  role: string
  conversationId: string | null
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
    tags: ConversationTag[]
  }
  messages: MessageItem[]
  nextCursor: string | null
}

interface ConversationContext {
  client: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null }
  inquiries: {
    id: string
    description: string
    status: string
    priceEstimateLow: number | null
    priceEstimateHigh: number | null
    depositForm: { id: string; totalCharged: number; signedAt: string | null; paidManually: boolean } | null
  }[]
  giftCards: { id: string; amountCents: number; status: string; expiresAt: string | null }[]
  nextAppointment: {
    id: string
    startTime: string
    artistName: string
    waiverId: string | null
    waiverStatus: string | null
  } | null
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

export default function ConversationsPanel() {
  const user = useEffectiveUser()
  const queryClient = useQueryClient()
  const { isOpen, activeConversationId, openPanel, closePanel } = useConversationPanel()

  const isArtist = user?.role === 'ARTIST'
  const [tab, setTab] = useState<Tab>('CLIENT')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Artists only ever have their own single Team thread -- no tab UI, no
  // list, just get-or-create it and go straight there.
  useEffect(() => {
    if (!isOpen || !isArtist || !user) return
    apiFetch<ConversationSummary>('/conversations', { method: 'POST', body: JSON.stringify({ staffUserId: user.userId }) })
      .then((conversation) => setSelectedId(conversation.id))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isArtist])

  useEffect(() => {
    if (activeConversationId) setSelectedId(activeConversationId)
  }, [activeConversationId])

  // UI-1 §8: Esc dismisses the slide-over, same as the scrim/close button.
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closePanel()
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
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 text-white shadow-xl transition hover:bg-neutral-700"
      >
        <MessageIcon className="h-6 w-6" />
        {!!badgeCounts?.conversations && badgeCounts.conversations > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold text-white">
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
          animates; content inside only renders while open, so a closed
          panel does no background polling. Desktop gets real working
          width (~560px) rather than a cramped floating card; mobile is a
          full-screen takeover. Rendered once at the app root (see App.tsx),
          so it -- and whichever thread is open -- survives route changes
          while open. */}
      <div
        className={[
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-neutral-800 bg-neutral-900 shadow-2xl transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
          'sm:w-[560px]',
        ].join(' ')}
        aria-hidden={!isOpen}
      >
        {isOpen &&
          (selectedId ? (
            <ThreadView
              conversationId={selectedId}
              canGoBack={!isArtist}
              onBack={() => setSelectedId(null)}
              onClose={closePanel}
              onMessageSent={refreshNavCounts}
            />
          ) : (
            <ConversationListView
              tab={tab}
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
  onTabChange,
  showTabs,
  onSelect,
  onClose,
}: {
  tab: Tab
  onTabChange: (tab: Tab) => void
  showTabs: boolean
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const [entityTypeFilter, setEntityTypeFilter] = useState('')
  const [artistIdFilter, setArtistIdFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const params = new URLSearchParams({ type: tab })
  if (tab === 'CLIENT' && entityTypeFilter) params.set('entityType', entityTypeFilter)
  if (tab === 'CLIENT' && artistIdFilter) params.set('artistId', artistIdFilter)
  if (tab === 'CLIENT' && search.trim()) params.set('search', search.trim())

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['conversations', tab, entityTypeFilter, artistIdFilter, search.trim()],
    queryFn: () => apiFetch<ConversationSummary[]>(`/conversations?${params.toString()}`),
    refetchInterval: 30_000,
  })

  const { data: roster } = useQuery({
    queryKey: ['conversations-staff-roster'],
    queryFn: () => apiFetch<StaffRosterEntry[]>('/conversations/staff'),
    enabled: tab === 'STAFF',
  })

  const { data: artistOptions } = useQuery({
    queryKey: ['artists-for-conversation-filter'],
    queryFn: () => apiFetch<ArtistFilterOption[]>('/artists'),
    enabled: tab === 'CLIENT' && showFilters,
  })

  const rosterWithoutThread = (roster ?? []).filter((member) => !member.conversationId)
  const hasActiveFilter = !!(entityTypeFilter || artistIdFilter || search.trim())

  return (
    <>
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Conversations</h2>
        <div className="flex items-center gap-1">
          {tab === 'CLIENT' && (
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              aria-label="Filter conversations"
              className={[
                'flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-neutral-800 hover:text-white',
                hasActiveFilter ? 'text-white' : 'text-neutral-500',
              ].join(' ')}
            >
              <TagIcon className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showTabs && (
        <div className="flex gap-1 border-b border-neutral-800 px-3 pt-2">
          {(['CLIENT', 'STAFF'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTabChange(t)}
              className={[
                'rounded-t-lg px-3 py-1.5 text-xs font-medium transition',
                tab === t ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-white',
              ].join(' ')}
            >
              {t === 'CLIENT' ? 'Clients' : 'Team'}
            </button>
          ))}
        </div>
      )}

      {tab === 'CLIENT' && showFilters && (
        <div className="space-y-2 border-b border-neutral-800 px-3 py-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by client name…"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs text-white focus:border-neutral-600 focus:outline-none"
          />
          <div className="flex gap-2">
            <select
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-white focus:border-neutral-600 focus:outline-none"
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
              className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-white focus:border-neutral-600 focus:outline-none"
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
              className="text-xs text-neutral-500 underline hover:text-white"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <p className="p-4 text-sm text-neutral-400">Loading…</p>}

        {!isLoading && conversations?.length === 0 && rosterWithoutThread.length === 0 && (
          <p className="p-4 text-sm text-neutral-400">
            {tab === 'CLIENT' ? 'No client conversations yet.' : 'No team conversations yet.'}
          </p>
        )}

        <ul className="divide-y divide-neutral-800">
          {conversations?.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => onSelect(conversation.id)}
                className="flex w-full items-start gap-2 px-4 py-3 text-left transition hover:bg-neutral-800/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-white">
                      {conversation.counterpart?.name ?? 'Unknown'}
                    </p>
                    {conversation.lastMessageAt && (
                      <span className="shrink-0 text-[11px] text-neutral-500">
                        {formatRelativeTime(conversation.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  {conversation.lastMessage && (
                    <p className="mt-0.5 truncate text-xs text-neutral-400">
                      {conversation.lastMessage.direction === 'OUTBOUND' ? 'You: ' : ''}
                      {conversation.lastMessage.body || '📷 Image'}
                    </p>
                  )}
                </div>
                {conversation.unreadCount > 0 && (
                  <span className="mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">
                    {conversation.unreadCount}
                  </span>
                )}
              </button>
            </li>
          ))}

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
                  className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-neutral-800/60"
                >
                  <span className="truncate text-sm text-neutral-300">{member.name}</span>
                  <span className="shrink-0 text-[11px] text-neutral-500">Start</span>
                </button>
              </li>
            ))}
        </ul>
      </div>
    </>
  )
}

function ThreadView({
  conversationId,
  canGoBack,
  onBack,
  onClose,
  onMessageSent,
}: {
  conversationId: string
  canGoBack: boolean
  onBack: () => void
  onClose: () => void
  onMessageSent: () => void
}) {
  const user = useEffectiveUser()
  const { target: viewAsTarget } = useViewAs()
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['conversation-thread', conversationId],
    queryFn: () => apiFetch<ThreadResponse>(`/conversations/${conversationId}/messages`),
    refetchInterval: 15_000,
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

  const isClientThread = data?.conversation.type === 'CLIENT'

  useEffect(() => {
    apiFetch(`/conversations/${conversationId}/read`, { method: 'POST' })
      .then(onMessageSent)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

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
    enabled: isClientThread && showTemplates,
  })

  const { data: linksData } = useQuery({
    queryKey: ['client-shareable-links', data?.conversation.clientId],
    queryFn: () => apiFetch<ShareableLinksResponse>(`/clients/${data!.conversation.clientId}/shareable-links`),
    enabled: isClientThread && showLinkMenu && !!data?.conversation.clientId,
  })

  // Backs both the quick-details drawer and the "add tag" / "add to inquiry"
  // pickers -- all three need the same "what does this client have going on"
  // summary, so they share one query.
  const { data: context } = useQuery({
    queryKey: ['conversation-context', conversationId],
    queryFn: () => apiFetch<ConversationContext>(`/conversations/${conversationId}/context`),
    enabled: isClientThread && (showContext || showTagPicker || imagePickerFor !== null),
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

  let lastDay = ''

  return (
    <>
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-3">
        {canGoBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
        )}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{counterpartName}</h2>
        {isClientThread && (
          <>
            <button
              type="button"
              onClick={() => {
                setShowTagPicker((v) => !v)
                setShowContext(false)
              }}
              aria-label="Add tag"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
            >
              <TagIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowContext((v) => !v)
                setShowTagPicker(false)
              }}
              aria-label="Client details"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
            >
              <InfoIcon className="h-4 w-4" />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMoreMenu((v) => !v)}
                aria-label="More actions"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
              >
                <MoreIcon className="h-4 w-4" />
              </button>
              {showMoreMenu && (
                <div className="absolute right-0 top-8 z-20 w-56 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl">
                  <button
                    type="button"
                    onClick={handleOpenDraftModal}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    <SparkleIcon className="h-3.5 w-3.5" />
                    Draft inquiry from conversation
                  </button>
                </div>
              )}
            </div>
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      {isClientThread && data.conversation.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-neutral-800 px-3 py-2">
          {data.conversation.tags.map((tag) => (
            <span
              key={tag.id}
              className="flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-800/60 px-2 py-0.5 text-[11px] text-neutral-300"
            >
              <Link to={tag.deepLink} className="hover:text-white">
                {tag.entityType}: {tag.label}
              </Link>
              <button
                type="button"
                onClick={() => handleRemoveTag(tag.id)}
                aria-label={`Remove ${tag.entityType} tag`}
                className="text-neutral-500 hover:text-white"
              >
                <CloseIcon className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {isClientThread && showTagPicker && (
        <div className="max-h-48 overflow-y-auto border-b border-neutral-800 px-3 py-2">
          {tagError && <p className="mb-1 text-xs text-red-400">{tagError}</p>}
          {!context && <p className="text-xs text-neutral-500">Loading…</p>}
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
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
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
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
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
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
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
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
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
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="truncate">Waiver: {context.nextAppointment.waiverStatus}</span>
                  {!existingTagKeys.has(`LiabilityWaiver:${context.nextAppointment.waiverId}`) && (
                    <PlusIcon className="h-3 w-3 shrink-0" />
                  )}
                </button>
              )}
              {context.inquiries.length === 0 && context.giftCards.length === 0 && !context.nextAppointment && (
                <p className="px-2 py-1 text-xs text-neutral-500">Nothing to tag yet for this client.</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {isClientThread && showContext && (
          // Mobile: full overlay covering the thread (absolute inset-0).
          // Desktop (sm:): docks as a second column instead -- sm:order-last
          // visually places it after the thread without needing to move it
          // in the DOM, sm:static drops it out of the overlay positioning.
          <div className="absolute inset-0 z-20 overflow-y-auto bg-neutral-900 px-4 py-4 sm:static sm:z-auto sm:order-last sm:w-72 sm:shrink-0 sm:border-l sm:border-neutral-800">
            {!context && <p className="text-sm text-neutral-400">Loading…</p>}
            {context && (
              <div className="space-y-4 text-sm">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Contact</p>
                  <p className="mt-1 text-white">
                    {context.client.firstName} {context.client.lastName}
                  </p>
                  <p className="text-xs text-neutral-400">{context.client.email ?? 'No email'}</p>
                  <p className="text-xs text-neutral-400">{context.client.phone ?? 'No phone'}</p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Inquiries</p>
                  {context.inquiries.length === 0 && <p className="mt-1 text-xs text-neutral-500">None</p>}
                  {context.inquiries.map((inquiry) => (
                    <Link
                      key={inquiry.id}
                      to={`/inquiries/${inquiry.id}`}
                      className="mt-1 block rounded-lg border border-neutral-800 px-2.5 py-2 hover:bg-neutral-800/60"
                    >
                      <p className="truncate text-xs text-white">{inquiry.description}</p>
                      <p className="mt-0.5 text-[11px] text-neutral-500">
                        {formatStatus(inquiry.status)}
                        {inquiry.priceEstimateLow != null && inquiry.priceEstimateHigh != null
                          ? ` · $${inquiry.priceEstimateLow}-$${inquiry.priceEstimateHigh}`
                          : ''}
                      </p>
                    </Link>
                  ))}
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Next appointment</p>
                  {!context.nextAppointment && <p className="mt-1 text-xs text-neutral-500">None scheduled</p>}
                  {context.nextAppointment && (
                    <Link
                      to={`/appointments/${context.nextAppointment.id}`}
                      className="mt-1 block rounded-lg border border-neutral-800 px-2.5 py-2 hover:bg-neutral-800/60"
                    >
                      <p className="text-xs text-white">{formatDateTime(context.nextAppointment.startTime)}</p>
                      <p className="mt-0.5 text-[11px] text-neutral-500">
                        with {context.nextAppointment.artistName}
                        {context.nextAppointment.waiverStatus ? ` · Waiver: ${context.nextAppointment.waiverStatus}` : ''}
                      </p>
                    </Link>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Gift cards</p>
                  {context.giftCards.length === 0 && <p className="mt-1 text-xs text-neutral-500">None</p>}
                  {context.giftCards.map((card) => (
                    <Link
                      key={card.id}
                      to={`/gift-cards/${card.id}`}
                      className="mt-1 block rounded-lg border border-neutral-800 px-2.5 py-2 hover:bg-neutral-800/60"
                    >
                      <p className="text-xs text-white">${(card.amountCents / 100).toFixed(2)}</p>
                      <p className="mt-0.5 text-[11px] text-neutral-500">{formatStatus(card.status)}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div ref={scrollRef} className="h-full min-w-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {isLoading && <p className="text-sm text-neutral-400">Loading…</p>}

          {data?.messages.map((message) => {
            const isOutboundSide = isClientThread
              ? message.direction === 'OUTBOUND'
              : message.authorUserId === user?.userId
            const showDaySeparator = dayKey(message.createdAt) !== lastDay
            lastDay = dayKey(message.createdAt)
            const sharedInquiryId = message.metadata?.kind === 'shared_inquiry' ? message.metadata.inquiryId : null
            const sharedInquiryLink =
              sharedInquiryId && user?.role === 'ARTIST' && assignedInquiryIds.has(sharedInquiryId)
                ? '/my-inquiries'
                : null

            return (
              <div key={message.id}>
                {showDaySeparator && (
                  <p className="my-2 text-center text-[11px] uppercase tracking-wider text-neutral-600">
                    {dayLabel(message.createdAt)}
                  </p>
                )}
                <div className={`flex ${isOutboundSide ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={[
                      'max-w-[75%] rounded-2xl px-3 py-2 text-sm',
                      sharedInquiryId
                        ? 'border border-neutral-700 bg-neutral-800/80 text-neutral-100'
                        : isOutboundSide
                          ? 'bg-neutral-700 text-white'
                          : 'bg-neutral-800 text-neutral-100',
                    ].join(' ')}
                  >
                    {!isClientThread && (
                      <p className="mb-0.5 text-[11px] font-medium text-neutral-400">
                        {message.author?.name ?? message.author?.email ?? 'Unknown'}
                      </p>
                    )}
                    {sharedInquiryId && (
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                        Shared inquiry
                      </p>
                    )}
                    {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
                    {message.attachments && message.attachments.length > 0 && (
                      <div className={sharedInquiryId ? 'mt-1 grid grid-cols-2 gap-1' : undefined}>
                        {message.attachments.map((url) => (
                          <div key={url} className="group relative mt-1">
                            <img src={url} alt="Attachment" className="max-h-48 rounded-lg" />
                            {isClientThread && !sharedInquiryId && (
                              <button
                                type="button"
                                onClick={() => setImagePickerFor(imagePickerFor === url ? null : url)}
                                className="absolute bottom-1 right-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100"
                              >
                                Add to inquiry
                              </button>
                            )}
                            {imagePickerFor === url && (
                              <div className="absolute bottom-full right-0 z-10 mb-1 w-48 rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl">
                                {imageAttachError && <p className="px-1 pb-1 text-[10px] text-red-400">{imageAttachError}</p>}
                                {!context && <p className="px-1 py-1 text-[10px] text-neutral-500">Loading…</p>}
                                {context && context.inquiries.length === 0 && (
                                  <p className="px-1 py-1 text-[10px] text-neutral-500">No inquiries for this client.</p>
                                )}
                                {context?.inquiries.map((inquiry) => (
                                  <button
                                    key={inquiry.id}
                                    type="button"
                                    onClick={() => handleAttachImageToInquiry(url, inquiry.id)}
                                    className="block w-full truncate rounded-md px-2 py-1 text-left text-[11px] text-neutral-300 hover:bg-neutral-800"
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
                    {sharedInquiryLink && (
                      <Link
                        to={sharedInquiryLink}
                        className="mt-1 flex items-center gap-1 text-[11px] font-medium text-neutral-300 hover:text-white"
                      >
                        View in My Inquiries <ArrowUpRightIcon className="h-3 w-3" />
                      </Link>
                    )}
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-neutral-400">
                      {isClientThread && <span className="rounded-full bg-black/20 px-1.5 py-0.5">{channelLabel(message.channel)}</span>}
                      {formatDateTime(message.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="border-t border-neutral-800 p-3">
        {isClientThread && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-white focus:border-neutral-600 focus:outline-none"
            >
              {CLIENT_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {channelLabel(c)}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1 rounded-full border border-neutral-800 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setDirection('INBOUND')}
                className={`rounded-full px-2 py-1 ${direction === 'INBOUND' ? 'bg-neutral-700 text-white' : 'text-neutral-500'}`}
              >
                Their message
              </button>
              <button
                type="button"
                onClick={() => setDirection('OUTBOUND')}
                className={`rounded-full px-2 py-1 ${direction === 'OUTBOUND' ? 'bg-neutral-700 text-white' : 'text-neutral-500'}`}
              >
                Our reply
              </button>
            </div>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((url) => (
              <div key={url} className="relative h-14 w-14 overflow-hidden rounded-lg border border-neutral-800">
                <img src={url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((a) => a !== url))}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white"
                >
                  <CloseIcon className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {showTemplates && isClientThread && (
          <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-neutral-800 p-2">
            {(templatesData?.messageTemplates ?? []).length === 0 && (
              <p className="p-1 text-xs text-neutral-500">No templates configured (Settings → Policies &amp; Defaults).</p>
            )}
            {templatesData?.messageTemplates?.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => {
                  setBody((current) => (current ? `${current}\n${template.body}` : template.body))
                  setShowTemplates(false)
                }}
                className="block w-full rounded-lg px-2 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-800"
              >
                <span className="font-medium text-white">{template.name}</span>
              </button>
            ))}
          </div>
        )}

        {showLinkMenu && isClientThread && (
          <div className="mb-2 max-h-48 overflow-y-auto rounded-lg border border-neutral-800 p-2 text-xs">
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
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>{link.label}</span>
                {link.hint && <span className="shrink-0 text-neutral-600">{link.hint}</span>}
              </button>
            ))}
          </div>
        )}

        {sendError && <p className="mb-2 text-xs text-red-400">{sendError}</p>}

        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message…"
            className="min-w-0 flex-1 resize-none rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
          />
          <div className="flex shrink-0 flex-col gap-1">
            <label className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-neutral-700 text-neutral-400 transition hover:bg-neutral-800 hover:text-white">
              <AttachmentIcon className="h-4 w-4" />
              <input type="file" accept="image/*" onChange={handleAttach} className="hidden" disabled={uploading} />
            </label>
            {isClientThread && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setShowTemplates((v) => !v)
                    setShowLinkMenu(false)
                  }}
                  aria-label="Templates"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-700 text-xs font-semibold text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
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
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-700 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleSend}
          disabled={sending || uploading || !!viewAsTarget || (body.trim().length === 0 && attachments.length === 0)}
          className="mt-2 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>

      {showDraftModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
          onClick={() => setShowDraftModal(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Draft inquiry from conversation</h2>
              <button
                type="button"
                onClick={() => setShowDraftModal(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-3 text-xs text-neutral-500">
              AI-drafted from this conversation — review before sending.
            </p>

            {draftLoading && <p className="mt-4 text-sm text-neutral-400">Extracting fields…</p>}
            {draftError && <p className="mt-4 text-sm text-red-400">{draftError}</p>}

            {!draftLoading && (
              <div className="mt-4 space-y-3">
                {DRAFT_FIELD_ORDER.map((field) => (
                  <div key={field}>
                    <label className="mb-1 block text-xs font-medium text-neutral-400">{DRAFT_FIELD_LABELS[field]}</label>
                    {field === 'description' ? (
                      <textarea
                        rows={3}
                        value={draftFields[field] ?? ''}
                        onChange={(e) => setDraftFields((current) => ({ ...current, [field]: e.target.value }))}
                        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                      />
                    ) : (
                      <input
                        type="text"
                        value={draftFields[field] ?? ''}
                        onChange={(e) => setDraftFields((current) => ({ ...current, [field]: e.target.value }))}
                        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                      />
                    )}
                  </div>
                ))}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleCreatePrefillLink}
                    disabled={creatingPrefillLink || Object.values(draftFields).every((v) => !v)}
                    className="flex-1 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                  >
                    {creatingPrefillLink ? 'Creating…' : 'Create prefill link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDraftModal(false)}
                    className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
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
