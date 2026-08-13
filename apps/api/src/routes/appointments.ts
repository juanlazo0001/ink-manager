import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { Prisma } from "../../generated/prisma/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role, AppointmentStatus, AppointmentType, GiftCardStatus } from "../../generated/prisma/enums";
import { requirePermission } from "../lib/permissions";
import { diffObjects, logAudit } from "../lib/audit";
import { validateGiftCardsForAttachment, generateUniqueGiftCardCode, computeGiftCardExpiration } from "../lib/giftCards";
import { resolveRequiredDepositCents, resolveDepositTiers } from "../lib/depositTiers";
import { generateAndSendDepositForm } from "../lib/deposits";
import { isSameCalendarDay } from "../lib/dateRange";
import {
  findBufferConflict,
  formatBufferWarning,
  resolveSchedulingBufferMs,
  DEFAULT_SCHEDULING_BUFFER_MS,
} from "../lib/schedulingConflict";
import { ensureLiabilityWaiver } from "../lib/waivers";
import {
  studioHasActiveMembership,
  callerBelongsToStudio,
  activeStudioIdsForCaller,
  hasPermissionAt,
  hasPermissionOrSoloArtistAt,
} from "../lib/artistAccess";
import { emitInvalidation } from "../lib/realtime/registry";
import { getOrCreateClientConversation } from "../lib/conversations";
import { sendClientSms } from "../lib/clientSms";
import { sendClientEmail } from "../lib/clientEmail";
import { renderClientEmailHtml } from "../lib/emailTemplate";
import { resolveImageMeta } from "../lib/imageMeta";
import { NOTE_AUTHOR_SELECT, canModifyNote, isBlankHtml, isValidAttachments } from "../lib/notes";
import { getChargeableConnectedAccountId } from "../lib/stripeConnect";
import { computeApplicationFeeCents, createDirectChargeCheckoutSession, createOrRetrieveDirectChargePaymentIntent } from "../lib/stripe";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { shortenUrl } from "../lib/shortLinks";
import { SELF_SCHEDULE_TOKEN_TTL_DAYS } from "../lib/selfSchedule";

const router = Router();

router.use(requireAuth);

// Same exclude-from-default-list-views treatment as Client.archivedAt /
// Inquiry.archivedAt -- the record stays intact and directly reachable via
// GET /:id, only the default list (which backs the Calendar) excludes it.
const NOT_ARCHIVED = { archivedAt: null } as const;

// Every appointment needs an inquiry (the project it belongs to). A
// TATTOO_SESSION additionally needs one or more attached ACTIVE (or
// EXEMPT) gift cards together meeting or exceeding the required deposit
// for that inquiry's price estimate -- N appointments require their own N
// card stacks. A CONSULTATION skips the gift-card requirement entirely
// (see below) -- it's an informal, no-commitment step, not a booked
// session. A client with no available card (or not enough of one) can't
// get a TATTOO_SESSION booked here; the error says so explicitly rather
// than a generic 400.
router.post("/", async (req, res) => {
  const body = req.body ?? {};

  const missing = ["artistId", "clientId", "startTime", "endTime", "inquiryId"].filter((field) => !body[field]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  const { artistId, clientId, startTime, endTime, notes, inquiryId, giftCardIds, plannedSessionId } = body;

  // Absent body field defaults to TATTOO_SESSION -- every pre-existing
  // caller (and every old cached frontend bundle) never sends this field
  // at all, so the same defensive default the schema itself uses keeps
  // them working unchanged.
  const appointmentType: AppointmentType =
    body.appointmentType === AppointmentType.CONSULTATION ? AppointmentType.CONSULTATION : AppointmentType.TATTOO_SESSION;
  const isConsultation = appointmentType === AppointmentType.CONSULTATION;

  if (
    !isConsultation &&
    (!Array.isArray(giftCardIds) || giftCardIds.length === 0 || !giftCardIds.every((v) => typeof v === "string"))
  ) {
    return res.status(400).json({ error: "giftCardIds must be a non-empty array of strings" });
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return res.status(400).json({ error: "startTime and endTime must be valid dates, with startTime before endTime" });
  }

  const [artist, client, inquiry] = await Promise.all([
    prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } }),
    prisma.client.findUnique({ where: { id: clientId } }),
    prisma.inquiry.findUnique({ where: { id: inquiryId }, include: { service: true } }),
  ]);

  // Artist mobility bug fix: the studio this appointment belongs to is
  // whichever studio the client/inquiry actually live at -- never assumed
  // to be req.user!.studioId, which for a guest artist (or a front desk
  // granting one appointments.create) is only their HOME studio and can
  // legitimately differ from the guest studio this booking is for. Every
  // studio-scoped lookup below (settings/timezone, buffer, gift-card
  // validation, the created row itself) uses this resolved studioId, not
  // the caller's own.
  if (!client || !inquiry || inquiry.clientId !== clientId || client.studioId !== inquiry.studioId) {
    return res.status(400).json({ error: "inquiryId must belong to this client in your studio" });
  }
  const studioId = client.studioId;

  if (!(await callerBelongsToStudio(req.user!, studioId))) {
    return res.status(400).json({ error: "clientId must belong to your studio" });
  }

  // Permission-context fix: evaluated against THIS studio (the client/
  // inquiry's own, resolved above), not req.user!.studioId -- a guest
  // artist's ability to create an appointment here follows the studio
  // they're actually booking into, never a grant that only exists at their
  // home studio (see lib/artistAccess.ts's own comment for the confirmed
  // exploit this closes).
  const createPermission = await hasPermissionOrSoloArtistAt(req.user!, studioId, "appointments.create");
  if (!createPermission.allowed) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const studioSettings = await prisma.studioSettings.findUnique({
    where: { studioId },
    select: { timezone: true, depositTiers: true, schedulingBufferMinutes: true },
  });
  if (!isSameCalendarDay(start, end, studioSettings?.timezone ?? "America/New_York")) {
    return res.status(400).json({ error: "An appointment cannot span more than one day" });
  }

  // Artist mobility, Part 2: a studio can also book its own active GUEST
  // artists, not just HOME ones -- the whole point of inviting a guest is
  // being able to actually assign them appointments here.
  const artistBelongsToStudio =
    artist != null && (artist.user.studioId === studioId || (await studioHasActiveMembership(studioId, artist.id)));
  if (!artistBelongsToStudio) {
    return res.status(400).json({ error: "artistId must belong to your studio" });
  }

  // Solo artist architecture, Phase 3: the bypass grants "manage YOUR OWN
  // appointments," not blanket appointments.create -- matters only in the
  // edge case of a solo-by-definition studio (no OWNER/FRONT_DESK) that
  // still has more than one ARTIST-role user, where it stops one solo
  // artist from booking onto a different artist's calendar. A studio that
  // explicitly granted ARTIST role this permission via the real Settings
  // matrix (req.viaSoloArtistBypass false in that case) is unaffected --
  // this only tightens the bypass path itself.
  if (createPermission.viaSoloArtistBypass && artist.userId !== req.user!.userId) {
    return res.status(403).json({ error: "As a solo artist, you can only create your own appointments" });
  }

  // Artist's own override (if set) takes precedence over the studio default.
  const bufferMs = resolveSchedulingBufferMs(artist.schedulingBufferMinutes, studioSettings?.schedulingBufferMinutes);

  // Multi-session planning: optional -- an appointment can still be booked
  // completely un-planned (ad hoc, or a project with no session plan at
  // all) exactly as before. When named, that planned session's own
  // estimatedHoursMin/Max is what the caller should have fed into the
  // scheduling-assistant duration target, not the inquiry's top-level
  // fields -- this route only validates and links it, the actual
  // duration-target selection happens client-side (AppointmentForm.tsx).
  let plannedSession: { id: string; inquiryId: string; appointmentId: string | null } | null = null;
  if (plannedSessionId !== undefined) {
    if (typeof plannedSessionId !== "string") {
      return res.status(400).json({ error: "plannedSessionId must be a string" });
    }
    plannedSession = await prisma.plannedSession.findUnique({
      where: { id: plannedSessionId },
      select: { id: true, inquiryId: true, appointmentId: true },
    });
    if (!plannedSession || plannedSession.inquiryId !== inquiryId) {
      return res.status(400).json({ error: "plannedSessionId must belong to this project's session plan" });
    }
    if (plannedSession.appointmentId) {
      return res.status(400).json({ error: "This planned session already has an appointment booked" });
    }
  }

  if (!isConsultation) {
    const requiredCents = resolveRequiredDepositCents(
      inquiry.service,
      inquiry.priceEstimateLow,
      inquiry.priceEstimateHigh,
      resolveDepositTiers(studioSettings?.depositTiers),
    );

    const giftCardResult = await validateGiftCardsForAttachment(giftCardIds, studioId, clientId, requiredCents);
    if ("error" in giftCardResult) {
      return res.status(400).json({
        error: `${giftCardResult.error} — collect a deposit or issue a gift card for this client first.`,
      });
    }
  }

  const appointment = await prisma.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        artistId,
        clientId,
        inquiryId,
        startTime: start,
        endTime: end,
        notes,
        studioId,
        status: AppointmentStatus.CONFIRMED,
        appointmentType,
      },
    });

    if (!isConsultation) {
      await Promise.all(
        giftCardIds.map((giftCardId: string) =>
          tx.giftCard.update({ where: { id: giftCardId }, data: { appointmentId: created.id } }),
        ),
      );
    }

    if (plannedSession) {
      await tx.plannedSession.update({ where: { id: plannedSession.id }, data: { appointmentId: created.id } });
    }

    return created;
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: appointment.id,
    action: "create",
    changes: {
      artistId,
      clientId,
      inquiryId,
      appointmentType,
      giftCardIds: isConsultation ? [] : giftCardIds,
      startTime: start,
      endTime: end,
      ...(plannedSession ? { plannedSessionId: plannedSession.id } : {}),
    },
  });

  const conflict = await findBufferConflict(artistId, start, end, appointment.id, bufferMs);

  emitInvalidation({ type: "appointment.changed", studioId });

  res.status(201).json({ ...appointment, bufferWarning: formatBufferWarning(conflict, bufferMs) });
});

