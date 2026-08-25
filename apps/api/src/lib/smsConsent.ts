import crypto from "node:crypto";
import { prisma } from "./prisma";
import { PUBLIC_APP_URL } from "./publicUrl";
import { getOrCreateClientConversation } from "./conversations";
import { sendClientSms } from "./clientSms";
import { renderTemplate, type ReminderTemplates } from "./reminderTemplates";

// Post-add consent. Until this existed, the only ways a client could ever
// acquire SMS consent were the PUBLIC intake form and an INBOUND text --
// so a client added by staff (walk-in, phone booking, CSV import) had a
// phone number on file that could never legally be texted, and the only
// route out was to ask them to text the studio first. These are the two
// staff-initiated paths that close that gap.

// Long enough that a client who opens it a few days later still gets a
// working link, short enough that a stale one in an old email stops being
// a live consent surface. Matches the spirit of the other public-link
// TTLs in this codebase rather than inventing a new number.
export const SMS_CONSENT_TOKEN_TTL_DAYS = 14;

// Every value that can land in Client.smsConsentSource, in one place.
// Pre-existing: "intake_form" (routes/inquiries.ts), "inbound_keyword" and
// "inbound_sms" (routes/webhooks.ts). The ones below are the new
// staff-initiated additions.
//
// Why the method is recorded rather than a single flat "staff_recorded":
// under A2P 10DLC a carrier audit asks HOW consent was obtained, and
// "someone on staff ticked a box" is a materially weaker answer than
// "verbally, in person, on this date, recorded by this user." The audit
// log supplies the who; this supplies the how.
export const STAFF_CONSENT_METHODS = {
  verbal_in_person: "staff_verbal_in_person",
  verbal_phone: "staff_verbal_phone",
  written_form: "staff_written_form",
} as const;

export type StaffConsentMethod = keyof typeof STAFF_CONSENT_METHODS;

export function isStaffConsentMethod(value: unknown): value is StaffConsentMethod {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STAFF_CONSENT_METHODS, value);
}

// The client opted in themselves, through the tokenized public page.
export const SMS_CONSENT_SOURCE_LINK = "consent_link";

// Staff recorded, on the client's behalf, that they revoked consent --
// the counterpart to an inbound STOP for a client who says "stop texting
// me" in person or on the phone.
export const SMS_OPT_OUT_SOURCE_STAFF = "staff_recorded";

// Mirrors lib/clientSms.ts's own resolution exactly: Client.phone is
// SUPPOSED to mirror the primary ClientPhone row, but real data drifted
// before that write-path gap was fixed, so the real rows are the fallback.
// Consent for a client with no reachable number is meaningless, and worse,
// it would read as a green "consent on file" that can never produce a
// message -- so both consent paths below require a number.
export function resolveClientPhone(client: {
  phone: string | null;
  phones?: { phone: string }[];
}): string | null {
  return client.phone ?? client.phones?.[0]?.phone ?? null;
}

export type ConsentEligibility =
  | { ok: true }
  | { ok: false; code: "no_phone" | "already_given" | "opted_out"; error: string };

// The single gate both consent paths (staff-recorded AND the public link)
// run through, so the two can never disagree about who is eligible.
//
// The opted-out refusal is the one that matters most, and it is deliberate
// rather than conservative: after an inbound STOP, TWILIO ITSELF blocks
// every outbound message to that number (error 21610) until the handset
// sends START. Nothing this application writes to its own database can
// lift that. So letting staff flip the flag back would not restore
// texting -- it would produce a client who looks reachable in the UI,
// passes the send-path consent check, and then has every single message
// rejected by the carrier layer. Refusing here keeps the app's state and
// Twilio's state honest with each other, and it is also the compliant
// answer: a revoked consent is the customer's to restore, not staff's.
export function checkConsentEligibility(client: {
  phone: string | null;
  phones?: { phone: string }[];
  smsConsentGivenAt: Date | null;
  smsOptedOutAt: Date | null;
}): ConsentEligibility {
  if (!resolveClientPhone(client)) {
    return { ok: false, code: "no_phone", error: "Add a phone number for this client first" };
  }

  if (client.smsOptedOutAt) {
    return {
      ok: false,
      code: "opted_out",
      error:
        "This client opted out of texts. Only they can undo that -- ask them to text START to the studio's number, which also clears the block on Twilio's side.",
    };
  }

  if (client.smsConsentGivenAt) {
    return { ok: false, code: "already_given", error: "This client has already given SMS consent" };
  }

  return { ok: true };
}

export function buildConsentUrl(token: string): string {
  return `${PUBLIC_APP_URL}/sms-consent/${token}`;
}

// Issuing a fresh link always REPLACES any outstanding one (the column is
// unique and single-valued), so re-sending invalidates the previous link
// rather than leaving two live consent surfaces for one client.
export async function issueConsentToken(clientId: string): Promise<{ token: string; expiresAt: Date; url: string }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SMS_CONSENT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.client.update({
    where: { id: clientId },
    data: { smsConsentToken: token, smsConsentTokenExpiresAt: expiresAt },
  });

  return { token, expiresAt, url: buildConsentUrl(token) };
}

// The CTIA-convention confirmation text sent the moment a client opts in.
// Lifted out of routes/webhooks.ts (where it served only the inbound
// START/YES/UNSTOP path) once the self-serve consent link became a second
// opt-in path: a client who opts in through a link deserves exactly the
// same confirmation as one who texts START, and it doubles as proof the
// number actually receives messages. One implementation, so the two can't
// drift into confirming differently.
//
// Renders the studio's own saved template (StudioSettings.reminderTemplates
// .optInConfirmation, same editor as the reminder cadence). A studio that
// hasn't saved one silently no-ops rather than sending a broken/empty
// message -- the same "skip if not configured" gate the ticker uses.
//
// Note this is sent AFTER consent is recorded, so it passes
// sendClientSms's own hard consent check on its own merits and needs no
// bypass.
export async function sendOptInConfirmation(studioId: string, clientId: string): Promise<void> {
  const [studio, settings] = await Promise.all([
    prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } }),
    prisma.studioSettings.findUnique({ where: { studioId }, select: { reminderTemplates: true } }),
  ]);
  const templates = settings?.reminderTemplates as unknown as ReminderTemplates | null;
  if (!templates?.optInConfirmation) return;

  const body = renderTemplate(templates.optInConfirmation, { studioName: studio?.name ?? "our studio" });
  const { conversation } = await getOrCreateClientConversation(studioId, clientId, null);
  await sendClientSms({ studioId, clientId, conversationId: conversation.id, body, actorUserId: null });
}
