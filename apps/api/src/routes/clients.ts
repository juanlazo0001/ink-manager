import { Router } from "express";
import { prisma } from "../lib/prisma";
import type { Prisma } from "../../generated/prisma/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role, InquiryStatus, FlashPieceStatus } from "../../generated/prisma/enums";
import { requirePermission } from "../lib/permissions";
import { diffObjects, logAudit } from "../lib/audit";
import { normalizePhone } from "../lib/phone";
import { createClientFromFields, syncPrimaryEmail, syncPrimaryPhone } from "../lib/clientContacts";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { shortenUrl } from "../lib/shortLinks";
import { generateUniqueReferralCode } from "../lib/referrals";
import { clientMatchesPhoneOrEmail, findStudioClientsForMatching } from "../lib/duplicateDetection";
import { performMerge, validateMergePair } from "../lib/clientMerge";
import { emitInvalidation } from "../lib/realtime/registry";
import { callerBelongsToStudio, activeStudioIdsForCaller, hasPermissionAt } from "../lib/artistAccess";
import { isSupportedLocale } from "../lib/locale";
import { streamClientFullExport, SECTION_KEYS, type SectionKey } from "../lib/clientFullExport";
import { EXPORT_FIELD_KEYS, EXPORT_FIELD_LABELS, buildClientContactValues, type ExportFieldKey } from "../lib/clientExportFields";
import {
  SMS_CONSENT_TOKEN_TTL_DAYS,
  SMS_OPT_OUT_SOURCE_STAFF,
  STAFF_CONSENT_METHODS,
  checkConsentEligibility,
  isStaffConsentMethod,
  issueConsentToken,
} from "../lib/smsConsent";

const router = Router();

router.use(requireAuth);

// Preferred-artist preload (New Inquiry's client picker, both the search
// results and an already-known client's own page): "the last artist this
// client had an appointment with" -- one query for however many client
// ids are being resolved at once, ordered so the FIRST appointment row
// seen per clientId is necessarily their most recent (any status --
// including a not-yet-happened upcoming one is still a reasonable signal
// of who this client is currently working with). Absent entirely for a
// client with no appointment history yet.
async function getLastArtistIds(clientIds: string[]): Promise<Map<string, string>> {
  if (clientIds.length === 0) return new Map();
  const appointments = await prisma.appointment.findMany({
    where: { clientId: { in: clientIds } },
    orderBy: { startTime: "desc" },
    select: { clientId: true, artistId: true },
  });
  const result = new Map<string, string>();
  for (const appointment of appointments) {
    if (!result.has(appointment.clientId)) {
      result.set(appointment.clientId, appointment.artistId);
    }
  }
  return result;
}

// clients.manage used to gate this entire router as one blanket permission
// -- split into clients.view/edit/merge/archive/import (clients.import
// lives in clientImport.ts, a separate router) as of this expansion, each
// applied per-route below. Any studio's existing clients.manage override
// was propagated onto all five successors before this change shipped (see
// REPORT.md's "Granular permissions expansion" entry) so no studio's
// customization silently reset to a different default.
// Permission-context fix inventory: intentionally left home-scoped -- no
// pre-existing record to check a matrix against (studioId below IS
// req.user!.studioId by construction, same reasoning as inquiries.ts's/
// flashPieces.ts's own POST / create routes).
router.post("/", requirePermission("clients.edit"), async (req, res) => {
  const body = req.body ?? {};

  const missing = ["firstName", "lastName"].filter((field) => !body[field]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  const { firstName, lastName, email, phone, address } = body;
  const referralCode = await generateUniqueReferralCode();

  const client = await prisma.$transaction((tx) =>
    createClientFromFields(tx, { studioId: req.user!.studioId, firstName, lastName, email, phone, address, referralCode }),
  );

  emitInvalidation({ type: "client.updated", studioId: req.user!.studioId, clientId: client.id });

  res.status(201).json(client);
});

// Merged clients are folded into their survivor and excluded from every
// list -- they still exist (soft-merge), but shouldn't show up as if they
// were a separate active client.
const NOT_MERGED = { mergedIntoId: null } as const;

// Same exclude-from-default-list-views treatment as NOT_MERGED, but the
// underlying record is otherwise fully intact and directly reachable via
// GET /:id -- see Client.archivedAt.
const NOT_ARCHIVED = { archivedAt: null } as const;

// Transfer-to-artist epic, Part 4: unconditional, same as NOT_MERGED --
// never cleared, a transfer isn't reversible (Client.transferredAt's own
// schema comment), so unlike archivedAt there's no includeTransferred
// toggle to bring it back into the list.
const NOT_TRANSFERRED = { transferredAt: null } as const;

const VALID_ACTIVITY_FILTERS = ["upcoming_appointment", "active_project", "no_activity"] as const;
type ActivityFilter = (typeof VALID_ACTIVITY_FILTERS)[number];

// Projects tab's own status list (see apps/web/src/pages/Inquiries.tsx's
// PROJECTS_TAB_STATUSES) -- duplicated here rather than shared since
// there's no package boundary between apps/api and apps/web, same
// convention as every other hand-kept enum-value list in this codebase.
const ACTIVE_PROJECT_STATUSES: InquiryStatus[] = [InquiryStatus.SCHEDULING, InquiryStatus.WAITLISTED, InquiryStatus.CONFIRMED];

router.get("/", requirePermission("clients.view"), async (req, res) => {
  const includeArchived = req.query.includeArchived === "true";
  const activity = (Array.isArray(req.query.activity) ? req.query.activity : req.query.activity ? [req.query.activity] : [])
    .filter((v): v is ActivityFilter => VALID_ACTIVITY_FILTERS.includes(v as ActivityFilter));

  const now = new Date();

  // Multi-select semantics match every other filter in this app (Inquiries'
  // status/artist filters): several selected values are OR'd together, not
  // AND'd -- "has an upcoming appointment OR has an active project" is what
  // a staff member means by checking both boxes, not "has both at once."
  const activityConditions: Prisma.ClientWhereInput[] = [];
  if (activity.includes("upcoming_appointment")) {
    activityConditions.push({ appointments: { some: { startTime: { gte: now }, status: "CONFIRMED" } } });
  }
  if (activity.includes("active_project")) {
    activityConditions.push({ inquiries: { some: { status: { in: ACTIVE_PROJECT_STATUSES } } } });
  }
  if (activity.includes("no_activity")) {
    activityConditions.push({
      appointments: { none: { startTime: { gte: now }, status: "CONFIRMED" } },
      inquiries: { none: { status: { in: ACTIVE_PROJECT_STATUSES } } },
    });
  }

  // Artist mobility bug fix: if a studio ever grants ARTIST clients.view,
  // their list spans every studio they have a live relationship with (HOME
  // + active GUESTs), not just home -- same activeStudioIdsForCaller set
  // used for conversations.ts's own list scoping.
  const studioIds = await activeStudioIdsForCaller(req.user!);
  const baseWhere: Prisma.ClientWhereInput = {
    studioId: { in: studioIds },
    ...NOT_MERGED,
    ...NOT_TRANSFERRED,
    ...(includeArchived ? {} : NOT_ARCHIVED),
  };

  const clients = await prisma.client.findMany({
    where: activityConditions.length > 0 ? { AND: [baseWhere, { OR: activityConditions }] } : baseWhere,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json(await withActivity(clients, now));
});

// Per-row "is anything happening with this client" signal, for a status
// chip on a client row (apps/mobile's client list; apps/web's own list can
// adopt it whenever it wants one).
//
// This route already computed exactly these conditions as FILTERS -- the
// activityConditions block above -- but returned nothing per row saying
// which of them a given client matched. So a client list could be narrowed
// to "has an upcoming appointment" while no row could say so.
//
// Three grouped queries for the whole page, never one per row: the list is
// capped at 100, and an N+1 here would be 300 round trips. Each groups on
// clientId over an indexed column set (Appointment has @@index([studioId,
// startTime]) and Inquiry is queried by clientId + status), so this is
// three cheap aggregates, not a heavy join.
//
// Raw signals rather than one pre-rendered label: a chip needs a colour
// and a shape as well as a word, which is a client decision. The intended
// precedence, when several are true at once, is upcoming appointment >
// pending deposit > active project -- soonest commitment first.
interface ClientActivity {
  /** ISO instant of the NEXT confirmed appointment, or null. */
  upcomingAppointmentAt: string | null;
  /** A project in SCHEDULING / WAITLISTED / CONFIRMED. */
  hasActiveProject: boolean;
  /** A project at DEPOSIT_PENDING -- money asked for and not yet in. */
  hasPendingDeposit: boolean;
}

async function withActivity<T extends { id: string }>(clients: T[], now: Date): Promise<(T & { activity: ClientActivity })[]> {
  if (clients.length === 0) return [];
  const ids = clients.map((c) => c.id);

  const [upcoming, activeProjects, pendingDeposits] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["clientId"],
      // Byte-identical to the `upcoming_appointment` FILTER condition
      // above -- deliberately, including its not excluding archived
      // appointments. A chip that disagreed with the filter that selected
      // the row would be exactly the kind of two-sources-of-truth bug this
      // addition exists to remove.
      where: { clientId: { in: ids }, startTime: { gte: now }, status: "CONFIRMED" },
      _min: { startTime: true },
    }),
    prisma.inquiry.groupBy({
      by: ["clientId"],
      where: { clientId: { in: ids }, status: { in: ACTIVE_PROJECT_STATUSES } },
      _count: { _all: true },
    }),
    prisma.inquiry.groupBy({
      by: ["clientId"],
      where: { clientId: { in: ids }, status: InquiryStatus.DEPOSIT_PENDING },
      _count: { _all: true },
    }),
  ]);

  const nextAppointment = new Map(upcoming.map((r) => [r.clientId, r._min.startTime]));
  const active = new Set(activeProjects.map((r) => r.clientId));
  const pending = new Set(pendingDeposits.map((r) => r.clientId));

  return clients.map((client) => ({
    ...client,
    activity: {
      upcomingAppointmentAt: nextAppointment.get(client.id)?.toISOString() ?? null,
      hasActiveProject: active.has(client.id),
      hasPendingDeposit: pending.has(client.id),
    },
  }));
}

