import { apiFetch } from '@/lib/api';

/**
 * Activity history for a record — web's `AuditTrail`, on a phone.
 *
 * ─── THE GAP ────────────────────────────────────────────────────────
 *
 * Web's inquiry detail ends with an Activity History widget
 * (`<AuditTrail bare entityType="Inquiry" entityId={...} />`). Mobile had
 * no equivalent at all: session BH's parity run listed it as the one
 * whole SECTION web renders and mobile does not, which is the category
 * that outranks any amount of mismatched padding.
 *
 * ─── NOT NEW API SURFACE ────────────────────────────────────────────
 *
 *     GET /audit?entityType=Inquiry&entityId=<id>
 *
 * has existed and is what web calls. Gated on `audit.view`, so the
 * caller checks that permission rather than showing a section that 403s.
 */

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  actorUser: { id: string; name: string | null; email: string } | null;
  changes?: unknown;
}

export function fetchActivity(
  token: string,
  entityType: string,
  entityId: string,
  signal?: AbortSignal,
): Promise<AuditEntry[]> {
  return apiFetch<AuditEntry[]>(
    `/audit?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
    { token, signal },
  );
}

/**
 * Web's `ACTION_LABELS`, copied rather than approximated.
 *
 * The same decision `components/icons.tsx` made about web's glyphs: two
 * hand-maintained phrasings of "what happened to this record" would drift
 * within a session, and the wording is product copy, not implementation.
 *
 * The fallback is web's too — `action.replace(/[_-]/g, ' ')` — so an
 * action added on the server appears as readable words on both clients
 * on the day it ships, instead of appearing on one and being blank or
 * raw on the other.
 */
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
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[_-]/g, ' ');
}

/** "Dev Owner", or the email, or the system. */
export function actorLabel(entry: AuditEntry): string {
  const actor = entry.actorUser;
  if (!actor) {
    /*
     * A null actor is a SYSTEM write — a webhook, a scheduled job, a
     * client acting through a public token. Web renders "System" for
     * exactly this, and it matters that mobile says the same thing
     * rather than an empty string: "changed the status" with no subject
     * reads as a rendering fault.
     */
    return 'System';
  }
  return actor.name ?? actor.email;
}
