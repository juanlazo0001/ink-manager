import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { PhotoIcon } from '../components/icons'

interface Inquiry {
  id: string
  channel: string
  description: string
  status: string
  createdAt: string
  referenceImages: string[]
  client: { firstName: string; lastName: string }
}

type StatusBucket = 'All' | 'New' | 'Assigned' | 'Closed'

const STATUS_BUCKETS: StatusBucket[] = ['All', 'New', 'Assigned', 'Closed']

function bucketFor(status: string): Exclude<StatusBucket, 'All'> {
  if (status === 'NEW') return 'New'
  if (status === 'CLOSED_LOST' || status === 'COLD_LEAD') return 'Closed'
  return 'Assigned'
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

export default function Inquiries() {
  const navigate = useNavigate()
  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bucketFilter, setBucketFilter] = useState<StatusBucket>('All')

  useEffect(() => {
    let ignore = false

    async function load() {
      setError(null)

      try {
        const data = await apiFetch<Inquiry[]>('/inquiries')
        if (!ignore) setInquiries(data)
      } catch (err) {
        if (ignore) return

        if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view inquiries.")
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load inquiries')
        }
      }
    }

    load()

    return () => {
      ignore = true
    }
  }, [])

  const filteredInquiries = inquiries?.filter(
    (inquiry) => bucketFilter === 'All' || bucketFor(inquiry.status) === bucketFilter,
  )

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">Inquiries</h1>
            <p className="mt-1 text-sm text-neutral-400">Tattoo requests submitted through your intake form.</p>
          </div>

          <div className="mt-6 flex items-center gap-2 sm:max-w-xs">
            <select
              value={bucketFilter}
              onChange={(event) => setBucketFilter(event.target.value as StatusBucket)}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
            >
              {STATUS_BUCKETS.map((bucket) => (
                <option key={bucket} value={bucket}>
                  {bucket === 'All' ? 'All statuses' : bucket}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            {error && <p className="text-sm text-red-400">{error}</p>}

            {!error && inquiries === null && <p className="text-sm text-neutral-400">Loading inquiries…</p>}

            {!error && inquiries !== null && filteredInquiries?.length === 0 && (
              <p className="text-sm text-neutral-400">
                {bucketFilter !== 'All' ? 'No inquiries match this filter.' : 'No inquiries yet.'}
              </p>
            )}

            {!error && filteredInquiries && filteredInquiries.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-neutral-500">
                      <th className="pb-3 font-medium"></th>
                      <th className="pb-3 font-medium">Client</th>
                      <th className="hidden pb-3 font-medium md:table-cell">Channel</th>
                      <th className="hidden pb-3 font-medium md:table-cell">Description</th>
                      <th className="pb-3 font-medium">Submitted</th>
                      <th className="pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {filteredInquiries.map((inquiry) => (
                      <tr
                        key={inquiry.id}
                        onClick={() => navigate(`/inquiries/${inquiry.id}`)}
                        className="cursor-pointer hover:bg-neutral-800/40"
                      >
                        <td className="py-3">
                          {inquiry.referenceImages[0] ? (
                            <img
                              src={inquiry.referenceImages[0]}
                              alt=""
                              className="h-10 w-10 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-800 text-neutral-600">
                              <PhotoIcon className="h-5 w-5" />
                            </div>
                          )}
                        </td>
                        <td className="py-3 text-white">
                          {inquiry.client.firstName} {inquiry.client.lastName}
                        </td>
                        <td className="hidden py-3 text-neutral-400 md:table-cell">{formatStatus(inquiry.channel)}</td>
                        <td className="hidden py-3 text-neutral-400 md:table-cell">{truncate(inquiry.description, 60)}</td>
                        <td className="py-3 text-neutral-400">{formatDateTime(inquiry.createdAt)}</td>
                        <td className="py-3">
                          <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                            {formatStatus(inquiry.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
