import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchPublicWithRetry, isTransientApiFailure } from '../lib/api'
import { sanitizeHtml } from '../lib/sanitizeHtml'

interface PublicStudioPoliciesResponse {
  studioName: string
  privacyPolicy: string | null
  termsAndConditions: string | null
  refundPolicy: string | null
  depositPolicy: string | null
  reschedulePolicy: string | null
  communicationPolicy: string | null
}

type PageState = 'loading' | 'invalid' | 'unavailable' | 'ready'

interface PublicPolicyPageProps {
  field:
    | 'privacyPolicy'
    | 'termsAndConditions'
    | 'refundPolicy'
    | 'depositPolicy'
    | 'reschedulePolicy'
    | 'communicationPolicy'
  title: string
}

// Public, unauthenticated: backs /privacy/:studioSlug, /terms/:studioSlug,
// and (now) the four other fixed StudioSettings policy fields, each at its
// own dedicated URL -- same studioSlug-keyed GET + sanitize-at-render-time
// pattern as Policies.tsx (the CustomPolicy list page), just for one fixed
// field instead of an open-ended list.
export default function PublicPolicyPage({ field, title }: PublicPolicyPageProps) {
  const { studioSlug } = useParams<{ studioSlug: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [data, setData] = useState<PublicStudioPoliciesResponse | null>(null)

  useEffect(() => {
    if (!studioSlug) return

    let ignore = false

    fetchPublicWithRetry<PublicStudioPoliciesResponse>(`/studio-settings/public?studioSlug=${encodeURIComponent(studioSlug)}`)
      .then((response) => {
        if (ignore) return
        setData(response)
        setState('ready')
      })
      .catch((err) => {
        if (ignore) return
        // Both branches used to set 'invalid', making the 404 check purely
        // decorative -- an unreachable API rendered as "this studio does
        // not exist". Now only the API's own answer can say that.
        setState(isTransientApiFailure(err) ? 'unavailable' : 'invalid')
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
        {state === 'unavailable' && (
          <p className="text-sm text-fg-secondary">
            This page is temporarily unavailable — your link is fine, please try again in a moment.
          </p>
        )}

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
