import { apiFetch } from './api';
import { stamp } from './format';

/**
 * The activity feed — `GET /audit?entityType=…&entityId=…`.
 *
 * The same endpoint apps/web's `AuditTrail` calls, with the same query
 * shape. Sessions P and Q reported this as unavailable to mobile ("no
 * audit trail on that endpoint"); that was a claim about
 * `GET /clients/:id`, and the trail was never on it — it is its own
 * endpoint, and always was.
 */
export interface AuditEntry {
  id: string;
  action: string;
  changes: Record<string, unknown> | null;
  createdAt: string;
  actorUser: { id: string; name: string | null; email: string } | null;
}

export function fetchAuditTrail(
  token: string,
  entityType: string,
  entityId: string,
  signal?: AbortSignal,
): Promise<AuditEntry[]> {
  const query = `entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`;
  return apiFetch<AuditEntry[]>(`/audit?${query}`, { token, signal });
}

/**
 * Web's `ACTION_LABELS`.
 *
 * This map was originally gift-card-scoped, with a note saying the rest
 * were "left out rather than transcribed blind" because a gift card
 * could not raise them. The CLIENT page raises twenty-one of them, so
 * the client-reachable ones are now here — taken from web's map verbatim
 * rather than reworded, so one event does not read two ways in two
 * clients.
 *
 * Which ones those are was derived from apps/api rather than guessed:
 * the `entityType: "Client"` audit calls across `routes/clients.ts`,
 * `routes/clientImport.ts`, `lib/artistTransferExecution.ts`,
 * `lib/deposits.ts` and `lib/jobs/emailPoller.ts`.
 *
 * Still deliberately absent: the inquiry/estimate/appointment verbs web
 * carries for its own detail pages. Nothing mobile renders through this
 * raises them yet, and web's fallback (underscores and hyphens to
 * spaces) keeps them readable if one ever arrives.
 */
const ACTION_LABELS: Record<string, string> = {
  create: 'created',
  'create-by-staff': 'created this',
  'create-from-import': 'imported this',
  update: 'updated',
  delete: 'deleted',
  archive: 'archived',
  unarchive: 'unarchived',
  status_change: 'changed the status',
  verify: 'verified',
  void: 'voided',
  redeem: 'redeemed',
  'reassign-holder': 'transferred this to another client',
  'text-receipt': 'texted a receipt',
  'email-receipt': 'emailed a receipt',
  marked_charged_manually: 'marked charged manually',
  stripe_payment_confirmed: 'confirmed a Stripe payment',

  /* Client-reachable, from web's map. */
  permanently_deleted: 'permanently deleted',
  merge: 'merged a duplicate',
  'merge-from-import': 'merged during import',
  dismiss_duplicate: 'dismissed a duplicate match',
  sms_opted_in: 'opted in to texts',
  sms_opted_out: 'opted out of texts',
  add_email: 'added an email',
  remove_email: 'removed an email',
  make_primary_email: 'made an email primary',
  add_phone: 'added a phone',
  remove_phone: 'removed a phone',
  make_primary_phone: 'made a phone primary',
  referral_reward_triggered: 'triggered a referral reward',
  transferred: 'transferred this client to another studio',
  arrived_via_transfer: 'brought this client here via transfer',

  /*
   * NOT in web's map. The API logs it (`routes/clients.ts`) and web has
   * no label for it, so it falls through to the raw fallback there and
   * reads "sms consent link issued".
   *
   * Named here rather than left to the fallback because this is the
   * consent gate mobile itself ships, and CLAUDE.md treats that flow as
   * compliance-critical -- the audit row proving a request was sent is
   * the last place a raw slug belongs. Flagged in the session report as
   * a gap on web's side, not a divergence invented on this one.
   */
  sms_consent_link_issued: 'sent a consent request link',
};

export function humanizeAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[_-]/g, ' ');
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  amountCents: 'Amount',
  expiresAt: 'Expires',
  paymentMethod: 'Payment method',
  clientId: 'Holder',
  appointmentId: 'Attached session',
  exemptionReason: 'Exemption reason',
  redeemedAt: 'Redeemed',
  paidAt: 'Paid',

  /* Client fields, from web's map. `clientId` above already reads
     'Holder', which is correct on a gift card; a Client row's own diffs
     never carry it. */
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  preferredSchedule: 'Preferred schedule',
  locationId: 'Location',
  otherClientId: 'Other client',
  sourceClientId: 'Merged-from client',
  survivorId: 'Surviving client',
  referrerClientId: 'Referring client',
  referredClientId: 'Referred client',
  destinationStudioId: 'Destination studio',
  originStudioId: 'Origin studio',
  destinationClientId: 'Destination client',
  originClientId: 'Origin client',
  outcome: 'Outcome',
  cancelledAppointmentCount: 'Appointments cancelled',
};

