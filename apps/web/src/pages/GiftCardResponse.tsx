import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import QrCode from '../components/QrCode'

interface GiftCardView {
  studioName: string
  amountCents: number
  status: string
  expiresAt: string | null
}

export default function GiftCardResponse() {
  const { code } = useParams<{ code: string }>()
  const [data, setData] = useState<GiftCardView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return

    let ignore = false

    apiFetch<GiftCardView>(`/gift-cards/view/${code}`)
      .then((result) => {
        if (!ignore) setData(result)
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : 'This gift card code is invalid.')
      })

    return () => {
      ignore = true
    }
  }, [code])

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-900 px-4 py-10 text-white">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">
        {error && (
          <>
            <h1 className="text-xl font-semibold text-white">Gift card not found</h1>
            <p className="mt-2 text-sm text-neutral-400">{error}</p>
          </>
        )}

        {!error && !data && <p className="text-sm text-neutral-400">Loading…</p>}

        {!error && data && (
          <>
            <p className="text-sm text-neutral-400">{data.studioName}</p>
            <h1 className="mt-1 text-3xl font-bold text-white">${(data.amountCents / 100).toFixed(2)}</h1>
            <p className="mt-1 text-sm text-neutral-400">Gift Card</p>

            <div className="mt-4 flex justify-center">
              <QrCode value={window.location.href} />
            </div>

            <div className="mt-5 flex justify-center gap-6 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Status</p>
                <p className="mt-1 text-white">{formatStatus(data.status)}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Expires</p>
                <p className="mt-1 text-white">{data.expiresAt ? formatDateTime(data.expiresAt) : 'Never'}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
