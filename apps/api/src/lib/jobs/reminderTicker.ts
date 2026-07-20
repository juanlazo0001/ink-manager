import { prisma } from "../prisma";
import { AppointmentStatus } from "../../../generated/prisma/enums";
import { registerJob, type JobDetails } from "./registry";
import { civilDateKey, daysBetweenCivilDates, isWithinSendWindow } from "../reminderWindow";
import { ensureLiabilityWaiver } from "../waivers";
import { sendClientSms, sendStaffSms } from "../clientSms";
import { getOrCreateClientConversation, getOrCreateStaffConversation } from "../conversations";
import { PUBLIC_APP_URL } from "../publicUrl";
import { logAudit } from "../audit";

// Three separately-registered jobs (rather than one combined ticker) so
// each shows its own friendly name/description/Run Now in Settings ->
// System, and a failure or manual re-run of one never touches the
// JobRun status of the others -- all three still fire on the same
// 15-minute cadence and share the same per-studio helper functions below.
export const CLIENT_REMINDER_JOB_NAME = "clientAppointmentReminders";
export const ARTIST_REMINDER_JOB_NAME = "artistAppointmentReminders";
export const ESTIMATE_FOLLOWUP_JOB_NAME = "estimateFollowUpReminder";

interface ReminderTemplates {
  clientWeekBefore: string;
  clientNightBefore: string;
  clientMorningOf: string;
  artistDayBefore: string;
  estimateFollowUp: string;
}

interface ReminderSendTimes {
  weekBeforeTime: string;
  nightBeforeTime: string;
  morningOfTime: string;
  artistDayBeforeTime: string;
}

interface StudioCounts {
  sent: number;
  skippedNotConnected: number;
  skippedOptedOut: number;
  skippedNoPhone: number;
  skippedSendFailed: number;
}

function emptyCounts(): StudioCounts {
  return { sent: 0, skippedNotConnected: 0, skippedOptedOut: 0, skippedNoPhone: 0, skippedSendFailed: 0 };
}

function recordSkip(counts: StudioCounts, reason: string): void {
  if (reason === "not_connected") counts.skippedNotConnected += 1;
  else if (reason === "opted_out") counts.skippedOptedOut += 1;
  else if (reason === "no_phone") counts.skippedNoPhone += 1;
  else counts.skippedSendFailed += 1;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

function formatDateInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(date);
}

function formatTimeInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hourCycle: "h12" }).format(
    date,
  );
}

type ReminderField = "reminderWeekSentAt" | "reminderNightBeforeSentAt" | "reminderMorningOfSentAt";

// Client reminder cadence (week-before / night-before / morning-of) --
// same shape for all three, just a different target day-offset, sentAt
// dedup field, and template.
async function sendClientReminders(
  studioId: string,
  studioName: string,
  timezone: string,
  template: string,
  daysOut: number,
  sentAtField: ReminderField,
  now: Date,
  counts: StudioCounts,
): Promise<void> {
  const rangeStart = new Date(now.getTime() - 2 * 86_400_000);
  const rangeEnd = new Date(now.getTime() + 9 * 86_400_000);

  const candidates = await prisma.appointment.findMany({
    where: {
      studioId,
      status: AppointmentStatus.CONFIRMED,
      [sentAtField]: null,
      startTime: { gte: rangeStart, lte: rangeEnd },
    },
    include: { client: true, artist: { include: { user: true } } },
  });

  const todayKey = civilDateKey(now, timezone);
  const dueToday = candidates.filter(
    (appt) => daysBetweenCivilDates(todayKey, civilDateKey(appt.startTime, timezone)) === daysOut,
  );

  for (const appointment of dueToday) {
    const waiverResult = await ensureLiabilityWaiver(appointment.id, studioId, null, {
      minValidUntil: appointment.endTime,
    });
    const waiverLink = waiverResult.ok ? waiverResult.signingUrl : "";

    const body = renderTemplate(template, {
      clientFirstName: appointment.client.firstName,
      appointmentDate: formatDateInTz(appointment.startTime, timezone),
      appointmentTime: formatTimeInTz(appointment.startTime, timezone),
      artistName: appointment.artist.user.name ?? appointment.artist.user.email,
      waiverLink,
      studioName,
    });

    const { conversation } = await getOrCreateClientConversation(studioId, appointment.clientId, null);
    const result = await sendClientSms({
      studioId,
      clientId: appointment.clientId,
      conversationId: conversation.id,
      body,
      actorUserId: null,
    });

    if (result.sent) {
      await prisma.appointment.update({ where: { id: appointment.id }, data: { [sentAtField]: new Date() } });
      counts.sent += 1;
    } else {
      recordSkip(counts, result.reason);
    }
  }
}

