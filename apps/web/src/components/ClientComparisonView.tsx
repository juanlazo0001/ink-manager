import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { formatDateTime, formatPhoneInput } from '../lib/format'

interface ComparisonClient {
  id: string
  firstName: string
  lastName: string
  createdAt: string
  instagramHandle: string | null
  facebookProfileUrl: string | null
  otherContact: string | null
  phones: { id: string; phone: string; label: string | null; isPrimary: boolean }[]
  emails: { id: string; email: string; label: string | null; isPrimary: boolean }[]
  inquiries: { id: string; createdAt: string }[]
  giftCards: { id: string; amountCents: number; createdAt: string }[]
}

interface ComparisonAppointment {
  id: string
  startTime: string
  status: string
}

interface ClientSummary {
  client: ComparisonClient
  appointments: ComparisonAppointment[]
}

// Rough "did anything happen with this client recently" signal -- the most
// recent of: account creation, any inquiry, any gift card issuance, any
// appointment. Good enough for "does this look like the same active
// person", not meant as an authoritative activity log.
function computeLastActivity(summary: ClientSummary): string {
  const dates = [
    summary.client.createdAt,
    ...summary.client.inquiries.map((i) => i.createdAt),
    ...summary.client.giftCards.map((g) => g.createdAt),
    ...summary.appointments.map((a) => a.startTime),
  ]
  return dates.sort().at(-1)!
}

interface ClientComparisonViewProps {
  clientAId: string
  clientBId: string
  onProceed: () => void
  onCancel: () => void
}

// Shared between the auto-suggested-duplicate flow and the manual
// merge-search flow (§2/§3) -- both just point this at two client ids and
// get the same side-by-side view, with the same "Proceed to Merge" step in
// front of the existing confirm-merge dialog (unchanged, still reused as-is).
export default function ClientComparisonView({ clientAId, clientBId, onProceed, onCancel }: ClientComparisonViewProps) {
  const [summaries, setSummaries] = useState<[ClientSummary, ClientSummary] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    async function loadOne(id: string): Promise<ClientSummary> {
      const [client, appointments] = await Promise.all([
        apiFetch<ComparisonClient>(`/clients/${id}`),
        apiFetch<ComparisonAppointment[]>(`/appointments?clientId=${id}`),
      ])
      return { client, appointments }
    }

    async function load() {
      setSummaries(null)
      setError(null)
      try {
        const [a, b] = await Promise.all([loadOne(clientAId), loadOne(clientBId)])
        if (!ignore) setSummaries([a, b])
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load comparison')
      }
    }

    load()
    return () => {
      ignore = true
    }
  }, [clientAId, clientBId])

  if (error) return <p className="text-sm text-danger">{error}</p>
  if (!summaries) return <p className="text-sm text-fg-secondary">Loading comparison…</p>

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {summaries.map((summary) => (
          <ComparisonColumn key={summary.client.id} summary={summary} />
        ))}
      </div>
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onProceed}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover"
        >
          Proceed to Merge
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function ComparisonColumn({ summary }: { summary: ClientSummary }) {
  const { client, appointments } = summary
  const giftCardValueCents = client.giftCards.reduce((sum, card) => sum + card.amountCents, 0)
  const mostRecentAppointment = [...appointments].sort((a, b) => b.startTime.localeCompare(a.startTime))[0] ?? null
  const hasSocials = client.instagramHandle || client.facebookProfileUrl || client.otherContact

  return (
    <div className="min-w-0 rounded-xl border border-border p-4">
      <h3 className="font-semibold text-fg">
        {client.firstName} {client.lastName}
      </h3>

      <div className="mt-3 space-y-1 text-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Phones</p>
        {client.phones.length === 0 && <p className="text-fg-muted">None on file</p>}
        {client.phones.map((p) => (
          <p key={p.id} className="text-fg-secondary">
            {formatPhoneInput(p.phone)}
            {p.isPrimary ? ' (primary)' : ''}
            {p.label ? ` — ${p.label}` : ''}
          </p>
        ))}
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Emails</p>
        {client.emails.length === 0 && <p className="text-fg-muted">None on file</p>}
        {client.emails.map((e) => (
          <p key={e.id} className="text-fg-secondary">
            {e.email}
            {e.isPrimary ? ' (primary)' : ''}
            {e.label ? ` — ${e.label}` : ''}
          </p>
        ))}
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Socials</p>
        {!hasSocials && <p className="text-fg-muted">None on file</p>}
        {client.instagramHandle && <p className="text-fg-secondary">Instagram: {client.instagramHandle}</p>}
        {client.facebookProfileUrl && <p className="text-fg-secondary">Facebook: {client.facebookProfileUrl}</p>}
        {client.otherContact && <p className="text-fg-secondary">Other: {client.otherContact}</p>}
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Activity</p>
        <p className="text-fg-secondary">
          {client.inquiries.length} inquir{client.inquiries.length === 1 ? 'y' : 'ies'}
        </p>
        <p className="text-fg-secondary">
          {appointments.length} appointment{appointments.length === 1 ? '' : 's'}
          {mostRecentAppointment
            ? ` — most recent ${formatDateTime(mostRecentAppointment.startTime)} (${mostRecentAppointment.status})`
            : ''}
        </p>
        <p className="text-fg-secondary">
          {client.giftCards.length} gift card{client.giftCards.length === 1 ? '' : 's'}
          {client.giftCards.length > 0 ? ` — $${(giftCardValueCents / 100).toFixed(2)} total` : ''}
        </p>
        <p className="text-fg-secondary">Last activity: {formatDateTime(computeLastActivity(summary))}</p>
      </div>
    </div>
  )
}
