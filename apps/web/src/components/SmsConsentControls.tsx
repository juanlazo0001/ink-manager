import { useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'

// Post-add SMS consent, staff side. Lives in its own component rather than
// inline in ClientDetail.tsx because it owns three distinct mutations and a
// fair amount of state, and ClientDetail is already very long.
//
// The two grant paths are deliberately offered side by side rather than one
// being "the" way: recording verbal consent is right for someone standing at
// the counter, and the self-serve link is right for everyone else -- and the
// link produces the stronger record, since it is the client's own action
// rather than the studio attesting on their behalf.

// Every value Client.smsConsentSource can hold, rendered for humans. Covers
// the pre-existing sources (public intake form, inbound keyword, inbound
// text) as well as the ones these controls add, so the line always says
// where consent actually came from instead of showing a raw enum-ish string.
const CONSENT_SOURCE_LABELS: Record<string, string> = {
  intake_form: 'intake form',
  inbound_keyword: 'text keyword',
  inbound_sms: 'inbound text',
  consent_link: 'opt-in link',
  staff_verbal_in_person: 'verbal, in person',
  staff_verbal_phone: 'verbal, by phone',
  staff_written_form: 'signed form',
}

const STAFF_METHODS = [
  { value: 'verbal_in_person', label: 'Verbal — in person' },
  { value: 'verbal_phone', label: 'Verbal — over the phone' },
  { value: 'written_form', label: 'Signed paper form' },
] as const

interface ConsentPatch {
  smsConsentGivenAt?: string | null
  smsConsentSource?: string | null
  smsOptedOutAt?: string | null
}

interface Props {
  clientId: string
  smsConsentGivenAt: string | null
  smsConsentSource: string | null
  smsOptedOutAt: string | null
  canEdit: boolean
  // Merged/ended clients are read-only everywhere else in this page; consent
  // is no different.
  disabled?: boolean
  onUpdated: (patch: ConsentPatch) => void
}

export default function SmsConsentControls({
  clientId,
  smsConsentGivenAt,
  smsConsentSource,
  smsOptedOutAt,
  canEdit,
  disabled = false,
  onUpdated,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showMethods, setShowMethods] = useState(false)
  const [method, setMethod] = useState<string>(STAFF_METHODS[0].value)

  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const [linkExpiresAt, setLinkExpiresAt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [confirmRevoke, setConfirmRevoke] = useState(false)

  const interactive = canEdit && !disabled

  function fail(err: unknown, fallback: string) {
    setError(err instanceof ApiError || err instanceof Error ? err.message : fallback)
  }

  async function recordConsent() {
    setBusy(true)
    setError(null)
    try {
      const updated = await apiFetch<ConsentPatch>(`/clients/${clientId}/sms-consent`, {
        method: 'POST',
        body: JSON.stringify({ method }),
      })
      onUpdated(updated)
      setShowMethods(false)
    } catch (err) {
      fail(err, 'Failed to record consent')
    } finally {
      setBusy(false)
    }
  }

  async function issueLink() {
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const result = await apiFetch<{ url: string; expiresAt: string }>(`/clients/${clientId}/sms-consent/link`, {
        method: 'POST',
      })
      setLinkUrl(result.url)
      setLinkExpiresAt(result.expiresAt)
    } catch (err) {
      fail(err, 'Failed to create an opt-in link')
    } finally {
      setBusy(false)
    }
  }

  async function revokeConsent() {
    setBusy(true)
    setError(null)
    try {
      const updated = await apiFetch<ConsentPatch>(`/clients/${clientId}/sms-consent`, { method: 'DELETE' })
      onUpdated(updated)
      setConfirmRevoke(false)
      setLinkUrl(null)
    } catch (err) {
      fail(err, 'Failed to record the opt-out')
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    if (!linkUrl) return
    try {
      await navigator.clipboard.writeText(linkUrl)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const sourceLabel = smsConsentSource ? CONSENT_SOURCE_LABELS[smsConsentSource] ?? smsConsentSource : null

  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-fg-secondary">
        SMS Consent:{' '}
        {smsConsentGivenAt ? (
          <span className="text-success">
            Given {formatDateTime(smsConsentGivenAt)}
            {sourceLabel ? ` · ${sourceLabel}` : ''}
          </span>
        ) : (
          <span className="text-fg-muted">Not yet given</span>
        )}
      </p>

      {/* An opted-out client gets no grant controls at all. Staff cannot
          undo a STOP -- Twilio blocks the number at its own layer until the
          handset sends START, so a button here would produce a client who
          looks reachable and whose every message is rejected. */}
      {smsOptedOutAt && (
        <p className="mt-2 text-xs font-medium text-warning">
          Opted out of SMS {formatDateTime(smsOptedOutAt)} — outbound texts to this client are refused until they text
          START.
        </p>
      )}

      {interactive && !smsOptedOutAt && !smsConsentGivenAt && (
        <div className="mt-2">
          {!showMethods && !linkUrl && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowMethods(true)}
                className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface-inset hover:text-fg"
              >
                Record consent
              </button>
              <button
                type="button"
                onClick={issueLink}
                disabled={busy}
                className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface-inset hover:text-fg disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Get opt-in link'}
              </button>
            </div>
          )}

          {showMethods && (
            <div className="rounded-lg border border-border p-3">
              <label htmlFor="consentMethod" className="block text-xs font-medium text-fg-secondary">
                How did they give consent?
              </label>
              <select
                id="consentMethod"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-xs text-fg focus:border-accent focus:outline-none"
              >
                {STAFF_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[11px] leading-snug text-fg-muted">
                Only record consent the client actually gave. This is the studio&rsquo;s record if a carrier ever asks.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={recordConsent}
                  disabled={busy}
                  className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save consent'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMethods(false)
                    setError(null)
                  }}
                  className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface-inset"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {linkUrl && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-fg-secondary">Opt-in link</p>
              <p className="mt-1 select-all break-all rounded bg-surface-inset px-2 py-1.5 font-mono text-[11px] text-fg">
                {linkUrl}
              </p>
              {/* Emphatically NOT sendable by SMS from here: texting an
                  opt-in invitation to someone who has not consented is
                  itself an unconsented message. */}
              <p className="mt-2 text-[11px] leading-snug text-fg-muted">
                Send this by email or hand it over in person — don&rsquo;t text it, since they haven&rsquo;t opted in
                yet. Single use
                {linkExpiresAt ? `, expires ${formatDateTime(linkExpiresAt)}` : ''}.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-bg transition hover:bg-accent-hover"
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={() => setLinkUrl(null)}
                  className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface-inset"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recording a withdrawal is never gated the way granting is -- if a
          client says stop, staff must be able to honour it immediately. */}
      {interactive && !smsOptedOutAt && smsConsentGivenAt && (
        <div className="mt-2">
          {confirmRevoke ? (
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-fg-secondary">
                Record that this client asked to stop receiving texts? Only they can turn texts back on afterwards, by
                texting START.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={revokeConsent}
                  disabled={busy}
                  className="rounded-full bg-danger-strong px-3 py-1 text-xs font-semibold text-white transition disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Record opt-out'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRevoke(false)}
                  className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface-inset"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRevoke(true)}
              className="text-xs font-medium text-fg-muted underline-offset-2 transition hover:text-danger hover:underline"
            >
              They asked to stop texts
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
