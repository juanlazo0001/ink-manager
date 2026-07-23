import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { AppointmentStatus, Channel, InquiryStatus, MessageChannel, MessageDirection } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { diffObjects, logAudit } from "../lib/audit";
import { validateGiftCardForAttachment } from "../lib/giftCards";
import { getOrCreateClientConversation, getOrCreateStaffConversation } from "../lib/conversations";
import { sendClientSms } from "../lib/clientSms";
import { shortenUrl } from "../lib/shortLinks";
import { normalizePhone } from "../lib/phone";
import { syncPrimaryEmail, syncPrimaryPhone } from "../lib/clientContacts";
import { findBufferConflict, formatBufferWarning } from "../lib/schedulingConflict";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { emitInvalidation } from "../lib/realtime/registry";
import { computeDepositTier, resolveDepositTiers } from "../lib/depositTiers";

const router = Router();

const ESTIMATE_TOKEN_TTL_DAYS = 7;
const DEPOSIT_TOKEN_TTL_HOURS = 48;

const REQUIRED_FIELDS = [
  "studioSlug",
  "firstName",
  "lastName",
  "email",
  "channel",
  "description",
  "colorOrBlackGrey",
  "placement",
  "estimatedSize",
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Public: the intake form fetches a prefill draft by its capability token
// (never PII in the URL, just this opaque token) to populate matching
// fields before the client has typed anything. Invalid/expired/used tokens
// return a plain 404 -- the form falls back to loading empty, no error
// banner drama (this is a quiet nice-to-have, not a broken link).
router.get("/prefill/:token", async (req, res) => {
  const token = req.params.token as string;

  const draft = await prisma.prefillDraft.findUnique({ where: { token } });
  if (!draft || draft.usedAt || draft.expiresAt < new Date()) {
    return res.status(404).json({ error: "Not found" });
  }

  res.json({ payload: draft.payload });
});

// Public *and* staff: the intake form is unauthenticated and always hits
// this route with a studioSlug. Front desk logging a walk-in/phone inquiry
// on a customer's behalf (StaffInquiryForm) hits the same route while
// authenticated -- optionalAuth populates req.user in that case, which is
// used below both to skip the studioSlug requirement (the studio is
// already known from the JWT) and to attribute the create in the audit log.
// Either way this creates the Client (or reuses an existing one, matched by
// email within the studio) and the Inquiry together, so the studio's
// pipeline sees a single lead rather than a duplicate client every time the
// same person submits again.
router.post("/", optionalAuth, async (req, res) => {
  const body = req.body ?? {};
  const isStaffRequest = Boolean(req.user);

  // optionalAuth only distinguishes "was there a valid token" -- it doesn't
  // restrict which role that token belongs to. Every other staff-mutation
  // route in this file is OWNER/FRONT_DESK only (matching StaffInquiryForm's
  // own frontend gate), so an authenticated ARTIST hitting this route
  // directly must be rejected the same way, not silently allowed through.
  if (isStaffRequest && req.user!.role !== Role.OWNER && req.user!.role !== Role.FRONT_DESK) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const requiredFields = isStaffRequest ? REQUIRED_FIELDS.filter((field) => field !== "studioSlug") : REQUIRED_FIELDS;
  const missing = requiredFields.filter((field) => !body[field]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  if (typeof body.hasBeenTattooedBefore !== "boolean") {
    return res.status(400).json({ error: "hasBeenTattooedBefore must be a boolean" });
  }

  if (!Object.values(Channel).includes(body.channel)) {
    return res.status(400).json({ error: `channel must be one of: ${Object.values(Channel).join(", ")}` });
  }

  if (body.referenceImages !== undefined && !isStringArray(body.referenceImages)) {
    return res.status(400).json({ error: "referenceImages must be an array of strings" });
  }

  if (body.placementImages !== undefined && !isStringArray(body.placementImages)) {
    return res.status(400).json({ error: "placementImages must be an array of strings" });
  }

  // Package I: both photo types are now mandatory, on both the public
  // intake form AND the staff-side "New Inquiry" form (StaffInquiryForm.tsx)
  // -- unlike smsConsent below, this isn't a public-only consent concern, so
  // there's no isStaffRequest carve-out here; the two forms stay identical.
  if (!isStringArray(body.referenceImages) || body.referenceImages.length === 0) {
    return res.status(400).json({ error: "At least one reference image is required" });
  }

  if (!isStringArray(body.placementImages) || body.placementImages.length === 0) {
    return res.status(400).json({ error: "At least one placement photo is required" });
  }

  // A2P 10DLC compliance: the PUBLIC intake form's consent checkbox is
  // required to submit at all (unchecked-by-default, enforced here too, not
  // just via a disabled button) -- staff logging a walk-in/phone inquiry
  // through this same route has no such checkbox in its UI and isn't the
  // client affirmatively opting in themselves, so this only applies to the
  // public path.
  if (!isStaffRequest && body.smsConsent !== true) {
    return res.status(400).json({ error: "SMS consent is required to submit this form" });
  }

  const {
    studioSlug,
    firstName,
    lastName,
    email,
    phone,
    channel,
    description,
    colorOrBlackGrey,
    placement,
    estimatedSize,
    hasBeenTattooedBefore,
    budget,
    desiredTiming,
    preferredArtistId,
    referenceImages,
    placementImages,
    draftToken,
    smsConsent,
  } = body;

  const studio = isStaffRequest
    ? await prisma.studio.findUnique({ where: { id: req.user!.studioId } })
    : await prisma.studio.findUnique({ where: { slug: studioSlug } });
  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  // A draft token riding along is optional and best-effort -- an invalid/
  // stale one (already used, expired, wrong studio) never blocks a real
  // submission, it's just not marked used.
  let draft: { id: string } | null = null;
  if (typeof draftToken === "string" && draftToken.length > 0) {
    const found = await prisma.prefillDraft.findUnique({ where: { token: draftToken } });
    if (found && found.studioId === studio.id && !found.usedAt && found.expiresAt >= new Date()) {
      draft = found;
    }
  }

  if (preferredArtistId) {
    const preferredArtist = await prisma.artist.findUnique({
      where: { id: preferredArtistId },
      include: { user: true },
    });

    if (!preferredArtist || preferredArtist.user.studioId !== studio.id) {
      return res.status(400).json({ error: "preferredArtistId must belong to this studio" });
    }
  }

  const existingClient = await prisma.client.findFirst({
    where: { studioId: studio.id, email },
  });

  // Consent is only ever SET here, never overwritten -- a returning
  // client's original consent timestamp (from whichever submission first
  // gave it) is preserved across every later one, staff or public.
  const givesConsentNow = !isStaffRequest && smsConsent === true;

  let client;
  if (existingClient) {
    client =
      givesConsentNow && !existingClient.smsConsentGivenAt
        ? await prisma.client.update({
            where: { id: existingClient.id },
            data: { smsConsentGivenAt: new Date(), smsConsentSource: "intake_form" },
          })
        : existingClient;
  } else {
    client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          studioId: studio.id,
          firstName,
          lastName,
          email,
          phone: phone ? normalizePhone(phone) : phone,
          ...(givesConsentNow ? { smsConsentGivenAt: new Date(), smsConsentSource: "intake_form" } : {}),
        },
      });
      await syncPrimaryPhone(tx, created.id, created.phone);
      await syncPrimaryEmail(tx, created.id, created.email);
      return created;
    });
  }

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId: studio.id,
      clientId: client.id,
      channel,
      description,
      colorOrBlackGrey,
      placement,
      estimatedSize,
      hasBeenTattooedBefore,
      budget,
      desiredTiming,
      preferredArtistId: preferredArtistId || null,
      referenceImages: referenceImages ?? [],
      placementImages: placementImages ?? [],
    },
  });

  if (draft) {
    await prisma.prefillDraft.update({ where: { id: draft.id }, data: { usedAt: new Date() } });
  }

  if (isStaffRequest) {
    await logAudit({
      studioId: studio.id,
      actorUserId: req.user!.userId,
      entityType: "Inquiry",
      entityId: inquiry.id,
      action: "create-by-staff",
      changes: { clientId: client.id, channel },
    });
  }

  emitInvalidation({ type: "inquiry.created", studioId: studio.id });

  res.status(201).json(inquiry);
});

