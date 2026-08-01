import { Router } from "express";
import { prisma } from "../lib/prisma";
import { AppointmentStatus, AppointmentType, FlashPieceStatus } from "../../generated/prisma/enums";
import { logAudit } from "../lib/audit";
import { DEFAULT_THEME_PRESET } from "../lib/themePresets";
import { emitInvalidation } from "../lib/realtime/registry";
import { getAvailableDates, getSlotsForDate } from "../lib/schedulingAssistant";
import { findBufferConflict, resolveSchedulingBufferMs } from "../lib/schedulingConflict";

const router = Router();

// Deliberately wider than getSuggestedTimes' own DEFAULT_SEARCH_DAYS
// (21 -- "2-4 weeks" per that feature's own spec, for staff picking a
// near-term slot to suggest). A client browsing their own calendar here
// has no reason to be capped at 3 weeks out -- widened to comfortably
// cover a few months. Kept as its own constant, not a shared one, since
// the staff-facing suggestion tool's near-term framing is intentional
// and shouldn't drift just because this picker's needs changed.
const SELF_SCHEDULE_SEARCH_DAYS = 90;

// Client self-scheduling exploration: public, unauthenticated -- same
// crypto-token + verify/respond pattern as estimates.ts/deposits.ts/
// waivers.ts. Only reachable for an Inquiry whose assigned artist opted in
// (Artist.allowsClientSelfScheduling) and that received a token from
// PATCH /estimates/respond/:token's PROCEED branch.
function isExpiredOrInvalid(inquiry: { selfScheduleTokenExpiresAt: Date | null } | null) {
  if (!inquiry) {
    return { code: "invalid", error: "This link is invalid." } as const;
  }

  if (!inquiry.selfScheduleTokenExpiresAt || inquiry.selfScheduleTokenExpiresAt < new Date()) {
    return { code: "expired", error: "This link has expired." } as const;
  }

  return null;
}

// Single source of truth for "how long is this inquiry's one session,"
// shared by both routes below -- matches InquiryDetail.tsx's own
// midpoint-of-range convention exactly (durationMinutes fed to
// /scheduling/suggested-times for staff), so a client sees the same slot
// sizing staff already does for this same inquiry.
function durationMinutesFor(inquiry: { timeEstimateHoursMin: number | null; timeEstimateHoursMax: number | null }) {
  if (inquiry.timeEstimateHoursMin == null || inquiry.timeEstimateHoursMax == null) return null;
  return Math.round(((inquiry.timeEstimateHoursMin + inquiry.timeEstimateHoursMax) / 2) * 60);
}