// Shared by both POST /export (below) and POST /export-full -- "which
// clients does this export request mean" must never drift between the
// two, or a client visible in one export could silently vanish from the
// other. Exactly one of clientIds/filter, identical validation and
// filter semantics GET / above already uses (just uncapped, unlike that
// route's own take: 100 list-view limit).
async function resolveClientExportWhere(
  user: Parameters<typeof activeStudioIdsForCaller>[0],
  body: unknown,
): Promise<{ error: string; status: 400 } | { where: Prisma.ClientWhereInput }> {
  const { clientIds, filter } = (body as { clientIds?: unknown; filter?: unknown }) ?? {};

  if (clientIds !== undefined && (!Array.isArray(clientIds) || clientIds.some((v) => typeof v !== "string"))) {
    return { error: "clientIds must be an array of strings", status: 400 };
  }
  if (filter !== undefined && (typeof filter !== "object" || filter === null || Array.isArray(filter))) {
    return { error: "filter must be an object", status: 400 };
  }
  if (!clientIds && !filter) {
    return { error: "Provide either clientIds or filter", status: 400 };
  }

  const studioIds = await activeStudioIdsForCaller(user);

  if (clientIds) {
    return {
      where: { id: { in: clientIds as string[] }, studioId: { in: studioIds }, ...NOT_MERGED, ...NOT_TRANSFERRED },
    };
  }

  const f = filter as { q?: unknown; includeArchived?: unknown; activity?: unknown };
  const q = typeof f.q === "string" ? f.q.trim() : "";
  const includeArchived = f.includeArchived === true;
  const activity = (Array.isArray(f.activity) ? f.activity : []).filter((v: unknown): v is ActivityFilter =>
    VALID_ACTIVITY_FILTERS.includes(v as ActivityFilter),
  );
  const now = new Date();
  const activityConditions: Prisma.ClientWhereInput[] = [];
  if (activity.includes("upcoming_appointment")) {
    activityConditions.push({ appointments: { some: { startTime: { gte: now }, status: "CONFIRMED" } } });
  }
  if (activity.includes("active_project")) {
    activityConditions.push({ inquiries: { some: { status: { in: ACTIVE_PROJECT_STATUSES } } } });
  }
  if (activity.includes("no_activity")) {
    activityConditions.push({
      appointments: { none: { startTime: { gte: now }, status: "CONFIRMED" } },
      inquiries: { none: { status: { in: ACTIVE_PROJECT_STATUSES } } },
    });
  }
  const nameConditions: Prisma.ClientWhereInput[] = q
    ? q
        .split(/\s+/)
        .filter(Boolean)
        .map((word: string) => {
          const contains = { contains: word, mode: "insensitive" as const };
          return { OR: [{ firstName: contains }, { lastName: contains }] };
        })
    : [];

  const baseWhere: Prisma.ClientWhereInput = {
    studioId: { in: studioIds },
    ...NOT_MERGED,
    ...NOT_TRANSFERRED,
    ...(includeArchived ? {} : NOT_ARCHIVED),
  };

  return {
    where: {
      AND: [baseWhere, ...(activityConditions.length > 0 ? [{ OR: activityConditions }] : []), ...nameConditions],
    },
  };
}

// Staff quick win: CSV export. Gated behind bulkActions.use ("select
// multiple records and act on them at once") rather than clients.view
// alone -- bulk-extracting contact data out of the app as a portable
// file is a meaningfully bigger capability than seeing it on screen,
// and this key is the closest existing match to "select rows, act on
// them" in the matrix; flagged as a judgment call, not an established
// convention.
//
// A static path, registered before GET /:id below for the same
// Express-routing reason /merge-search is.
//
// HARD RULE, enforced structurally, not by convention: this route's
// Prisma `select` never reaches into Waiver/health-screening data --
// there is no path from Client to that data in this query at all, so
// there's nothing to accidentally leak here regardless of future edits
// to the columns list below, and `fields` below can only ever select a
// subset of EXPORT_FIELD_DEFS -- never an arbitrary column name.
//
// Body is exactly one of:
//   { clientIds: string[] }                          -- an explicit, manually-checked set
//   { filter: { q?, includeArchived?, activity? } }   -- "select all N matching" (same
//                                                         filter semantics as GET / above,
//                                                         but never capped at that route's
//                                                         own take: 100 list-view limit)
// Plus optional `fields: string[]` -- which columns to emit and in what
// order (the picker's own display order); omitted entirely means "all of
// them," preserving pre-picker behavior for any caller that doesn't send it.
router.post("/export", requirePermission("bulkActions.use"), async (req, res) => {
  const { fields } = req.body ?? {};

  if (
    fields !== undefined &&
    (!Array.isArray(fields) ||
      fields.length === 0 ||
      fields.some((f: unknown) => typeof f !== "string" || !EXPORT_FIELD_KEYS.includes(f)))
  ) {
    return res.status(400).json({ error: `fields must be a non-empty array from: ${EXPORT_FIELD_KEYS.join(", ")}` });
  }
  const selectedFields: ExportFieldKey[] = fields ?? (EXPORT_FIELD_KEYS as ExportFieldKey[]);

  const resolved = await resolveClientExportWhere(req.user!, req.body);
  if ("error" in resolved) {
    return res.status(resolved.status).json({ error: resolved.error });
  }
  const { where } = resolved;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="clients-export-${new Date().toISOString().slice(0, 10)}.csv"`);

  // Excel's own well-known gotcha: without a UTF-8 byte-order mark, it
  // silently re-decodes the file using the system's default codepage
  // instead of UTF-8, mangling any accented character the instant the
  // file is double-clicked open. The BOM is invisible everywhere else
  // (every other CSV/text tool either strips or ignores it).
  res.write("﻿");

  const { stringify } = await import("csv-stringify");
  const stringifier = stringify({
    header: true,
    columns: selectedFields.map((key) => EXPORT_FIELD_LABELS[key]),
  });
  stringifier.pipe(res);

  // Batched, not one giant findMany -- the actual "stream for large
  // sets" guarantee: memory use stays bounded to one batch's worth of
  // rows regardless of how many thousand clients match, and the
  // response starts flowing to the browser well before the last batch
  // is even queried.
  const BATCH_SIZE = 500;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.client.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        instagramHandle: true,
        facebookProfileUrl: true,
        otherContact: true,
        address: true,
        referralCode: true,
        createdAt: true,
        phones: { select: { phone: true, isPrimary: true }, orderBy: { isPrimary: "desc" } },
        emails: { select: { email: true, isPrimary: true }, orderBy: { isPrimary: "desc" } },
      },
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    for (const c of batch) {
      const valuesByField = buildClientContactValues(c);
      stringifier.write(selectedFields.map((key) => valuesByField[key]));
    }

    cursor = batch[batch.length - 1]!.id;
    if (batch.length < BATCH_SIZE) break;
  }

  stringifier.end();
});

// The comprehensive, health-data-inclusive counterpart to POST /export
// above -- one row per Inquiry/Session/Gift Card/Deposit/Waiver, plus
// signed PDFs, bundled into a ZIP alongside a clients.csv built from the
// same `fields` picker POST /export uses. Reached from the SAME "Export"
// button/modal as the plain CSV export on the frontend (Clients.tsx) --
// picking any of `sections` is what switches the download from a CSV to
// this ZIP -- but kept as its own, more heavily gated ROUTE here, since
// reaching real waiver/health data specifically requires waivers.viewStatus
// on top of ordinary bulkActions.use, same precedent GET /:id/pdf on
// waivers.ts already established for a single waiver. `sections` is
// REQUIRED (unlike `fields`, which still defaults to "all") -- this route
// is only ever called once at least one full-record section is checked;
// there's no sensible "export everything" default for a set this sensitive.
router.post(
  "/export-full",
  requirePermission("bulkActions.use"),
  requirePermission("waivers.viewStatus"),
  async (req, res) => {
    const { fields, sections, includePdfs } = req.body ?? {};

    if (
      fields !== undefined &&
      (!Array.isArray(fields) ||
        fields.length === 0 ||
        fields.some((f: unknown) => typeof f !== "string" || !EXPORT_FIELD_KEYS.includes(f)))
    ) {
      return res.status(400).json({ error: `fields must be a non-empty array from: ${EXPORT_FIELD_KEYS.join(", ")}` });
    }
    const selectedFields: ExportFieldKey[] = fields ?? (EXPORT_FIELD_KEYS as ExportFieldKey[]);

    if (
      !Array.isArray(sections) ||
      sections.length === 0 ||
      sections.some((s: unknown) => typeof s !== "string" || !SECTION_KEYS.includes(s as SectionKey))
    ) {
      return res.status(400).json({ error: `sections must be a non-empty array from: ${SECTION_KEYS.join(", ")}` });
    }
    const selectedSections = new Set(sections as SectionKey[]);

    const resolved = await resolveClientExportWhere(req.user!, req.body);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const { where } = resolved;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="clients-full-export-${new Date().toISOString().slice(0, 10)}.zip"`);

    await streamClientFullExport(
      where,
      { fields: selectedFields, sections: selectedSections, includePdfs: includePdfs === true },
      res,
    );
  },
);