// Phase 7A: everything except the two terminal enum values. Used by
// mark-lost (valid FROM any of these) and reopen (valid target TO any of
// these) -- broader than coldLeadSweep.ts's own eligible-statuses list,
// since reopening a lost Projects-side inquiry (e.g. back to CONFIRMED) is
// legitimate and isn't the sweep's concern.
const NON_TERMINAL_STATUSES: InquiryStatus[] = (Object.values(InquiryStatus) as InquiryStatus[]).filter(
  (s) => s !== InquiryStatus.CLOSED_LOST && s !== InquiryStatus.COLD_LEAD,
);

// The "converted to a Project" line, mirrored from apps/web's own
// PROJECTS_TAB_STATUSES (Inquiries.tsx) -- deposit paid through completed.
// Package H: once here, the estimate that got the client to pay is history,
// not a draft; PATCH /:id below rejects further edits to it.
const PROJECT_STATUSES: InquiryStatus[] = [InquiryStatus.SCHEDULING, InquiryStatus.WAITLISTED, InquiryStatus.CONFIRMED];

const INQUIRY_INCLUDE = {
  client: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  preferredArtist: { select: { id: true, user: { select: { name: true, email: true, avatarUrl: true } } } },
  // email/avatarUrl added for the Kanban board's card (Package E) --
  // renders through the shared ArtistAvatar component, which needs both to
  // avoid falling back to a raw email string.
  assignedArtist: { select: { id: true, user: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
  appointment: { select: { id: true, startTime: true, endTime: true, status: true } },
  // UI-1 §3: every appointment/session under this project (1:many via
  // Appointment.inquiryId), for the project detail page's nested
  // Appointments section -- distinct from the singular `appointment`
  // above, which is only the original scheduling-flow slot.
  sessions: {
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      artist: { select: { id: true, user: { select: { name: true, email: true, avatarUrl: true } } } },
    },
    orderBy: { startTime: "asc" },
  },
  // Package M: one project can now have several, one per tattoo session --
  // oldest first, so the UI can label them "Session 1", "Session 2", etc.
  // in the order they were actually generated.
  depositForms: {
    select: {
      id: true,
      token: true,
      tokenExpiresAt: true,
      sessionNumber: true,
      depositAmount: true,
      feeAmount: true,
      totalCharged: true,
      signedAt: true,
      signatureName: true,
      signatureData: true,
      paidManually: true,
      paidAt: true,
      proposedStartAt: true,
      proposedEndAt: true,
      giftCard: { select: { id: true, code: true, amountCents: true, status: true } },
    },
    orderBy: { sessionNumber: "asc" },
  },
} as const;

// The inbox list only renders these fields -- preferredArtist/depositForm
// are detail-page-only, so the list query skips them.
// updatedAt/priceEstimateLow/High/assignedArtist were added for the Kanban
// board's card (Package E): "time in this stage" (updatedAt), the estimate
// range, and the assigned artist's avatar+name -- the List view simply
// ignores fields it doesn't render.
// estimateSentAt/estimateOpenedAt (Package H): distinguishes "estimate sent,
// not opened yet" from "opened, awaiting response" on the List/Kanban views
// without a new stored status -- see deriveEstimateSubStatus below.
// appointment.startTime (Package H): the Projects tab's "Scheduled Date"
// column.
const INQUIRY_LIST_SELECT = {
  id: true,
  channel: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  priceEstimateLow: true,
  priceEstimateHigh: true,
  estimateSentAt: true,
  estimateOpenedAt: true,
  referenceImages: true,
  client: { select: { firstName: true, lastName: true } },
  assignedArtist: { select: { id: true, user: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
  appointment: { select: { startTime: true } },
} as const;

// Excluded from the default inbox the same way merged clients are excluded
// from the client list -- fully intact, still reachable via GET /:id.
const NOT_ARCHIVED = { archivedAt: null } as const;

const SORT_OPTIONS = ["createdAt_desc", "createdAt_asc", "updatedAt_desc", "clientName_asc", "clientName_desc"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

function sortOrderBy(sort: SortOption): Prisma.InquiryOrderByWithRelationInput[] {
  switch (sort) {
    case "createdAt_asc":
      return [{ createdAt: "asc" }];
    case "updatedAt_desc":
      return [{ updatedAt: "desc" }];
    case "clientName_asc":
      return [{ client: { firstName: "asc" } }, { client: { lastName: "asc" } }];
    case "clientName_desc":
      return [{ client: { firstName: "desc" } }, { client: { lastName: "desc" } }];
    case "createdAt_desc":
    default:
      return [{ createdAt: "desc" }];
  }
}

// Normalizes a query param that Express may hand back as a single string,
// an array (repeated ?key=a&key=b), or undefined -- every multi-select
// filter below (status, artistId) takes this same shape.
function queryStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

// Staff-facing inbox: every inquiry submitted for this studio. Package H:
// sort + multi-select status/artist filters + name/description search all
// moved server-side here (previously the whole studio's inquiries were
// fetched once and filtered/sorted client-side) -- the point isn't just
// performance, it's that filtering a full unpaginated fetch client-side
// silently stops being correct the moment `take` below ever needs
// lowering or real pagination gets added; a filter a client applies to
// only the first page it already has would quietly under-report matches
// that exist further back. Doing it in the query keeps that always true.
router.get("/", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const { studioId } = req.user!;

  const statusValues = queryStringArray(req.query.status).filter((s): s is InquiryStatus =>
    (Object.values(InquiryStatus) as string[]).includes(s),
  );

  const artistValues = queryStringArray(req.query.artistId);
  const wantsUnassigned = artistValues.includes("unassigned");
  const artistIds = artistValues.filter((v) => v !== "unassigned");

  let artistWhere: Prisma.InquiryWhereInput | undefined;
  if (artistIds.length > 0 && wantsUnassigned) {
    artistWhere = { OR: [{ assignedArtistId: { in: artistIds } }, { assignedArtistId: null }] };
  } else if (artistIds.length > 0) {
    artistWhere = { assignedArtistId: { in: artistIds } };
  } else if (wantsUnassigned) {
    artistWhere = { assignedArtistId: null };
  }

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  // Same multi-word AND-of-OR pattern as clients.ts's own search -- a
  // two-word query like "Emily Rodriguez" needs both words satisfied,
  // each by whichever field actually has it.
  const words = q.split(/\s+/).filter(Boolean);
  const searchWhere: Prisma.InquiryWhereInput | undefined =
    words.length > 0
      ? {
          AND: words.map((word) => {
            const contains = { contains: word, mode: "insensitive" as const };
            return {
              OR: [
                { description: contains },
                { client: { firstName: contains } },
                { client: { lastName: contains } },
              ],
            };
          }),
        }
      : undefined;

  const sortParam = typeof req.query.sort === "string" ? req.query.sort : "createdAt_desc";
  const sort: SortOption = (SORT_OPTIONS as readonly string[]).includes(sortParam)
    ? (sortParam as SortOption)
    : "createdAt_desc";

  const inquiries = await prisma.inquiry.findMany({
    where: {
      studioId,
      ...NOT_ARCHIVED,
      ...(statusValues.length > 0 ? { status: { in: statusValues } } : {}),
      ...(artistWhere ?? {}),
      ...(searchWhere ?? {}),
    },
    select: INQUIRY_LIST_SELECT,
    orderBy: sortOrderBy(sort),
    take: 100,
  });

  res.json(inquiries);
});

// Artist-facing inbox: inquiries currently assigned to the requesting
// artist and awaiting their review. Registered before the "/:id" route
// below so Express doesn't try to match "assigned-to-me" as an :id.
//
// ?scope=all (Package E's Kanban board): an artist has zero access to
// GET / or GET /:id (both OWNER/FRONT_DESK-only) -- this is their ONLY
// window into inquiry data, so their filtered Kanban board reuses this
// same route with the ARTIST_ASSIGNED-only filter dropped, rather than
// opening up either staff-only route. Default (no scope param) behavior
// is completely unchanged, so MyInquiries.tsx's existing approve/decline
// inbox is unaffected.
router.get("/assigned-to-me", requireAuth, requireRole(Role.ARTIST), async (req, res) => {
  const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId } });
  if (!artist) {
    return res.json([]);
  }

  const scopeAll = req.query.scope === "all";

  const inquiries = await prisma.inquiry.findMany({
    where: {
      assignedArtistId: artist.id,
      ...(scopeAll ? NOT_ARCHIVED : { status: InquiryStatus.ARTIST_ASSIGNED }),
    },
    include: INQUIRY_INCLUDE,
    orderBy: scopeAll ? { updatedAt: "desc" } : { assignedAt: "desc" },
  });

  res.json(inquiries);
});

