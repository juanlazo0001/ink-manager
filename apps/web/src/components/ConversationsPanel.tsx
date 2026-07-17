import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { formatDateTime, formatRelativeTime } from '../lib/format'
import { uploadImageToCloudinary } from '../lib/cloudinary'
import { useAuth } from '../context/useAuth'
import { useConversationPanel } from '../context/useConversationPanel'
import { navCountsQueryKey } from '../lib/queryKeys'
import type { NavCounts } from '../lib/useNavCounts'
import { ArrowLeftIcon, AttachmentIcon, CloseIcon, MessageIcon, PlusIcon } from './icons'

type Tab = 'CLIENT' | 'STAFF'

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

interface MessageItem {
  id: string
  channel: string
  direction: 'INBOUND' | 'OUTBOUND'
  body: string
  attachments: string[] | null
  createdAt: string
  authorUserId: string | null
  author: { id: string; name: string | null; email: string } | null
}

interface ThreadResponse {
  conversation: {
    id: string
    type: Tab
    clientId: string | null
    staffUserId: string | null
    counterpart: { id: string; name: string } | null
  }
  messages: MessageItem[]
  nextCursor: string | null
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
  const { user } = useAuth()
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

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-end sm:inset-auto sm:bottom-24 sm:right-6">
          <div
            className="absolute inset-0 bg-black/60 sm:hidden"
            onClick={closePanel}
            aria-hidden="true"
          />
          <div className="relative flex h-full w-full flex-col border border-neutral-800 bg-neutral-900 shadow-2xl sm:h-[32rem] sm:w-96 sm:rounded-2xl">
            {selectedId ? (
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
            )}
          </div>
        </div>
      )}
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
  const { data: conversations, isLoading } = useQuery({
    queryKey: ['conversations', tab],
    queryFn: () => apiFetch<ConversationSummary[]>(`/conversations?type=${tab}`),
    refetchInterval: 30_000,
  })

  const { data: roster } = useQuery({
    queryKey: ['conversations-staff-roster'],
    queryFn: () => apiFetch<StaffRosterEntry[]>('/conversations/staff'),
    enabled: tab === 'STAFF',
  })

  const rosterWithoutThread = (roster ?? []).filter((member) => !member.conversationId)

  return (
    <>
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Conversations</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
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
  const { user } = useAuth()
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
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {isLoading && <p className="text-sm text-neutral-400">Loading…</p>}

        {data?.messages.map((message) => {
          const isOutboundSide = isClientThread
            ? message.direction === 'OUTBOUND'
            : message.authorUserId === user?.userId
          const showDaySeparator = dayKey(message.createdAt) !== lastDay
          lastDay = dayKey(message.createdAt)

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
                    isOutboundSide ? 'bg-neutral-700 text-white' : 'bg-neutral-800 text-neutral-100',
                  ].join(' ')}
                >
                  {!isClientThread && (
                    <p className="mb-0.5 text-[11px] font-medium text-neutral-400">
                      {message.author?.name ?? message.author?.email ?? 'Unknown'}
                    </p>
                  )}
                  {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
                  {message.attachments?.map((url) => (
                    <img key={url} src={url} alt="Attachment" className="mt-1 max-h-48 rounded-lg" />
                  ))}
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
                  if (!link.url) return
                  setBody((current) => (current ? `${current}\n${link.url}` : link.url))
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
          disabled={sending || uploading || (body.trim().length === 0 && attachments.length === 0)}
          className="mt-2 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </>
  )
}
