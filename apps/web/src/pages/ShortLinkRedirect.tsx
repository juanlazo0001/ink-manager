import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'

interface ShortLinkResolution {
  targetUrl: string
}

// Public: this is the page every shortened link (estimate/deposit/waiver/
// gift-card/intake/prefill) actually points at now -- apiFetch resolves
// the code against the API's own GET /s/:code (JSON in, JSON out, no
// server-side redirect there), then this does the real browser redirect
// itself. Keeping the redirect on this side (rather than the API issuing
// an HTTP 302 directly) matters because apps/api and apps/web are
// separate Railway services with separate public domains -- every other
// public link in this app resolves to a page on THIS domain, and a
// short link is no different.
export default function ShortLinkRedirect() {
  const { code } = useParams<{ code: string }>()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return

    let ignore = false

    apiFetch<ShortLinkResolution>(`/s/${code}`)
      .then((result) => {
        if (ignore) return
        window.location.replace(result.targetUrl)
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : "This link isn't valid.")
      })

    return () => {
      ignore = true
    }
  }, [code])

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center">
        {error ? (
          <>
            <h1 className="text-xl font-semibold text-fg">Link not found</h1>
            <p className="mt-2 text-sm text-fg-secondary">{error}</p>
          </>
        ) : (
          <p className="text-sm text-fg-secondary">Redirecting…</p>
        )}
      </div>
    </div>
  )
}