// Backs the manual-merge search picker (§2): find ANY client in the
// studio by name/email/phone, not just contact-matching auto-suggestions.
// A static path, so it must be registered before GET /:id below --
// otherwise Express would match "/merge-search" as :id.
router.get("/merge-search", requirePermission("clients.view"), async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const excludeId = typeof req.query.excludeId === "string" ? req.query.excludeId : undefined;

  if (q.length < 2) {
    return res.json([]);
  }

  // Split on whitespace and require every word to match SOME field --
  // otherwise a two-word query like "Casey Testperson" would never match
  // anything, since neither firstName nor lastName alone contains the full
  // string (the pitfall in the single-string `OR` the global omnibox search
  // uses, fine there since it's usually a single token).
  const words = q.split(/\s+/).filter(Boolean);
  const studioIds = await activeStudioIdsForCaller(req.user!);
  const results = await prisma.client.findMany({
    where: {
      studioId: { in: studioIds },
      ...NOT_MERGED,
      ...NOT_TRANSFERRED,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      AND: words.map((word) => {
        const contains = { contains: word, mode: "insensitive" as const };
        return { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }] };
      }),
    },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Additive on top of the manual-merge picker's own use of this same
  // endpoint (that UI just ignores the extra field) -- backs
  // StaffInquiryForm's client-lookup search, which preloads the preferred-
  // artist dropdown with whoever a picked candidate last had an
  // appointment with.
  const lastArtistIds = await getLastArtistIds(results.map((r) => r.id));
  res.json(results.map((r) => ({ ...r, lastArtistId: lastArtistIds.get(r.id) ?? null })));
});