// Optional ?start=&end= (ISO) scopes to a visible calendar range (Phase
// UI-5) via an interval-overlap query, on top of the existing filters --
// deliberately extending this route rather than adding a parallel one, so
// role scoping (ARTIST sees only their own) never has two places to get
// out of sync. Without a range, keeps the pre-Phase-UI-5 "latest 100"
// behavior (Sidebar's prefetch and any other no-range caller).
//
// Permission-context fix inventory: intentionally left on the plain,
// home-studio-scoped requirePermission rather than converted to the
// record-scoped helper below -- this is a multi-studio LIST (an ARTIST's
// results already span every studio in activeStudioIdsForCaller, home +
// every active guest, in one query), not a single record with one owning
// studio to check against. Converting properly would mean filtering that
// studio set down per-studio by hasPermission before querying, which would
// also change a staff caller's 403-on-denied into a 200-with-empty-list --
// a real behavior change this fix's own rule 4 (staff semantics unchanged)
// rules out doing casually. appointments.view defaults TRUE for ARTIST
// everywhere and overriding it off at exactly one of an artist's several
// studios is a narrow, unusual configuration -- flagged as a residual,
// low-severity (read-only) gap for a future pass, not fixed here.
const APPOINTMENT_LIST_INCLUDE = {
  artist: { select: { id: true, user: { select: { name: true, email: true, avatarUrl: true } } } },
  client: { select: { id: true, firstName: true, lastName: true } },
  inquiryProject: { select: { id: true, description: true } },
  // Derived status (Calendar/ClientDetail's status pills) needs this to
  // tell "Waiver Pending" apart from a plain CONFIRMED/REQUESTED --
  // checkedOutAt already comes through as a plain scalar column below.
  liabilityWaiver: { select: { status: true } },
} as const;

function shapeListAppointment<
  T extends {
    inquiryProject: { id: string; description: string } | null;
    artist: { id: string; user: { name: string | null; email: string; avatarUrl: string | null } };
  },
>({ inquiryProject, artist, ...rest }: T) {
  return {
    ...rest,
    artist: { id: artist.id, name: artist.user.name ?? artist.user.email, avatarUrl: artist.user.avatarUrl },
    inquiry: inquiryProject
      ? {
          id: inquiryProject.id,
          label:
            inquiryProject.description.length > 60
              ? `${inquiryProject.description.slice(0, 60).trimEnd()}…`
              : inquiryProject.description,
        }
      : null,
  };
}

router.get("/", requirePermission("appointments.view"), async (req, res) => {
  const { studioId, role, userId } = req.user!;
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
  const rangeStartRaw = typeof req.query.start === "string" ? new Date(req.query.start) : undefined;
  const rangeEndRaw = typeof req.query.end === "string" ? new Date(req.query.end) : undefined;
  const hasValidRange =
    rangeStartRaw && rangeEndRaw && !Number.isNaN(rangeStartRaw.getTime()) && !Number.isNaN(rangeEndRaw.getTime());
  const take = hasValidRange ? 500 : 100;

  // Staff-supplied filter (e.g. AppointmentForm's slot-suggestion feature
  // fetching just one artist's bookings) -- an ARTIST caller below always
  // overrides this with their own id regardless, so this only ever narrows
  // what OWNER/FRONT_DESK see, never widens an artist's own view.
  let artistId: string | undefined = typeof req.query.artistId === "string" ? req.query.artistId : undefined;
  // Artist mobility bug fix: an ARTIST's own calendar spans every studio
  // they CURRENTLY belong to (HOME + active GUESTs), not just home -- a
  // guest artist's own sessions booked at a GUEST studio have a different
  // appointment.studioId than home, so ANDing home studioId alone silently
  // dropped every one of them. But it must still be studio-scoped to
  // ACTIVE memberships, not dropped entirely: once a GUEST membership
  // ends, that studio's appointments must stop appearing on this artist's
  // calendar going forward, same as they'd stop appearing in the studio's
  // own Team roster (see the historical GET /artists roster bug this
  // matches) -- an ended relationship, not just a different one.
  let artistStudioIds: string[] | null = null;

  if (role === Role.ARTIST) {
    const artist = await prisma.artist.findUnique({ where: { userId } });

    if (!artist) {
      return res.json([]);
    }

    artistId = artist.id;
    artistStudioIds = await activeStudioIdsForCaller(req.user!);
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      ...(artistStudioIds ? { studioId: { in: artistStudioIds } } : { studioId }),
      ...NOT_ARCHIVED,
      ...(clientId ? { clientId } : {}),
      ...(artistId ? { artistId } : {}),
      ...(hasValidRange ? { startTime: { lt: rangeEndRaw! }, endTime: { gt: rangeStartRaw! } } : {}),
    },
    include: APPOINTMENT_LIST_INCLUDE,
    orderBy: { startTime: "asc" },
    take,
  });

  // Solo-guest fix (union, rule 1): this caller may ALSO be an artist with
  // active GUEST memberships elsewhere -- if so, blend in whatever's
  // assigned to them at those studios too, same "my calendar isn't blind
  // to my own guest work" precedent inquiries.ts's own GET / already
  // established. Gated on `!artistStudioIds` (the ARTIST-role branch above
  // already covers a plain artist caller in full) rather than on role, so
  // a solo studio-of-one's own OWNER account (which can have an Artist
  // profile too) isn't blind to their own guest-studio bookings just
  // because their home role isn't literally ARTIST. No-op for the
  // overwhelming majority of staff callers (no Artist row at all).
  let combined = appointments;
  if (!artistStudioIds) {
    const requestingArtist = await prisma.artist.findUnique({ where: { userId }, select: { id: true } });
    if (requestingArtist) {
      const guestMemberships = await prisma.studioMembership.findMany({
        where: { artistId: requestingArtist.id, type: "GUEST", endedAt: null },
        select: { studioId: true },
      });
      if (guestMemberships.length > 0) {
        const guestAppointments = await prisma.appointment.findMany({
          where: {
            studioId: { in: guestMemberships.map((m) => m.studioId) },
            artistId: requestingArtist.id,
            ...NOT_ARCHIVED,
            ...(clientId ? { clientId } : {}),
            ...(hasValidRange ? { startTime: { lt: rangeEndRaw! }, endTime: { gt: rangeStartRaw! } } : {}),
          },
          include: APPOINTMENT_LIST_INCLUDE,
          orderBy: { startTime: "asc" },
          take,
        });
        combined = [...appointments, ...guestAppointments]
          .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
          .slice(0, take);
      }
    }
  }

  res.json(combined.map(shapeListAppointment));
});

const APPOINTMENT_DETAIL_INCLUDE = {
  artist: { select: { id: true, user: { select: { email: true, name: true, avatarUrl: true } } } },
  // Embedded payments UX redesign: the payment takeover's identity line
  // ("Your session with {artist} at {studio}") needs the studio's own
  // name, which this include never fetched before now.
  studio: { select: { id: true, name: true } },
  // referralCode: surfaced in the checkout-complete panel so staff can
  // remind the client to share their own code right after the session --
  // reuses the code already generated at this client's own creation, not a
  // new code system (see referrals.ts).
  // phone/email added for the Send Waiver channel picker.
  // phones/emails (minimal -- just presence) for the send-channel picker's
  // real-contact-row availability check -- see routes/inquiries.ts's own
  // INQUIRY_INCLUDE comment for the full "legacy-singular" bug this closes.
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      referralCode: true,
      phone: true,
      email: true,
      phones: { select: { id: true } },
      emails: { select: { id: true } },
    },
  },
  // The project this session belongs to -- via inquiryId/inquiryProject, not
  // the older 1:1 `inquiry` back-relation (Inquiry.appointmentId), which is
  // a different, usually-null link left over from the original scheduling flow.
  // Package I: budget/reference/placement fields added so the appointment
  // detail page can surface project context inline, without navigating away.
  inquiryProject: {
    select: {
      id: true,
      description: true,
      clientId: true,
      colorOrBlackGrey: true,
      placement: true,
      budget: true,
      priceEstimateLow: true,
      priceEstimateHigh: true,
      referenceImages: true,
      placementImages: true,
      referenceImagesMeta: true,
      placementImagesMeta: true,
      // Multi-session planning: only its length is needed here (the "of Y"
      // in "Session X of Y") -- the specific session THIS appointment
      // fulfills comes from the top-level plannedSession select below.
      plannedSessions: { select: { id: true } },
    },
  },
  // Multi-session planning: null for every appointment on a project with
  // no session plan at all, or one booked outside the plan -- lets this
  // page show which specific session's hour estimate applies here instead
  // of a stale/generic top-level one (which is null anyway once a plan
  // exists -- see PlannedSession's own schema comment).
  plannedSession: { select: { sessionNumber: true, estimatedHoursMin: true, estimatedHoursMax: true } },
  giftCards: {
    select: { id: true, code: true, amountCents: true, status: true, expiresAt: true, exemptionReason: true },
  },
  checkedOutBy: { select: { id: true, name: true, email: true } },
  // Non-PII summary only -- the health data and ID image behind this
  // waiver live behind GET /waivers/:id, which is OWNER/FRONT_DESK only.
  liabilityWaiver: { select: { id: true, status: true, signedAt: true, verifiedAt: true } },
  // Package N: checkout/finished-tattoo photos for this one session,
  // newest first (most recently added at the top of the grid).
  photos: {
    select: { id: true, url: true, uploadedAt: true, uploadedBy: { select: { id: true, name: true, email: true } } },
    orderBy: { uploadedAt: "desc" },
  },
} as const;

