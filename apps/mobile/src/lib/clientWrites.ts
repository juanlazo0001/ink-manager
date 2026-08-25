import { apiFetch } from './api';
import type { ClientDetail, ClientEmail, ClientPhone } from './clients';

/**
 * The client record's write surface — mobile's first live writes.
 *
 * ─── THE INVENTORY, read off `apps/api/src/routes/clients.ts` ───────
 *
 *   PATCH  /clients/:id                          clients.edit
 *   POST   /clients/:id/phones                   clients.edit
 *   DELETE /clients/:id/phones/:phoneId          clients.edit
 *   POST   /clients/:id/phones/:id/make-primary  clients.edit
 *   POST   /clients/:id/emails                   clients.edit
 *   DELETE /clients/:id/emails/:emailId          clients.edit
 *   POST   /clients/:id/emails/:id/make-primary  clients.edit
 *   POST   /clients/:id/archive                  clients.archive
 *   POST   /clients/:id/unarchive                clients.archive
 *   POST   /clients/:id/merge                    clients.merge
 *   DELETE /clients/:id                          OWNER only — NOT wired
 *
 * `DELETE /clients/:id` is web's other More-menu item and is deliberately
 * left toast-gated: it is permanent destruction, it is OWNER-only, and it
 * is not in the set this session was cleared to make live (contact CRUD,
 * edit, archive, merge). Web guards it with a typed confirmation over a
 * server-rendered preview of what would be destroyed; that preview
 * endpoint would need porting too, and neither is a thing to bolt on
 * quickly.
 *
 * ─── WHAT PATCH ACCEPTS ─────────────────────────────────────────────
 *
 * `EDITABLE_CLIENT_FIELDS`, exactly: firstName, lastName, email, phone,
 * instagramHandle, facebookProfileUrl, otherContact, address,
 * preferredLocale. Anything else in the body is IGNORED, not rejected —
 * so sending a stray field fails silently rather than loudly, which is
 * why this module names the fields rather than spreading a form object.
 *
 * Two server behaviours worth knowing:
 *
 *   - `phone` is run through `normalizePhone` before storage, and writing
 *     `phone`/`email` re-syncs the primary row in the phones/emails
 *     tables. So editing the header phone and editing the Contact Info
 *     list are two doors onto the same data.
 *   - A merged client is REFUSED (400): "This client has been merged and
 *     can no longer be edited directly."
 */

export interface ClientPatch {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  instagramHandle?: string | null;
  facebookProfileUrl?: string | null;
  otherContact?: string | null;
  address?: string | null;
}

export function updateClient(token: string, id: string, patch: ClientPatch): Promise<ClientDetail> {
  return apiFetch<ClientDetail>(`/clients/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(patch),
  });
}

export function addClientPhone(
  token: string,
  id: string,
  input: { phone: string; label?: string | null },
): Promise<ClientPhone> {
  return apiFetch<ClientPhone>(`/clients/${encodeURIComponent(id)}/phones`, {
    method: 'POST',
    token,
    body: JSON.stringify({ phone: input.phone, label: input.label ?? null }),
  });
}

export function removeClientPhone(token: string, id: string, phoneId: string): Promise<null> {
  return apiFetch<null>(
    `/clients/${encodeURIComponent(id)}/phones/${encodeURIComponent(phoneId)}`,
    { method: 'DELETE', token },
  );
}

export function makeClientPhonePrimary(token: string, id: string, phoneId: string): Promise<null> {
  return apiFetch<null>(
    `/clients/${encodeURIComponent(id)}/phones/${encodeURIComponent(phoneId)}/make-primary`,
    { method: 'POST', token },
  );
}

export function addClientEmail(
  token: string,
  id: string,
  input: { email: string; label?: string | null },
): Promise<ClientEmail> {
  return apiFetch<ClientEmail>(`/clients/${encodeURIComponent(id)}/emails`, {
    method: 'POST',
    token,
    body: JSON.stringify({ email: input.email, label: input.label ?? null }),
  });
}

export function removeClientEmail(token: string, id: string, emailId: string): Promise<null> {
  return apiFetch<null>(
    `/clients/${encodeURIComponent(id)}/emails/${encodeURIComponent(emailId)}`,
    { method: 'DELETE', token },
  );
}

export function makeClientEmailPrimary(token: string, id: string, emailId: string): Promise<null> {
  return apiFetch<null>(
    `/clients/${encodeURIComponent(id)}/emails/${encodeURIComponent(emailId)}/make-primary`,
    { method: 'POST', token },
  );
}

export function archiveClient(token: string, id: string): Promise<ClientDetail> {
  return apiFetch<ClientDetail>(`/clients/${encodeURIComponent(id)}/archive`, { method: 'POST', token });
}

export function unarchiveClient(token: string, id: string): Promise<ClientDetail> {
  return apiFetch<ClientDetail>(`/clients/${encodeURIComponent(id)}/unarchive`, { method: 'POST', token });
}

/**
 * Absorb another client into this one.
 *
 * ─── THE SEMANTICS, and they matter for the confirm copy ────────────
 *
 * `POST /clients/:survivorId/merge { sourceClientId }`. The client you
 * are LOOKING AT is the survivor; the one you pick is absorbed. Inside
 * one transaction (`performMerge` in `apps/api/src/lib/clientMerge.ts`):
 *
 *   1. every inquiry, appointment, gift card and the rest is repointed
 *      to the survivor;
 *   2. the two clients' conversations are folded together;
 *   3. the source's phones and emails are carried over as aliases;
 *   4. the source gets `mergedIntoId = survivor` — it is NOT deleted.
 *
 * So the source survives as a tombstone that points here. It drops out
 * of every list view (they filter on `mergedIntoId: null`) and the API
 * refuses to edit it: "This client has been merged and can no longer be
 * edited directly."
 *
 * IT IS NOT REVERSIBLE. There is no unmerge route — `archive` has an
 * `unarchive`, this has nothing — and step 1 records no inverse. The
 * confirm copy says exactly that, because it is true.
 */
export function mergeClients(
  token: string,
  survivorId: string,
  sourceClientId: string,
): Promise<ClientDetail> {
  return apiFetch<ClientDetail>(`/clients/${encodeURIComponent(survivorId)}/merge`, {
    method: 'POST',
    token,
    body: JSON.stringify({ sourceClientId }),
  });
}
