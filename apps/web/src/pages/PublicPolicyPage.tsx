import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { sanitizeHtml } from '../lib/sanitizeHtml'

interface PublicStudioPoliciesResponse {
  studioName: string
  privacyPolicy: string | null
  termsAndConditions: string | null
}

type PageState = 'loading' | 'invalid' | 'ready'

interface PublicPolicyPageProps {
  field: 'privacyPolicy' | 'termsAndConditions'
  title: string
}

// Public, unauthenticated: backs both /privacy/:studioSlug and
// /terms/:studioSlug -- same studioSlug-keyed GET + sanitize-at-render-time
// pattern as Policies.tsx (the CustomPolicy list page), just for these two
// fixed StudioSettings fields instead of an open-ended list.
export default function PublicPolicyPage({ field, title }: PublicPolicyPageProps) {
  const { studioSlug } = useParams<{ studioSlug: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [data, setData] = useState<PublicStudioPoliciesResponse | null>(null)

  useEffect(() => {
    if (!studioSlug) return

    let ignore = false

    apiFetch<PublicStudioPoliciesResponse>(`/studio-settings/public?studioSlug=${encodeURIComponent(studioSlug)}`)
      .then((response) => {
        if (ignore) return
        setData(response)
        setState('ready')
      })
      .catch((err) => {
        if (ignore) return
        if (err instanceof ApiError && err.status === 404) {
          setState('invalid')
          return
        }
        setState('invalid')
      })

    return () => {
      ignore = true
    }
  }, [studioSlug])

  const bodyHtml = data?.[field] ?? null

  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-2xl px-6 py-10 sm:px-10">
        {state === 'loading' && <p className="text-sm text-fg-secondary">Loading…</p>}

        {state === 'invalid' && <p className="text-sm text-fg-secondary">This studio couldn't be found.</p>}

        {state === 'ready' && data && (
          <>
            <p className="text-sm font-medium text-fg-secondary">{data.studioName}</p>
            <h1 className="mt-1 text-2xl font-bold text-fg">{title}</h1>

            {bodyHtml ? (
              <div
                className="tiptap-content mt-6 whitespace-pre-wrap text-sm text-fg-secondary"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyHtml) }}
              />
            ) : (
              <p className="mt-6 text-sm text-fg-secondary">This studio hasn't published a {title.toLowerCase()} yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