router.get("/:id", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, include: INQUIRY_INCLUDE });

  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Same shortLinks.shortenUrl every other public link on this server goes
  // through (SMS sends, the client-facing shareable-links composer) --
  // idempotent by target URL, so this returns the exact same short code
  // already handed out elsewhere for the same token, not a new one. The
  // page previously reconstructed a full-length `${origin}/estimate/...`
  // URL client-side from the raw token instead, which is what a client
  // actually saw if they opened the "Share this link" box on a page reload
  // rather than right after the initial send.
  const now = new Date();
  const estimateActive = !!(inquiry.estimateToken && inquiry.estimateTokenExpiresAt && inquiry.estimateTokenExpiresAt > now);
  const estimateUrl = estimateActive ? await shortenUrl(`${PUBLIC_APP_URL}/estimate/${inquiry.estimateToken}`) : null;

  const depositForms = await Promise.all(
    inquiry.depositForms.map(async (form) => {
      const active = !form.signedAt && form.tokenExpiresAt > now;
      return { ...form, url: active ? await shortenUrl(`${PUBLIC_APP_URL}/deposit/${form.token}`) : null };
    }),
  );

  res.json({ ...inquiry, estimateUrl, depositForms });
});

// Detail-field edits only -- status transitions stay in their own dedicated
// routes above/below (assign, respond, schedule, waitlist), never here.
const REQUIRED_STRING_FIELDS = ["description", "colorOrBlackGrey", "placement", "estimatedSize"] as const;
const NULLABLE_STRING_FIELDS = ["budget", "desiredTiming"] as const;
const NUMERIC_FIELDS = [
  "priceEstimateLow",
  "priceEstimateHigh",
  "timeEstimateHoursMin",
  "timeEstimateHoursMax",
] as const;
const IMAGE_ARRAY_FIELDS = ["referenceImages", "placementImages"] as const;

router.patch("/:id", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};

  if ("status" in body) {
    return res.status(400).json({ error: "status cannot be changed through this route" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Package H: once converted to a Project, the estimate is what the
  // client actually paid a deposit against -- staff can still see it, but
  // editing it after the fact would silently rewrite the number the client
  // agreed to. Only blocks the estimate fields specifically; description/
  // placement/budget/etc. stay editable. Package L's InquiryNote entries
  // are a separate log with their own routes, not covered by this route.
  const editsEstimate = NUMERIC_FIELDS.some((field) => body[field] !== undefined);
  if (editsEstimate && PROJECT_STATUSES.includes(inquiry.status)) {
    return res.status(400).json({
      error: "The estimate can't be edited after this inquiry has converted to a Project (deposit already paid).",
    });
  }

  const data: Record<string, string | number | null | string[]> = {};

  for (const field of REQUIRED_STRING_FIELDS) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string" || body[field].trim().length === 0) {
      return res.status(400).json({ error: `${field} must be a non-empty string` });
    }
    data[field] = body[field].trim();
  }

  for (const field of NULLABLE_STRING_FIELDS) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== "string") {
      return res.status(400).json({ error: `${field} must be a string or null` });
    }
    data[field] = typeof body[field] === "string" ? body[field].trim() || null : null;
  }

  for (const field of NUMERIC_FIELDS) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== "number") {
      return res.status(400).json({ error: `${field} must be a number or null` });
    }
    data[field] = body[field];
  }

  for (const field of IMAGE_ARRAY_FIELDS) {
    if (body[field] === undefined) continue;
    if (!isStringArray(body[field])) {
      return res.status(400).json({ error: `${field} must be an array of strings` });
    }
    data[field] = body[field];
  }

  const updated = await prisma.inquiry.update({ where: { id }, data, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "update",
    changes: diffObjects(inquiry, data, [
      ...REQUIRED_STRING_FIELDS,
      ...NULLABLE_STRING_FIELDS,
      ...NUMERIC_FIELDS,
      ...IMAGE_ARRAY_FIELDS,
    ] as unknown as (keyof typeof inquiry)[]),
  });

  res.json(updated);
});

// Staff hands a NEW inquiry off to an artist. Re-assigning only makes sense
// while it's still NEW — once an artist has responded (or is mid-review),
// this endpoint won't touch it; DECLINE below is what puts it back to NEW.
router.patch("/:id/assign", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { artistId } = req.body ?? {};

  if (!artistId) {
    return res.status(400).json({ error: "artistId is required" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.status !== InquiryStatus.NEW) {
    return res.status(400).json({ error: "Only a NEW inquiry can be assigned" });
  }

  const artist = await prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } });
  if (!artist || artist.user.studioId !== req.user!.studioId) {
    return res.status(400).json({ error: "artistId must belong to your studio" });
  }

  const updateData = { assignedArtistId: artistId, assignedAt: new Date(), status: InquiryStatus.ARTIST_ASSIGNED };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: updateData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, updateData, ["status", "assignedArtistId", "assignedAt"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId });

  res.json(updated);
});

const DECISIONS = ["APPROVE", "DECLINE"] as const;

