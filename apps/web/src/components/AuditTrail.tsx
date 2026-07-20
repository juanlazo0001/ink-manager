import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'

interface AuditLogEntry {
  id: string
  action: string
  changes: Record<string, { from: unknown; to: unknown }> | Record<string, unknown> | null
  createdAt: string
  actorUser: { id: string; name: string | null; email: string } | null
}

// Raw field names as tracked by apps/api's diffObjects calls -- shown instead
// of the camelCase key so the feed reads as prose, not a database dump.
const FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  colorOrBlackGrey: 'Color / black & grey',
  placement: 'Placement',
  estimatedSize: 'Estimated size',
  budget: 'Budget',
  desiredTiming: 'Desired timing',
  priceEstimateLow: 'Price estimate (low)',
  priceEstimateHigh: 'Price estimate (high)',
  timeEstimateHoursMin: 'Time estimate (min hours)',
  timeEstimateHoursMax: 'Time estimate (max hours)',
  status: 'Status',
  assignedArtistId: 'Assigned artist',
  assignedAt: 'Assigned at',
  declineNote: 'Decline reason',
  appointmentId: 'Appointment',
  estimateSentAt: 'Estimate sent',
  estimateOpenedAt: 'Estimate opened',
  estimateRespondedAt: 'Estimate responded',
  completedAt: 'Completed at',
  expiresAt: 'Expires',
  locationId: 'Location',
  preferredSchedule: 'Preferred schedule',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  showSidebarBadges: 'Sidebar badges',
  giftCardDefaultExpirationDays: 'Gift card expiration (days)',
  estimateFollowUpHours: 'Estimate follow-up (hours)',
  waiverHealthQuestions: 'Waiver health questions',
  waiverClauses: 'Waiver clauses',
  messageTemplates: 'Message templates',
}

// Fallback for anything not in the map above -- "someFieldName" -> "Some field name" --
// so a field added on the backend later never regresses to showing raw camelCase.
function humanizeField(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field]
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

// Values that look like an ISO date get run through formatDateTime; the
// server already resolves assignedArtistId/appointmentId to a name/ISO date
// respectively, so those pass straight through here.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (field === 'status' && typeof value === 'string') return formatStatus(value)
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) return formatDateTime(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isFromToShape(value: unknown): value is { from: unknown; to: unknown } {
  return typeof value === 'object' && value !== null && 'from' in value && 'to' in value
}

interface MergeChanges {
  sourceClientId: string
  sourceClientName?: string
  survivorId: string
  repointed: Record<string, number>
  conversation: { merged: boolean; movedMessages: number }
  aliasesAdded: { addedPhones: unknown[]; addedEmails: unknown[] }
}

function isMergeChanges(action: string, changes: unknown): changes is MergeChanges {
  return (
    action === 'merge' &&
    typeof changes === 'object' &&
    changes !== null &&
    'repointed' in changes &&
    'conversation' in changes
  )
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1)
}

function pluralize(label: string, count: number): string {
  if (count === 1) return label
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`
  return `${label}s`
}

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

// Raw action strings are snake_case identifiers (e.g. "sms_opted_out"),
// not prose -- space them out so the feed reads as a sentence fragment.
function humanizeAction(action: string): string {
  return action.replace(/_/g, ' ')
}

// Merge audit entries store a structural summary (counts per relation type,
// conversation-fold result, alias additions) rather than a field-level diff,
// so they don't fit the generic from/to renderer below -- turned into a
// sentence instead of the raw JSON dump the generic path would produce.
function formatMergeSummary(changes: MergeChanges): string {
  const repointedParts = Object.entries(changes.repointed)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${count} ${pluralize(lowerFirst(humanizeField(type)), count)}`)

  const aliasCount = changes.aliasesAdded.addedPhones.length + changes.aliasesAdded.addedEmails.length

  const who = changes.sourceClientName ? `"${changes.sourceClientName}"` : 'another client record'
  const sentences = [`Merged ${who} into this client.`]

  if (repointedParts.length > 0) {
    sentences.push(`Moved over ${joinWithAnd(repointedParts)}.`)
  }
  if (changes.conversation.merged) {
    sentences.push(
      `Combined conversation threads (${changes.conversation.movedMessages} message${changes.conversation.movedMessages === 1 ? '' : 's'} moved).`,
    )
  }
  if (aliasCount > 0) {
    sentences.push(`Added ${aliasCount} contact alias${aliasCount === 1 ? '' : 'es'} from the merged client.`)
  }

  return sentences.join(' ')
}

export default function AuditTrail({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    apiFetch<AuditLogEntry[]>(`/audit?entityType=${entityType}&entityId=${entityId}`)
      .then((data) => {
        if (!ignore) setLogs(data)
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load activity history')
      })

    return () => {
      ignore = true
    }
  }, [entityType, entityId])

  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">Activity History</h2>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      {!error && logs === null && <p className="mt-4 text-sm text-fg-secondary">Loading…</p>}

      {!error && logs !== null && logs.length === 0 && (
        <p className="mt-4 text-sm text-fg-secondary">No activity recorded yet.</p>
      )}

      {!error && logs !== null && logs.length > 0 && (
        <ul className="mt-4 space-y-3">
          {logs.map((log) => (
            <li key={log.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-fg">
                  <span className="font-medium">{log.actorUser?.name || log.actorUser?.email || 'System'}</span>{' '}
                  <span className="text-fg-secondary">{humanizeAction(log.action)}</span>
                </span>
                <span className="text-xs text-fg-muted">{formatDateTime(log.createdAt)}</span>
              </div>

              {log.changes && isMergeChanges(log.action, log.changes) && (
                <p className="mt-2 text-xs text-fg-secondary">{formatMergeSummary(log.changes)}</p>
              )}

              {log.changes && !isMergeChanges(log.action, log.changes) && Object.keys(log.changes).length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-fg-secondary">
                  {Object.entries(log.changes).map(([field, value]) => (
                    <li key={field}>
                      <span className="font-medium text-fg-secondary">{humanizeField(field)}:</span>{' '}
                      {isFromToShape(value) ? (
                        <>
                          {formatValue(field, value.from)} <span className="text-fg-muted">→</span>{' '}
                          {formatValue(field, value.to)}
                        </>
                      ) : (
                        formatValue(field, value)
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
