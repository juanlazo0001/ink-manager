import { prisma } from "./prisma";
import { normalizePhone } from "./phone";

interface ClientWithAliases {
  id: string;
  phone: string | null;
  email: string | null;
  phones: { phone: string }[];
  emails: { email: string }[];
}

// Exact-match only (after normalizing phone formatting) -- no fuzzy name
// matching, keeping false positives at zero. Shared by the per-client
// "potential duplicates" banner (GET /:id/potential-duplicates) and the
// mass-import duplicate check (Package R) -- one real implementation of
// the matching rule, not two independently-written copies of it.
export function clientMatchesPhoneOrEmail(
  candidate: ClientWithAliases,
  phones: ReadonlySet<string>,
  emails: ReadonlySet<string>,
): boolean {
  const candidatePhones = candidate.phones.map((p) => p.phone);
  if (candidate.phone) candidatePhones.push(normalizePhone(candidate.phone));
  if (candidatePhones.some((phone) => phones.has(phone))) return true;

  const candidateEmails = candidate.emails.map((e) => e.email);
  if (candidate.email) candidateEmails.push(candidate.email.toLowerCase());
  if (candidateEmails.some((email) => emails.has(email))) return true;

  return false;
}

// Studio-scoped, excludes already-merged clients -- the same universe
// GET /:id/potential-duplicates searches over.
export async function findStudioClientsForMatching(studioId: string, excludeId?: string) {
  return prisma.client.findMany({
    where: { studioId, mergedIntoId: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    include: { phones: true, emails: true },
  });
}

// Package R: mass-import matching -- a raw CSV row's phone/email against
// every existing (non-merged) client in the studio, using the exact same
// predicate as the per-client banner above. First match wins; a row with
// neither a phone nor an email never matches anything (nothing to compare).
export async function findMatchingClientForImportRow(
  studioId: string,
  phone: string | null,
  email: string | null,
): Promise<{ id: string; firstName: string; lastName: string } | null> {
  if (!phone && !email) return null;

  const phones = new Set<string>();
  if (phone) phones.add(normalizePhone(phone));
  const emails = new Set<string>();
  if (email) emails.add(email.toLowerCase());

  const candidates = await findStudioClientsForMatching(studioId);
  const match = candidates.find((candidate) => clientMatchesPhoneOrEmail(candidate, phones, emails));
  return match ? { id: match.id, firstName: match.firstName, lastName: match.lastName } : null;
}
