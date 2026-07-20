import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { formatDateTime } from '../lib/format'
import QrCode from '../components/QrCode'
import StatusPill from '../components/StatusPill'

interface GiftCardView {
  studioName: string
  code: string
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
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center">
        {error && (
          <>
            <h1 className="text-xl font-semibold text-fg">Gift card not found</h1>
            <p className="mt-2 text-sm text-fg-secondary">{error}</p>
          </>
        )}

        {!error && !data && <p className="text-sm text-fg-secondary">Loading…</p>}

        {!error && data && (
          <>
            <p className="text-sm text-fg-secondary">{data.studioName}</p>
            <h1 className="mt-1 text-3xl font-bold text-fg">${(data.amountCents / 100).toFixed(2)}</h1>
            <p className="mt-1 text-sm text-fg-secondary">Gift Card Receipt</p>

            <div className="mt-4 flex justify-center">
              <QrCode value={window.location.href} />
            </div>

            <p className="mt-4 select-all rounded-lg border border-border bg-surface-inset px-3 py-2 font-mono text-sm tracking-wider text-fg">
              {data.code}
            </p>
            <p className="mt-1 text-xs text-fg-muted">Present this code or QR at checkout to redeem</p>

            <div className="mt-5 flex justify-center gap-6 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Status</p>
                <div className="mt-1">
                  <StatusPill status={data.status} />
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Expires</p>
                <p className="mt-1 text-fg">{data.expiresAt ? formatDateTime(data.expiresAt) : 'Never'}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