router.get("/:id", async (req, res) => {
  const id = req.params.id as string;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      inquiries: {
        select: {
          id: true,
          description: true,
          status: true,
          channel: true,
          createdAt: true,
          // Needed to compute which inquiries are eligible for a "Send
          // Deposit Form" click on the client page (DEPOSIT_PENDING status
          // + both bounds set + not already signed -- same rule POST
          // /inquiries/:id/deposit-form itself enforces).
          priceEstimateLow: true,
          priceEstimateHigh: true,
          // AppointmentForm's suggested-times feature needs the artist's
          // own time estimate for this project to know how long a slot to
          // look for -- both bounds required before suggestions can use it
          // (see the max() logic in AppointmentForm.tsx).
          timeEstimateHoursMin: true,
          timeEstimateHoursMax: true,
          // Package I: lets AppointmentForm default its artist picker to
          // this inquiry's already-assigned artist when opened from a
          // project context.
          assignedArtistId: true,
          // Client's own stated preference (distinct from assignedArtistId
          // above) -- lets ClientDetail's "New Inquiry"/"Send Inquiry"
          // actions default to whoever this client asked for last time,
          // since inquiries is already ordered createdAt desc (most recent
          // first).
          preferredArtistId: true,
          // Package M: one per tattoo session now, oldest first so the
          // client profile's list reads "Session 1, Session 2, ..." in the
          // order they were actually generated.
          depositForms: {
            select: {
              id: true,
              sessionNumber: true,
              depositAmount: true,
              feeAmount: true,
              totalCharged: true,
              signedAt: true,
              paidManually: true,
              paidAt: true,
              paidVia: true,
              // Session-Plan/DepositForm linkage bug fix: same by-sessionNumber
              // resolution ClientDetail.tsx's session badges now use (never
              // PlannedSession.depositFormId alone) -- createdAt disambiguates
              // when two rows share a sessionNumber, matching the send guard's
              // own `orderBy: { createdAt: "desc" }`.
              createdAt: true,
              giftCard: { select: { id: true, code: true, amountCents: true, status: true } },
            },
            orderBy: { sessionNumber: "asc" },
          },
          // Service lines: AppointmentForm's required-deposit preview needs
          // depositModel/flatDepositCents to compute a FLAT service's
          // required deposit correctly instead of always falling back to a
          // tier lookup; id backs its practitioner-picker filtering (only
          // artists tagged as offering THIS inquiry's service).
          service: { select: { id: true, depositModel: true, flatDepositCents: true } },
          // Multi-session planning: lets AppointmentForm offer a picker of
          // which planned session a new appointment fulfills (any one with
          // no appointment yet -- see AppointmentForm.tsx's own filtering;
          // gift cards/exemptions stack across the whole client, so a
          // session doesn't need its OWN deposit paid to be bookable) and
          // feed that session's own hour estimate into the scheduling-
          // assistant duration target instead of the project's top-level
          // fields. Also backs the Projects widget's own per-session status
          // list below. Empty for every project with no declared plan,
          // same as today.
          plannedSessions: {
            select: {
              id: true,
              sessionNumber: true,
              estimatedHoursMin: true,
              estimatedHoursMax: true,
              estimatedPriceLow: true,
              estimatedPriceHigh: true,
              appointmentId: true,
              depositForm: { select: { paidAt: true } },
              appointment: { select: { checkedOutAt: true } },
            },
            orderBy: { sessionNumber: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      giftCards: {
        select: {
          id: true,
          code: true,
          amountCents: true,
          status: true,
          expiresAt: true,
          appointmentId: true,
          createdAt: true,
          exemptionReason: true,
        },
        orderBy: { createdAt: "desc" },
      },
      // Non-PII summary only -- the health data and ID image live behind
      // GET /waivers/:id, which is OWNER/FRONT_DESK only.
      liabilityWaivers: {
        select: { id: true, status: true, signedAt: true, verifiedAt: true, appointmentId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
      mergedInto: { select: { id: true, firstName: true, lastName: true } },
      transferredToStudio: { select: { id: true, name: true } },
      phones: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      emails: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      // Package O: "who referred this client" (display-only, on this
      // client's own page) -- distinct from referredClients, which nobody
      // reads today (the reward is triggered server-side off referredByClientId
      // directly, not by walking this list).
      referredBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!client || !(await callerBelongsToStudio(req.user!, client.studioId))) {
    return res.status(404).json({ error: "Client not found" });
  }

  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.view"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const lastArtistId = (await getLastArtistIds([client.id])).get(client.id) ?? null;

  // A direct fetch of a merged client still succeeds (rather than 404) --
  // a stale bookmark, an old audit-log link, or a duplicate-detection result
  // should be able to show what it was merged into rather than dead-end.
  res.json({ ...client, lastArtistId });
});

// Mirrored from apps/web's own PROJECTS_TAB_STATUSES (Inquiries.tsx) and
// inquiries.ts's own PROJECT_STATUSES -- same "converted to a Project"
// line, duplicated rather than imported across route files per this
// codebase's existing precedent for this exact value. There is no
// separate "Project note" table -- Inquiry and "Project" are the same
// row at different points in its status, so an inquiry's notes land in
// the "inquiry" or "project" bucket below purely off its *current*
// status, not whatever it was when each note was written (not tracked).
const PROJECT_STATUSES: InquiryStatus[] = [InquiryStatus.SCHEDULING, InquiryStatus.WAITLISTED, InquiryStatus.CONFIRMED];

// Consolidated, read-only view of every manually-written note this client
// has anywhere in the app -- InquiryNote (bucketed "inquiry" vs "project"
// by the parent inquiry's current status) and AppointmentNote (one
// bucket, tagged with which specific session it came from since a client
// can have many appointments per project). Own dedicated route rather
// than folded into GET /:id, same reasoning as /inquiries/:id/notes: most
// callers of the client profile fetch don't need every note body on
// every load. Hardcoded OWNER/FRONT_DESK, not the customizable
// clients.manage permission this router otherwise runs under -- matches
// InquiryNote/AppointmentNote's own hardcoded "internal only, never shown
// to an artist" rule at the route level, even if a studio granted ARTIST
// clients.manage.
// Stacked with requireRole(OWNER, FRONT_DESK) as a hard floor -- this was
// already true before this expansion (the old clients.manage gate was
// itself stacked with the same requireRole here), meaning even a studio
// that granted ARTIST clients.manage=true could never see client notes
// through this route. Preserved exactly, not loosened.
router.get("/:id/notes", requireRole(Role.OWNER, Role.FRONT_DESK), requirePermission("clients.view"), async (req, res) => {
  const id = req.params.id as string;

  const client = await prisma.client.findUnique({ where: { id }, select: { studioId: true } });
  if (!client || !(await callerBelongsToStudio(req.user!, client.studioId))) {
    return res.status(404).json({ error: "Client not found" });
  }

  const inquiries = await prisma.inquiry.findMany({
    where: { clientId: id },
    select: {
      id: true,
      description: true,
      status: true,
      notes: {
        include: { author: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const appointments = await prisma.appointment.findMany({
    where: { clientId: id },
    select: {
      id: true,
      startTime: true,
      inquiryProject: { select: { description: true } },
      noteEntries: {
        include: { author: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { startTime: "desc" },
  });

  type ConsolidatedNote = {
    id: string;
    bodyHtml: string;
    createdAt: Date;
    updatedAt: Date;
    author: { id: string; name: string | null; email: string } | null;
    attachments: Prisma.JsonValue;
    // startTime only ever set for an "appointment" source -- the frontend
    // formats it (this app's dates are always formatted client-side, e.g.
    // via lib/format.ts's formatDateTime, never pre-formatted in a route
    // response) and appends it after the label for that bucket only.
    source: { type: "inquiry" | "appointment"; id: string; label: string; startTime?: Date };
  };

  const inquiryNotes: ConsolidatedNote[] = [];
  const projectNotes: ConsolidatedNote[] = [];
  const appointmentNotes: ConsolidatedNote[] = [];

  for (const inquiry of inquiries) {
    const bucket = PROJECT_STATUSES.includes(inquiry.status) ? projectNotes : inquiryNotes;
    for (const note of inquiry.notes) {
      bucket.push({ ...note, source: { type: "inquiry", id: inquiry.id, label: inquiry.description } });
    }
  }

  for (const appointment of appointments) {
    const label = appointment.inquiryProject?.description ?? "Appointment";
    for (const note of appointment.noteEntries) {
      appointmentNotes.push({
        ...note,
        source: { type: "appointment", id: appointment.id, label, startTime: appointment.startTime },
      });
    }
  }

  res.json({ inquiry: inquiryNotes, project: projectNotes, appointment: appointmentNotes });
});

// Backs the conversation composer's "+" form-link menu: every shareable
// public link this client already has, plus disabled placeholders (with a
// hint) for entities that exist but have no active link yet. Deliberately
// does NOT generate/rotate any token -- that stays on the inquiry/
// appointment pages, this is read-only.
router.get("/:id/shareable-links", async (req, res) => {
  const id = req.params.id as string;
  const now = new Date();

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      studio: {
        select: {
          slug: true,
          settings: {
            select: {
              privacyPolicy: true,
              termsAndConditions: true,
              refundPolicy: true,
              depositPolicy: true,
              reschedulePolicy: true,
              communicationPolicy: true,
            },
          },
        },
      },
      inquiries: {
        select: {
          id: true,
          description: true,
          estimateToken: true,
          estimateTokenExpiresAt: true,
          // status/priceEstimate* back the new depositFormEligible flag
          // below -- same DEPOSIT_PENDING + both bounds set + not signed
          // rule POST /inquiries/:id/deposit-form itself enforces.
          status: true,
          priceEstimateLow: true,
          priceEstimateHigh: true,
          // Package M: one per session now -- oldest first so "latest" is
          // reliably the last element below.
          depositForms: {
            select: { id: true, sessionNumber: true, token: true, tokenExpiresAt: true, signedAt: true },
            orderBy: { sessionNumber: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      giftCards: {
        select: { id: true, code: true, amountCents: true, status: true, derivedFromGiftCardId: true },
        orderBy: { createdAt: "desc" },
      },
      appointments: {
        select: {
          id: true,
          startTime: true,
          // Backs waiverEligible below -- POST /appointments/:id/waiver
          // only makes sense for a session that's actually happening.
          status: true,
          liabilityWaiver: { select: { token: true, tokenExpiresAt: true, status: true } },
        },
        orderBy: { startTime: "desc" },
      },
    },
  });

  if (!client || !(await callerBelongsToStudio(req.user!, client.studioId))) {
    return res.status(404).json({ error: "Client not found" });
  }

  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.view"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const estimateLinks = await Promise.all(
    client.inquiries.map(async (inquiry) => {
      const active = inquiry.estimateToken && inquiry.estimateTokenExpiresAt && inquiry.estimateTokenExpiresAt > now;
      return {
        inquiryId: inquiry.id,
        label: `Estimate — ${inquiry.description.slice(0, 40)}`,
        url: active ? await shortenUrl(`${PUBLIC_APP_URL}/estimate/${inquiry.estimateToken}`) : null,
        hint: active ? null : "Generate from the inquiry page",
      };
    }),
  );

  // Package M: one row per deposit form, not per inquiry -- a project with
  // several tattoo sessions can have several of these, each labeled by its
  // own session number.
  const depositLinks = await Promise.all(
    client.inquiries.flatMap((inquiry) =>
      inquiry.depositForms.map(async (form) => {
        const active = !form.signedAt && form.tokenExpiresAt > now;
        return {
          inquiryId: inquiry.id,
          depositFormId: form.id,
          label: `Deposit form (Session ${form.sessionNumber}) — ${inquiry.description.slice(0, 40)}`,
          url: active ? await shortenUrl(`${PUBLIC_APP_URL}/deposit/${form.token}`) : null,
          hint: active ? null : form.signedAt ? "Already signed" : "Generate from the inquiry page",
        };
      }),
    ),
  );

  const waiverLinks = await Promise.all(
    client.appointments
      .filter((appointment) => appointment.liabilityWaiver)
      .map(async (appointment) => {
        const waiver = appointment.liabilityWaiver!;
        const active =
          waiver.status === "PENDING" && waiver.token && waiver.tokenExpiresAt && waiver.tokenExpiresAt > now;
        return {
          appointmentId: appointment.id,
          label: `Waiver — ${new Date(appointment.startTime).toLocaleDateString()}`,
          url: active ? await shortenUrl(`${PUBLIC_APP_URL}/waiver/${waiver.token}`) : null,
          hint: active ? null : "Generate from the appointment page",
        };
      }),
  );

  // Gift card public pages never expire (the code is a permanent bearer
  // token -- Phase 3), so every gift card the client has is always active.
  // EXEMPT cards (Package F deposit exemptions) are excluded entirely --
  // there's no reason to text a client a public link/QR for their own
  // internal scheduling exemption.
  const giftCardLinks = await Promise.all(
    client.giftCards
      .filter((card) => card.status !== "EXEMPT")
      .map(async (card) => ({
        giftCardId: card.id,
        label: `Gift card — $${(card.amountCents / 100).toFixed(2)}`,
        url: await shortenUrl(`${PUBLIC_APP_URL}/gift-card/${card.code}`),
        hint: null,
      })),
  );

  // Distinct from depositLinks/waiverLinks above (which only ever list
  // entities that ALREADY have a form/waiver row) -- these back the
  // composer's "Send Deposit Form"/"Send Waiver" actions, which need to
  // create one that doesn't exist yet. Same eligibility rules the actual
  // POST routes enforce (deposit-form upserts, so an inquiry with an
  // existing-but-unsigned one is still eligible == "resend"; waiver
  // rejects outright if one exists, so eligibility there is "none yet").
  //
  // An inquiry whose existing deposit form is still active (unsigned,
  // unexpired) is deliberately EXCLUDED here even though the route would
  // technically allow resending -- it already has a row in depositLinks
  // above with the identical label, and offering both would just be two
  // near-identical-looking rows in the same menu, one of which silently
  // invalidates the other's token. Only offer the fresh-send action when
  // there's no live link to just insert instead (none yet, or expired).
  const depositFormOptions = client.inquiries
    .filter((inquiry) => {
      if (inquiry.status !== "DEPOSIT_PENDING") return false;
      if (inquiry.priceEstimateLow == null || inquiry.priceEstimateHigh == null) return false;
      // Package M: still only relevant to the single pre-conversion session
      // here (this composer trigger is deliberately scoped the same as
      // before -- "send another deposit form" for a later session is a
      // Project-page-only action, see InquiryDetail.tsx), so only the
      // latest form (there's realistically at most one at this stage) matters.
      const latest = inquiry.depositForms[inquiry.depositForms.length - 1] as
        | (typeof inquiry.depositForms)[number]
        | undefined;
      if (latest?.signedAt) return false;
      const hasActiveLink = latest && latest.tokenExpiresAt > now;
      return !hasActiveLink;
    })
    .map((inquiry) => ({ inquiryId: inquiry.id, label: inquiry.description }));

  const waiverOptions = client.appointments
    .filter(
      (appointment) =>
        !appointment.liabilityWaiver && (appointment.status === "CONFIRMED" || appointment.status === "COMPLETED"),
    )
    .map((appointment) => ({ appointmentId: appointment.id, label: appointment.startTime.toISOString() }));

  // Package C1 custom policies (studio-authored, e.g. aftercare/cancellation)
  // plus the two fixed StudioSettings policy pages (privacy/terms) -- all
  // three are already independently public/unauthenticated routes
  // (Policies.tsx, PublicPolicyPage.tsx), just never surfaced in the
  // composer before now. A studio with no public custom policies gets no
  // "All policies" link (nothing to show there); same null-if-unset
  // treatment as privacy/terms below.
  const publicPolicies = await prisma.customPolicy.findMany({
    where: { studioId: client.studioId, isPublic: true },
    select: { id: true, title: true },
    orderBy: { order: "asc" },
  });

  const policyLinks = await Promise.all(
    publicPolicies.map(async (policy) => ({
      label: policy.title,
      url: await shortenUrl(`${PUBLIC_APP_URL}/policies/${client.studio.slug}#${policy.id}`),
    })),
  );

  const allPoliciesUrl =
    publicPolicies.length > 0 ? await shortenUrl(`${PUBLIC_APP_URL}/policies/${client.studio.slug}`) : null;

  // Flash gallery: studio-wide, not client- or inquiry-specific (unlike
  // estimate/deposit/waiver links above) -- same reasoning as policyLinks,
  // one row per artist who currently has anything to show, so staff can
  // just pick and send rather than needing to already be on that artist's
  // Flash Gallery page. Only artists with at least one AVAILABLE piece are
  // offered; an artist with none (or only pending/booked/retired ones) has
  // nothing worth sending a link to right now.
  const artistsWithFlash = await prisma.artist.findMany({
    where: { user: { studioId: client.studioId }, flashPieces: { some: { status: FlashPieceStatus.AVAILABLE } } },
    select: { id: true, user: { select: { name: true, email: true } } },
  });

  const flashGalleryLinks = await Promise.all(
    artistsWithFlash.map(async (artist) => ({
      artistId: artist.id,
      label: `Flash Gallery — ${artist.user.name ?? artist.user.email}`,
      url: await shortenUrl(`${PUBLIC_APP_URL}/flash/${client.studio.slug}/${artist.id}`),
    })),
  );

  const privacyPolicyUrl = client.studio.settings?.privacyPolicy
    ? await shortenUrl(`${PUBLIC_APP_URL}/privacy/${client.studio.slug}`)
    : null;

  const termsUrl = client.studio.settings?.termsAndConditions
    ? await shortenUrl(`${PUBLIC_APP_URL}/terms/${client.studio.slug}`)
    : null;

  const refundPolicyUrl = client.studio.settings?.refundPolicy
    ? await shortenUrl(`${PUBLIC_APP_URL}/refund-policy/${client.studio.slug}`)
    : null;

  const depositPolicyUrl = client.studio.settings?.depositPolicy
    ? await shortenUrl(`${PUBLIC_APP_URL}/deposit-policy/${client.studio.slug}`)
    : null;

  const reschedulePolicyUrl = client.studio.settings?.reschedulePolicy
    ? await shortenUrl(`${PUBLIC_APP_URL}/reschedule-policy/${client.studio.slug}`)
    : null;

  const communicationPolicyUrl = client.studio.settings?.communicationPolicy
    ? await shortenUrl(`${PUBLIC_APP_URL}/communication-policy/${client.studio.slug}`)
    : null;

  res.json({
    intakeFormUrl: await shortenUrl(`${PUBLIC_APP_URL}/inquiry/${client.studio.slug}`),
    estimateLinks,
    depositLinks,
    depositFormOptions,
    waiverOptions,
    waiverLinks,
    giftCardLinks,
    flashGalleryLinks,
    allPoliciesUrl,
    policyLinks,
    privacyPolicyUrl,
    termsUrl,
    refundPolicyUrl,
    depositPolicyUrl,
    reschedulePolicyUrl,
    communicationPolicyUrl,
  });
});

// clientAId/clientBId are always stored with the lexicographically smaller
// id first, so a dismissed pair is unique/matchable regardless of which of
// the two clients the dismiss action was fired from.
function normalizeDuplicatePair(clientId1: string, clientId2: string): [string, string] {
  return clientId1 < clientId2 ? [clientId1, clientId2] : [clientId2, clientId1];
}

// Other non-merged clients in this studio sharing an email or phone.
// Exact-match only (after normalizing phone formatting) -- no fuzzy name
// matching, keeping false positives at zero. Excludes any pair staff has
// already dismissed as "not a duplicate" -- manual merge via search stays
// available for a dismissed pair regardless, this only suppresses the
// automatic suggestion banner.
router.get("/:id/potential-duplicates", async (req, res) => {
  const id = req.params.id as string;

  const client = await prisma.client.findUnique({ where: { id }, include: { phones: true, emails: true } });
  if (!client || !(await callerBelongsToStudio(req.user!, client.studioId))) {
    return res.status(404).json({ error: "Client not found" });
  }

  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.view"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Studio-scoping bug fix: scoped to the CLIENT's own studio, not
  // req.user!.studioId (the caller's possibly-different HOME studio) --
  // same class fixed elsewhere in this file.
  const [candidates, dismissedPairs] = await Promise.all([
    findStudioClientsForMatching(client.studioId, id),
    prisma.dismissedDuplicatePair.findMany({
      where: { studioId: client.studioId, OR: [{ clientAId: id }, { clientBId: id }] },
    }),
  ]);

  const dismissedOtherIds = new Set(
    dismissedPairs.map((pair) => (pair.clientAId === id ? pair.clientBId : pair.clientAId)),
  );

  // Every known alias, not just the primary scalar fields -- a secondary
  // phone/email is just as real a match signal as the primary one. The
  // scalar fields are included defensively too, in case a row was somehow
  // never mirrored into the alias tables.
  const clientPhones = new Set(client.phones.map((p) => p.phone));
  if (client.phone) clientPhones.add(normalizePhone(client.phone));
  const clientEmails = new Set(client.emails.map((e) => e.email));
  if (client.email) clientEmails.add(client.email.toLowerCase());

  const duplicates = candidates.filter((candidate) => {
    if (dismissedOtherIds.has(candidate.id)) return false;
    return clientMatchesPhoneOrEmail(candidate, clientPhones, clientEmails);
  });

  res.json(duplicates.map(({ phones, emails, ...rest }) => rest));
});

// Suppresses the automatic potential-duplicate suggestion for this pair --
// staff decided these two clients are NOT the same person. Does not touch
// merge eligibility: the pair remains fully mergeable via the manual
// search picker (§2), since staff might reconsider later. Idempotent --
// dismissing an already-dismissed pair just re-confirms it (upsert).
router.post("/:id/dismiss-duplicate", async (req, res) => {
  const id = req.params.id as string;
  const { otherClientId } = req.body ?? {};

  if (!otherClientId || typeof otherClientId !== "string") {
    return res.status(400).json({ error: "otherClientId is required" });
  }
  if (otherClientId === id) {
    return res.status(400).json({ error: "A client cannot be dismissed as its own duplicate" });
  }

  const [client, other] = await Promise.all([
    prisma.client.findUnique({ where: { id } }),
    prisma.client.findUnique({ where: { id: otherClientId } }),
  ]);

  if (!client || !(await callerBelongsToStudio(req.user!, client.studioId))) {
    return res.status(404).json({ error: "Client not found" });
  }

  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!other || other.studioId !== client.studioId) {
    return res.status(404).json({ error: "Other client not found" });
  }

  const [clientAId, clientBId] = normalizeDuplicatePair(id, otherClientId);

  const dismissal = await prisma.dismissedDuplicatePair.upsert({
    where: { clientAId_clientBId: { clientAId, clientBId } },
    update: {},
    create: { studioId: client.studioId, clientAId, clientBId, dismissedById: req.user!.userId },
  });

  await logAudit({
    studioId: client.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "dismiss_duplicate",
    changes: { otherClientId },
  });

  res.json(dismissal);
});

const EDITABLE_CLIENT_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "instagramHandle",
  "facebookProfileUrl",
  "otherContact",
  "address",
  // Language becomes customer-specific: the staff escape hatch for a
  // client's stored preference (Client.preferredLocale) -- front desk can
  // fix a wrong/unset value when a client mentions it, matrix-gated by
  // the same clients.edit permission as every other field here.
  "preferredLocale",
] as const;

router.patch("/:id", async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || !(await callerBelongsToStudio(req.user!, client.studioId))) {
    return res.status(404).json({ error: "Client not found" });
  }

  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (client.mergedIntoId) {
    return res.status(400).json({ error: "This client has been merged and can no longer be edited directly" });
  }

  const data: Record<string, string | null> = {};

  for (const field of EDITABLE_CLIENT_FIELDS) {
    if (body[field] === undefined) continue;

    if (field === "firstName" || field === "lastName") {
      if (typeof body[field] !== "string" || body[field].trim().length === 0) {
        return res.status(400).json({ error: `${field} must be a non-empty string` });
      }
      data[field] = body[field].trim();
    } else if (field === "phone") {
      if (body.phone !== null && typeof body.phone !== "string") {
        return res.status(400).json({ error: "phone must be a string or null" });
      }
      data.phone = typeof body.phone === "string" && body.phone.trim() ? normalizePhone(body.phone) : null;
    } else if (field === "preferredLocale") {
      if (body.preferredLocale !== null && !isSupportedLocale(body.preferredLocale)) {
        return res.status(400).json({ error: "preferredLocale must be one of the supported locales, or null" });
      }
      data.preferredLocale = body.preferredLocale;
    } else {
      if (body[field] !== null && typeof body[field] !== "string") {
        return res.status(400).json({ error: `${field} must be a string or null` });
      }
      data[field] = typeof body[field] === "string" ? body[field].trim() || null : null;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.client.update({ where: { id }, data });
    if ("phone" in data) await syncPrimaryPhone(tx, id, result.phone);
    if ("email" in data) await syncPrimaryEmail(tx, id, result.email);
    return result;
  });

  await logAudit({
    // Artist studio scoping: the client's OWN studio, never the caller's
    // (possibly stale/guest-mismatched) home studioId -- see CLAUDE.md's
    // standing rule on this exact class of bug.
    studioId: client.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "update",
    changes: diffObjects(client, data, EDITABLE_CLIENT_FIELDS as unknown as (keyof typeof client)[]),
  });

  emitInvalidation({ type: "client.updated", studioId: client.studioId, clientId: id });

  res.json(updated);
});

// Shared existence/ownership check for every phone/email sub-route below.
async function loadOwnedClient(id: string, user: Parameters<typeof callerBelongsToStudio>[0]) {
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || !(await callerBelongsToStudio(user, client.studioId))) return null;
  return client;
}

const P2002_UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === P2002_UNIQUE_VIOLATION;
}

// Always added as a secondary contact -- never auto-promoted to primary,
// even for a client with no phone on file yet. Making it primary is a
// separate, explicit action (see make-primary below), so a client always
// ends up with the primary contact staff actually chose, not whichever one
// happened to be added first.
router.post("/:id/phones", async (req, res) => {
  const id = req.params.id as string;
  const { phone, label } = req.body ?? {};

  if (typeof phone !== "string" || normalizePhone(phone).length === 0) {
    return res.status(400).json({ error: "phone is required" });
  }
  if (label !== undefined && label !== null && typeof label !== "string") {
    return res.status(400).json({ error: "label must be a string or null" });
  }

  const client = await loadOwnedClient(id, req.user!);
  if (!client) return res.status(404).json({ error: "Client not found" });
  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const normalized = normalizePhone(phone);

  // Legacy-singular bug fix (validation pass, live-reproduced): this route
  // used to create a bare ClientPhone row and stop there -- never
  // isPrimary, never synced to Client.phone. `syncPrimaryPhone`'s own
  // comment states the intended invariant plainly ("every code path that
  // creates or edits [Client.phone] calls these"), but this route
  // bypassed it entirely. For a client with zero existing phones, the one
  // being added IS their primary going forward -- same promotion
  // PATCH /:id/phones/:phoneId/make-primary already performs, just at
  // creation time instead of after the fact. A client who already has a
  // phone keeps today's "additional, non-primary contact" behavior
  // unchanged.
  const existingPhoneCount = await prisma.clientPhone.count({ where: { clientId: id } });
  const isFirstPhone = existingPhoneCount === 0;

  let created;
  try {
    if (isFirstPhone) {
      created = await prisma.$transaction(async (tx) => {
        const row = await tx.clientPhone.create({
          data: { clientId: id, phone: normalized, label: label || null, isPrimary: true },
        });
        await tx.client.update({ where: { id }, data: { phone: normalized } });
        return row;
      });
    } else {
      created = await prisma.clientPhone.create({
        data: { clientId: id, phone: normalized, label: label || null },
      });
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(400).json({ error: "This phone number is already on file for this client" });
    }
    throw err;
  }

  await logAudit({
    studioId: client.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "add_phone",
    changes: { phone: normalized, label: label || null },
  });

  emitInvalidation({ type: "client.updated", studioId: client.studioId, clientId: id });

  res.status(201).json(created);
});

router.delete("/:id/phones/:phoneId", async (req, res) => {
  const id = req.params.id as string;
  const phoneId = req.params.phoneId as string;

  const client = await loadOwnedClient(id, req.user!);
  if (!client) return res.status(404).json({ error: "Client not found" });
  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const target = await prisma.clientPhone.findUnique({ where: { id: phoneId } });
  if (!target || target.clientId !== id) {
    return res.status(404).json({ error: "Phone not found" });
  }

  if (target.isPrimary) {
    const otherCount = await prisma.clientPhone.count({ where: { clientId: id, id: { not: phoneId } } });
    if (otherCount > 0) {
      return res.status(400).json({ error: "Make another phone primary before removing this one" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.clientPhone.delete({ where: { id: phoneId } });
      await tx.client.update({ where: { id }, data: { phone: null } });
    });
  } else {
    await prisma.clientPhone.delete({ where: { id: phoneId } });
  }

  await logAudit({
    studioId: client.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "remove_phone",
    changes: { phone: target.phone, wasPrimary: target.isPrimary },
  });

  emitInvalidation({ type: "client.updated", studioId: client.studioId, clientId: id });

  res.status(204).end();
});

router.post("/:id/phones/:phoneId/make-primary", async (req, res) => {
  const id = req.params.id as string;
  const phoneId = req.params.phoneId as string;

  const client = await loadOwnedClient(id, req.user!);
  if (!client) return res.status(404).json({ error: "Client not found" });
  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const target = await prisma.clientPhone.findUnique({ where: { id: phoneId } });
  if (!target || target.clientId !== id) {
    return res.status(404).json({ error: "Phone not found" });
  }

  if (!target.isPrimary) {
    await prisma.$transaction(async (tx) => {
      await tx.clientPhone.updateMany({ where: { clientId: id, isPrimary: true }, data: { isPrimary: false } });
      await tx.clientPhone.update({ where: { id: phoneId }, data: { isPrimary: true } });
      await tx.client.update({ where: { id }, data: { phone: target.phone } });
    });

    await logAudit({
      studioId: client.studioId,
      actorUserId: req.user!.userId,
      entityType: "Client",
      entityId: id,
      action: "make_primary_phone",
      changes: { phone: target.phone },
    });

    emitInvalidation({ type: "client.updated", studioId: client.studioId, clientId: id });
  }

  const updatedClient = await prisma.client.findUnique({ where: { id } });
  res.json(updatedClient);
});

router.post("/:id/emails", async (req, res) => {
  const id = req.params.id as string;
  const { email, label } = req.body ?? {};

  if (typeof email !== "string" || email.trim().length === 0) {
    return res.status(400).json({ error: "email is required" });
  }
  if (label !== undefined && label !== null && typeof label !== "string") {
    return res.status(400).json({ error: "label must be a string or null" });
  }

  const client = await loadOwnedClient(id, req.user!);
  if (!client) return res.status(404).json({ error: "Client not found" });
  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const normalized = email.trim().toLowerCase();

  // Same legacy-singular bug fix as POST /:id/phones above -- a client's
  // first email becomes their primary and syncs to Client.email; an
  // additional one keeps today's non-primary behavior.
  const existingEmailCount = await prisma.clientEmail.count({ where: { clientId: id } });
  const isFirstEmail = existingEmailCount === 0;

  let created;
  try {
    if (isFirstEmail) {
      created = await prisma.$transaction(async (tx) => {
        const row = await tx.clientEmail.create({
          data: { clientId: id, email: normalized, label: label || null, isPrimary: true },
        });
        await tx.client.update({ where: { id }, data: { email: normalized } });
        return row;
      });
    } else {
      created = await prisma.clientEmail.create({
        data: { clientId: id, email: normalized, label: label || null },
      });
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(400).json({ error: "This email is already on file for this client" });
    }
    throw err;
  }

  await logAudit({
    studioId: client.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "add_email",
    changes: { email: normalized, label: label || null },
  });

  emitInvalidation({ type: "client.updated", studioId: client.studioId, clientId: id });

  res.status(201).json(created);
});

router.delete("/:id/emails/:emailId", async (req, res) => {
  const id = req.params.id as string;
  const emailId = req.params.emailId as string;

  const client = await loadOwnedClient(id, req.user!);
  if (!client) return res.status(404).json({ error: "Client not found" });
  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const target = await prisma.clientEmail.findUnique({ where: { id: emailId } });
  if (!target || target.clientId !== id) {
    return res.status(404).json({ error: "Email not found" });
  }

  if (target.isPrimary) {
    const otherCount = await prisma.clientEmail.count({ where: { clientId: id, id: { not: emailId } } });
    if (otherCount > 0) {
      return res.status(400).json({ error: "Make another email primary before removing this one" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.clientEmail.delete({ where: { id: emailId } });
      await tx.client.update({ where: { id }, data: { email: null } });
    });
  } else {
    await prisma.clientEmail.delete({ where: { id: emailId } });
  }

  await logAudit({
    studioId: client.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "remove_email",
    changes: { email: target.email, wasPrimary: target.isPrimary },
  });

  emitInvalidation({ type: "client.updated", studioId: client.studioId, clientId: id });

  res.status(204).end();
});

router.post("/:id/emails/:emailId/make-primary", async (req, res) => {
  const id = req.params.id as string;
  const emailId = req.params.emailId as string;

  const client = await loadOwnedClient(id, req.user!);
  if (!client) return res.status(404).json({ error: "Client not found" });
  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const target = await prisma.clientEmail.findUnique({ where: { id: emailId } });
  if (!target || target.clientId !== id) {
    return res.status(404).json({ error: "Email not found" });
  }

  if (!target.isPrimary) {
    await prisma.$transaction(async (tx) => {
      await tx.clientEmail.updateMany({ where: { clientId: id, isPrimary: true }, data: { isPrimary: false } });
      await tx.clientEmail.update({ where: { id: emailId }, data: { isPrimary: true } });
      await tx.client.update({ where: { id }, data: { email: target.email } });
    });

    await logAudit({
      studioId: client.studioId,
      actorUserId: req.user!.userId,
      entityType: "Client",
      entityId: id,
      action: "make_primary_email",
      changes: { email: target.email },
    });

    emitInvalidation({ type: "client.updated", studioId: client.studioId, clientId: id });
  }

  const updatedClient = await prisma.client.findUnique({ where: { id } });
  res.json(updatedClient);
});

// Soft-merge: the source client survives (marked via mergedIntoId) rather
// than being deleted, so its history stays inspectable. Every FK the
// source held moves to the survivor; nothing about the survivor's own
// fields changes -- edit those separately via PATCH /clients/:id if needed.
// (Except its secondary contact aliases, which do gain the source's
// phone/email as new entries -- see carryOverContactAliases.)
router.post("/:id/merge", async (req, res) => {
  const id = req.params.id as string;
  const { sourceClientId } = req.body ?? {};

  if (!sourceClientId) {
    return res.status(400).json({ error: "sourceClientId is required" });
  }

  // Artist mobility bug fix: verify against the SURVIVOR client's own
  // studio, then pass THAT confirmed studioId into validateMergePair --
  // it trusts studioId as already-authenticated the same way
  // generateAndSendDepositForm does.
  const survivorForAuth = await prisma.client.findUnique({ where: { id }, select: { studioId: true } });
  if (!survivorForAuth || !(await callerBelongsToStudio(req.user!, survivorForAuth.studioId))) {
    return res.status(404).json({ error: "Client not found" });
  }
  const studioId = survivorForAuth.studioId;

  // Permission-context fix: evaluated at the survivor client's own studio.
  if (!(await hasPermissionAt(req.user!, studioId, "clients.merge"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const validation = await validateMergePair(studioId, id, sourceClientId);
  if ("error" in validation) {
    return res.status(validation.status).json({ error: validation.error });
  }
  const { source } = validation;

  const { repointCounts, conversationResult, aliasesAdded } = await prisma.$transaction((tx) =>
    performMerge(tx, sourceClientId, id),
  );

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "merge",
    changes: {
      sourceClientId,
      sourceClientName: `${source.firstName} ${source.lastName}`.trim(),
      survivorId: id,
      repointed: repointCounts,
      conversation: conversationResult,
      aliasesAdded,
    },
  });

  // Both records' worth of collaboratively-viewed data change here -- the
  // survivor gains repointed inquiries/appointments/gift cards, and the
  // source becomes a merged, no-longer-independently-editable record.
  emitInvalidation({ type: "client.updated", studioId, clientId: id });
  emitInvalidation({ type: "client.updated", studioId, clientId: sourceClientId });

  const merged = await prisma.client.findUnique({ where: { id } });
  res.json(merged);
});

// Archive: soft, reversible hide -- same exclude-from-list-views treatment
// as a merge, but nothing is repointed/destroyed and it can be undone.
// Post-add SMS consent (staff side). Deliberately its own routes rather
// than fields on PATCH /:id: consent is a compliance record, not an
// ordinary editable attribute, and it earns its own explicit audit action,
// its own permission check and its own refusal rules. Folding it into
// EDITABLE_CLIENT_FIELDS would let it ride along inside an unrelated edit
// with a generic "update" audit entry -- exactly the wrong shape for the
// one field a carrier might one day ask us to evidence.
//
// Shared loader for all three: existence + studio ownership + clients.edit
// evaluated AT THE CLIENT'S OWN STUDIO (never the caller's home studio --
// CLAUDE.md's standing artist-scoping rule), plus the phones needed to
// resolve whether there's a reachable number at all.
async function loadClientForConsent(user: Parameters<typeof callerBelongsToStudio>[0], id: string) {
  const client = await prisma.client.findUnique({
    where: { id },
    include: { phones: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 } },
  });
  if (!client || !(await callerBelongsToStudio(user, client.studioId))) {
    return { ok: false as const, status: 404, body: { error: "Client not found" } };
  }
  if (!(await hasPermissionAt(user, client.studioId, "clients.edit"))) {
    return { ok: false as const, status: 403, body: { error: "Forbidden" } };
  }
  if (client.mergedIntoId) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "This client has been merged and can no longer be edited directly" },
    };
  }
  return { ok: true as const, client };
}

// Staff-attested consent: the client told someone, in person or on the
// phone, that they're happy to be texted. The METHOD is required -- see
// STAFF_CONSENT_METHODS' own comment on why "staff ticked a box" is not a
// sufficient record under A2P 10DLC.
router.post("/:id/sms-consent", async (req, res) => {
  const id = req.params.id as string;
  const loaded = await loadClientForConsent(req.user!, id);
  if (!loaded.ok) return res.status(loaded.status).json(loaded.body);
  const { client } = loaded;

  const { method } = req.body ?? {};
  if (!isStaffConsentMethod(method)) {
    return res.status(400).json({
      error: `method must be one of: ${Object.keys(STAFF_CONSENT_METHODS).join(", ")}`,
    });
  }

  const eligibility = checkConsentEligibility(client);
  if (!eligibility.ok) {
    // already_given is a 200 no-op, not an error: consent is only ever SET
    // and never overwritten anywhere in this codebase, so a double-click
    // or a second staff member doing the same thing should be harmless and
    // preserve the ORIGINAL timestamp rather than restamping it.
    if (eligibility.code === "already_given") return res.json(client);
    return res.status(409).json({ error: eligibility.error, code: eligibility.code });
  }

  const source = STAFF_CONSENT_METHODS[method];
  const updated = await prisma.client.update({
    where: { id },
    data: {
      smsConsentGivenAt: new Date(),
      smsConsentSource: source,
      // Any outstanding self-serve link is now moot -- clear it so a
      // forwarded link can't later be replayed against this client.
      smsConsentToken: null,
      smsConsentTokenExpiresAt: null,
    },
  });

  await logAudit({
    studioId: client.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "sms_opted_in",
    changes: { via: "staff_recorded", method, source, consentRecorded: true },
  });

  emitInvalidation({ type: "client.updated", studioId: client.studioId, clientId: id });

  res.json(updated);
});

// Issue (or re-issue) the single-use self-serve consent link. Returns the
// URL for staff to copy or email -- deliberately NOT sent by SMS from
// here, because texting an opt-in invitation to someone who has not
// consented is itself an unconsented message, which is the exact thing
// carriers treat as a violation.
router.post("/:id/sms-consent/link", async (req, res) => {
  const id = req.params.id as string;
  const loaded = await loadClientForConsent(req.user!, id);
  if (!loaded.ok) return res.status(loaded.status).json(loaded.body);
  const { client } = loaded;

  const eligibility = checkConsentEligibility(client);
  if (!eligibility.ok) {
    return res.status(409).json({ error: eligibility.error, code: eligibility.code });
  }

  const { expiresAt, url } = await issueConsentToken(id);

  // No token in the audit entry -- it is a live credential for as long as
  // it stands, and the audit log is readable by more people than should be
  // able to opt a client in. That an link was issued, by whom, is the part
  // worth recording.
  await logAudit({
    studioId: client.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "sms_consent_link_issued",
    changes: { expiresAt, ttlDays: SMS_CONSENT_TOKEN_TTL_DAYS },
  });

  res.json({ url, expiresAt });
});

// Staff-recorded revocation -- the counterpart to an inbound STOP, for a
// client who says "stop texting me" in person or over the phone. Unlike
// granting consent this has NO eligibility gate beyond ownership: honoring
// a withdrawal is never something to refuse, and making it harder to stop
// texts than to start them would be precisely backwards.
router.delete("/:id/sms-consent", async (req, res) => {
  const id = req.params.id as string;
  const loaded = await loadClientForConsent(req.user!, id);
  if (!loaded.ok) return res.status(loaded.status).json(loaded.body);
  const { client } = loaded;

  if (client.smsOptedOutAt) return res.json(client);

  const updated = await prisma.client.update({
    where: { id },
    data: {
      smsOptedOutAt: new Date(),
      // An outstanding invite must die with the opt-out, or the client
      // could be walked back in through a link issued before it.
      smsConsentToken: null,
      smsConsentTokenExpiresAt: null,
    },
  });

  await logAudit({
    studioId: client.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "sms_opted_out",
    changes: { via: SMS_OPT_OUT_SOURCE_STAFF },
  });

  emitInvalidation({ type: "client.updated", studioId: client.studioId, clientId: id });

  res.json(updated);
});

router.post("/:id/archive", async (req, res) => {
  const id = req.params.id as string;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || !(await callerBelongsToStudio(req.user!, client.studioId))) {
    return res.status(404).json({ error: "Client not found" });
  }

  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.archive"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (client.archivedAt) {
    return res.json(client);
  }

  const updated = await prisma.client.update({ where: { id }, data: { archivedAt: new Date() } });

  await logAudit({
    studioId: client.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "archive",
    changes: { archivedAt: updated.archivedAt },
  });

  emitInvalidation({ type: "client.updated", studioId: client.studioId, clientId: id });

  res.json(updated);
});

router.post("/:id/unarchive", async (req, res) => {
  const id = req.params.id as string;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || !(await callerBelongsToStudio(req.user!, client.studioId))) {
    return res.status(404).json({ error: "Client not found" });
  }

  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, client.studioId, "clients.archive"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!client.archivedAt) {
    return res.json(client);
  }

  const updated = await prisma.client.update({ where: { id }, data: { archivedAt: null } });

  await logAudit({
    studioId: client.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "unarchive",
    changes: { archivedAt: null },
  });

  emitInvalidation({ type: "client.updated", studioId: client.studioId, clientId: id });

  res.json(updated);
});

// Shared between the delete-preview (so the confirmation UI can show what
// will be destroyed) and the audit snapshot written just before the actual
// DELETE below -- both need the exact same full picture of this client's
// history.
async function gatherClientDeletionSummary(clientId: string) {
  const [inquiries, appointments, waivers, giftCards, depositForms, conversation, phones, emails] =
    await Promise.all([
      prisma.inquiry.count({ where: { clientId } }),
      prisma.appointment.count({ where: { clientId } }),
      prisma.liabilityWaiver.count({ where: { clientId } }),
      prisma.giftCard.findMany({ where: { clientId }, select: { id: true, code: true, amountCents: true, status: true } }),
      prisma.depositForm.count({ where: { inquiry: { clientId } } }),
      prisma.conversation.findUnique({ where: { clientId }, select: { id: true } }),
      prisma.clientPhone.count({ where: { clientId } }),
      prisma.clientEmail.count({ where: { clientId } }),
    ]);

  const messages = conversation ? await prisma.message.count({ where: { conversationId: conversation.id } }) : 0;
  const activeGiftCardCents = giftCards
    .filter((card) => card.status === "ACTIVE")
    .reduce((sum, card) => sum + card.amountCents, 0);

  return {
    inquiries,
    appointments,
    waivers,
    giftCards: giftCards.map((card) => ({ id: card.id, code: card.code, amountCents: card.amountCents, status: card.status })),
    activeGiftCardCents,
    depositForms,
    conversations: conversation ? 1 : 0,
    messages,
    phones,
    emails,
  };
}

// OWNER only, always available regardless of attached history -- the
// strong in-app confirmation (exact-match "DELETE" text input) is the
// safeguard, not a history-based restriction. Powers the confirmation
// modal's plain-language breakdown before the real DELETE is sent.
router.get("/:id/delete-preview", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || !(await callerBelongsToStudio(req.user!, client.studioId))) {
    return res.status(404).json({ error: "Client not found" });
  }

  const mergedFromCount = await prisma.client.count({ where: { mergedIntoId: id } });
  const summary = await gatherClientDeletionSummary(id);

  res.json({ ...summary, blockedByMerge: mergedFromCount > 0 });
});