router.get("/:id", async (req, res) => {
  const id = req.params.id as string;

  const appointment = await prisma.appointment.findUnique({ where: { id }, include: APPOINTMENT_DETAIL_INCLUDE });

  if (!appointment || !(await callerBelongsToStudio(req.user!, appointment.studioId))) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  // Permission-context fix: evaluated against the appointment's own
  // studio, not req.user!.studioId -- a guest artist's view rights follow
  // the studio the appointment actually lives at.
  if (!(await hasPermissionAt(req.user!, appointment.studioId, "appointments.view"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Gates the checkout-complete panel's "share your referral code" callout
  // -- default true (StudioSettings.referralProgramEnabled) matches every
  // studio's always-on behavior before this flag existed. Reads the
  // APPOINTMENT's own studio settings, not req.user!.studioId -- those
  // differ for a guest artist viewing an appointment at their guest studio.
  const studioSettings = await prisma.studioSettings.findUnique({
    where: { studioId: appointment.studioId },
    select: { referralProgramEnabled: true },
  });

  const { inquiryProject, plannedSession, studio, ...rest } = appointment;
  const { plannedSessions: projectPlannedSessions, ...inquiryProjectRest } = inquiryProject ?? {};
  const inquiry = inquiryProject && {
    ...inquiryProjectRest,
    referenceImagesDetail: await resolveImageMeta(inquiryProject.referenceImages, inquiryProject.referenceImagesMeta),
    placementImagesDetail: await resolveImageMeta(inquiryProject.placementImages, inquiryProject.placementImagesMeta),
  };
  res.json({
    ...rest,
    inquiry,
    studio,
    // Same fromGuestStudio convention as inquiries.ts's GET /assigned-to-me/:id
    // -- lets the frontend gate staff-only UI (AppointmentDetail.tsx's
    // canManage and its sibling OWNER-role checks) on whether this record
    // is actually AT the caller's home studio, not just their raw global
    // role. A solo owner-artist reaching a host studio's appointment only
    // via an active GUEST membership has a real OWNER role but no staff
    // standing there at all -- effectiveRoleAt already enforces this
    // server-side on every action; this closes the matching UI-visibility
    // gap (see CLAUDE.md's timezone/permission-context notes and REPORT.md).
    fromGuestStudio: studio.id !== req.user!.studioId ? studio : null,
    referralProgramEnabled: studioSettings?.referralProgramEnabled ?? true,
    plannedSession: plannedSession
      ? {
          sessionNumber: plannedSession.sessionNumber,
          estimatedHoursMin: plannedSession.estimatedHoursMin,
          estimatedHoursMax: plannedSession.estimatedHoursMax,
          totalSessions: projectPlannedSessions?.length ?? 0,
        }
      : null,
  });
});

// Archive: soft, reversible hide -- same treatment as Client.archivedAt /
// Inquiry.archivedAt.
router.post("/:id/archive", async (req, res) => {
  const id = req.params.id as string;
  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment || !(await callerBelongsToStudio(req.user!, appointment.studioId))) {
    return res.status(404).json({ error: "Appointment not found" });
  }
  const { allowed, viaSoloArtistBypass } = await hasPermissionOrSoloArtistAt(
    req.user!,
    appointment.studioId,
    "appointments.reschedule",
  );
  if (!allowed) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (viaSoloArtistBypass) {
    const ownArtist = await prisma.artist.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
    if (!ownArtist || appointment.artistId !== ownArtist.id) {
      return res.status(403).json({ error: "As a solo artist, you can only manage your own appointments" });
    }
  }
  if (appointment.archivedAt) {
    return res.json(appointment);
  }

  const updated = await prisma.appointment.update({ where: { id }, data: { archivedAt: new Date() } });

  await logAudit({
    studioId: appointment.studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "archive",
    changes: { archivedAt: updated.archivedAt },
  });

  emitInvalidation({ type: "appointment.changed", studioId: appointment.studioId });

  res.json(updated);
});

router.post("/:id/unarchive", async (req, res) => {
  const id = req.params.id as string;
  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment || !(await callerBelongsToStudio(req.user!, appointment.studioId))) {
    return res.status(404).json({ error: "Appointment not found" });
  }
  const { allowed, viaSoloArtistBypass } = await hasPermissionOrSoloArtistAt(
    req.user!,
    appointment.studioId,
    "appointments.reschedule",
  );
  if (!allowed) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (viaSoloArtistBypass) {
    const ownArtist = await prisma.artist.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
    if (!ownArtist || appointment.artistId !== ownArtist.id) {
      return res.status(403).json({ error: "As a solo artist, you can only manage your own appointments" });
    }
  }
  if (!appointment.archivedAt) {
    return res.json(appointment);
  }

  const updated = await prisma.appointment.update({ where: { id }, data: { archivedAt: null } });

  await logAudit({
    studioId: appointment.studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "unarchive",
    changes: { archivedAt: null },
  });

  emitInvalidation({ type: "appointment.changed", studioId: appointment.studioId });

  res.json(updated);
});

// Shared between the delete-preview (so the confirmation UI can show what
// will be detached/destroyed) and the audit snapshot written just before
// the actual DELETE below.
async function gatherAppointmentDeletionSummary(appointmentId: string) {
  const [waivers, giftCards, conversationTags, photos] = await Promise.all([
    prisma.liabilityWaiver.count({ where: { appointmentId } }),
    prisma.giftCard.findMany({
      where: { appointmentId },
      select: { id: true, code: true, amountCents: true, status: true },
    }),
    prisma.conversationTag.count({ where: { entityType: "Appointment", entityId: appointmentId } }),
    // Package N: no FK cascade -- these get destroyed along with the
    // appointment (a session photo has no life independent of its
    // session), so the confirmation UI needs to disclose that too.
    prisma.appointmentPhoto.count({ where: { appointmentId } }),
  ]);

  return {
    waivers,
    giftCardsToDetach: giftCards,
    conversationTags,
    photos,
  };
}

router.get("/:id/delete-preview", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment || appointment.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  const summary = await gatherAppointmentDeletionSummary(id);
  res.json(summary);
});

// True permanent delete -- OWNER only. Scoped to just this one appointment,
// same detach-don't-destroy philosophy as Inquiry's own delete route: a gift
// card attached here is the client's money, independent of this one
// session, so it's DETACHED (appointmentId -> null), never destroyed. The
// liability waiver, by contrast, has a required (non-nullable) appointmentId
// -- it cannot exist without this appointment, so it's deleted along with it.
router.delete("/:id", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const { confirm } = req.body ?? {};

  if (confirm !== "DELETE") {
    return res.status(400).json({ error: 'Type "DELETE" to confirm this action.' });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment || appointment.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  const summary = await gatherAppointmentDeletionSummary(id);

  await prisma.$transaction(async (tx) => {
    // Detach, don't destroy -- the client's money survives this delete.
    await tx.giftCard.updateMany({ where: { appointmentId: id }, data: { appointmentId: null } });

    await tx.liabilityWaiver.deleteMany({ where: { appointmentId: id } });
    await tx.conversationTag.deleteMany({ where: { entityType: "Appointment", entityId: id } });
    // No life independent of the session -- destroyed along with it,
    // same as the liability waiver above. FK is ON DELETE RESTRICT, so
    // this has to happen before the appointment delete below regardless.
    await tx.appointmentPhoto.deleteMany({ where: { appointmentId: id } });

    // Inquiry.appointmentId is an optional back-reference to this same
    // appointment (the older 1:1 "scheduled slot" link) -- null it before
    // deleting the appointment, or that FK blocks the delete below.
    await tx.inquiry.updateMany({ where: { appointmentId: id }, data: { appointmentId: null } });
    await tx.appointment.delete({ where: { id } });
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "permanently_deleted",
    changes: {
      appointment: { startTime: appointment.startTime, endTime: appointment.endTime, status: appointment.status },
      ...summary,
    },
  });

  emitInvalidation({ type: "appointment.changed", studioId: req.user!.studioId });

  res.json({ success: true, detachedGiftCards: summary.giftCardsToDetach });
});