// One consolidated message per artist per day, not one per appointment --
// ArtistReminderLog is the dedup record for that (Appointment's own
// reminder*SentAt fields are the client cadence's dedup, a different
// concept).
async function sendArtistDigest(
  studioId: string,
  studioName: string,
  timezone: string,
  template: string,
  now: Date,
  counts: StudioCounts,
): Promise<void> {
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const tomorrowKey = civilDateKey(tomorrow, timezone);
  const forDate = new Date(`${tomorrowKey}T00:00:00.000Z`);

  const rangeStart = new Date(now.getTime());
  const rangeEnd = new Date(now.getTime() + 2 * 86_400_000);

  const candidates = await prisma.appointment.findMany({
    where: { studioId, status: AppointmentStatus.CONFIRMED, startTime: { gte: rangeStart, lte: rangeEnd } },
    include: { client: true, artist: { include: { user: true } } },
    orderBy: { startTime: "asc" },
  });

  const tomorrowsAppointments = candidates.filter((appt) => civilDateKey(appt.startTime, timezone) === tomorrowKey);

  const byArtist = new Map<string, typeof tomorrowsAppointments>();
  for (const appt of tomorrowsAppointments) {
    const list = byArtist.get(appt.artistId) ?? [];
    list.push(appt);
    byArtist.set(appt.artistId, list);
  }

  for (const [artistId, appts] of byArtist) {
    const existingLog = await prisma.artistReminderLog.findUnique({
      where: { artistId_forDate: { artistId, forDate } },
    });
    if (existingLog) continue;

    const artistUser = appts[0].artist.user;
    if (!artistUser.phone) {
      counts.skippedNoPhone += 1;
      continue;
    }

    const header = renderTemplate(template, { artistName: artistUser.name ?? artistUser.email, studioName });
    const lines = appts.map(
      (appt) => `${formatTimeInTz(appt.startTime, timezone)} - ${appt.client.firstName} ${appt.client.lastName}`,
    );
    const body = [header, ...lines].join("\n");

    const { conversation } = await getOrCreateStaffConversation(studioId, artistUser.id, null);
    const result = await sendStaffSms({
      studioId,
      userId: artistUser.id,
      conversationId: conversation.id,
      body,
      actorUserId: null,
    });

    if (result.sent) {
      await prisma.artistReminderLog.create({ data: { studioId, artistId, forDate } });
      counts.sent += 1;
    } else {
      recordSkip(counts, result.reason);
    }
  }
}

// Elapsed-time based (estimateOpenedAt + 24h), not clock-window based --
// checked every tick regardless of studio timezone, since "24 hours since
// a real event" needs no timezone math at all.
async function sendEstimateFollowUps(
  studioId: string,
  studioName: string,
  template: string,
  counts: StudioCounts,
): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const candidates = await prisma.inquiry.findMany({
    where: {
      studioId,
      estimateOpenedAt: { not: null, lte: cutoff },
      estimateRespondedAt: null,
      estimateFollowUpSentAt: null,
      estimateToken: { not: null },
    },
    include: { client: true },
  });

  for (const inquiry of candidates) {
    const body = renderTemplate(template, {
      clientFirstName: inquiry.client.firstName,
      estimateLink: `${PUBLIC_APP_URL}/estimate/${inquiry.estimateToken}`,
      studioName,
    });

    const { conversation } = await getOrCreateClientConversation(studioId, inquiry.clientId, null);
    const result = await sendClientSms({
      studioId,
      clientId: inquiry.clientId,
      conversationId: conversation.id,
      body,
      actorUserId: null,
    });

    if (result.sent) {
      await prisma.inquiry.update({ where: { id: inquiry.id }, data: { estimateFollowUpSentAt: new Date() } });
      await logAudit({
        studioId,
        actorUserId: null,
        entityType: "Inquiry",
        entityId: inquiry.id,
        action: "estimate_followup_sent",
        changes: { messageId: result.messageId },
      });
      counts.sent += 1;
    } else {
      recordSkip(counts, result.reason);
    }
  }
}