export function humanizeField(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  /*
   * Web's fallback, INCLUDING its trailing .toLowerCase() on the tail.
   *
   * That call was missing here, so a multi-word camelCase field kept its
   * interior capitals: 'giftCard' -> 'Gift Card' where web gives
   * 'Gift card', and 'assignedAt' -> 'Assigned At' where web gives
   * 'Assigned at'.
   *
   * Invisible while this only labelled gift-card diffs, because every
   * one of those was in FIELD_LABELS and never reached the fallback. The
   * merge summary is what exposed it -- it lowercases the first letter
   * and pluralizes, so the divergence surfaced mid-sentence as
   * "Moved over ... 2 gift Cards".
   *
   * The [_-] replace is mobile's own and is kept: web splits underscores
   * in humanizeACTION but not in humanizeFIELD, and a snake_case field
   * reaching here should not render raw.
   */
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** `{ from, to }` is the shape apps/api's `diffObjects` writes. */
export function isFromTo(value: unknown): value is { from: unknown; to: unknown } {
  return typeof value === 'object' && value !== null && 'from' in value && 'to' in value;
}

/** An ISO instant, as apps/api writes them into audit diffs. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  const text = String(value);
  // A diff that changed a timestamp stores it raw. Printing
  // "2026-05-01T15:05:00.000Z" in a feed a person reads is a database
  // dump; web formats these the same way, through its own `formatValue`.
  if (ISO_INSTANT.test(text)) return stamp(text);
  return text;
}

/**
 * ─── MERGE ROWS ARE NOT FIELD DIFFS ─────────────────────────────────
 *
 * `ActivityHistory`'s own header comment predicted exactly this: web
 * renders merge entries "through a separate sentence formatter", and
 * that was left unported because "a gift card raises neither -- merges
 * are a client-level action".
 *
 * The client page raises them. A merge row's `changes` is a STRUCTURAL
 * SUMMARY -- counts per repointed relation, the conversation-fold
 * result, alias additions -- not `{from, to}` pairs, so the generic
 * renderer would print raw JSON at it. This is web's
 * `formatMergeSummary`, ported.
 */
export interface MergeChanges {
  sourceClientId: string;
  sourceClientName?: string;
  survivorId: string;
  repointed: Record<string, number>;
  conversation: { merged: boolean; movedMessages: number };
  /* Optional: merge rows written before the multi-contact-merge phase
     genuinely lack this -- absent, not empty, so it cannot be required. */
  aliasesAdded?: { addedPhones: unknown[]; addedEmails: unknown[] };
}

export function isMergeChanges(action: string, changes: unknown): changes is MergeChanges {
  return (
    action === 'merge' &&
    typeof changes === 'object' &&
    changes !== null &&
    'repointed' in changes &&
    'conversation' in changes
  );
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toLowerCase() + value.slice(1);
}

function pluralize(label: string, count: number): string {
  if (count === 1) return label;
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export function formatMergeSummary(changes: MergeChanges): string {
  const repointedParts = Object.entries(changes.repointed)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${count} ${pluralize(lowerFirst(humanizeField(type)), count)}`);

  const aliasCount =
    (changes.aliasesAdded?.addedPhones.length ?? 0) + (changes.aliasesAdded?.addedEmails.length ?? 0);

  const who = changes.sourceClientName ? `"${changes.sourceClientName}"` : 'another client record';
  const sentences = [`Merged ${who} into this client.`];

  if (repointedParts.length > 0) {
    sentences.push(`Moved over ${joinWithAnd(repointedParts)}.`);
  }
  if (changes.conversation.merged) {
    sentences.push(
      `Combined conversation threads (${changes.conversation.movedMessages} message${
        changes.conversation.movedMessages === 1 ? '' : 's'
      } moved).`,
    );
  }
  if (aliasCount > 0) {
    sentences.push(`Added ${aliasCount} contact alias${aliasCount === 1 ? '' : 'es'} from the merged client.`);
  }

  return sentences.join(' ');
}

/** Who did it. Null actor means a webhook or a scheduled job, as on web. */
export function actorLabel(actor: AuditEntry['actorUser']): string {
  return actor?.name || actor?.email || 'System';
}