// Day-of liability waiver: one per appointment, front desk creates it and
// hands the client the link; front desk later verifies the signed result
// against the client's physical ID (POST /waivers/:id/verify).
router.post("/:id/waiver", async (req, res) => {
  const id = req.params.id as string;
  const { autoSend, channel } = req.body ?? {};

  if (channel !== undefined && channel !== "SMS" && channel !== "EMAIL") {
    return res.status(400).json({ error: "channel must be SMS or EMAIL" });
  }

  const existing = await prisma.appointment.findUnique({
    where: { id },
    select: { studioId: true, liabilityWaiver: true, clientId: true, client: { select: { firstName: true } } },
  });
  if (existing?.liabilityWaiver) {
    return res.status(400).json({ error: "A waiver already exists for this appointment" });
  }
  if (!existing) {
    return res.status(404).json({ error: "Appointment not found" });
  }
  // Artist mobility bug fix: verify against the APPOINTMENT's own studio,
  // then pass THAT confirmed studioId through -- ensureLiabilityWaiver
  // trusts it as already-authenticated the same way generateAndSendDepositForm
  // does, and uses it for the created waiver's own studioId.
  if (!(await callerBelongsToStudio(req.user!, existing.studioId))) {
    return res.status(404).json({ error: "Appointment not found" });
  }
  const studioId = existing.studioId;

  // Permission-context fix: evaluated at the appointment's own studio.
  if (!(await hasPermissionAt(req.user!, studioId, "waivers.generate"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const result = await ensureLiabilityWaiver(id, studioId, req.user!.userId);

  if (!result.ok) {
    const status = result.error === "Appointment not found" ? 404 : 400;
    return res.status(status).json({ error: result.error });
  }

  // Auto-send through the same real-SMS path as the estimate auto-send --
  // same reasoning as the deposit-form route: "Create Waiver"/"Send
  // Waiver" across AppointmentDetail/ClientDetail otherwise generated a
  // link with no trace in Conversations. autoSend: false is the
  // composer's own create-then-insert-link flow opting out, same as
  // deposit-form.
  let waiverSendResult:
    | Awaited<ReturnType<typeof sendClientSms>>
    | Awaited<ReturnType<typeof sendClientEmail>>
    | null = null;
  if (autoSend !== false) {
    const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } });
    const waiverConversationId = (await getOrCreateClientConversation(studioId, existing.clientId, req.user!.userId))
      .conversation.id;
    const waiverMessage = `Hi ${existing.client.firstName}, please sign your liability waiver before your appointment with ${studio?.name ?? "our studio"}: ${result.signingUrl}`;
    waiverSendResult =
      channel === "EMAIL"
        ? await sendClientEmail({
            studioId,
            clientId: existing.clientId,
            conversationId: waiverConversationId,
            subject: `Please sign your waiver -- ${studio?.name ?? "our studio"}`,
            bodyText: waiverMessage,
            bodyHtml: renderClientEmailHtml({
              studioName: studio?.name ?? "Your studio",
              heading: "Please sign your liability waiver",
              bodyParagraphs: [`Hi ${existing.client.firstName}, please sign your liability waiver before your appointment.`],
              buttonText: "Sign waiver",
              buttonUrl: result.signingUrl,
            }),
            actorUserId: req.user!.userId,
            logAttemptEvenOnFailure: true,
          })
        : await sendClientSms({
            studioId,
            clientId: existing.clientId,
            conversationId: waiverConversationId,
            body: waiverMessage,
            actorUserId: req.user!.userId,
            logAttemptEvenOnFailure: true,
          });
  }

  emitInvalidation({ type: "appointment.changed", studioId });

  res.status(201).json({ ...result.waiver, signingUrl: result.signingUrl, waiverSendResult });
});

