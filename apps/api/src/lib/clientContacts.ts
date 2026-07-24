import type { Prisma } from "../../generated/prisma/client";
import { normalizePhone } from "./phone";

// Keeps ClientPhone/ClientEmail's isPrimary row in exact sync with
// Client.phone/Client.email, whichever way the scalar field changed --
// every code path that creates or edits those scalar fields (client
// creation, the public intake form's client creation, PATCH /clients/:id)
// calls these instead of writing its own copy of this logic. The scalar
// field is always the source of truth; these just mirror it into the
// alias tables so secondary contacts can live alongside it.
//
// Falsy phone/email (null, undefined, "") clears the primary alias (demoted
// to a secondary, never deleted -- this is additive history, not a place
// to silently lose a previously-recorded contact).

export async function syncPrimaryPhone(
  tx: Prisma.TransactionClient,
  clientId: string,
  phone: string | null | undefined,
): Promise<void> {
  const normalized = phone ? normalizePhone(phone) : null;
  const currentPrimary = await tx.clientPhone.findFirst({ where: { clientId, isPrimary: true } });

  if (!normalized) {
    if (currentPrimary) {
      await tx.clientPhone.update({ where: { id: currentPrimary.id }, data: { isPrimary: false } });
    }
    return;
  }

  if (currentPrimary?.phone === normalized) return;

  if (currentPrimary) {
    await tx.clientPhone.update({ where: { id: currentPrimary.id }, data: { isPrimary: false } });
  }

  await tx.clientPhone.upsert({
    where: { clientId_phone: { clientId, phone: normalized } },
    update: { isPrimary: true },
    create: { clientId, phone: normalized, isPrimary: true },
  });
}

export async function syncPrimaryEmail(
  tx: Prisma.TransactionClient,
  clientId: string,
  email: string | null | undefined,
): Promise<void> {
  const normalized = email ? email.trim().toLowerCase() : null;
  const currentPrimary = await tx.clientEmail.findFirst({ where: { clientId, isPrimary: true } });

  if (!normalized) {
    if (currentPrimary) {
      await tx.clientEmail.update({ where: { id: currentPrimary.id }, data: { isPrimary: false } });
    }
    return;
  }

  if (currentPrimary?.email === normalized) return;

  if (currentPrimary) {
    await tx.clientEmail.update({ where: { id: currentPrimary.id }, data: { isPrimary: false } });
  }

  await tx.clientEmail.upsert({
    where: { clientId_email: { clientId, email: normalized } },
    update: { isPrimary: true },
    create: { clientId, email: normalized, isPrimary: true },
  });
}

// Shared client-creation routine -- direct "Add Client" (POST /clients),
// mass-import ADD rows, and mass-import MERGE rows (which create a
// throwaway client from the CSV row first, then genuinely merge it into
// the matched client via the real merge logic) all go through this one
// path, rather than three copies of the same create-plus-alias-sync
// sequence. referralCode is a parameter, not generated in here, because
// generateUniqueReferralCode's own uniqueness check queries the raw
// prisma client (not a transaction client) -- callers generate it BEFORE
// opening their transaction, same as the direct-add route always has.
export async function createClientFromFields(
  tx: Prisma.TransactionClient,
  params: {
    studioId: string;
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    instagramHandle?: string | null;
    facebookProfileUrl?: string | null;
    otherContact?: string | null;
    referralCode: string;
  },
) {
  const created = await tx.client.create({
    data: {
      studioId: params.studioId,
      firstName: params.firstName,
      lastName: params.lastName,
      email: params.email || null,
      phone: params.phone ? normalizePhone(params.phone) : null,
      instagramHandle: params.instagramHandle || null,
      facebookProfileUrl: params.facebookProfileUrl || null,
      otherContact: params.otherContact || null,
      referralCode: params.referralCode,
    },
  });
  await syncPrimaryPhone(tx, created.id, created.phone);
  await syncPrimaryEmail(tx, created.id, created.email);
  return created;
}