async function loadStudiosWithSettings() {
  return prisma.studio.findMany({ include: { settings: true } });
}

async function runClientReminders(scheduledFor: Date): Promise<JobDetails> {
  const studios = await loadStudiosWithSettings();
  const perStudio: Record<string, StudioCounts> = {};

  for (const studio of studios) {
    const counts = emptyCounts();
    const timezone = studio.settings?.timezone ?? "America/New_York";
    const sendTimes = studio.settings?.reminderSendTimes as unknown as ReminderSendTimes | null;
    const templates = studio.settings?.reminderTemplates as unknown as ReminderTemplates | null;

    if (sendTimes && templates) {
      if (isWithinSendWindow(timezone, sendTimes.weekBeforeTime, scheduledFor)) {
        await sendClientReminders(
          studio.id,
          studio.name,
          timezone,
          templates.clientWeekBefore,
          7,
          "reminderWeekSentAt",
          scheduledFor,
          counts,
        );
      }
      if (isWithinSendWindow(timezone, sendTimes.nightBeforeTime, scheduledFor)) {
        await sendClientReminders(
          studio.id,
          studio.name,
          timezone,
          templates.clientNightBefore,
          1,
          "reminderNightBeforeSentAt",
          scheduledFor,
          counts,
        );
      }
      if (isWithinSendWindow(timezone, sendTimes.morningOfTime, scheduledFor)) {
        await sendClientReminders(
          studio.id,
          studio.name,
          timezone,
          templates.clientMorningOf,
          0,
          "reminderMorningOfSentAt",
          scheduledFor,
          counts,
        );
      }
    }

    perStudio[studio.id] = counts;
  }

  return { perStudio };
}

async function runArtistReminders(scheduledFor: Date): Promise<JobDetails> {
  const studios = await loadStudiosWithSettings();
  const perStudio: Record<string, StudioCounts> = {};

  for (const studio of studios) {
    const counts = emptyCounts();
    const timezone = studio.settings?.timezone ?? "America/New_York";
    const sendTimes = studio.settings?.reminderSendTimes as unknown as ReminderSendTimes | null;
    const templates = studio.settings?.reminderTemplates as unknown as ReminderTemplates | null;

    if (sendTimes && templates && isWithinSendWindow(timezone, sendTimes.artistDayBeforeTime, scheduledFor)) {
      await sendArtistDigest(studio.id, studio.name, timezone, templates.artistDayBefore, scheduledFor, counts);
    }

    perStudio[studio.id] = counts;
  }

  return { perStudio };
}

async function runEstimateFollowUps(): Promise<JobDetails> {
  const studios = await loadStudiosWithSettings();
  const perStudio: Record<string, StudioCounts> = {};

  for (const studio of studios) {
    const counts = emptyCounts();
    const templates = studio.settings?.reminderTemplates as unknown as ReminderTemplates | null;

    if (templates) {
      await sendEstimateFollowUps(studio.id, studio.name, templates.estimateFollowUp, counts);
    }

    perStudio[studio.id] = counts;
  }

  return { perStudio };
}

registerJob({
  name: CLIENT_REMINDER_JOB_NAME,
  description:
    "Texts clients ahead of their appointment: one week before, the night before, and the morning of, each in the studio's own local time.",
  schedule: "*/15 * * * *",
  slotMinutes: 15,
  run: runClientReminders,
});

registerJob({
  name: ARTIST_REMINDER_JOB_NAME,
  description: "Sends each artist one consolidated text listing their appointments for the next day.",
  schedule: "*/15 * * * *",
  slotMinutes: 15,
  run: runArtistReminders,
});

registerJob({
  name: ESTIMATE_FOLLOWUP_JOB_NAME,
  description: "Texts a client who opened an estimate but hasn't responded within 24 hours.",
  schedule: "*/15 * * * *",
  slotMinutes: 15,
  run: runEstimateFollowUps,
});
