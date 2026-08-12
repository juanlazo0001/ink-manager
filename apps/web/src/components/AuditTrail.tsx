import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { formatDateTime, formatDateOnly, formatStatus } from '../lib/format'
import MultiSelectFilter from './MultiSelectFilter'

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
  reason: 'Reason',
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
  // Newly resolved to a name/label by apps/api's audit.ts (see its own
  // ID_FIELD_CATEGORIES comment) -- "id" dropped from the label the same
  // way assignedArtistId/appointmentId above already do, since the VALUE
  // shown is a name, not an id, once resolved.
  clientId: 'Client',
  otherClientId: 'Other client',
  sourceClientId: 'Merged-from client',
  survivorId: 'Surviving client',
  referrerClientId: 'Referring client',
  referredClientId: 'Referred client',
  giftCardId: 'Gift card',
  giftCardIds: 'Gift cards',
  exemptGiftCardIds: 'Exempt gift cards',
  newGiftCardId: 'New gift card',
  derivedFromGiftCardId: 'Derived from gift card',
  satisfiedByExistingGiftCardId: 'Satisfied by gift card',
  fromAppointmentId: 'From appointment',
  toAppointmentId: 'To appointment',
  detachedFromAppointment: 'Detached from appointment',
  // Transfer-to-artist epic -- resolved to names/labels server-side
  // (apps/api/src/routes/audit.ts's own ID_FIELD_CATEGORIES), same as
  // clientId/giftCardId above; these are just the display labels for
  // those already-resolved values.
  destinationStudioId: 'Destination studio',
  originStudioId: 'Origin studio',
  destinationClientId: 'Destination client',
  originClientId: 'Origin client',
  destinationInquiryId: 'Destination project',
  outcome: 'Outcome',
  cancelledAppointmentCount: 'Appointments cancelled',
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
  if ((field === 'status' || field === 'outcome') && typeof value === 'string') return formatStatus(value)
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
  // Optional: merge audit rows logged before this field existed (pre
  // multi-contact-merge phase) genuinely lack it -- absent, not just
  // empty, so this can't be typed as always-present.
  aliasesAdded?: { addedPhones: unknown[]; addedEmails: unknown[] }
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

// Raw action strings mix snake_case ("sms_opted_out") AND kebab-case
// ("create-by-staff", "text-receipt") across the ~60 distinct actions
// logged app-wide -- explicit labels for the ones actually visible in
// real activity feeds today (this list isn't exhaustive; anything not
// here still gets a genuinely readable result from the fallback below,
// just not hand-tuned prose).
const ACTION_LABELS: Record<string, string> = {
  create: 'created',
  'create-by-staff': 'created this',
  'create-from-import': 'imported this',
  update: 'updated',
  delete: 'deleted',
  permanently_deleted: 'permanently deleted',
  archive: 'archived',
  unarchive: 'unarchived',
  status_change: 'changed the status',
  merge: 'merged a duplicate',
  'merge-from-import': 'merged during import',
  dismiss_duplicate: 'dismissed a duplicate match',
  artist_assigned: 'assigned an artist',
  artist_reassigned: 'reassigned the artist',
  estimate_sent: 'sent the estimate',
  estimate_resent: 'resent the estimate',
  estimate_opened: 'opened the estimate',
  estimate_revised: 'revised the estimate',
  estimate_followup_sent: 'sent an estimate follow-up',
  waiver_signed: 'signed the waiver',
  verify: 'verified',
  void: 'voided',
  checkout: 'checked out',
  'complete-consultation': 'completed the consultation',
  marked_charged_manually: 'marked charged manually',
  stripe_payment_confirmed: 'confirmed a Stripe payment',
  reorder: 'reordered',
  'text-receipt': 'texted a receipt',
  sms_sent: 'sent a text',
  sms_received: 'received a text',
  sms_opted_in: 'opted in to texts',
  sms_opted_out: 'opted out of texts',
  email_sent: 'sent an email',
  email_received: 'received an email',
  tag_added: 'added a tag',
  tag_removed: 'removed a tag',
  photos_added: 'added photos',
  photo_deleted: 'deleted a photo',
  reference_image_added: 'added a reference image',
  auto_booked_from_deposit: 'auto-booked the appointment on deposit payment',
  auto_book_conflict: 'could not auto-book -- the tentative time was no longer available',
  // Transfer-to-artist epic. Both logged with entityType: "Client" and
  // actually rendered today (ClientDetail.tsx's own AuditTrail usage) --
  // "transferred" at the ORIGIN studio (actor is the artist who
  // accepted), "arrived_via_transfer" at the DESTINATION studio for the
  // same execution (see artistTransferExecution.ts's own comment on why
  // that's two rows, not one). Deliberately NOT adding labels here for
  // the epic's other action strings (initiated/accepted/declined/
  // cancelled/executed, all entityType: "ArtistTransfer") -- no page
  // renders that entity type through this shared component yet, and
  // "cancelled"/"executed" already mean something different for
  // ImportBatch's own audit rows; adding them now would be dead code
  // today and a real relabeling collision the moment someone builds
  // that view later.
  transferred: 'transferred this client to another studio',
  arrived_via_transfer: 'brought this client here via transfer',
  // UI batch item 5: "Attach to Client" was renamed "Transfer to Client" --
  // the underlying action string (PATCH /:id/holder) stays "reassign-holder"
  // (an internal identifier, not user-facing), but the displayed verb now
  // matches the new button wording. "rollover" (PATCH /:id/attachment) is
  // the new "Attach to Session" feature's own action string, shared with
  // detaching a card from an appointment -- one readable label covers both
  // directions since `changes.toAppointmentId` already tells them apart.
  'reassign-holder': 'transferred this card to another client',
  rollover: 'moved this card to a different appointment',
}