// Artist's response to an inquiry assigned to them. APPROVE records the
// artist's own estimate and hands it back to staff (AWAITING_CLIENT_RESPONSE).
// DECLINE unassigns it and puts it back in the pool (NEW) with a note for
// staff explaining why, so it can be reassigned.
router.patch("/:id/respond", requireAuth, requireRole(Role.ARTIST), async (req, res) => {
  const id = req.params.id as string;
  const { decision, priceEstimateLow, priceEstimateHigh, timeEstimateHoursMin, timeEstimateHoursMax, declineNote } =
    req.body ?? {};

  if (!DECISIONS.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of: ${DECISIONS.join(", ")}` });
  }

  const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId } });
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });

  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (!artist || inquiry.assignedArtistId !== artist.id) {
    return res.status(403).json({ error: "This inquiry is not assigned to you" });
  }

  if (decision === "DECLINE") {
    if (typeof declineNote !== "string" || declineNote.trim().length === 0) {
      return res.status(400).json({ error: "declineNote is required when declining" });
    }

    const declineData = {
      assignedArtistId: null,
      assignedAt: null,
      status: InquiryStatus.NEW,
      declineNote: declineNote.trim(),
    };

    const updated = await prisma.inquiry.update({
      where: { id },
      data: declineData,
      include: INQUIRY_INCLUDE,
    });

    await logAudit({
      studioId: req.user!.studioId,
      actorUserId: req.user!.userId,
      entityType: "Inquiry",
      entityId: id,
      action: "status_change",
      changes: diffObjects(inquiry, declineData, ["status", "assignedArtistId", "assignedAt", "declineNote"]),
    });

    emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId });

    return res.json(updated);
  }

  for (const [field, value] of Object.entries({
    priceEstimateLow,
    priceEstimateHigh,
    timeEstimateHoursMin,
    timeEstimateHoursMax,
  })) {
    if (value !== undefined && typeof value !== "number") {
      return res.status(400).json({ error: `${field} must be a number` });
    }
  }

  const approveData = {
    status: InquiryStatus.AWAITING_CLIENT_RESPONSE,
    priceEstimateLow: priceEstimateLow ?? null,
    priceEstimateHigh: priceEstimateHigh ?? null,
    timeEstimateHoursMin: timeEstimateHoursMin ?? null,
    timeEstimateHoursMax: timeEstimateHoursMax ?? null,
  };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: approveData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, approveData, [
      "status",
      "priceEstimateLow",
      "priceEstimateHigh",
      "timeEstimateHoursMin",
      "timeEstimateHoursMax",
    ]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId });

  res.json(updated);
});

// Staff sends (or resends, with revised numbers) the client-facing estimate
// link. Valid from AWAITING_CLIENT_RESPONSE (first send) or
// BUDGET_NEGOTIATION (resend after the client pushed back on price) — either
// way it lands the client back in AWAITING_CLIENT_RESPONSE to review the
// (possibly updated) numbers.
router.post("/:id/send-estimate", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { priceEstimateLow, priceEstimateHigh, timeEstimateHoursMin, timeEstimateHoursMax } = req.body ?? {};

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Deliberately not narrowed to AWAITING_CLIENT_RESPONSE/BUDGET_NEGOTIATION
  // -- front desk/owner routinely gets a price verbally from the artist
  // (especially guest artists who never touch the app) and types it in
  // themselves, often before the artist has "responded" in-app at all.
  // Only the two terminal statuses are off-limits, same allowlist every
  // other cross-status inquiry action in this file already uses.
  if (!NON_TERMINAL_STATUSES.includes(inquiry.status)) {
    return res.status(400).json({ error: "An estimate can't be sent on a closed or cold-lead inquiry" });
  }

  for (const [field, value] of Object.entries({
    priceEstimateLow,
    priceEstimateHigh,
    timeEstimateHoursMin,
    timeEstimateHoursMax,
  })) {
    if (value !== undefined && typeof value !== "number") {
      return res.status(400).json({ error: `${field} must be a number` });
    }
  }

  // Validate the *effective* range (newly submitted value, falling back to
  // whatever's already on the inquiry) -- staff can resend without
  // resubmitting numbers that were already approved by the artist.
  const effective = {
    priceEstimateLow: priceEstimateLow ?? inquiry.priceEstimateLow,
    priceEstimateHigh: priceEstimateHigh ?? inquiry.priceEstimateHigh,
    timeEstimateHoursMin: timeEstimateHoursMin ?? inquiry.timeEstimateHoursMin,
    timeEstimateHoursMax: timeEstimateHoursMax ?? inquiry.timeEstimateHoursMax,
  };

  for (const [field, value] of Object.entries(effective)) {
    if (value == null) {
      return res.status(400).json({ error: `${field} is required before an estimate can be sent` });
    }
    if (value <= 0) {
      return res.status(400).json({ error: `${field} must be a positive number` });
    }
  }

  if (effective.priceEstimateLow! > effective.priceEstimateHigh!) {
    return res.status(400).json({ error: "priceEstimateLow must be less than or equal to priceEstimateHigh" });
  }

  if (effective.timeEstimateHoursMin! > effective.timeEstimateHoursMax!) {
    return res
      .status(400)
      .json({ error: "timeEstimateHoursMin must be less than or equal to timeEstimateHoursMax" });
  }

  // A prior send/resend already having a sent timestamp is what distinguishes
  // a resend from a first send -- everything else about the flow is identical.
  const isResend = inquiry.estimateSentAt != null;

  const estimateToken = crypto.randomBytes(32).toString("hex");
  const estimateTokenExpiresAt = new Date(Date.now() + ESTIMATE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const studioSettings = await prisma.studioSettings.findUnique({ where: { studioId: req.user!.studioId } });

  const sendEstimateData = {
    estimateToken,
    estimateTokenExpiresAt,
    estimateSentAt: new Date(),
    estimateTermsSnapshot: studioSettings?.estimateTerms ?? null,
    status: InquiryStatus.AWAITING_CLIENT_RESPONSE,
    priceEstimateLow: effective.priceEstimateLow,
    priceEstimateHigh: effective.priceEstimateHigh,
    timeEstimateHoursMin: effective.timeEstimateHoursMin,
    timeEstimateHoursMax: effective.timeEstimateHoursMax,
    // A resend is a new estimate event -- prior open/response timing no
    // longer describes the estimate the client is about to see. It's still
    // recoverable from the audit log below if needed. estimateFollowUpSentAt
    // resets alongside them (Phase 7B-2) so the 24-hour follow-up text can
    // fire again for the freshly-resent estimate rather than staying
    // silently blocked by a follow-up that already went out for the old one.
    ...(isResend ? { estimateOpenedAt: null, estimateRespondedAt: null, estimateFollowUpSentAt: null } : {}),
  };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: sendEstimateData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: isResend ? "estimate_resent" : "estimate_sent",
    changes: diffObjects(inquiry, sendEstimateData, [
      "status",
      "estimateSentAt",
      "estimateOpenedAt",
      "estimateRespondedAt",
      "estimateFollowUpSentAt",
      "priceEstimateLow",
      "priceEstimateHigh",
      "timeEstimateHoursMin",
      "timeEstimateHoursMax",
    ]),
  });

  const estimateUrl = await shortenUrl(`${PUBLIC_APP_URL}/estimate/${estimateToken}`);

  // Auto-send through the same real-SMS path the composer/reminders use --
  // a Message row lands in this client's actual Conversations thread on
  // success, exactly like any other outbound text. This is deliberately
  // best-effort: the estimate itself is already generated and the
  // inquiry's status already moved forward above regardless of whether
  // the text goes out, so a skip/failure here doesn't roll any of that
  // back -- staff still has the link to share manually (the response
  // below always reports which case happened).
  const studio = await prisma.studio.findUnique({ where: { id: req.user!.studioId }, select: { name: true } });
  const estimateSendResult = await sendClientSms({
    studioId: req.user!.studioId,
    clientId: updated.clientId,
    conversationId: (await getOrCreateClientConversation(req.user!.studioId, updated.clientId, req.user!.userId))
      .conversation.id,
    body: `Hi ${updated.client.firstName}, here's your tattoo estimate from ${studio?.name ?? "our studio"}: ${estimateUrl}`,
    actorUserId: req.user!.userId,
  });

  emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId });

  res.status(201).json({ ...updated, estimateUrl, estimateSendResult });
});

