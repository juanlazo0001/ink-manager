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
 * Web's `ACTION_LABELS`, carrying the entries a gift card can actually
 * produce plus the generic lifecycle ones every entity shares.
 *
 * Web's own map is longer — it covers inquiries, estimates, waivers and
 * appointments too. Those are copied here only where a gift card could
 * raise them; the rest are left out rather than transcribed blind, and
 * web's own fallback (underscores and hyphens to spaces) handles anything
 * this map has not met.
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
};

export function humanizeField(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  // Web's fallback: camelCase to spaced words, first letter capitalised.
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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

/** Who did it. Null actor means a webhook or a scheduled job, as on web. */
export function actorLabel(actor: AuditEntry['actorUser']): string {
  return actor?.name || actor?.email || 'System';
}
