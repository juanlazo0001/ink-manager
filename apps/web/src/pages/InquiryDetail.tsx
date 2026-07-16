import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { ArrowLeftIcon } from '../components/icons'

interface Inquiry {
  id: string
  channel: string
  description: string
  colorOrBlackGrey: string
  placement: string
  estimatedSize: string
  hasBeenTattooedBefore: boolean
  budget: string | null
  desiredTiming: string | null
  referenceImages: string[]
  placementImages: string[]
  status: string
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  timeEstimateHours: number | null
  declineNote: string | null
  createdAt: string
  assignedAt: string | null
  client: { firstName: string; lastName: string; email: string | null; phone: string | null }
  preferredArtist: { id: string; user: { name: string | null } } | null
  assignedArtist: { id: string; user: { name: string | null } } | null
}

interface ArtistOption {
  id: string
  user: { email: string }
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 text-sm text-white">{value}</p>
    </div>
  )
}

function ImageGrid({ images }: { images: string[] }) {
  if (images.length === 0) {
    return <p className="text-sm text-neutral-400">None uploaded.</p>
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {images.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block aspect-square overflow-hidden rounded-lg border border-neutral-800"
        >
          <img src={url} alt="" className="h-full w-full object-cover transition hover:opacity-80" />
        </a>
      ))}
    </div>
  )
}

export default function InquiryDetail() {
  const { id } = useParams<{ id: string }>()
  const [inquiry, setInquiry] = useState<Inquiry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [artistOptions, setArtistOptions] = useState<ArtistOption[] | null>(null)
  const [selectedArtistId, setSelectedArtistId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    let ignore = false

    async function load() {
      setInquiry(null)
      setError(null)

      try {
        const data = await apiFetch<Inquiry>(`/inquiries/${id}`)
        if (!ignore) setInquiry(data)
      } catch (err) {
        if (ignore) return

        if (err instanceof ApiError && err.status === 404) {
          setError('Inquiry not found.')
        } else if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view this inquiry.")
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load inquiry')
        }
      }
    }

    load()

    return () => {
      ignore = true
    }
  }, [id, refreshIndex])

  useEffect(() => {
    let ignore = false

    apiFetch<ArtistOption[]>('/artists')
      .then((data) => {
        if (!ignore) setArtistOptions(data)
      })
      .catch(() => {
        // The assign dropdown just stays empty if this fails — the rest of
        // the page still works.
      })

    return () => {
      ignore = true
    }
  }, [])

  async function handleAssign() {
    if (!id || !selectedArtistId) return

    setAssigning(true)
    setAssignError(null)

    try {
      await apiFetch(`/inquiries/${id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ artistId: selectedArtistId }),
      })

      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Failed to assign artist')
    } finally {
      setAssigning(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 sm:px-10 sm:py-8">
          <Link to="/inquiries" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Inquiries
          </Link>

          {error && (
            <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {!error && !inquiry && <p className="mt-6 text-sm text-neutral-400">Loading inquiry…</p>}

          {!error && inquiry && (
            <>
              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 className="text-xl font-bold text-white">
                      {inquiry.client.firstName} {inquiry.client.lastName}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-400">
                      Submitted {formatDateTime(inquiry.createdAt)} via {formatStatus(inquiry.channel)}
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                    {formatStatus(inquiry.status)}
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DetailField label="Email" value={inquiry.client.email ?? 'Not provided'} />
                  <DetailField label="Phone" value={inquiry.client.phone ?? 'Not provided'} />
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Assignment</h2>

                {inquiry.status === 'NEW' ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <select
                      value={selectedArtistId}
                      onChange={(event) => setSelectedArtistId(event.target.value)}
                      className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                    >
                      <option value="" disabled>
                        {artistOptions === null ? 'Loading artists…' : 'Select an artist'}
                      </option>
                      {artistOptions?.map((artist) => (
                        <option key={artist.id} value={artist.id}>
                          {artist.user.email}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAssign}
                      disabled={!selectedArtistId || assigning}
                      className="rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                    >
                      {assigning ? 'Assigning…' : 'Assign Artist'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <DetailField label="Assigned artist" value={inquiry.assignedArtist?.user.name ?? 'Not yet assigned'} />
                    <DetailField
                      label="Assigned at"
                      value={inquiry.assignedAt ? formatDateTime(inquiry.assignedAt) : 'Not yet assigned'}
                    />
                  </div>
                )}

                {assignError && <p className="mt-3 text-sm text-red-400">{assignError}</p>}

                {(inquiry.priceEstimateLow != null ||
                  inquiry.priceEstimateHigh != null ||
                  inquiry.timeEstimateHours != null) && (
                  <div className="mt-5 grid grid-cols-1 gap-4 border-t border-neutral-800 pt-4 sm:grid-cols-3">
                    <DetailField
                      label="Price estimate low"
                      value={inquiry.priceEstimateLow != null ? `$${inquiry.priceEstimateLow}` : 'Not provided'}
                    />
                    <DetailField
                      label="Price estimate high"
                      value={inquiry.priceEstimateHigh != null ? `$${inquiry.priceEstimateHigh}` : 'Not provided'}
                    />
                    <DetailField
                      label="Time estimate"
                      value={inquiry.timeEstimateHours != null ? `${inquiry.timeEstimateHours} hours` : 'Not provided'}
                    />
                  </div>
                )}

                {inquiry.declineNote && (
                  <div className="mt-5 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-amber-500">
                      Last decline note
                    </p>
                    <p className="mt-1 text-sm text-amber-200">{inquiry.declineNote}</p>
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Tattoo details</h2>

                <div className="mt-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Description</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-white">{inquiry.description}</p>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DetailField label="Color or Black & Grey" value={inquiry.colorOrBlackGrey} />
                  <DetailField label="Placement" value={inquiry.placement} />
                  <DetailField label="Estimated size" value={inquiry.estimatedSize} />
                  <DetailField label="Tattooed before" value={inquiry.hasBeenTattooedBefore ? 'Yes' : 'No'} />
                  <DetailField label="Budget" value={inquiry.budget ?? 'Not provided'} />
                  <DetailField label="Desired timing" value={inquiry.desiredTiming ?? 'Not provided'} />
                  <DetailField label="Preferred artist" value={inquiry.preferredArtist?.user.name ?? 'No preference'} />
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Reference images</h2>
                <div className="mt-4">
                  <ImageGrid images={inquiry.referenceImages} />
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Placement photos</h2>
                <div className="mt-4">
                  <ImageGrid images={inquiry.placementImages} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