// Creates the real Appointment once the deposit's been paid (SCHEDULING is
// only reachable after mark-paid issues a gift card -- Phase 3), links it
// back to the Inquiry, and attaches the gift card in the same transaction.
// Doesn't block on a tight same-day schedule for the artist — just flags
// it via bufferWarning so staff can decide.
router.post("/:id/schedule", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { startTime, endTime, giftCardId } = req.body ?? {};

  if (!startTime || !endTime) {
    return res.status(400).json({ error: "startTime and endTime are required" });
  }

  if (!giftCardId) {
    return res
      .status(400)
      .json({ error: "giftCardId is required — collect a deposit or issue a gift card for this client first." });
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return res.status(400).json({ error: "startTime and endTime must be valid dates, with startTime before endTime" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.status !== InquiryStatus.SCHEDULING) {
    return res.status(400).json({ error: "Only an inquiry in SCHEDULING can be scheduled" });
  }

  if (!inquiry.assignedArtistId) {
    return res.status(400).json({ error: "This inquiry has no assigned artist" });
  }

  const giftCardResult = await validateGiftCardForAttachment(giftCardId, req.user!.studioId, inquiry.clientId);
  if ("error" in giftCardResult) {
    return res.status(400).json({ error: giftCardResult.error });
  }

  const conflict = await findBufferConflict(inquiry.assignedArtistId, start, end);

  const appointment = await prisma.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        studioId: req.user!.studioId,
        artistId: inquiry.assignedArtistId!,
        clientId: inquiry.clientId,
        inquiryId: id,
        startTime: start,
        endTime: end,
        status: AppointmentStatus.CONFIRMED,
      },
    });

    await tx.giftCard.update({ where: { id: giftCardId }, data: { appointmentId: created.id } });

    return created;
  });

  const scheduleData = { appointmentId: appointment.id, status: InquiryStatus.CONFIRMED };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: scheduleData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, scheduleData, ["status", "appointmentId"]),
  });

  emitInvalidation({ type: "appointment.changed", studioId: req.user!.studioId });
  emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId });

  res.status(201).json({
    ...updated,
    bufferWarning: formatBufferWarning(conflict),
  });
});

// Alternative to scheduling right away: keeps the inquiry out of active
// scheduling without losing it, for a client who wants to wait for a
// specific slot. The optional note is stored the same way an artist's
// decline note is -- a single "most recent status note" field.
router.post("/:id/waitlist", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { note } = req.body ?? {};

  if (note !== undefined && typeof note !== "string") {
    return res.status(400).json({ error: "note must be a string" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.status !== InquiryStatus.SCHEDULING) {
    return res.status(400).json({ error: "Only an inquiry in SCHEDULING can be waitlisted" });
  }

  const waitlistData = { status: InquiryStatus.WAITLISTED, declineNote: note?.trim() || null };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: waitlistData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, waitlistData, ["status", "declineNote"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId });

  res.json(updated);
});

// Package H: the other missing workflow action -- /waitlist above had no
// reverse. Symmetric with it: the only thing this undoes is that exact
// transition, back to SCHEDULING (never straight to CONFIRMED -- picking an
// actual time slot stays its own deliberate step through /schedule).
router.post("/:id/unwaitlist", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.status !== InquiryStatus.WAITLISTED) {
    return res.status(400).json({ error: "Only a WAITLISTED inquiry can be removed from the waitlist" });
  }

  const unwaitlistData = { status: InquiryStatus.SCHEDULING };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: unwaitlistData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, unwaitlistData, ["status"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId });

  res.json(updated);
});

