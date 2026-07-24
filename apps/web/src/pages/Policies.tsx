import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { sanitizeHtml } from '../lib/sanitizeHtml'
import { applyThemePreset } from '../lib/themePresets'

interface PublicCustomPolicy {
  id: string
  title: string
  bodyHtml: string | null
}

interface PublicPoliciesResponse {
  studioName: string
  themePreset: string
  policies: PublicCustomPolicy[]
}

type PageState = 'loading' | 'invalid' | 'ready'

// Public, unauthenticated: lists every isPublic CustomPolicy for a studio
// (Package C1 §1). Same studioSlug-keyed GET pattern as /inquiry/:studioSlug
// (IntakeForm.tsx), same sanitize-at-render-time treatment as every other
// StudioSettings HTML policy field (EstimateResponse.tsx, WaiverSign.tsx).
export default function Policies() {
  const { studioSlug } = useParams<{ studioSlug: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [data, setData] = useState<PublicPoliciesResponse | null>(null)

  useEffect(() => {
    if (!studioSlug) return

    let ignore = false

    apiFetch<PublicPoliciesResponse>(`/custom-policies/public?studioSlug=${encodeURIComponent(studioSlug)}`)
      .then((response) => {
        if (ignore) return
        setData(response)
        applyThemePreset(response.themePreset)
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

  // Deep-linked from the staff composer's "Policies" menu (one specific
  // policy, not just the page) -- the browser's native hash-scroll fires
  // on load before this page's own async fetch has rendered anything to
  // scroll to, so it has to be redone manually once the content is ready.
  useEffect(() => {
    if (state !== 'ready' || !window.location.hash) return
    const target = document.getElementById(window.location.hash.slice(1))
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [state])

  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-2xl px-6 py-10 sm:px-10">
        {state === 'loading' && <p className="text-sm text-fg-secondary">Loading…</p>}

        {state === 'invalid' && <p className="text-sm text-fg-secondary">This studio couldn't be found.</p>}

        {state === 'ready' && data && (
          <>
            <h1 className="text-2xl font-bold text-fg">{data.studioName} — Policies</h1>

            {data.policies.length === 0 && (
              <p className="mt-6 text-sm text-fg-secondary">No policies have been published yet.</p>
            )}

            <div className="mt-6 space-y-8">
              {data.policies.map((policy) => (
                <section key={policy.id} id={policy.id}>
                  <h2 className="text-lg font-semibold text-fg">{policy.title}</h2>
                  <div
                    className="tiptap-content mt-2 whitespace-pre-wrap text-sm text-fg-secondary"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(policy.bodyHtml ?? '') }}
                  />
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
