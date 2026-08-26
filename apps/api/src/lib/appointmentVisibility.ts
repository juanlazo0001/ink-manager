import { Role } from "../../generated/prisma/enums";
import type { AuthPayload } from "../middleware/auth";
import { effectiveRoleAt, rolesByStudioForCaller } from "./artistAccess";
import { hasPermission } from "./permissions";

// Server-side response projection for GET /appointments and
// GET /appointments/:id -- the appointments counterpart to inquiries.ts's
// long-standing ARTIST_INQUIRY_SELECT + lib/artistFieldVisibility.ts pair.
//
// Why this file exists: both appointment routes used to return the whole
// Appointment row (`include`, then `res.json({ ...rest })`), so every
// caller holding `appointments.view` -- which is in ARTIST's DEFAULT set --
// received finalCostCents, tipCents, closeoutNotes, paidVia, both Stripe
// ids, the full gift-card stack with codes and dollar amounts, and the
// client's phone/email/SMS-consent state. Every one of those was gated
// CLIENT-SIDE ONLY, in two places independently (apps/web's
// AppointmentDetail.tsx and apps/mobile's own appointmentVisibility.ts,
// whose header comment documents the leak it was written to work around).
// Two clients agreeing to hide a field is not the same as the field not
// being sent, and `curl` was never bound by either.
//
// The rules below are NOT re-decided here -- each mirrors what those two
// clients already gate on today, so adopting this projection changes
// nothing anyone can currently see and removes only what they could
// already not see:
//
//   financials     <- appointments.checkout   (web's `canCheckout`,
//                     mobile's `canSeeFinancials`)
//   giftCards      <- giftCards.view          (web's `canViewGiftCards`,
//                     mobile's `canSeeGiftCards`)
//   clientContact  <- staff standing          (web's `canManage`,
//                     mobile's `hasStaffStanding`)
//
// Every one of them is evaluated at the RECORD's own studio, never the
// caller's home studio or their raw JWT role -- the standing rule in
// CLAUDE.md's artist-scoping section, and the reason this goes through
// effectiveRoleAt rather than reading req.user.role. That is also what
// makes the guest-studio case correct for free: a solo studio's OWNER
// reaching a host studio's appointment through an active GUEST membership
// resolves to Role.ARTIST there, so they get the host's real ARTIST
// matrix, not OWNER's unconditional `hasPermission` short-circuit -- the
// same trap hasPermissionAt's own comment exists to describe.
export interface AppointmentVisibility {
  /**
   * The caller's EFFECTIVE role at this appointment's own studio, or null
   * when they have no live relationship with it at all. Surfaced (rather
   * than kept private to the three flags below) so a caller needing a
   * fourth, studio-SETTING-driven decision -- the detail route's
   * artistFieldVisibility.pricingDetail check -- can make it without
   * re-running effectiveRoleAt's own Artist/membership lookups.
   */
  role: Role | null;
  /** Final cost, tip, closeout notes, payment plumbing, who closed it out. */
  financials: boolean;
  /** The attached gift-card stack -- codes, dollar amounts, statuses. */
  giftCards: boolean;
  /**
   * The client's real phone/email and SMS-consent state.
   *
   * Staff standing on THIS record, matching web's `canManage`: a real
   * OWNER/FRONT_DESK role AND the record being at the caller's own studio.
   * Not a permission key, because there isn't one that means this --
   * `clients.view` is the closest, and it governs the Clients section
   * rather than a contact block nested inside an appointment.
   */
  clientContact: boolean;
}

async function forRole(studioId: string, role: Role | null): Promise<AppointmentVisibility> {
  if (!role) return { role: null, financials: false, giftCards: false, clientContact: false };
  const [financials, giftCards] = await Promise.all([
    hasPermission(studioId, role, "appointments.checkout"),
    hasPermission(studioId, role, "giftCards.view"),
  ]);
  return { role, financials, giftCards, clientContact: role === Role.OWNER || role === Role.FRONT_DESK };
}

/** Single-record form, for GET /appointments/:id. */
export async function resolveAppointmentVisibility(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
  recordStudioId: string,
): Promise<AppointmentVisibility> {
  return forRole(recordStudioId, await effectiveRoleAt(user, recordStudioId));
}

// Batched form for GET /, whose result set genuinely spans several studios
// in ONE response for an ARTIST caller (home + every active guest -- see
// that route's own artistStudioIds comment), each of which may answer
// these three questions differently. Same shape and reasoning as
// artistFieldVisibility.ts's own getArtistFieldVisibilityForStudios:
// resolve once per distinct studioId, never once per row.
//
// Goes through rolesByStudioForCaller rather than N effectiveRoleAt calls
// so the caller's Artist row and membership list are each read once, not
// once per studio.
export async function resolveAppointmentVisibilityForStudios(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
  studioIds: string[],
): Promise<Map<string, AppointmentVisibility>> {
  const roles = await rolesByStudioForCaller(user);
  const unique = [...new Set(studioIds)];
  const entries = await Promise.all(
    unique.map(async (id) => [id, await forRole(id, roles.get(id) ?? null)] as const),
  );
  return new Map(entries);
}

// Post-fetch stripping rather than a per-route static `select`, for the
// same reason artistFieldVisibility.ts gives: GET / can return rows from
// several studios with different answers in one response, and no single
// Prisma `select` expresses "a different shape per row."
//
// Deletes keys outright rather than nulling them, so a withheld field is
// genuinely ABSENT from the JSON -- `"finalCostCents": null` is a claim
// (this session closed out at no charge), absence is not. Deleting a key
// that was never there is a safe no-op, so the same function serves both
// the list shape and the richer detail shape without a second variant.
export function applyAppointmentVisibility<T extends Record<string, unknown>>(
  row: T,
  visibility: AppointmentVisibility,
): T {
  const result: Record<string, unknown> = { ...row };
  // Both routes nest these under `client`; rebuilt (never mutated in
  // place) because the Prisma row object is shared with nothing here, but
  // the caller's may not be.
  let client = result.client && typeof result.client === "object" ? { ...(result.client as Record<string, unknown>) } : null;

  if (!visibility.financials) {
    delete result.finalCostCents;
    delete result.tipCents;
    delete result.closeoutNotes;
    // checkedOutAt deliberately SURVIVES: "this session has been closed
    // out" is operational status, not a financial figure -- it is what
    // the project-stage derivation (lib/kanban.ts's deriveProjectStage,
    // mirrored server-side in INQUIRY_LIST_SELECT) reads to tell
    // "Session Complete" from "Scheduled", and ARTIST_INQUIRY_SELECT
    // already hands it to artists on their own projects. Only WHO closed
    // it out goes, alongside the money.
    delete result.checkedOutById;
    delete result.checkedOutBy;
    delete result.paidVia;
    delete result.stripeCheckoutSessionId;
    delete result.stripePaymentIntentId;
    // Rendered only inside web's checkout-complete panel, which is itself
    // behind appointments.checkout -- so it travels with financials
    // rather than with contact details, matching where it is actually
    // used rather than what it superficially resembles.
    if (client) delete client.referralCode;
  }

  if (!visibility.giftCards) {
    delete result.giftCards;
  }

  if (!visibility.clientContact && client) {
    delete client.phone;
    delete client.email;
    delete client.smsConsentGivenAt;
    delete client.smsOptedOutAt;
    // Presence-only id lists, but presence IS the answer the send-channel
    // picker wants, and that picker only ever renders behind staff
    // standing.
    delete client.phones;
    delete client.emails;
  }

  if (client) result.client = client;

  return result as T;
}
