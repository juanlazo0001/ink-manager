import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { useViewAs } from '../context/useViewAs'
import { formatStatus } from '../lib/format'
import { AppointmentsIcon, ArtistsIcon, ClientsIcon, CloseIcon, DocumentIcon, SearchIcon, SpinnerIcon } from './icons'
import { FlatArtistAvatar } from './ArtistAvatar'

interface SearchClient {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

interface SearchInquiry {
  id: string
  status: string
  description: string
  client: { firstName: string; lastName: string }
}

interface SearchArtist {
  id: string
  user: { name: string; email: string; avatarUrl: string | null }
}

interface SearchAppointment {
  id: string
  startTime: string
  status: string
  client: { firstName: string; lastName: string }
  artist: { user: { name: string; avatarUrl: string | null } } | null
}

interface SearchResults {
  clients: SearchClient[]
  inquiries: SearchInquiry[]
  artists: SearchArtist[]
  appointments: SearchAppointment[]
}

const EMPTY_RESULTS: SearchResults = { clients: [], inquiries: [], artists: [], appointments: [] }

interface SearchPaletteProps {
  onClose: () => void
}

export default function SearchPalette({ onClose }: SearchPaletteProps) {
  const navigate = useNavigate()
  const { target: viewAsTarget } = useViewAs()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query.trim(), 300)
  const hasQuery = debouncedQuery.length >= 2

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const { data, isFetching } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => apiFetch<SearchResults>(`/search?q=${encodeURIComponent(debouncedQuery)}`),
    enabled: hasQuery,
  })
  const results = data ?? EMPTY_RESULTS

  function go(to: string) {
    onClose()
    navigate(to)
  }

  const isLoading = hasQuery && isFetching
  const hasResults =
    hasQuery &&
    (results.clients.length > 0 || results.inquiries.length > 0 || results.artists.length > 0 || results.appointments.length > 0)

  return (
    <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        // Anchored right below the search trigger button in the top bar
        // (fixed right-4, top-4/top-14) rather than centered on screen --
        // origin-top-right + animate-scale-fade-in (the same convention
        // every other trigger-anchored popover in this app uses, e.g. the
        // composer's channel/attach menus) makes it read as growing out of
        // that button instead of just appearing mid-screen.
        className={`fixed right-4 w-[calc(100vw-2rem)] max-w-lg origin-top-right animate-scale-fade-in rounded-2xl border border-border bg-surface shadow-xl ${
          viewAsTarget ? 'top-28' : 'top-16'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <SearchIcon className="h-4 w-4 text-fg-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search clients, inquiries, artists, appointments..."
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
          />
          {isLoading && <SpinnerIcon className="h-4 w-4 animate-spin text-fg-muted" />}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="flex h-7 w-7 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!hasQuery && <p className="px-3 py-6 text-center text-sm text-fg-muted">Type at least 2 characters to search.</p>}

          {hasQuery && !isLoading && !hasResults && (
            <p className="px-3 py-6 text-center text-sm text-fg-muted">No results for "{debouncedQuery}".</p>
          )}

          {hasQuery && results.clients.length > 0 && (
            <SearchSection title="Clients">
              {results.clients.map((client) => (
                <SearchRow
                  key={client.id}
                  icon={ClientsIcon}
                  primary={`${client.firstName} ${client.lastName}`}
                  secondary={client.email ?? client.phone ?? undefined}
                  onClick={() => go(`/clients/${client.id}`)}
                />
              ))}
            </SearchSection>
          )}

          {hasQuery && results.inquiries.length > 0 && (
            <SearchSection title="Inquiries">
              {results.inquiries.map((inquiry) => (
                <SearchRow
                  key={inquiry.id}
                  icon={DocumentIcon}
                  primary={`${inquiry.client.firstName} ${inquiry.client.lastName}`}
                  secondary={`${formatStatus(inquiry.status)} · ${inquiry.description}`}
                  onClick={() => go(`/inquiries/${inquiry.id}`)}
                />
              ))}
            </SearchSection>
          )}

          {hasQuery && results.artists.length > 0 && (
            <SearchSection title="Artists">
              {results.artists.map((artist) => (
                <SearchRow
                  key={artist.id}
                  icon={ArtistsIcon}
                  avatar={<FlatArtistAvatar name={artist.user.name} avatarUrl={artist.user.avatarUrl} className="h-6 w-6" />}
                  primary={artist.user.name}
                  secondary={artist.user.email}
                  onClick={() => go(`/artists/${artist.id}`)}
                />
              ))}
            </SearchSection>
          )}

          {hasQuery && results.appointments.length > 0 && (
            <SearchSection title="Appointments">
              {results.appointments.map((appointment) => (
                <SearchRow
                  key={appointment.id}
                  icon={AppointmentsIcon}
                  primary={`${appointment.client.firstName} ${appointment.client.lastName}`}
                  secondary={[
                    appointment.artist?.user.name,
                    new Date(appointment.startTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  onClick={() => go(`/appointments/${appointment.id}`)}
                />
              ))}
            </SearchSection>
          )}
        </div>
      </div>
    </div>
  )
}

function SearchSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-2">
      <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">{title}</p>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function SearchRow({
  icon: Icon,
  avatar,
  primary,
  secondary,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>
  // Overrides the generic icon with an actual profile picture (or initials
  // fallback) -- used for Artists results, where a real avatar is available.
  avatar?: ReactNode
  primary: string
  secondary?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-surface-inset"
    >
      {avatar ?? <Icon className="h-4 w-4 shrink-0 text-fg-muted" />}
      <span className="flex-1 truncate">
        <span className="text-sm font-medium text-fg">{primary}</span>
        {secondary && <span className="ml-2 text-xs text-fg-muted">{secondary}</span>}
      </span>
    </button>
  )
}