// Checkout: confirms the final cost with the artist, settles the deposit
// stack (a separate REDEEM-or-ROLL choice per attached card, not one
// choice for the whole stack), and records closeout notes. Every
// appointment should have at least one attached gift card, but the guard
// below still checks -- if it's somehow missing, that's a data problem to
// resolve manually rather than something to paper over.
router.post("/:id/checkout", async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};
  const { finalCostCents, decisions, closeoutNotes } = body;

  if (typeof finalCostCents !== "number" || !Number.isFinite(finalCostCents) || finalCostCents < 0) {
    return res.status(400).json({ error: "finalCostCents must be a non-negative number" });
  }

  if (
    !Array.isArray(decisions) ||
    decisions.some(
      (d) =>
        typeof d !== "object" ||
        d === null ||
        typeof d.giftCardId !== "string" ||
        (d.action !== "REDEEM" && d.action !== "ROLL"),
    )
  ) {
    return res.status(400).json({ error: "decisions must be an array of { giftCardId, action: 'REDEEM' | 'ROLL' }" });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id }, include: { giftCards: true } });

  // Artist mobility bug fix: verify against the APPOINTMENT's own studio,
  // then use THAT confirmed studioId for everything below (gift-card
  // validation/settlement, Stripe Connect account lookup) -- req.user!.studioId
  // is only the caller's HOME studio and would both wrongly 404 a
  // legitimately guest-assigned artist and, if merely relaxed, run the rest
  // of checkout against the wrong studio's settings/gift cards.
  if (!appointment || !(await callerBelongsToStudio(req.user!, appointment.studioId))) {
    return res.status(404).json({ error: "Appointment not found" });
  }
  const studioId = appointment.studioId;

  // Permission-context fix: evaluated at the appointment's own studio.
  if (!(await hasPermissionAt(req.user!, studioId, "appointments.checkout"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (appointment.appointmentType === AppointmentType.CONSULTATION) {
    return res.status(400).json({
      error: "Consultations don't go through financial checkout -- use POST /:id/complete-consultation instead.",
    });
  }

  if (appointment.checkedOutAt) {
    return res.status(400).json({ error: "This appointment has already been checked out" });
  }

  if (appointment.giftCards.length === 0) {
    return res.status(400).json({
      error:
        "This appointment has no attached gift card to redeem or roll. Every appointment should have one -- resolve this manually before checking out.",
    });
  }

  // An EXEMPT card has no real value to redeem or preserve -- it's always
  // detached (never redeemed) regardless of what the client sends, so it
  // stays EXEMPT and immediately reusable for this client's next
  // appointment. It's excluded from the REDEEM/ROLL choice entirely -- the
  // frontend never shows it in that list, and this route rejects a
  // decision that names one, rather than silently ignoring bad input.
  const exemptCards = appointment.giftCards.filter((c) => c.status === GiftCardStatus.EXEMPT);
  const decidableCards = appointment.giftCards.filter((c) => c.status !== GiftCardStatus.EXEMPT);

  const decisionByCardId = new Map<string, "REDEEM" | "ROLL">();
  for (const d of decisions as { giftCardId: string; action: "REDEEM" | "ROLL" }[]) {
    if (decisionByCardId.has(d.giftCardId)) {
      return res.status(400).json({ error: `Duplicate decision for gift card ${d.giftCardId}` });
    }
    decisionByCardId.set(d.giftCardId, d.action);
  }

  for (const [giftCardId] of decisionByCardId) {
    const card = appointment.giftCards.find((c) => c.id === giftCardId);
    if (!card) {
      return res.status(400).json({ error: `Gift card ${giftCardId} is not attached to this appointment` });
    }
    if (card.status === GiftCardStatus.EXEMPT) {
      return res
        .status(400)
        .json({ error: `Gift card ${giftCardId} is an EXEMPT card and is never redeemed or rolled explicitly` });
    }
  }

  const missingDecision = decidableCards.find((c) => !decisionByCardId.has(c.id));
  if (missingDecision) {
    return res.status(400).json({ error: `Missing a REDEEM/ROLL decision for gift card ${missingDecision.id}` });
  }

  const redeemedCards = decidableCards.filter((c) => decisionByCardId.get(c.id) === "REDEEM");
  const rolledCards = decidableCards.filter((c) => decisionByCardId.get(c.id) === "ROLL");

  const redeemedTotalCents = redeemedCards.reduce((sum, c) => sum + c.amountCents, 0);
  const amountDueCents = Math.max(0, finalCostCents - redeemedTotalCents);
  const overageCents = Math.max(0, redeemedTotalCents - finalCostCents);

  // Resolved before the transaction, same established pattern as every
  // other gift-card issuance in this codebase (routes/deposits.ts,
  // routes/giftCards.ts) -- generateUniqueGiftCardCode does its own
  // uniqueness-checking DB read, which shouldn't run inside a transaction
  // it doesn't need to be part of.
  const [studioSettings, overageCode] = await Promise.all([
    prisma.studioSettings.findUnique({ where: { studioId }, select: { giftCardDefaultExpirationDays: true, embeddedPaymentsEnabled: true } }),
    overageCents > 0 ? generateUniqueGiftCardCode() : Promise.resolve(null),
  ]);

  const { updated, newGiftCard } = await prisma.$transaction(async (tx) => {
    for (const card of redeemedCards) {
      await tx.giftCard.update({
        where: { id: card.id },
        data: { status: GiftCardStatus.REDEEMED, redeemedAt: new Date() },
      });
    }
    for (const card of [...rolledCards, ...exemptCards]) {
      await tx.giftCard.update({ where: { id: card.id }, data: { appointmentId: null } });
    }

    // Overage becomes ONE new gift card for the combined leftover -- not
    // one per redeemed card -- reusing the exact same issuance shape every
    // other gift card in this codebase is created with (code, studio-
    // default expiration, issuedById), just fed the combined sum.
    //
    // derivedFromGiftCardId is a single nullable FK, so it can only ever
    // point at ONE origin card -- set it when exactly one card was
    // redeemed (the common case this field exists for), left null when
    // multiple redeemed cards combine into the overage, since there's no
    // single "the" origin in that case. The audit entry below always
    // records every contributing card id regardless, so the multi-card
    // case is still fully traceable, just not via this FK.
    let newGiftCard = null;
    if (overageCents > 0 && overageCode) {
      newGiftCard = await tx.giftCard.create({
        data: {
          studioId,
          clientId: appointment.clientId,
          code: overageCode,
          amountCents: overageCents,
          expiresAt: computeGiftCardExpiration(studioSettings?.giftCardDefaultExpirationDays ?? null),
          issuedById: req.user!.userId,
          derivedFromGiftCardId: redeemedCards.length === 1 ? redeemedCards[0].id : null,
          // Same single-origin-only reasoning as derivedFromGiftCardId
          // right above -- this leftover value isn't a fresh payment, it's
          // carried forward from whichever card(s) it came from, so
          // inherit the origin's own paymentMethod when there's exactly
          // one unambiguous origin to inherit from. Left unset (not
          // fabricated) when multiple redeemed cards combine, same as
          // derivedFromGiftCardId going null in that case.
          paymentMethod: redeemedCards.length === 1 ? redeemedCards[0].paymentMethod : null,
        },
      });
    }

    const updated = await tx.appointment.update({
      where: { id },
      data: {
        finalCostCents,
        closeoutNotes: typeof closeoutNotes === "string" && closeoutNotes.trim() ? closeoutNotes.trim() : null,
        checkedOutAt: new Date(),
        checkedOutById: req.user!.userId,
        status: AppointmentStatus.COMPLETED,
      },
    });

    return { updated, newGiftCard };
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "checkout",
    changes: {
      finalCostCents,
      decisions: decidableCards.map((c) => ({ giftCardId: c.id, action: decisionByCardId.get(c.id) })),
      exemptGiftCardIds: exemptCards.map((c) => c.id),
      redeemedTotalCents,
      amountDueCents,
      ...(overageCents > 0
        ? { overageCents, newGiftCardId: newGiftCard?.id, derivedFromGiftCardId: newGiftCard?.derivedFromGiftCardId ?? null }
        : {}),
    },
  });

  // One audit entry per affected card, keyed to that card's own id -- this
  // is what GiftCardDetail's own AuditTrail (entityType: "GiftCard",
  // entityId: card.id) reads, so each card's individual history stays
  // legible even though the decision was made as part of one combined
  // checkout. This is IN ADDITION to (not a per-card duplicate of) the
  // single combined Appointment-level entry above.
  for (const card of redeemedCards) {
    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      entityType: "GiftCard",
      entityId: card.id,
      action: "redeemed",
      changes: {
        status: { from: card.status, to: GiftCardStatus.REDEEMED },
        appointmentId: id,
        finalCostCents,
        redeemedTotalCents,
      },
    });
  }
  for (const card of rolledCards) {
    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      entityType: "GiftCard",
      entityId: card.id,
      action: "rollover",
      changes: { fromAppointmentId: id, toAppointmentId: null, reason: "checkout_roll" },
    });
  }
  for (const card of exemptCards) {
    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      entityType: "GiftCard",
      entityId: card.id,
      action: "rollover",
      changes: { fromAppointmentId: id, toAppointmentId: null, reason: "exempt_card_detach" },
    });
  }

  // The new overage card's own audit trail entry -- separate from the
  // per-redeemed-card "redeemed" entries above, this is the new card's
  // FIRST entry, recording where it came from and for how much (both
  // amounts: what was redeemed and what carried over as the new card).
  if (newGiftCard) {
    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      entityType: "GiftCard",
      entityId: newGiftCard.id,
      action: "issued_from_overage",
      changes: {
        derivedFromGiftCardId: newGiftCard.derivedFromGiftCardId,
        redeemedTotalCents,
        finalCostCents,
        overageCents,
        appointmentId: id,
      },
    });
  }

  // Real charge for the remaining balance (Part 3), same direct-charge +
  // application-fee pattern as the deposit checkout session (Part 2).
  // Checkout itself is already complete at this point regardless of
  // whether this succeeds -- collecting the amount due is a separate,
  // decoupled concern from "the session happened and is in the books,"
  // same reasoning as why the manual mark-as-charged fallback below can
  // apply after the fact. A studio without Stripe connected, or an
  // appointment with nothing left to pay, gets no checkout session and no
  // change in behavior from before this feature existed.
  let checkoutUrl: string | null = null;
  let stripeCheckoutSessionId: string | null = null;
  // Embedded payments migration: when the studio has the flag on, hand the
  // staff UI a PaymentIntent client secret to mount inline instead of a
  // Checkout Session URL to open in a new tab -- same "have the client pay
  // on a device now" moment, just without leaving this page to do it.
  let paymentIntentClientSecret: string | null = null;
  let paymentIntentConnectedAccountId: string | null = null;
  if (amountDueCents > 0) {
    const stripeAccountId = await getChargeableConnectedAccountId(studioId);
    if (stripeAccountId) {
      if (studioSettings?.embeddedPaymentsEnabled) {
        try {
          const intent = await createOrRetrieveDirectChargePaymentIntent({
            connectedAccountId: stripeAccountId,
            existingPaymentIntentId: appointment.stripePaymentIntentId,
            amountCents: amountDueCents,
            // No tip has been chosen yet at this point (that only happens
            // in the /tip step below, once the client-facing takeover is
            // showing) -- fee basis equals the charge amount here, same as
            // before this param became explicit.
            applicationFeeCents: computeApplicationFeeCents(amountDueCents),
            metadata: { appointmentId: id },
          });
          await prisma.appointment.update({
            where: { id },
            data: { stripePaymentIntentId: intent.id },
          });
          paymentIntentClientSecret = intent.clientSecret;
          paymentIntentConnectedAccountId = stripeAccountId;
        } catch (err) {
          console.error("[appointments/checkout] Failed to create Stripe PaymentIntent", {
            appointmentId: id,
            error: err instanceof Error ? err.message : err,
          });
        }
      } else {
        try {
          const session = await createDirectChargeCheckoutSession({
            connectedAccountId: stripeAccountId,
            amountCents: amountDueCents,
            productName: "Tattoo session balance",
            successUrl: `${PUBLIC_APP_URL}/appointments/pay-complete?status=success`,
            cancelUrl: `${PUBLIC_APP_URL}/appointments/pay-complete?status=canceled`,
            metadata: { appointmentId: id },
          });
          await prisma.appointment.update({
            where: { id },
            data: { stripeCheckoutSessionId: session.id },
          });
          checkoutUrl = session.url;
          stripeCheckoutSessionId = session.id;
        } catch (err) {
          console.error("[appointments/checkout] Failed to create Stripe Checkout Session", {
            appointmentId: id,
            error: err instanceof Error ? err.message : err,
          });
        }
      }
    }
  }

  // Real-time audit (Part 2): checkout is the single biggest silent
  // mutation found in this file -- it finalizes the appointment (status ->
  // COMPLETED), redeems/rolls every attached gift card, and can issue a
  // brand-new overage card, none of which was ever broadcast before this.
  emitInvalidation({ type: "appointment.changed", studioId });
  emitInvalidation({ type: "giftcard.changed", studioId, clientId: appointment.clientId });

  res.json({
    ...updated,
    stripeCheckoutSessionId,
    amountDueCents,
    overageCents,
    newGiftCard,
    checkoutUrl,
    paymentIntentClientSecret,
    paymentIntentConnectedAccountId,
  });
});

