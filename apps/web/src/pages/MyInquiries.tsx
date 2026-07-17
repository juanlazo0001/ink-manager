import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import { apiFetch } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { useAuth } from '../context/useAuth'
import { useMarkSectionSeen } from '../lib/useMarkSectionSeen'

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
  createdAt: string
  client: { firstName: string; lastName: string }
}

function ImageGrid({ images }: { images: string[] }) {
  if (images.length === 0) {
    return <p className="text-sm text-neutral-400">None uploaded.</p>
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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

const EMPTY_APPROVE_FORM = {
  priceEstimateLow: '',
  priceEstimateHigh: '',
  timeEstimateHoursMin: '',
  timeEstimateHoursMax: '',
}

export default function MyInquiries() {
  const { user } = useAuth()
  useMarkSectionSeen('inquiries')

  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [approvingInquiry, setApprovingInquiry] = useState<Inquiry | null>(null)
  const [approveForm, setApproveForm] = useState(EMPTY_APPROVE_FORM)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [approveSubmitting, setApproveSubmitting] = useState(false)

  const [decliningInquiry, setDecliningInquiry] = useState<Inquiry | null>(null)
  const [declineNote, setDeclineNote] = useState('')
  const [declineError, setDeclineError] = useState<string | null>(null)
  const [declineSubmitting, setDeclineSubmitting] = useState(false)

  useEffect(() => {
    if (user?.role !== 'ARTIST') return

    let ignore = false

    async function load() {
      setError(null)

      try {
        const data = await apiFetch<Inquiry[]>('/inquiries/assigned-to-me')
        if (!ignore) setInquiries(data)
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load inquiries')
      }
    }

    load()

    return () => {
      ignore = true
    }
  }, [user?.role, refreshIndex])

  function openApprove(inquiry: Inquiry) {
    setApprovingInquiry(inquiry)
    setApproveForm(EMPTY_APPROVE_FORM)
    setApproveError(null)
  }

  async function handleApproveSubmit(event: FormEvent) {
    event.preventDefault()
    if (!approvingInquiry) return

    setApproveError(null)
    setApproveSubmitting(true)

    try {
      await apiFetch(`/inquiries/${approvingInquiry.id}/respond`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision: 'APPROVE',
          priceEstimateLow: approveForm.priceEstimateLow ? Number(approveForm.priceEstimateLow) : undefined,
          priceEstimateHigh: approveForm.priceEstimateHigh ? Number(approveForm.priceEstimateHigh) : undefined,
          timeEstimateHoursMin: approveForm.timeEstimateHoursMin
            ? Number(approveForm.timeEstimateHoursMin)
            : undefined,
          timeEstimateHoursMax: approveForm.timeEstimateHoursMax
            ? Number(approveForm.timeEstimateHoursMax)
            : undefined,
        }),
      })

      setApprovingInquiry(null)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Failed to approve inquiry')
    } finally {
      setApproveSubmitting(false)
    }
  }

  function openDecline(inquiry: Inquiry) {
    setDecliningInquiry(inquiry)
    setDeclineNote('')
    setDeclineError(null)
  }

  async function handleDeclineSubmit(event: FormEvent) {
    event.preventDefault()
    if (!decliningInquiry) return

    setDeclineError(null)
    setDeclineSubmitting(true)

    try {
      await apiFetch(`/inquiries/${decliningInquiry.id}/respond`, {
        method: 'PATCH',
        body: JSON.stringify({ decision: 'DECLINE', declineNote }),
      })

      setDecliningInquiry(null)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setDeclineError(err instanceof Error ? err.message : 'Failed to decline inquiry')
    } finally {
      setDeclineSubmitting(false)
    }
  }

  if (user && user.role !== 'ARTIST') {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 sm:px-10 sm:py-8">
          <div>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">My Inquiries</h1>
            <p className="mt-1 text-sm text-neutral-400">Tattoo requests assigned to you for review.</p>
          </div>

          {error && (
            <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {!error && inquiries === null && <p className="mt-6 text-sm text-neutral-400">Loading inquiries…</p>}

          {!error && inquiries !== null && inquiries.length === 0 && (
            <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
              <p className="text-sm text-neutral-400">Nothing assigned to you right now.</p>
            </div>
          )}

          {!error && inquiries && inquiries.length > 0 && (
            <div className="mt-6 space-y-5">
              {inquiries.map((inquiry) => (
                <div key={inquiry.id} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-white">
                        {inquiry.client.firstName} {inquiry.client.lastName}
                      </h2>
                      <p className="mt-1 text-sm text-neutral-400">
                        Submitted {formatDateTime(inquiry.createdAt)} via {formatStatus(inquiry.channel)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openApprove(inquiry)}
                        className="rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => openDecline(inquiry)}
                        className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
                      >
                        Decline
                      </button>
                    </div>
                  </div>

                  <p className="mt-4 whitespace-pre-wrap text-sm text-white">{inquiry.description}</p>

                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Placement</p>
                      <p className="mt-1 text-sm text-white">{inquiry.placement}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Size</p>
                      <p className="mt-1 text-sm text-white">{inquiry.estimatedSize}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Color</p>
                      <p className="mt-1 text-sm text-white">{inquiry.colorOrBlackGrey}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Budget</p>
                      <p className="mt-1 text-sm text-white">{inquiry.budget ?? 'Not provided'}</p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
                      Reference images
                    </p>
                    <ImageGrid images={inquiry.referenceImages} />
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
                      Placement photos
                    </p>
                    <ImageGrid images={inquiry.placementImages} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {approvingInquiry && (
        <Modal
          title={`Approve — ${approvingInquiry.client.firstName} ${approvingInquiry.client.lastName}`}
          onClose={() => setApprovingInquiry(null)}
        >
          <form onSubmit={handleApproveSubmit}>
            {approveError && (
              <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                {approveError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="priceLow" className="mb-1 block text-sm font-medium text-neutral-300">
                  Price low ($)
                </label>
                <input
                  id="priceLow"
                  type="number"
                  min="0"
                  step="1"
                  value={approveForm.priceEstimateLow}
                  onChange={(event) => setApproveForm({ ...approveForm, priceEstimateLow: event.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                />
              </div>

              <div>
                <label htmlFor="priceHigh" className="mb-1 block text-sm font-medium text-neutral-300">
                  Price high ($)
                </label>
                <input
                  id="priceHigh"
                  type="number"
                  min="0"
                  step="1"
                  value={approveForm.priceEstimateHigh}
                  onChange={(event) => setApproveForm({ ...approveForm, priceEstimateHigh: event.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="timeHoursMin" className="mb-1 block text-sm font-medium text-neutral-300">
                  Time min (hours)
                </label>
                <input
                  id="timeHoursMin"
                  type="number"
                  min="0"
                  step="0.5"
                  value={approveForm.timeEstimateHoursMin}
                  onChange={(event) => setApproveForm({ ...approveForm, timeEstimateHoursMin: event.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                />
              </div>
              <div>
                <label htmlFor="timeHoursMax" className="mb-1 block text-sm font-medium text-neutral-300">
                  Time max (hours)
                </label>
                <input
                  id="timeHoursMax"
                  type="number"
                  min="0"
                  step="0.5"
                  value={approveForm.timeEstimateHoursMax}
                  onChange={(event) => setApproveForm({ ...approveForm, timeEstimateHoursMax: event.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={approveSubmitting}
              className="mt-5 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
            >
              {approveSubmitting ? 'Approving…' : 'Approve'}
            </button>
          </form>
        </Modal>
      )}

      {decliningInquiry && (
        <Modal
          title={`Decline — ${decliningInquiry.client.firstName} ${decliningInquiry.client.lastName}`}
          onClose={() => setDecliningInquiry(null)}
        >
          <form onSubmit={handleDeclineSubmit}>
            {declineError && (
              <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                {declineError}
              </div>
            )}

            <label htmlFor="declineNote" className="mb-1 block text-sm font-medium text-neutral-300">
              Why are you declining?
            </label>
            <textarea
              id="declineNote"
              required
              rows={4}
              value={declineNote}
              onChange={(event) => setDeclineNote(event.target.value)}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
            />
            <p className="mt-1 text-xs text-neutral-500">
              This goes back to staff so they can reassign it — the inquiry returns to the New pool.
            </p>

            <button
              type="submit"
              disabled={declineSubmitting}
              className="mt-5 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
            >
              {declineSubmitting ? 'Declining…' : 'Decline'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}