// The missing workflow action: marks an inquiry lost. Valid from any
// non-terminal status (Inquiries-side or Projects-side alike -- a
// confirmed project can still fall through). Deliberately conversation-
// agnostic: a separate workstream adds a chat-side entry point that calls
// this same route, so nothing here assumes it was reached from a thread.
router.post("/:id/mark-lost", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { reason } = req.body ?? {};

  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return res.status(400).json({ error: "reason must be a string" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (!NON_TERMINAL_STATUSES.includes(inquiry.status)) {
    return res.status(400).json({ error: "This inquiry is already in a terminal state (CLOSED_LOST or COLD_LEAD)" });
  }

  const lostData = {
    status: InquiryStatus.CLOSED_LOST,
    lostAt: new Date(),
    lostReason: typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null,
  };

  const updated = await prisma.inquiry.update({ where: { id }, data: lostData, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, lostData, ["status", "lostAt", "lostReason"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId });

  res.json(updated);
});

// Reverses mark-lost OR the cold-lead sweep -- both terminal states share
// one reopen path. status is an explicit target rather than a fixed
// "back to NEW": staff know best where an inquiry should resume (one that
// was CONFIRMED before going cold shouldn't have to restart the pipeline).
router.post("/:id/reopen", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { status } = req.body ?? {};

  if (typeof status !== "string" || !NON_TERMINAL_STATUSES.includes(status as InquiryStatus)) {
    return res.status(400).json({ error: `status must be one of: ${NON_TERMINAL_STATUSES.join(", ")}` });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.status !== InquiryStatus.CLOSED_LOST && inquiry.status !== InquiryStatus.COLD_LEAD) {
    return res.status(400).json({ error: "Only a CLOSED_LOST or COLD_LEAD inquiry can be reopened" });
  }

  const reopenData = { status: status as InquiryStatus, lostAt: null, lostReason: null };

  const updated = await prisma.inquiry.update({ where: { id }, data: reopenData, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, reopenData, ["status", "lostAt", "lostReason"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId });

  res.json(updated);
});

// Generates (or, if unsigned, regenerates) a client-facing deposit form
// link. Valid either pre-conversion (DEPOSIT_PENDING, the original
// session) or post-conversion (PROJECT_STATUSES -- Package M's "send
// another deposit form" for a later session), and the tier is computed
// from the artist's own estimate, not anything the client stated.
//
// Package M: an inquiry can now carry several DepositForm rows (one per
// tattoo session) instead of exactly one. This route still does both
// things it always did -- create the first one, or rotate the token on an
// existing UNSIGNED one ("Resend") -- it just decides which based on the
// most recent row rather than a unique-by-inquiry lookup: if that latest
// row is missing or already signed, a new session gets created (next
// sessionNumber); if it's still unsigned, that's the one being resent.
// This also covers the case where an inquiry converted via
// attach-gift-card (skipping the deposit-form flow entirely for its first
// session) and only reaches this route for the first time on session 2 --
// "latest row missing" is true there too, so it still creates session 1.
router.post("/:id/deposit-form", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { proposedStartAt, proposedEndAt, autoSend } = req.body ?? {};

  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    include: { depositForms: { orderBy: { sessionNumber: "desc" }, take: 1 }, client: true },
  });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.status !== InquiryStatus.DEPOSIT_PENDING && !PROJECT_STATUSES.includes(inquiry.status)) {
    return res.status(400).json({
      error: "A deposit form can only be sent while DEPOSIT_PENDING or after the inquiry has converted to a Project",
    });
  }

  if (inquiry.priceEstimateLow == null || inquiry.priceEstimateHigh == null) {
    return res.status(400).json({ error: "This inquiry is missing a price estimate" });
  }

  const latest = inquiry.depositForms[0] as (typeof inquiry.depositForms)[number] | undefined;
  const isNewSession = !latest || latest.signedAt != null;

  // A tentative time is required whenever this creates a fresh session --
  // staff must commit to some proposed slot (suggested or hand-picked)
  // before that session's client-facing link is created at all. Resending
  // the current unsigned session's form (token rotation only, below)
  // leaves whatever tentative time is already set untouched -- PATCH
  // .../deposit-form/proposed-time is the only way to change it after the
  // fact, since that route doesn't rotate the token and so never
  // invalidates a link already shared with the client.
  let proposedStart: Date | null = null;
  let proposedEnd: Date | null = null;
  if (isNewSession) {
    if (typeof proposedStartAt !== "string" || typeof proposedEndAt !== "string") {
      return res.status(400).json({ error: "A tentative appointment time is required before generating a deposit form" });
    }
    proposedStart = new Date(proposedStartAt);
    proposedEnd = new Date(proposedEndAt);
    if (Number.isNaN(proposedStart.getTime()) || Number.isNaN(proposedEnd.getTime()) || proposedStart >= proposedEnd) {
      return res.status(400).json({ error: "proposedStartAt must be a valid date before proposedEndAt" });
    }
  }

  const settings = await prisma.studioSettings.findUnique({ where: { studioId: req.user!.studioId } });
  const tiers = resolveDepositTiers(settings?.depositTiers);

  const average = (inquiry.priceEstimateLow + inquiry.priceEstimateHigh) / 2;
  const { depositAmount, totalCharged } = computeDepositTier(average, tiers);
  const feeAmount = totalCharged - depositAmount;

  const token = crypto.randomBytes(32).toString("hex");
  const tokenExpiresAt = new Date(Date.now() + DEPOSIT_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  const depositForm = isNewSession
    ? await prisma.depositForm.create({
        data: {
          inquiryId: id,
          sessionNumber: (latest?.sessionNumber ?? 0) + 1,
          token,
          tokenExpiresAt,
          depositAmount,
          feeAmount,
          totalCharged,
          proposedStartAt: proposedStart,
          proposedEndAt: proposedEnd,
        },
      })
    : await prisma.depositForm.update({
        where: { id: latest!.id },
        data: { token, tokenExpiresAt, depositAmount, feeAmount, totalCharged },
      });

  const depositUrl = await shortenUrl(`${PUBLIC_APP_URL}/deposit/${token}`);

  // Auto-send through the same real-SMS path as the estimate auto-send --
  // "Send Deposit Form"/"Resend Deposit Form" across InquiryDetail/
  // ClientDetail otherwise generated a link with nothing to show for it in
  // Conversations. Best-effort, same as the estimate: the form itself is
  // already generated above regardless of whether the text goes out, so
  // staff still has depositUrl to share manually if this skips/fails.
  // autoSend: false is the composer's own "create-then-insert-link" flow
  // (ConversationsPanel) opting out -- it inserts the link into the draft
  // for staff to compose their own message around before sending, so an
  // automatic send here would just duplicate what the composer's own Send
  // button is about to do.
  let depositSendResult: Awaited<ReturnType<typeof sendClientSms>> | null = null;
  if (autoSend !== false) {
    const studio = await prisma.studio.findUnique({ where: { id: req.user!.studioId }, select: { name: true } });
    depositSendResult = await sendClientSms({
      studioId: req.user!.studioId,
      clientId: inquiry.clientId,
      conversationId: (await getOrCreateClientConversation(req.user!.studioId, inquiry.clientId, req.user!.userId))
        .conversation.id,
      body: `Hi ${inquiry.client.firstName}, here's your deposit form to secure your appointment with ${studio?.name ?? "our studio"}: ${depositUrl} (expires in 48 hours)`,
      actorUserId: req.user!.userId,
    });
  }

  res.status(201).json({ ...depositForm, depositUrl, depositSendResult });
});

// Package D: staff picks (or clears) a tentative, informational-only time
// from getSuggestedTimes to show on the public deposit page. Deliberately
// separate from POST /:id/deposit-form above -- that route rotates the
// token/expiry every call, which would invalidate a link already sent to
// the client; this only ever touches the two proposed* columns. No
// Appointment is created or referenced here, and no gift card is involved
// -- purely informational, matching the deposit-form's own pre-payment,
// pre-real-scheduling position in the pipeline.
router.patch(
  "/:id/deposit-form/proposed-time",
  requireAuth,
  requireRole(Role.OWNER, Role.FRONT_DESK),
  async (req, res) => {
    const id = req.params.id as string;
    const body = req.body ?? {};
    const { proposedStartAt, proposedEndAt } = body;

    // Package M: several deposit forms can exist for this inquiry now --
    // this route only ever makes sense against whichever one is still
    // awaiting the client's signature (the tentative time is purely
    // pre-signing, informational context), so it targets the most recent
    // still-unsigned session rather than assuming there's only one.
    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      include: { depositForms: { where: { signedAt: null }, orderBy: { sessionNumber: "desc" }, take: 1 } },
    });
    if (!inquiry || inquiry.studioId !== req.user!.studioId) {
      return res.status(404).json({ error: "Inquiry not found" });
    }
    const pending = inquiry.depositForms[0];
    if (!pending) {
      return res.status(400).json({ error: "This inquiry has no deposit form awaiting signature" });
    }

    // Both set or both cleared -- never a dangling start with no end.
    const bothNull = proposedStartAt === null && proposedEndAt === null;
    const bothStrings = typeof proposedStartAt === "string" && typeof proposedEndAt === "string";
    if (!bothNull && !bothStrings) {
      return res.status(400).json({ error: "proposedStartAt and proposedEndAt must both be set or both be null" });
    }
    if (bothStrings && !(new Date(proposedStartAt) < new Date(proposedEndAt))) {
      return res.status(400).json({ error: "proposedStartAt must be before proposedEndAt" });
    }

    const updated = await prisma.depositForm.update({
      where: { id: pending.id },
      data: {
        proposedStartAt: bothStrings ? new Date(proposedStartAt) : null,
        proposedEndAt: bothStrings ? new Date(proposedEndAt) : null,
      },
    });

    await logAudit({
      studioId: req.user!.studioId,
      actorUserId: req.user!.userId,
      entityType: "DepositForm",
      entityId: updated.id,
      action: "update",
      changes: { proposedStartAt: updated.proposedStartAt, proposedEndAt: updated.proposedEndAt },
    });

    res.json(updated);
  },
);