// True permanent delete -- OWNER only, no restriction based on attached
// history. Every model with a clientId (direct or via inquiry/appointment)
// is destroyed in one transaction, children before parents; the audit
// entry written right after is the only surviving trace (AuditLog has no
// FK to Client). Gift cards are NOT detached here the way inquiry-delete
// detaches them -- deleting the client destroys their money along with
// everything else, which is exactly what "permanent" means at this level.
router.delete("/:id", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const { confirm } = req.body ?? {};

  if (confirm !== "DELETE") {
    return res.status(400).json({ error: 'Type "DELETE" to confirm this action.' });
  }

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || !(await callerBelongsToStudio(req.user!, client.studioId))) {
    return res.status(404).json({ error: "Client not found" });
  }

  const mergedFromCount = await prisma.client.count({ where: { mergedIntoId: id } });
  if (mergedFromCount > 0) {
    return res.status(400).json({
      error: `${mergedFromCount} other client record(s) were merged into this one and would be left dangling. Cannot delete.`,
    });
  }

  const summary = await gatherClientDeletionSummary(id);

  await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({ where: { clientId: id } });
    if (conversation) {
      await tx.prefillDraft.deleteMany({ where: { conversationId: conversation.id } });
      await tx.message.deleteMany({ where: { conversationId: conversation.id } });
      await tx.conversationRead.deleteMany({ where: { conversationId: conversation.id } });
      await tx.conversationTag.deleteMany({ where: { conversationId: conversation.id } });
      await tx.conversationParticipant.deleteMany({ where: { conversationId: conversation.id } });
      await tx.conversation.delete({ where: { id: conversation.id } });
    }

    await tx.liabilityWaiver.deleteMany({ where: { clientId: id } });
    await tx.clientPhone.deleteMany({ where: { clientId: id } });
    await tx.clientEmail.deleteMany({ where: { clientId: id } });
    // DepositForm before GiftCard: DepositForm.giftCardId optionally points
    // at a gift card, so it must go first or the gift card delete below
    // would be blocked by that reference.
    await tx.depositForm.deleteMany({ where: { inquiry: { clientId: id } } });
    await tx.giftCard.deleteMany({ where: { clientId: id } });
    // Inquiry.appointmentId is an optional back-reference to a specific
    // appointment -- null it before deleting appointments, or that FK
    // blocks the appointment delete below.
    await tx.inquiry.updateMany({ where: { clientId: id }, data: { appointmentId: null } });
    // AppointmentPhoto.appointmentId is required (RESTRICT at the DB
    // level, unlike every other FK pointing at Client/Appointment in this
    // transaction, which are all SET NULL) -- any appointment with a
    // checkout-time photo attached would otherwise block the delete below.
    await tx.appointmentPhoto.deleteMany({ where: { appointment: { clientId: id } } });
    await tx.appointment.deleteMany({ where: { clientId: id } });
    // InquiryNote.inquiryId is also required/RESTRICT, same as
    // AppointmentPhoto above -- any inquiry with a staff note on it would
    // otherwise block the inquiry delete below.
    await tx.inquiryNote.deleteMany({ where: { inquiry: { clientId: id } } });
    // Multi-session planning: PlannedSession.inquiryId is ON DELETE
    // RESTRICT too (its depositFormId/appointmentId links are already SET
    // NULL by the deletes above) -- any client with a multi-session
    // project would otherwise block the inquiry delete below.
    await tx.plannedSession.deleteMany({ where: { inquiry: { clientId: id } } });
    await tx.inquiry.deleteMany({ where: { clientId: id } });
    await tx.client.delete({ where: { id } });
  });

  await logAudit({
    studioId: client.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "permanently_deleted",
    changes: { client: { firstName: client.firstName, lastName: client.lastName, email: client.email, phone: client.phone }, ...summary },
  });

  // Deletes every inquiry this client had too (see the transaction above),
  // so the Inquiries list/Kanban board needs to drop them live as well, not
  // just the client list.
  emitInvalidation({ type: "client.updated", studioId: client.studioId, clientId: id });
  emitInvalidation({ type: "inquiry.updated", studioId: client.studioId });

  res.json({ success: true });
});

export default router;
