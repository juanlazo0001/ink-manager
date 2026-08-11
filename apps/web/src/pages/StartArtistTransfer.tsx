import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../lib/api'
import { eligibleTransferArtistsQueryKey } from '../lib/queryKeys'
import { useEffectiveUser } from '../context/useEffectiveUser'

interface EligibleArtist {
  artistId: string
  name: string
  eligible: boolean
  ineligibleReason: string | null
  destinationStudio: { id: string; name: string } | null
}

interface PickerClient {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  openProject: { id: string; description: string; status: string } | null
}

interface TransferPreview {
  eligible: boolean
  ineligibleReason: string | null
  artist: { id: string; name: string } | null
  originStudio: { id: string; name: string }
  destinationStudio: { id: string; name: string } | null
  clients: {
    id: string
    name: string
    openProject: { id: string; description: string; status: string } | null
    futureAppointments: { id: string; startTime: string; endTime: string }[]
  }[]
  invalidClientIds: string[]
  totalFutureAppointmentsToCancel: number
  staysAtOrigin: string[]
  ready: boolean
}

type Stage = 'artist' | 'clients' | 'review'

export default function StartArtistTransfer() {
  const user = useEffectiveUser()
  const navigate = useNavigate()
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const { data: eligibleArtists, isLoading: artistsLoading, error: artistsError } = useQuery({
    queryKey: eligibleTransferArtistsQueryKey(user!.studioId),
    queryFn: () => apiFetch<EligibleArtist[]>(`/studios/${user!.studioId}/artist-transfers/eligible-artists`),
  })

  const [selectedArtist, setSelectedArtist] = useState<EligibleArtist | null>(null)

  const [defaultClients, setDefaultClients] = useState<PickerClient[] | null>(null)
  const [defaultClientsLoading, setDefaultClientsLoading] = useState(false)
  const [defaultClientsError, setDefaultClientsError] = useState<string | null>(null)

  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<PickerClient[] | null>(null)
  const [searching, setSearching] = useState(false)

  const [selectedClients, setSelectedClients] = useState<Map<string, PickerClient>>(new Map())

  const [preview, setPreview] = useState<TransferPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  const stage: Stage = preview ? 'review' : selectedArtist ? 'clients' : 'artist'

  async function pickArtist(artist: EligibleArtist) {
    setSelectedArtist(artist)
    setSelectedClients(new Map())
    setSearchTerm('')
    setSearchResults(null)
    setDefaultClientsLoading(true)
    setDefaultClientsError(null)
    try {
      const clients = await apiFetch<PickerClient[]>(
        `/studios/${user!.studioId}/artist-transfers/artists/${artist.artistId}/clients`,
      )
      setDefaultClients(clients)
      setSelectedClients(new Map(clients.map((c) => [c.id, c])))
    } catch (err) {
      setDefaultClientsError(err instanceof Error ? err.message : 'Failed to load this artist\'s clients')
    } finally {
      setDefaultClientsLoading(false)
    }
  }

  useEffect(() => {
    if (!selectedArtist) return
    const term = searchTerm.trim()
    if (term.length < 2) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    const handle = setTimeout(async () => {
      try {
        const results = await apiFetch<PickerClient[]>(
          `/studios/${user!.studioId}/artist-transfers/artists/${selectedArtist.artistId}/clients?search=${encodeURIComponent(term)}`,
        )
        setSearchResults(results)
      } catch {
        setSearchResults(null)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [searchTerm, selectedArtist, user])

  function toggleClient(client: PickerClient) {
    setSelectedClients((prev) => {
      const next = new Map(prev)
      if (next.has(client.id)) next.delete(client.id)
      else next.set(client.id, client)
      return next
    })
  }

  const allDefaultSelected =
    defaultClients != null && defaultClients.length > 0 && defaultClients.every((c) => selectedClients.has(c.id))

  function toggleSelectAllDefault() {
    if (!defaultClients) return
    setSelectedClients((prev) => {
      const next = new Map(prev)
      if (allDefaultSelected) {
        for (const c of defaultClients) next.delete(c.id)
      } else {
        for (const c of defaultClients) next.set(c.id, c)
      }
      return next
    })
  }

  async function openReview() {
    if (!selectedArtist || selectedClients.size === 0) return
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const clientIds = [...selectedClients.keys()].join(',')
      const data = await apiFetch<TransferPreview>(
        `/studios/${user!.studioId}/artist-transfers/preview?artistId=${selectedArtist.artistId}&clientIds=${clientIds}`,
      )
      setPreview(data)
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Failed to load the review screen')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleConfirm() {
    if (!selectedArtist || !preview) return
    setConfirming(true)
    setConfirmError(null)
    try {
      await apiFetch(`/studios/${user!.studioId}/artist-transfers`, {
        method: 'POST',
        body: JSON.stringify({ artistId: selectedArtist.artistId, clientIds: [...selectedClients.keys()] }),
      })
      navigate('/team?tab=artists')
    } catch (err) {
      setConfirmError(err instanceof ApiError ? err.message : 'Failed to start the transfer')
    } finally {
      setConfirming(false)
    }
  }

  const visibleSearchResults = (searchResults ?? []).filter((c) => !defaultClients?.some((d) => d.id === c.id))

  // OWNER-only, hardcoded -- same trust tier as the backend routes this
  // page calls. Placed after every hook above so hook call order never
  // depends on role.
  if (user && user.role !== 'OWNER') {
    return <Navigate to="/team?tab=artists" replace />
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 sm:px-10 sm:py-8">
      <Link to="/team?tab=artists" className="text-sm text-fg-secondary hover:text-fg">
        ← Back to Team
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-fg sm:text-3xl">Transfer Clients to Artist</h1>
      <p className="mt-1 text-sm text-fg-secondary">
        Move a departing artist's client contacts and in-flight project work to their new home studio. Everything
        signed, financial, or note-shaped stays here. The artist must accept before anything moves.
      </p>

      {stage === 'artist' && (
        <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
          {artistsLoading && <p className="text-sm text-fg-secondary">Loading artists…</p>}
          {artistsError && <p className="text-sm text-danger">{artistsError.message}</p>}
          {eligibleArtists && eligibleArtists.length === 0 && (
            <p className="text-sm text-fg-secondary">No artist has ever had a membership at your studio.</p>
          )}
          {eligibleArtists && eligibleArtists.length > 0 && (
            <ul className="divide-y divide-border">
              {eligibleArtists.map((artist) => (
                <li key={artist.artistId} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-fg">{artist.name}</p>
                    {!artist.eligible && artist.ineligibleReason && (
                      <p className="mt-0.5 text-xs text-danger">{artist.ineligibleReason}</p>
                    )}
                    {artist.eligible && artist.destinationStudio && (
                      <p className="mt-0.5 text-xs text-fg-muted">Home studio: {artist.destinationStudio.name}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => pickArtist(artist)}
                    disabled={!artist.eligible}
                    className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-40"
                  >
                    Select
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {stage === 'clients' && selectedArtist && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl card-surface border border-border bg-surface p-4">
            <p className="text-sm text-fg">
              Transferring for <span className="font-semibold">{selectedArtist.name}</span> to{' '}
              <span className="font-semibold">{selectedArtist.destinationStudio?.name}</span>
            </p>
          </div>

          {defaultClientsLoading && <p className="text-sm text-fg-secondary">Loading clients…</p>}
          {defaultClientsError && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {defaultClientsError}
            </div>
          )}

          {defaultClients && (
            <div className="overflow-x-auto rounded-2xl card-surface border border-border bg-surface">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-fg-muted">
                    <th className="px-4 py-3 font-medium">
                      <input
                        type="checkbox"
                        checked={allDefaultSelected}
                        onChange={toggleSelectAllDefault}
                        className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Open project</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {defaultClients.map((client) => (
                    <tr key={client.id}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedClients.has(client.id)}
                          onChange={() => toggleClient(client)}
                          className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                        />
                      </td>
                      <td className="px-4 py-3 text-fg">
                        {client.firstName} {client.lastName}
                      </td>
                      <td className="px-4 py-3 text-fg-secondary">
                        {client.openProject ? client.openProject.description : <span className="text-fg-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-2xl card-surface border border-border bg-surface p-4">
            <label className="block text-sm font-medium text-fg-secondary">Add any other client</label>
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name, email, or phone…"
              className="mt-2 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {searching && <p className="mt-2 text-xs text-fg-secondary">Searching…</p>}
            {visibleSearchResults.length > 0 && (
              <ul className="mt-3 divide-y divide-border">
                {visibleSearchResults.map((client) => (
                  <li key={client.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-fg">
                      {client.firstName} {client.lastName}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleClient(client)}
                      className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface-raised"
                    >
                      {selectedClients.has(client.id) ? 'Added' : 'Add'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-2xl card-surface border border-border bg-surface p-4">
            <p className="text-sm text-fg-secondary">
              {selectedClients.size} client{selectedClients.size === 1 ? '' : 's'} selected
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedArtist(null)}
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
              >
                Back
              </button>
              <button
                type="button"
                onClick={openReview}
                disabled={selectedClients.size === 0 || previewLoading}
                className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
              >
                {previewLoading ? 'Loading…' : 'Review & Confirm'}
              </button>
            </div>
          </div>
          {previewError && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {previewError}
            </div>
          )}
        </div>
      )}

      {stage === 'review' && preview && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl card-surface border border-border bg-surface p-5">
            <p className="text-sm text-fg">
              This will request a transfer of <strong>{preview.clients.length}</strong> client
              {preview.clients.length === 1 ? '' : 's'} for <strong>{preview.artist?.name}</strong> from{' '}
              <strong>{preview.originStudio.name}</strong> to <strong>{preview.destinationStudio?.name}</strong>.
              Nothing moves until the artist accepts.
            </p>
          </div>

          {!preview.ready && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              {preview.ineligibleReason ?? 'This transfer is no longer ready to confirm.'}
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface-inset p-4 text-sm">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">This will move</p>
            <ul className="space-y-1 text-fg-secondary">
              {preview.clients.map((c) => (
                <li key={c.id}>
                  {c.name}
                  {c.openProject ? ` — ${c.openProject.description}` : ' — no open project'}
                </li>
              ))}
            </ul>

            <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wider text-fg-muted">Stays at origin</p>
            <ul className="space-y-1 text-fg-secondary">
              {preview.staysAtOrigin.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wider text-fg-muted">
              Future appointments cancelled
            </p>
            {preview.totalFutureAppointmentsToCancel === 0 ? (
              <p className="text-fg-secondary">None.</p>
            ) : (
              <ul className="space-y-1 text-fg-secondary">
                {preview.clients.flatMap((c) =>
                  c.futureAppointments.map((appt) => (
                    <li key={appt.id}>
                      {c.name}: {new Date(appt.startTime).toLocaleString()}
                    </li>
                  )),
                )}
              </ul>
            )}
          </div>

          {confirmError && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {confirmError}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreview(null)}
              disabled={confirming}
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!preview.ready || confirming}
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {confirming ? 'Sending…' : 'Send Transfer Request'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