// Alternative to the deposit-form flow above: the client already has an
// available gift card on file (e.g. from an earlier project, or issued
// directly by staff) that can secure this booking, so there's nothing to
// send/sign -- just move straight to SCHEDULING. Deliberately does NOT
// touch GiftCard.appointmentId here; the actual attach happens at
// POST /:id/schedule like every other card, same as mark-paid's freshly-
// issued card isn't attached to anything until that same step.
//
// Staff routinely hits "Send Deposit Form" before ever checking whether the
// client already has a card on file, so this stays available even after an
// unsigned DepositForm already exists -- it's only blocked once the client
// has actually signed one (a real commitment shouldn't be silently
// discarded). An unsigned one gets deleted here rather than left behind, so
// its public link can't still be signed for an inquiry that's already
// moved on without it.
router.post("/:id/attach-gift-card", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { giftCardId } = req.body ?? {};

  if (!giftCardId) {
    return res.status(400).json({ error: "giftCardId is required" });
  }

  // Only reachable pre-conversion (DEPOSIT_PENDING, gated below), so at
  // most one DepositForm row can exist for this inquiry at this point --
  // Package M's multi-session rows only ever get created post-conversion.
  const inquiry = await prisma.inquiry.findUnique({ where: { id }, include: { depositForms: true } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.status !== InquiryStatus.DEPOSIT_PENDING) {
    return res.status(400).json({ error: "Only an inquiry in DEPOSIT_PENDING can skip to an existing gift card" });
  }

  const existingDepositForm = inquiry.depositForms[0] as (typeof inquiry.depositForms)[number] | undefined;

  if (existingDepositForm?.signedAt) {
    return res.status(400).json({ error: "This client has already signed a deposit form for this inquiry" });
  }

  const giftCardResult = await validateGiftCardForAttachment(giftCardId, req.user!.studioId, inquiry.clientId);
  if ("error" in giftCardResult) {
    return res.status(400).json({ error: giftCardResult.error });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (existingDepositForm) {
      await tx.depositForm.delete({ where: { id: existingDepositForm.id } });
    }
    return tx.inquiry.update({ where: { id }, data: { status: InquiryStatus.SCHEDULING } });
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: {
      ...diffObjects(inquiry, { status: InquiryStatus.SCHEDULING }, ["status"]),
      satisfiedByExistingGiftCardId: giftCardId,
      ...(existingDepositForm ? { discardedUnsignedDepositFormId: existingDepositForm.id } : {}),
    },
  });

  emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId });

  res.json(updated);
});

// Explicit allowlist projection for the sanitized artist share -- named
// fields only, built up rather than derived by deleting keys from a full
// inquiry object, so nothing client-identifying (name/email/phone/DOB/
// address/emergency contact/health data/ID images) can leak through by
// accident as new Inquiry fields get added later. Deliberately just these
// seven fields plus photos -- no preferred artist, no staff-internal price/
// time estimate, both of which used to leak into this share before.
function buildSharedInquiryProjection(inquiry: {
  description: string;
  colorOrBlackGrey: string;
  placement: string;
  estimatedSize: string;
  hasBeenTattooedBefore: boolean;
  budget: string | null;
  desiredTiming: string | null;
  referenceImages: string[];
  placementImages: string[];
}): { body: string; attachments: string[] } {
  const lines = [
    `Tattoo: ${inquiry.description}`,
    `Style: ${inquiry.colorOrBlackGrey}`,
    `Placement: ${inquiry.placement}`,
    `Size: ${inquiry.estimatedSize}`,
    `Previously tattooed: ${inquiry.hasBeenTattooedBefore ? "Yes" : "No"}`,
  ];

  if (inquiry.budget) lines.push(`Budget: ${inquiry.budget}`);
  if (inquiry.desiredTiming) lines.push(`Desired timing: ${inquiry.desiredTiming}`);

  return { body: lines.join("\n"), attachments: [...inquiry.referenceImages, ...inquiry.placementImages] };
}

// Preview: exactly what would be composed into the artist's thread, before
// an artist is even picked -- the projection never depends on who receives
// it, so the frontend's confirmation modal can show this ahead of send (and
// let staff edit it there before sending -- see the optional body override
// below).
router.get("/:id/share-to-artist/preview", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  res.json(buildSharedInquiryProjection(inquiry));
});

// Sends a sanitized copy of an inquiry's tattoo details into the front-desk
// <-> artist STAFF thread. `body` is optional -- staff can edit the
// generated preview in the share modal before sending, so this accepts
// their edited text as an override; omitted (or blank), it falls back to
// the same fixed projection the preview above shows. Unlike the client-
// facing composer, this is staff talking to staff, so free-text here isn't
// the PII risk the original fixed-projection-only design was guarding
// against -- that guard was about auto-including client-identifying
// fields, not about staff's own wording.
router.post("/:id/share-to-artist", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { studioId, userId } = req.user!;
  const { artistUserId, body: customBody } = req.body ?? {};

  if (typeof artistUserId !== "string" || artistUserId.trim().length === 0) {
    return res.status(400).json({ error: "artistUserId is required" });
  }

  if (customBody !== undefined && typeof customBody !== "string") {
    return res.status(400).json({ error: "body must be a string" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  const artist = await prisma.artist.findUnique({ where: { userId: artistUserId }, include: { user: true } });
  if (!artist || artist.user.studioId !== studioId || artist.user.role !== Role.ARTIST) {
    return res.status(400).json({ error: "artistUserId must be an artist in your studio" });
  }

  const { conversation } = await getOrCreateStaffConversation(studioId, artistUserId, userId);
  const { body: defaultBody, attachments } = buildSharedInquiryProjection(inquiry);
  const body = customBody && customBody.trim().length > 0 ? customBody.trim() : defaultBody;
  const now = new Date();

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        studioId,
        conversationId: conversation.id,
        channel: MessageChannel.IN_APP,
        direction: MessageDirection.OUTBOUND,
        body,
        attachments: attachments.length > 0 ? attachments : undefined,
        authorUserId: userId,
        // Set at creation only -- messages stay immutable. Lets the UI
        // render this as a distinct "Shared inquiry" card instead of a
        // plain text bubble.
        metadata: { kind: "shared_inquiry", inquiryId: id },
        createdAt: now,
      },
    }),
    prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } }),
  ]);

  await logAudit({
    studioId,
    actorUserId: userId,
    entityType: "Inquiry",
    entityId: id,
    action: "shared_to_artist",
    changes: { artistUserId },
  });

  res.status(201).json({ conversationId: conversation.id, messageId: message.id });
});

// Archive: soft, reversible hide -- same treatment as Client.archivedAt.
router.post("/:id/archive", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }
  if (inquiry.archivedAt) {
    return res.json(inquiry);
  }

  const updated = await prisma.inquiry.update({ where: { id }, data: { archivedAt: new Date() } });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "archive",
    changes: { archivedAt: updated.archivedAt },
  });

  res.json(updated);
});

router.post("/:id/unarchive", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }
  if (!inquiry.archivedAt) {
    return res.json(inquiry);
  }

  const updated = await prisma.inquiry.update({ where: { id }, data: { archivedAt: null } });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "unarchive",
    changes: { archivedAt: null },
  });

  res.json(updated);
});