// Embedded payments UX redesign: the client-facing tip step, shown between
// the amount/identity screen and the payment method screen on the payment
// takeover overlay -- session checkout only (no tip on deposits/flash).
// Tip is computed by the frontend as a percentage of finalCostCents (the
// session subtotal), but this route re-derives every dollar amount itself
// server-side rather than trusting anything the client sends beyond the
// raw tipCents choice, same "no client-supplied charge amounts" rule the
// rest of this Stripe integration follows. Can be called more than once
// (a client changing their tip selection before confirming payment) --
// createOrRetrieveDirectChargePaymentIntent's own reuse-and-update path
// handles that without piling up abandoned PaymentIntents.
router.post("/:id/tip", async (req, res) => {
  const id = req.params.id as string;
  const tipCentsInput = (req.body ?? {}).tipCents;

  if (typeof tipCentsInput !== "number" || !Number.isInteger(tipCentsInput) || tipCentsInput < 0) {
    return res.status(400).json({ error: "tipCents must be a non-negative integer number of cents" });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id }, include: { giftCards: true } });
  if (!appointment || !(await callerBelongsToStudio(req.user!, appointment.studioId))) {
    return res.status(404).json({ error: "Appointment not found" });
  }
  const studioId = appointment.studioId;

  // Permission-context fix: evaluated at the appointment's own studio, same
  // as every other checkout-adjacent route in this file.
  if (!(await hasPermissionAt(req.user!, studioId, "appointments.checkout"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!appointment.checkedOutAt || appointment.finalCostCents == null) {
    return res.status(400).json({ error: "This appointment hasn't been checked out yet" });
  }
  if (appointment.paidVia) {
    return res.status(400).json({ error: "This appointment's balance has already been paid" });
  }

  // Tipping only exists on the embedded (Payment Element) path -- same gate
  // deposits.ts/flashPayments.ts/POST :id/checkout already apply before
  // touching Stripe. In practice the frontend only reaches this step after
  // /checkout already returned a PaymentIntent (itself flag-gated), but this
  // route is reachable directly, so it re-checks rather than trusting that.
  const studioSettings = await prisma.studioSettings.findUnique({ where: { studioId }, select: { embeddedPaymentsEnabled: true } });
  if (!studioSettings?.embeddedPaymentsEnabled) {
    return res.status(400).json({ error: "Embedded payment isn't enabled for this studio." });
  }

  // Generous abuse guardrail, not a real-world ceiling -- blocks a
  // manipulated/runaway tipCents value before it ever reaches Stripe.
  const tipCapCents = appointment.finalCostCents * 3;
  if (tipCentsInput > tipCapCents) {
    return res.status(400).json({ error: `tipCents cannot exceed ${tipCapCents}` });
  }

  // Same redeemed-cards derivation POST /:id/checkout and
  // PATCH /:id/mark-charged already use -- never trust a client-sent
  // subtotal for the platform fee basis.
  const redeemedTotalCents = appointment.giftCards.reduce((sum, c) => sum + c.amountCents, 0);
  const amountDueCents = Math.max(0, appointment.finalCostCents - redeemedTotalCents);
  const amountCents = amountDueCents + tipCentsInput;

  await prisma.appointment.update({ where: { id }, data: { tipCents: tipCentsInput } });
  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "tip_selected",
    changes: { tipCents: tipCentsInput, amountDueCents, amountCents },
  });

  if (amountCents <= 0) {
    emitInvalidation({ type: "appointment.changed", studioId });
    return res.json({
      tipCents: tipCentsInput,
      amountDueCents,
      amountCents,
      paymentIntentClientSecret: null,
      paymentIntentConnectedAccountId: null,
    });
  }

  const stripeAccountId = await getChargeableConnectedAccountId(studioId);
  if (!stripeAccountId) {
    return res.status(400).json({ error: "Online payment isn't available for this studio right now." });
  }

  try {
    // Reuses the (tip-less) PaymentIntent /:id/checkout already created
    // when amountDueCents > 0, updating its amount to include the tip --
    // or creates fresh if amountDueCents was 0 at checkout time. Fee basis
    // stays amountDueCents (pre-tip) regardless -- the platform takes no
    // cut of tips.
    const intent = await createOrRetrieveDirectChargePaymentIntent({
      connectedAccountId: stripeAccountId,
      existingPaymentIntentId: appointment.stripePaymentIntentId,
      amountCents,
      applicationFeeCents: computeApplicationFeeCents(amountDueCents),
      metadata: { appointmentId: id, tipCents: String(tipCentsInput) },
    });
    if (intent.id !== appointment.stripePaymentIntentId) {
      await prisma.appointment.update({ where: { id }, data: { stripePaymentIntentId: intent.id } });
    }

    emitInvalidation({ type: "appointment.changed", studioId });

    res.json({
      tipCents: tipCentsInput,
      amountDueCents,
      amountCents,
      paymentIntentClientSecret: intent.clientSecret,
      paymentIntentConnectedAccountId: stripeAccountId,
    });
  } catch (err) {
    console.error("[appointments/tip] Failed to create/update Stripe PaymentIntent", {
      appointmentId: id,
      error: err instanceof Error ? err.message : err,
    });
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to start payment" });
  }
});