router.get("/verify/:token", async (req, res) => {
  const token = req.params.token as string;

  const inquiry = await prisma.inquiry.findUnique({
    where: { selfScheduleToken: token },
    include: {
      client: true,
      studio: { include: { settings: { select: { themePreset: true } } } },
      assignedArtist: { include: { user: true } },
    },
  });

  const invalidity = isExpiredOrInvalid(inquiry);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  // Both should be impossible by construction (the token is only ever
  // issued for an eligible, assigned, single-session inquiry -- see
  // estimates.ts's PROCEED branch) but re-checked defensively rather than
  // trusting the token alone, same caution as respond below.
  const durationMinutes = durationMinutesFor(inquiry!);
  if (!inquiry!.assignedArtistId || !inquiry!.assignedArtist || durationMinutes == null) {
    return res.status(404).json({ error: "This link is invalid." });
  }

  // Date/time picker: which calendar dates have any genuine availability
  // at all, so the client's picker can disable every other date outright
  // rather than letting them pick a date and then discover it's empty.
  // Actual time-of-day options for whichever date they land on come from
  // GET /slots/:token below, fetched on demand per date rather than all
  // up front (a SELF_SCHEDULE_SEARCH_DAYS-day search window's worth of
  // times, all at once, is both wasted work for the ~90 dates never
  // clicked and a much bigger response than this page needs at load time).
  const availableDates = await getAvailableDates(inquiry!.assignedArtistId, durationMinutes, {
    searchDays: SELF_SCHEDULE_SEARCH_DAYS,
  });

  res.json({
    clientFirstName: inquiry!.client.firstName,
    studioName: inquiry!.studio.name,
    studioSlug: inquiry!.studio.slug,
    studioLogoUrl: inquiry!.studio.logoUrl,
    themePreset: inquiry!.studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
    artistName: inquiry!.assignedArtist.user.name ?? "your artist",
    artistAvatarUrl: inquiry!.assignedArtist.user.avatarUrl,
    durationMinutes,
    availableDates,
  });
});

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Client self-scheduling date/time picker: the time-of-day options for one
// specific date the client has already picked from the calendar grid
// (populated from GET /verify's own availableDates). Fetched per date
// rather than folded into /verify's response -- see that route's own
// comment for why.
router.get("/slots/:token", async (req, res) => {
  const token = req.params.token as string;
  const date = req.query.date;

  if (typeof date !== "string" || !DATE_KEY_PATTERN.test(date)) {
    return res.status(400).json({ error: "date must be a YYYY-MM-DD string" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { selfScheduleToken: token } });

  const invalidity = isExpiredOrInvalid(inquiry);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const durationMinutes = durationMinutesFor(inquiry!);
  if (!inquiry!.assignedArtistId || durationMinutes == null) {
    return res.status(404).json({ error: "This link is invalid." });
  }

  const slots = await getSlotsForDate(inquiry!.assignedArtistId, durationMinutes, date);
  res.json({ slots });
});

router.patch("/respond/:token", async (req, res) => {
  const token = req.params.token as string;
  const { startTime, endTime } = req.body ?? {};

  if (typeof startTime !== "string" || typeof endTime !== "string") {
    return res.status(400).json({ error: "startTime and endTime are required" });
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return res.status(400).json({ error: "startTime and endTime must be valid dates, with startTime before endTime" });
  }

  if (start < new Date()) {
    return res.status(400).json({ error: "That time has already passed -- please choose another." });
  }

  const inquiry = await prisma.inquiry.findUnique({
    where: { selfScheduleToken: token },
    include: { assignedArtist: true, flashPiece: true },
  });

  const invalidity = isExpiredOrInvalid(inquiry);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const durationMinutes = durationMinutesFor(inquiry!);
  if (!inquiry!.assignedArtistId || !inquiry!.assignedArtist || durationMinutes == null) {
    return res.status(404).json({ error: "This link is invalid." });
  }

  // Guards against a tampered request extending/shrinking the picked slot
  // beyond this inquiry's own session length -- the client only ever picks
  // from server-suggested candidates (no manual time entry in this flow),
  // so a mismatch here means the request wasn't a real suggested candidate.
  const requestedMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (requestedMinutes !== durationMinutes) {
    return res.status(400).json({ error: "That time no longer matches this session's expected length -- please choose another." });
  }

  const studioSettings = await prisma.studioSettings.findUnique({
    where: { studioId: inquiry!.studioId },
    select: { schedulingBufferMinutes: true },
  });
  const bufferMs = resolveSchedulingBufferMs(
    inquiry!.assignedArtist.schedulingBufferMinutes,
    studioSettings?.schedulingBufferMinutes,
  );

  // Re-validated here, not just trusted from the /verify suggestions --
  // another appointment could have been booked for this artist in the
  // window between the client loading the page and submitting a pick.
  const conflict = await findBufferConflict(inquiry!.assignedArtistId, start, end, undefined, bufferMs);
  if (conflict) {
    return res.status(409).json({ error: "That time is no longer available -- please choose another." });
  }

  // Pending, not binding: status REQUESTED (never CONFIRMED here) -- staff
  // still reviews and confirms it, same as the task brief's own stated
  // default. No gift card attached (the application-level "gift card
  // required for a TATTOO_SESSION" rule -- see appointments.ts's own
  // comment -- is enforced only by that staff-facing route, not by a
  // database constraint, so a real Appointment row can exist here before
  // any deposit's been paid). No plannedSessionId either -- this flow is
  // scoped to single-session inquiries only (see estimates.ts's
  // eligibility check).
  const appointment = await prisma.appointment.create({
    data: {
      artistId: inquiry!.assignedArtistId,
      clientId: inquiry!.clientId,
      inquiryId: inquiry!.id,
      studioId: inquiry!.studioId,
      startTime: start,
      endTime: end,
      status: AppointmentStatus.REQUESTED,
      appointmentType: AppointmentType.TATTOO_SESSION,
      notes: "Requested by client via self-scheduling.",
    },
  });

  await prisma.inquiry.update({
    where: { id: inquiry!.id },
    data: { selfScheduleToken: null, selfScheduleTokenExpiresAt: null },
  });

  // Flash gallery, Part 3: this is the actual moment a one-of-one flash
  // piece becomes BOOKED -- deliberately not at approval or at payment,
  // both of which leave it PENDING_APPROVAL. A real Appointment existing is
  // the genuine "retired forever" outcome isOneOfOne's own contract
  // describes; payment alone doesn't guarantee the client ever comes back
  // to actually pick a time (see the "stalled reservation" judgment call in
  // REPORT.md). A repeatable piece was never reserved in the first place,
  // so there's nothing to transition here for one.
  if (inquiry!.flashPiece?.isOneOfOne) {
    await prisma.flashPiece.update({
      where: { id: inquiry!.flashPiece.id },
      data: { status: FlashPieceStatus.BOOKED },
    });
    emitInvalidation({ type: "flash.changed", studioId: inquiry!.studioId });
  }

  await logAudit({
    studioId: inquiry!.studioId,
    actorUserId: null,
    entityType: "Appointment",
    entityId: appointment.id,
    action: "self_scheduled",
    changes: { artistId: inquiry!.assignedArtistId, clientId: inquiry!.clientId, startTime: start, endTime: end },
  });

  emitInvalidation({ type: "appointment.changed", studioId: inquiry!.studioId });
  emitInvalidation({ type: "inquiry.updated", studioId: inquiry!.studioId, inquiryId: inquiry!.id });

  res.json({ success: true, startTime: appointment.startTime, endTime: appointment.endTime });
});

export default router;