// Shared between the delete-preview and the audit snapshot written just
// before the real DELETE below.
async function gatherInquiryDeletionSummary(inquiryId: string) {
  const appointments = await prisma.appointment.findMany({ where: { inquiryId }, select: { id: true } });
  const appointmentIds = appointments.map((a) => a.id);

  const [waivers, depositFormCount, attachedGiftCards, consentFormsToDetachCount, conversationTagCount] = await Promise.all([
    prisma.liabilityWaiver.count({ where: { appointmentId: { in: appointmentIds } } }),
    // Package M: could be several now (one per session), not just 0 or 1.
    prisma.depositForm.count({ where: { inquiryId } }),
    prisma.giftCard.findMany({
      where: { appointmentId: { in: appointmentIds } },
      select: { id: true, code: true, amountCents: true, status: true },
    }),
    prisma.consentForm.count({ where: { appointmentId: { in: appointmentIds } } }),
    prisma.conversationTag.count({
      where: {
        OR: [
          { entityType: "Inquiry", entityId: inquiryId },
          { entityType: "Appointment", entityId: { in: appointmentIds } },
        ],
      },
    }),
  ]);

  return {
    appointments: appointmentIds.length,
    waivers,
    depositForms: depositFormCount,
    giftCardsToDetach: attachedGiftCards.map((card) => ({ id: card.id, code: card.code, amountCents: card.amountCents, status: card.status })),
    consentFormsToDetach: consentFormsToDetachCount,
    conversationTags: conversationTagCount,
  };
}

// OWNER only, always available regardless of attached history. Scoped to
// this inquiry's own tree -- unlike client-delete, any gift card attached
// to one of this inquiry's appointments is DETACHED (appointmentId ->
// null), never destroyed: it's the client's money, independent of this
// one project. Consent forms on these appointments are likewise unlinked
// (appointmentId -> null) rather than deleted, since they're optionally
// attached and represent a signed legal document that outlives the
// session it was originally tied to.
router.delete("/:id", requireAuth, requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const { confirm } = req.body ?? {};

  if (confirm !== "DELETE") {
    return res.status(400).json({ error: 'Type "DELETE" to confirm this action.' });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  const summary = await gatherInquiryDeletionSummary(id);

  await prisma.$transaction(async (tx) => {
    const appointments = await tx.appointment.findMany({ where: { inquiryId: id }, select: { id: true } });
    const appointmentIds = appointments.map((a) => a.id);

    // Detach, don't destroy -- the client's money survives this delete.
    await tx.giftCard.updateMany({ where: { appointmentId: { in: appointmentIds } }, data: { appointmentId: null } });
    // Unlink, don't destroy -- a signed consent form outlives the session.
    await tx.consentForm.updateMany({ where: { appointmentId: { in: appointmentIds } }, data: { appointmentId: null } });

    await tx.liabilityWaiver.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
    await tx.conversationTag.deleteMany({
      where: {
        OR: [
          { entityType: "Inquiry", entityId: id },
          { entityType: "Appointment", entityId: { in: appointmentIds } },
        ],
      },
    });
    await tx.depositForm.deleteMany({ where: { inquiryId: id } });

    // Inquiry.appointmentId is an optional back-reference to one of these
    // same appointments -- null it before deleting them, or that FK blocks
    // the appointment delete below.
    await tx.inquiry.update({ where: { id }, data: { appointmentId: null } });
    await tx.appointment.deleteMany({ where: { inquiryId: id } });
    await tx.inquiry.delete({ where: { id } });
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "permanently_deleted",
    changes: {
      inquiry: { description: inquiry.description, status: inquiry.status, clientId: inquiry.clientId },
      ...summary,
    },
  });

  res.json({ success: true, detachedGiftCards: summary.giftCardsToDetach });
});

router.get("/:id/delete-preview", requireAuth, requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  const summary = await gatherInquiryDeletionSummary(id);
  res.json(summary);
});

const NOTE_AUTHOR_SELECT = { select: { id: true, name: true, email: true } } as const;

// RichTextEditor's own empty state is "<p></p>", not "" -- a plain
// .trim().length check alone would accept that as valid content and save
// a visibly-blank note. Same tag-stripping approach as Settings.tsx's own
// stripHtmlPreview (client-side preview text), just used here to test for
// blankness rather than to render a preview.
function isBlankHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().length === 0;
}

// Manually-written commentary log -- a dedicated GET rather than folding
// into GET /:id, since bodyHtml can grow (rich text, several entries) and
// most callers of the inquiry detail fetch don't need it on every load.
// Same OWNER/FRONT_DESK gate as GET /:id itself (Package L: "ARTIST has no
// access, matches page-level gating") -- an ARTIST can't load the inquiry
// detail page at all, so they never reach this route either.
router.get("/:id/notes", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, select: { studioId: true } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  const notes = await prisma.inquiryNote.findMany({
    where: { inquiryId: id },
    include: { author: NOTE_AUTHOR_SELECT },
    orderBy: { createdAt: "desc" },
  });

  res.json(notes);
});

router.post("/:id/notes", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { bodyHtml } = req.body ?? {};

  if (typeof bodyHtml !== "string" || isBlankHtml(bodyHtml)) {
    return res.status(400).json({ error: "bodyHtml is required" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, select: { studioId: true } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  const note = await prisma.inquiryNote.create({
    data: {
      studioId: req.user!.studioId,
      inquiryId: id,
      authorId: req.user!.userId,
      bodyHtml: bodyHtml.trim(),
    },
    include: { author: NOTE_AUTHOR_SELECT },
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "InquiryNote",
    entityId: note.id,
    action: "create",
    changes: { inquiryId: id },
  });

  res.status(201).json(note);
});

// Edit or delete: the note's own author, or any OWNER (not just an OWNER
// who happens to be assigned to this inquiry -- same "OWNER can always
// act" precedent as every other author-scoped permission in this app).
// FRONT_DESK can only touch their own notes; an ARTIST never reaches this
// route at all (role gate below), consistent with GET/POST above.
function canModifyNote(note: { authorId: string }, req: import("express").Request): boolean {
  return note.authorId === req.user!.userId || req.user!.role === Role.OWNER;
}

router.patch("/:id/notes/:noteId", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const noteId = req.params.noteId as string;
  const { bodyHtml } = req.body ?? {};

  if (typeof bodyHtml !== "string" || isBlankHtml(bodyHtml)) {
    return res.status(400).json({ error: "bodyHtml is required" });
  }

  const note = await prisma.inquiryNote.findUnique({ where: { id: noteId } });
  if (!note || note.studioId !== req.user!.studioId || note.inquiryId !== id) {
    return res.status(404).json({ error: "Note not found" });
  }

  if (!canModifyNote(note, req)) {
    return res.status(403).json({ error: "Only this note's author or an OWNER can edit it" });
  }

  const trimmed = bodyHtml.trim();

  const updated = await prisma.inquiryNote.update({
    where: { id: noteId },
    data: { bodyHtml: trimmed },
    include: { author: NOTE_AUTHOR_SELECT },
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "InquiryNote",
    entityId: noteId,
    action: "update",
    changes: diffObjects(note, { bodyHtml: trimmed }, ["bodyHtml"]),
  });

  res.json(updated);
});

router.delete("/:id/notes/:noteId", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const noteId = req.params.noteId as string;

  const note = await prisma.inquiryNote.findUnique({ where: { id: noteId } });
  if (!note || note.studioId !== req.user!.studioId || note.inquiryId !== id) {
    return res.status(404).json({ error: "Note not found" });
  }

  if (!canModifyNote(note, req)) {
    return res.status(403).json({ error: "Only this note's author or an OWNER can delete it" });
  }

  await prisma.inquiryNote.delete({ where: { id: noteId } });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "InquiryNote",
    entityId: noteId,
    action: "delete",
    changes: { inquiryId: id, deletedBodyHtml: note.bodyHtml },
  });

  res.json({ success: true });
});

export default router;