// Manual fallback for collecting the amount due at checkout -- cash/comp,
// or Stripe simply isn't connected for this studio. Same paidVia labeling
// convention as deposits (routes/deposits.ts's mark-paid): this sets
// "MANUAL", the webhook-driven Stripe path sets "STRIPE", already-paid
// (either way) is a 400 rather than a silent no-op re-charge.
router.patch("/:id/mark-charged", async (req, res) => {
  const id = req.params.id as string;

  const appointment = await prisma.appointment.findUnique({ where: { id }, include: { giftCards: true } });
  if (!appointment || !(await callerBelongsToStudio(req.user!, appointment.studioId))) {
    return res.status(404).json({ error: "Appointment not found" });
  }
  const studioId = appointment.studioId;

  // Permission-context fix: evaluated at the appointment's own studio.
  if (!(await hasPermissionAt(req.user!, studioId, "appointments.checkout"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!appointment.checkedOutAt || appointment.finalCostCents == null) {
    return res.status(400).json({ error: "This appointment hasn't been checked out yet" });
  }
  if (appointment.paidVia) {
    return res.status(400).json({ error: "This appointment's balance has already been marked paid" });
  }

  // Same as the checkout route's own read: REDEEMED cards stay attached
  // (appointmentId untouched) post-checkout, ROLL/EXEMPT cards were
  // detached -- so appointment.giftCards is exactly the redeemed set.
  const redeemedTotalCents = appointment.giftCards.reduce((sum, c) => sum + c.amountCents, 0);
  const amountDueCents = Math.max(0, appointment.finalCostCents - redeemedTotalCents);
  if (amountDueCents <= 0) {
    return res.status(400).json({ error: "There's no remaining balance on this appointment to mark as charged" });
  }

  const updated = await prisma.appointment.update({
    where: { id },
    data: { paidVia: "MANUAL" },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "marked_charged_manually",
    changes: { paidVia: { from: null, to: "MANUAL" }, amountDueCents },
  });

  emitInvalidation({ type: "appointment.changed", studioId });

  res.json(updated);
});

// Lightweight counterpart to /:id/checkout for a CONSULTATION -- same
// completion fields (checkedOutAt/checkedOutById/closeoutNotes/status),
// same permission, but none of the financial machinery: no finalCostCents,
// no gift-card redeem/roll decisions, no overage card issuance. A
// consultation never has an attached gift card to begin with (see POST /
// above), so there's nothing to reconcile here.
router.post("/:id/complete-consultation", async (req, res) => {
  const id = req.params.id as string;
  const { notes } = req.body ?? {};

  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return res.status(400).json({ error: "notes must be a string" });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id } });

  if (!appointment || !(await callerBelongsToStudio(req.user!, appointment.studioId))) {
    return res.status(404).json({ error: "Appointment not found" });
  }
  const studioId = appointment.studioId;

  // Permission-context fix: evaluated at the appointment's own studio.
  if (!(await hasPermissionAt(req.user!, studioId, "appointments.checkout"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (appointment.appointmentType !== AppointmentType.CONSULTATION) {
    return res.status(400).json({
      error: "This isn't a consultation -- use POST /:id/checkout for a tattoo session instead.",
    });
  }

  if (appointment.checkedOutAt) {
    return res.status(400).json({ error: "This consultation has already been marked complete" });
  }

  const updated = await prisma.appointment.update({
    where: { id },
    data: {
      closeoutNotes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
      checkedOutAt: new Date(),
      checkedOutById: req.user!.userId,
      status: AppointmentStatus.COMPLETED,
    },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "complete-consultation",
    changes: { closeoutNotes: updated.closeoutNotes },
  });

  emitInvalidation({ type: "appointment.changed", studioId });

  res.json(updated);
});

// Package N: finished-tattoo (or other checkout-time) photos for this
// session. Reuses the existing Cloudinary signed-upload flow (same as
// intake reference/placement images) -- the client uploads directly to
// Cloudinary first (via GET /uploads/appointment-photo-signature) and only
// POSTs here with the resulting secure_url(s) to persist. Deliberately
// optional and separate from checkout itself: staff can attach photos
// while checking out, skip entirely, or come back later from this same
// route once the appointment is already COMPLETED -- no status
// requirement here, since "forgot at checkout" is exactly the case this
// needs to keep working for.
router.post("/:id/photos", async (req, res) => {
  const id = req.params.id as string;
  const { urls } = req.body ?? {};

  if (!Array.isArray(urls) || urls.length === 0 || !urls.every((u) => typeof u === "string" && u.trim().length > 0)) {
    return res.status(400).json({ error: "urls must be a non-empty array of strings" });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id }, select: { studioId: true } });
  if (!appointment || !(await callerBelongsToStudio(req.user!, appointment.studioId))) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  // Permission-context fix: evaluated at the appointment's own studio.
  if (!(await hasPermissionAt(req.user!, appointment.studioId, "appointments.photos.manage"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const photos = await prisma.$transaction(
    (urls as string[]).map((url) =>
      prisma.appointmentPhoto.create({
        data: { appointmentId: id, url: url.trim(), uploadedById: req.user!.userId },
        include: { uploadedBy: { select: { id: true, name: true, email: true } } },
      }),
    ),
  );

  await logAudit({
    studioId: appointment.studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "photos_added",
    changes: { count: photos.length, photoIds: photos.map((p) => p.id) },
  });

  emitInvalidation({ type: "appointment.changed", studioId: appointment.studioId });

  res.status(201).json(photos);
});

router.delete("/:id/photos/:photoId", async (req, res) => {
  const id = req.params.id as string;
  const photoId = req.params.photoId as string;

  const photo = await prisma.appointmentPhoto.findUnique({
    where: { id: photoId },
    include: { appointment: { select: { studioId: true } } },
  });

  if (!photo || photo.appointmentId !== id || !(await callerBelongsToStudio(req.user!, photo.appointment.studioId))) {
    return res.status(404).json({ error: "Photo not found" });
  }

  // Permission-context fix: evaluated at the photo's own appointment's studio.
  if (!(await hasPermissionAt(req.user!, photo.appointment.studioId, "appointments.photos.manage"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await prisma.appointmentPhoto.delete({ where: { id: photoId } });

  await logAudit({
    studioId: photo.appointment.studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "photo_deleted",
    changes: { photoId, url: photo.url },
  });

  emitInvalidation({ type: "appointment.changed", studioId: photo.appointment.studioId });

  res.json({ success: true });
});

// Handles both a plain status change (the pre-existing behavior) and a
// time/day reschedule (Phase UI-4 groundwork -- Phase UI-5's calendar
// drag-and-drop is the first real caller of the latter, via this same
// route, never a bespoke calendar-only endpoint). At least one of
// status/startTime+endTime must be present.
//
// appointments.reschedule is this route's (and archive/unarchive's) shared
// successor to the retired appointments.manage key -- all three used that
// exact same key before this expansion, so folding them into one new key
// keeps their access identical rather than inventing a key the task's own
// list didn't ask for.
router.patch("/:id", async (req, res) => {
  const id = req.params.id as string;
  const { status, startTime, endTime } = req.body ?? {};

  if (status === undefined && startTime === undefined && endTime === undefined) {
    return res.status(400).json({ error: "status or startTime/endTime is required" });
  }

  if (status !== undefined && !Object.values(AppointmentStatus).includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${Object.values(AppointmentStatus).join(", ")}` });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id } });

  if (!appointment || !(await callerBelongsToStudio(req.user!, appointment.studioId))) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  const { allowed, viaSoloArtistBypass } = await hasPermissionOrSoloArtistAt(
    req.user!,
    appointment.studioId,
    "appointments.reschedule",
  );
  if (!allowed) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (viaSoloArtistBypass) {
    const ownArtist = await prisma.artist.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
    if (!ownArtist || appointment.artistId !== ownArtist.id) {
      return res.status(403).json({ error: "As a solo artist, you can only manage your own appointments" });
    }
  }

  const data: { status?: AppointmentStatus; startTime?: Date; endTime?: Date } = {};
  let bufferMs = DEFAULT_SCHEDULING_BUFFER_MS;

  if (status !== undefined) {
    data.status = status;
  }

  if (startTime !== undefined || endTime !== undefined) {
    if (startTime === undefined || endTime === undefined) {
      return res.status(400).json({ error: "startTime and endTime must be provided together" });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      return res
        .status(400)
        .json({ error: "startTime and endTime must be valid dates, with startTime before endTime" });
    }

    const [studioSettingsForDayCheck, artistForBuffer] = await Promise.all([
      prisma.studioSettings.findUnique({
        where: { studioId: appointment.studioId },
        select: { timezone: true, schedulingBufferMinutes: true },
      }),
      // artistId is never accepted by this route (see comment below), so
      // the appointment's existing, unchanged artist is always the right
      // one to check for an override.
      prisma.artist.findUnique({ where: { id: appointment.artistId }, select: { schedulingBufferMinutes: true } }),
    ]);
    if (!isSameCalendarDay(start, end, studioSettingsForDayCheck?.timezone ?? "America/New_York")) {
      return res.status(400).json({ error: "An appointment cannot span more than one day" });
    }
    bufferMs = resolveSchedulingBufferMs(
      artistForBuffer?.schedulingBufferMinutes,
      studioSettingsForDayCheck?.schedulingBufferMinutes,
    );

    data.startTime = start;
    data.endTime = end;
  }

  const updated = await prisma.appointment.update({ where: { id }, data });

  await logAudit({
    studioId: appointment.studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "update",
    changes: diffObjects(appointment, data, ["status", "startTime", "endTime"]),
  });

  // artistId is never accepted by this route (see comment above) -- a
  // reassignment can't happen through this call, so the buffer check below
  // always reflects the appointment's existing, unchanged artist.
  const conflict =
    data.startTime && data.endTime
      ? await findBufferConflict(updated.artistId, data.startTime, data.endTime, id, bufferMs)
      : null;

  emitInvalidation({ type: "appointment.changed", studioId: appointment.studioId });

  res.json({ ...updated, bufferWarning: formatBufferWarning(conflict, bufferMs) });
});

// Front-desk approval, Part 2: the confirm side of the client self-
// scheduling flow -- a client picking their own time only ever creates a
// REQUESTED appointment (see selfSchedule.ts's own respond route), staff
// still has to actively confirm it. One step from the staff's
// perspective: re-checks the buffer/conflict window fresh (time has
// passed since the request -- another appointment could have taken it),
// flips REQUESTED -> CONFIRMED, links it as the Inquiry's own singular
// appointmentId (same field POST /inquiries/:id/schedule sets for the
// classic flow -- see lib/deposits.ts's own alreadyBooked comment for why
// this matters), and generates + sends the deposit form through the EXACT
// same mechanism (lib/deposits.ts's generateAndSendDepositForm) staff's
// existing manual "Send Deposit Form" button already uses -- same link,
// same real-SMS auto-send, same Conversations logging. That manual button
// stays completely untouched as a backup if this ever needs a retry.
//
// Same hasPermissionOrSoloArtistAt("appointments.reschedule") gate as
// PATCH /:id above -- reusing the existing scheduling-related matrix key
// rather than inventing a new one, per this feature's own spec. A studio
// that hasn't granted an ARTIST scheduling rights still can't approve
// anything; a genuine solo studio's own artist still can, same exception
// PATCH /:id already relies on -- evaluated at the appointment's own
// studio (permission-context fix), not the caller's home.
router.post("/:id/approve", async (req, res) => {
  const id = req.params.id as string;

  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment || !(await callerBelongsToStudio(req.user!, appointment.studioId))) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  const { allowed, viaSoloArtistBypass } = await hasPermissionOrSoloArtistAt(
    req.user!,
    appointment.studioId,
    "appointments.reschedule",
  );
  if (!allowed) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (viaSoloArtistBypass) {
    const ownArtist = await prisma.artist.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
    if (!ownArtist || appointment.artistId !== ownArtist.id) {
      return res.status(403).json({ error: "As a solo artist, you can only manage your own appointments" });
    }
  }

  if (appointment.status !== AppointmentStatus.REQUESTED) {
    return res.status(400).json({ error: "Only a requested appointment can be approved" });
  }

  const inquiry = await prisma.inquiry.findUnique({
    where: { id: appointment.inquiryId },
    select: { id: true, appointmentId: true, priceEstimateLow: true, priceEstimateHigh: true },
  });
  if (!inquiry) {
    return res.status(404).json({ error: "This appointment's project was not found" });
  }

  // Checked BEFORE any mutation -- approving an appointment whose deposit
  // form can't actually be generated (missing price estimate; extremely
  // rare, but possible: PATCH /estimates/respond/:token never strictly
  // required one) would leave a CONFIRMED appointment with no way for the
  // client to pay, exactly the "stalled process" this feature exists to
  // fix. Staff fixes the price (e.g. via Revise Estimate) and retries.
  if (inquiry.priceEstimateLow == null || inquiry.priceEstimateHigh == null) {
    return res.status(400).json({ error: "This inquiry is missing a price estimate -- add one before approving" });
  }

  const [studioSettings, artist] = await Promise.all([
    prisma.studioSettings.findUnique({
      where: { studioId: appointment.studioId },
      select: { schedulingBufferMinutes: true },
    }),
    prisma.artist.findUnique({ where: { id: appointment.artistId }, select: { schedulingBufferMinutes: true } }),
  ]);
  const bufferMs = resolveSchedulingBufferMs(artist?.schedulingBufferMinutes, studioSettings?.schedulingBufferMinutes);

  // The client's slot was checked for conflicts at the moment they picked
  // it (selfSchedule.ts's own respond route) -- re-checked here too, since
  // staff may not act on this task right away and another appointment for
  // the same artist could have been booked in the meantime. Excludes this
  // appointment itself so it never conflicts with its own row.
  const conflict = await findBufferConflict(appointment.artistId, appointment.startTime, appointment.endTime, id, bufferMs);
  if (conflict) {
    return res.status(409).json({
      error: "This time is no longer available -- another appointment now conflicts with it. Decline this request so the client can pick a new time, or reschedule it manually.",
    });
  }

  const [updated] = await prisma.$transaction([
    prisma.appointment.update({ where: { id }, data: { status: AppointmentStatus.CONFIRMED } }),
    ...(inquiry.appointmentId == null
      ? [prisma.inquiry.update({ where: { id: inquiry.id }, data: { appointmentId: id } })]
      : []),
  ]);

  await logAudit({
    studioId: appointment.studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "approve_requested_appointment",
    changes: { status: AppointmentStatus.CONFIRMED },
  });

  emitInvalidation({ type: "appointment.changed", studioId: appointment.studioId });
  emitInvalidation({ type: "inquiry.updated", studioId: appointment.studioId, inquiryId: inquiry.id });

  const depositResult = await generateAndSendDepositForm(inquiry.id, {
    studioId: appointment.studioId,
    actorUserId: req.user!.userId,
    proposedStartAt: updated.startTime.toISOString(),
    proposedEndAt: updated.endTime.toISOString(),
  });

  if (!depositResult.ok) {
    // The appointment is already confirmed regardless (price was
    // pre-validated above, so this branch should only ever be reached by a
    // genuine, unexpected failure) -- surface it separately rather than
    // rolling back a real confirmation, same best-effort philosophy as the
    // deposit form's own SMS send. Staff still has the manual "Send
    // Deposit Form" button as a backup.
    return res.status(200).json({ appointment: updated, depositForm: null, depositFormError: depositResult.error });
  }

  res.json({
    appointment: updated,
    depositForm: depositResult.depositForm,
    depositUrl: depositResult.depositUrl,
    depositSendResult: depositResult.depositSendResult,
  });
});

// Front-desk approval, Part 2: the decline side -- the requested time
// doesn't work (already covered by another appointment, artist's not
// actually available then, etc.). Cancels the request and, reusing the
// exact selfScheduleToken/previousSelfScheduleToken mechanism Bug B's
// token-lifecycle fix established (see estimates.ts's PROCEED branch and
// inquiries.ts's revise-estimate resend branch), reopens self-scheduling
// with a fresh link so the client can pick a different time -- without
// this, selfScheduleBookedAt would stay permanently set from their first
// (now-declined) pick and every self-schedule route would keep reporting
// "already booked" forever. Deliberately NOT a call to POST
// /inquiries/:id/revise-estimate -- that route is for an actual price/
// hours change and sends an SMS saying so ("the estimate ... has been
// updated to $X-$Y"), which would be a wrong, confusing message here
// where nothing about the estimate itself changed.
router.post("/:id/decline", async (req, res) => {
  const id = req.params.id as string;
  const { reason } = req.body ?? {};

  if (typeof reason !== "string" || reason.trim().length === 0) {
    return res.status(400).json({ error: "A reason is required to decline a requested appointment" });
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: {
      inquiryProject: {
        include: {
          client: { select: { firstName: true } },
          assignedArtist: { select: { allowsClientSelfScheduling: true } },
        },
      },
    },
  });
  if (!appointment || !(await callerBelongsToStudio(req.user!, appointment.studioId))) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  const { allowed, viaSoloArtistBypass } = await hasPermissionOrSoloArtistAt(
    req.user!,
    appointment.studioId,
    "appointments.reschedule",
  );
  if (!allowed) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (viaSoloArtistBypass) {
    const ownArtist = await prisma.artist.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
    if (!ownArtist || appointment.artistId !== ownArtist.id) {
      return res.status(403).json({ error: "As a solo artist, you can only manage your own appointments" });
    }
  }

  if (appointment.status !== AppointmentStatus.REQUESTED) {
    return res.status(400).json({ error: "Only a requested appointment can be declined" });
  }

  const trimmedReason = reason.trim();
  const inquiry = appointment.inquiryProject;

  const updated = await prisma.appointment.update({ where: { id }, data: { status: AppointmentStatus.CANCELLED } });

  await prisma.appointmentNote.create({
    data: {
      studioId: appointment.studioId,
      appointmentId: id,
      authorId: req.user!.userId,
      bodyHtml: `<p>Declined requested time: ${trimmedReason.replace(/</g, "&lt;")}</p>`,
    },
  });

  await logAudit({
    studioId: appointment.studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "decline_requested_appointment",
    changes: { status: AppointmentStatus.CANCELLED, reason: trimmedReason },
  });

  emitInvalidation({ type: "appointment.changed", studioId: appointment.studioId });

  // Same eligibility shape as estimates.ts's PROCEED branch and
  // inquiries.ts's revise-estimate resend branch, minus their own
  // "selfScheduleBookedAt == null" gate -- that field being SET is exactly
  // why we're here (the client already booked once; we're about to
  // deliberately un-book it below so they can try again).
  const selfScheduleEligible =
    inquiry.assignedArtist?.allowsClientSelfScheduling === true &&
    inquiry.timeEstimateHoursMin != null &&
    inquiry.timeEstimateHoursMax != null;

  if (!selfScheduleEligible) {
    return res.json({
      appointment: updated,
      selfScheduleReissued: false,
      message: "This artist no longer allows client self-scheduling -- reschedule this manually.",
    });
  }

  const freshSelfScheduleToken = crypto.randomBytes(32).toString("hex");
  const updatedInquiry = await prisma.inquiry.update({
    where: { id: inquiry.id },
    data: {
      selfScheduleBookedAt: null,
      ...(inquiry.selfScheduleToken ? { previousSelfScheduleToken: inquiry.selfScheduleToken } : {}),
      selfScheduleToken: freshSelfScheduleToken,
      selfScheduleTokenExpiresAt: new Date(Date.now() + SELF_SCHEDULE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  const scheduleUrl = await shortenUrl(`${PUBLIC_APP_URL}/schedule/${freshSelfScheduleToken}`);
  const studio = await prisma.studio.findUnique({ where: { id: appointment.studioId }, select: { name: true } });

  const scheduleSendResult = await sendClientSms({
    studioId: appointment.studioId,
    clientId: updatedInquiry.clientId,
    conversationId: (
      await getOrCreateClientConversation(appointment.studioId, updatedInquiry.clientId, req.user!.userId)
    ).conversation.id,
    body: `Hi ${inquiry.client.firstName}, unfortunately your requested time with ${studio?.name ?? "us"} didn't work out. Please pick a new time here: ${scheduleUrl} (expires in 7 days)`,
    actorUserId: req.user!.userId,
  });

  emitInvalidation({ type: "inquiry.updated", studioId: appointment.studioId, inquiryId: inquiry.id });

  res.json({ appointment: updated, selfScheduleReissued: true, scheduleUrl, scheduleSendResult });
});

// Manually-written commentary log scoped to this one session -- same
// shape/rules as InquiryNote (routes/inquiries.ts), just against
// AppointmentNote. Deliberately OWNER/FRONT_DESK only via requireRole, not
// requirePermission("appointments.reschedule") -- matches InquiryNote's own
// hardcoded "internal only, never shown to an artist" precedent rather
// than a studio's customizable appointments.manage grants, since an
// ARTIST can otherwise view (though not manage) this same appointment.
router.get("/:id/notes", requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;

  const appointment = await prisma.appointment.findUnique({ where: { id }, select: { studioId: true } });
  if (!appointment || appointment.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  const notes = await prisma.appointmentNote.findMany({
    where: { appointmentId: id },
    include: { author: NOTE_AUTHOR_SELECT },
    orderBy: { createdAt: "desc" },
  });

  res.json(notes);
});

router.post("/:id/notes", requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { bodyHtml, attachments } = req.body ?? {};

  if (typeof bodyHtml !== "string" || isBlankHtml(bodyHtml)) {
    return res.status(400).json({ error: "bodyHtml is required" });
  }

  if (attachments !== undefined && !isValidAttachments(attachments)) {
    return res.status(400).json({ error: "attachments must be an array of {url, filename, mimeType}" });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id }, select: { studioId: true } });
  if (!appointment || appointment.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  const note = await prisma.appointmentNote.create({
    data: {
      studioId: req.user!.studioId,
      appointmentId: id,
      authorId: req.user!.userId,
      bodyHtml: bodyHtml.trim(),
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    },
    include: { author: NOTE_AUTHOR_SELECT },
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "AppointmentNote",
    entityId: note.id,
    action: "create",
    changes: { appointmentId: id },
  });

  emitInvalidation({ type: "appointment.changed", studioId: req.user!.studioId });

  res.status(201).json(note);
});

router.patch("/:id/notes/:noteId", requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const noteId = req.params.noteId as string;
  const { bodyHtml, attachments } = req.body ?? {};

  if (typeof bodyHtml !== "string" || isBlankHtml(bodyHtml)) {
    return res.status(400).json({ error: "bodyHtml is required" });
  }

  if (attachments !== undefined && !isValidAttachments(attachments)) {
    return res.status(400).json({ error: "attachments must be an array of {url, filename, mimeType}" });
  }

  const note = await prisma.appointmentNote.findUnique({ where: { id: noteId } });
  if (!note || note.studioId !== req.user!.studioId || note.appointmentId !== id) {
    return res.status(404).json({ error: "Note not found" });
  }

  if (!canModifyNote(note, req)) {
    return res.status(403).json({ error: "Only this note's author or an OWNER can edit it" });
  }

  const trimmed = bodyHtml.trim();
  // See the identical comment in inquiries.ts's PATCH /:id/notes/:noteId --
  // undefined means "leave attachments untouched", an explicit [] means
  // "clear them" (requires Prisma.JsonNull, not plain null/undefined, to
  // actually null out a Json? column).
  const attachmentsUpdate: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
    attachments === undefined ? undefined : attachments.length > 0 ? attachments : Prisma.JsonNull;

  const updated = await prisma.appointmentNote.update({
    where: { id: noteId },
    data: { bodyHtml: trimmed, attachments: attachmentsUpdate },
    include: { author: NOTE_AUTHOR_SELECT },
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "AppointmentNote",
    entityId: noteId,
    action: "update",
    changes: diffObjects(note, { bodyHtml: trimmed }, ["bodyHtml"]),
  });

  emitInvalidation({ type: "appointment.changed", studioId: req.user!.studioId });

  res.json(updated);
});

router.delete("/:id/notes/:noteId", requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const noteId = req.params.noteId as string;

  const note = await prisma.appointmentNote.findUnique({ where: { id: noteId } });
  if (!note || note.studioId !== req.user!.studioId || note.appointmentId !== id) {
    return res.status(404).json({ error: "Note not found" });
  }

  if (!canModifyNote(note, req)) {
    return res.status(403).json({ error: "Only this note's author or an OWNER can delete it" });
  }

  await prisma.appointmentNote.delete({ where: { id: noteId } });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "AppointmentNote",
    entityId: noteId,
    action: "delete",
    changes: { appointmentId: id, deletedBodyHtml: note.bodyHtml },
  });

  emitInvalidation({ type: "appointment.changed", studioId: req.user!.studioId });

  res.json({ success: true });
});

export default router;