// Fallback for anything not in the map above -- spaces out both
// underscores AND hyphens (the map above only had underscore-splitting
// before this fix, so a kebab-case action like "create-by-staff" used to
// render as a literal raw slug instead of prose).
function humanizeAction(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]
  return action.replace(/[_-]/g, ' ')
}

// Merge audit entries store a structural summary (counts per relation type,
// conversation-fold result, alias additions) rather than a field-level diff,
// so they don't fit the generic from/to renderer below -- turned into a
// sentence instead of the raw JSON dump the generic path would produce.
function formatMergeSummary(changes: MergeChanges): string {
  const repointedParts = Object.entries(changes.repointed)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${count} ${pluralize(lowerFirst(humanizeField(type)), count)}`)

  const aliasCount = (changes.aliasesAdded?.addedPhones.length ?? 0) + (changes.aliasesAdded?.addedEmails.length ?? 0)

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

interface AuditTrailProps {
  entityType: string
  entityId: string
  // True at every top-level "Activity History" usage (InquiryDetail,
  // AppointmentDetail) now that those are wrapped in their own <Widget> --
  // skips this component's own card/title so there's exactly one of each,
  // not a widget-within-a-widget. False (the default) preserves the
  // original self-contained card, used by the one remaining nested usage
  // (the waiver-specific history inside the Liability Waiver widget).
  bare?: boolean
}

// Sentinel for "no actorUser" (a system/webhook/scheduled-job action, e.g.
// a client opening an estimate link or a Stripe webhook confirming
// payment) -- distinct from any real user id, used as both the filter
// option's value and the lookup key below.
const SYSTEM_ACTOR_VALUE = '__system__'

function actorLabel(actorUser: AuditLogEntry['actorUser']): string {
  return actorUser?.name || actorUser?.email || 'System'
}

export default function AuditTrail({ entityType, entityId, bare = false }: AuditTrailProps) {
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Client-side filtering, same reasoning as every other bounded (never
  // paginated, never studio-wide) list in this app that filters this way --
  // one entity's own activity history is never large enough to warrant a
  // server round trip per filter change.
  const [actionFilter, setActionFilter] = useState<string[]>([])
  const [actorFilter, setActorFilter] = useState<string[]>([])

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

  // Options are built from whatever's actually present in this entity's own
  // history -- never a studio-wide action/staff list -- so the dropdown
  // never offers a choice that would always return zero results here.
  const actionOptions = logs
    ? [...new Set(logs.map((log) => log.action))]
        .map((action) => ({ value: action, label: humanizeAction(action) }))
        .sort((a, b) => a.label.localeCompare(b.label))
    : []

  const actorOptions = logs
    ? [
        ...new Map(
          logs.map((log) => [
            log.actorUser?.id ?? SYSTEM_ACTOR_VALUE,
            { value: log.actorUser?.id ?? SYSTEM_ACTOR_VALUE, label: actorLabel(log.actorUser) },
          ]),
        ).values(),
      ].sort((a, b) => a.label.localeCompare(b.label))
    : []

  const filteredLogs = (logs ?? []).filter((log) => {
    if (actionFilter.length > 0 && !actionFilter.includes(log.action)) return false
    if (actorFilter.length > 0 && !actorFilter.includes(log.actorUser?.id ?? SYSTEM_ACTOR_VALUE)) return false
    return true
  })

  // Grouped by calendar day, newest first -- logs already arrive sorted
  // newest-first from the API, so groups fall out in that same order for
  // free just by walking the list once.
  const groupedByDay: { dateLabel: string; entries: AuditLogEntry[] }[] = []
  for (const log of filteredLogs) {
    const dateLabel = formatDateOnly(log.createdAt)
    const currentGroup = groupedByDay[groupedByDay.length - 1]
    if (currentGroup?.dateLabel === dateLabel) {
      currentGroup.entries.push(log)
    } else {
      groupedByDay.push({ dateLabel, entries: [log] })
    }
  }

  const content = (
    <>
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      {!error && logs === null && <p className="mt-4 text-sm text-fg-secondary">Loading…</p>}

      {!error && logs !== null && logs.length === 0 && (
        <p className="mt-4 text-sm text-fg-secondary">No activity recorded yet.</p>
      )}

      {!error && logs !== null && logs.length > 0 && (
        <>
          {/* Filters only earn their keep once there's more than a
              handful of entries to sift through -- below that, they're
              just two more controls to look at for no real benefit. */}
          {logs.length > 5 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <MultiSelectFilter
                placeholder="All actions"
                options={actionOptions}
                selected={actionFilter}
                onChange={setActionFilter}
                className="w-40"
              />
              <MultiSelectFilter
                placeholder="All staff"
                options={actorOptions}
                selected={actorFilter}
                onChange={setActorFilter}
                className="w-40"
              />
            </div>
          )}

          {filteredLogs.length === 0 ? (
            <p className="mt-4 text-sm text-fg-secondary">No activity matches these filters.</p>
          ) : (
            <div className="mt-4 space-y-5">
              {groupedByDay.map((group) => (
                <div key={group.dateLabel}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    {group.dateLabel}
                  </p>
                  <ul className="space-y-3">
                    {group.entries.map((log) => (
                      <li key={log.id} className="rounded-lg border border-border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-fg">
                            <span className="font-medium">{actorLabel(log.actorUser)}</span>{' '}
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
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )

  if (bare) return content

  return (
    <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">Activity History</h2>
      {content}
    </div>
  )
}
