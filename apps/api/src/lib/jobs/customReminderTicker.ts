import { prisma } from "../prisma";
import {
  AppointmentStatus,
  InquiryStatus,
  ReminderAudience,
  ReminderCondition,
} from "../../../generated/prisma/enums";
import { registerJob, type JobDetails } from "./registry";
import { isWithinSendWindow } from "../reminderWindow";
import { ensureLiabilityWaiver } from "../waivers";
import {
  sendClientSms,
  sendStaffSms,
  type SendClientSmsResult,
  type SendStaffSmsResult,
} from "../clientSms";
import { getOrCreateClientConversation, getOrCreateStaffConversation } from "../conversations";
import { renderTemplate } from "../reminderTemplates";
import { appointmentIsDue, conditionHolds } from "../reminderRules";

// Package BJ. The sibling ticker (reminderTicker.ts) runs the BUILT-IN
// cadence, whose reminders are a fixed set living in two JSON columns. This
// one runs the reminders a studio created for itself (StudioReminder rows).
//
// Deliberately a separate job rather than a fourth branch inside the client
// reminder job: it gets its own name/description/Run Now in Settings ->
// System, and a failure here never marks the built-in cadence's JobRun
// failed. Same 15-minute cadence and the same send-window/civil-date helpers,
// so the two never drift on "what does 1 day before mean".
export const CUSTOM_REMINDER_JOB_NAME = "studioConfiguredReminders";

interface Counts {
  sent: number;
  skippedNotConnected: number;
  skippedOptedOut: number;
  skippedNoConsent: number;
  skippedNoPhone: number;
  skippedSendFailed: number;
  // Matched the day/time but the reminder's own precondition said no --
  // e.g. WAIVER_UNSIGNED on an appointment whose waiver is already signed.
  // Not a failure: this is the reminder working, and it is counted
  // separately so a studio reading the job log can tell "nobody needed
  // chasing" apart from "nothing was tried".
  skippedConditionNotMet: number;
}

function emptyCounts(): Counts {
  return {
    sent: 0,
    skippedNotConnected: 0,
    skippedOptedOut: 0,
    skippedNoConsent: 0,
    skippedNoPhone: 0,
    skippedSendFailed: 0,
    skippedConditionNotMet: 0,
  };
}

function recordSkip(counts: Counts, reason: string): void {
  if (reason === "not_connected") counts.skippedNotConnected += 1;
  else if (reason === "opted_out") counts.skippedOptedOut += 1;
  else if (reason === "no_consent") counts.skippedNoConsent += 1;
  else if (reason === "no_phone") counts.skippedNoPhone += 1;
  else counts.skippedSendFailed += 1;
}

function formatDateInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(date);
}

function formatTimeInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hourCycle: "h12" }).format(
    date,
  );
}

async function runReminder(
  reminder: {
    id: string;
    audience: ReminderAudience;
    condition: ReminderCondition;
    offsetDays: number;
    body: string;
  },
  studioId: string,
  studioName: string,
  timezone: string,
  now: Date,
  counts: Counts,
): Promise<void> {
  // Wide instant window, then an exact CIVIL-DATE match below. The window is
  // only a cheap index-friendly prefilter -- it is deliberately looser than
  // offsetDays so that no timezone offset can push a matching appointment
  // outside it; the civil-date comparison is what actually decides.
  const rangeStart = new Date(now.getTime() + (reminder.offsetDays - 2) * 86_400_000);
  const rangeEnd = new Date(now.getTime() + (reminder.offsetDays + 2) * 86_400_000);

  const candidates = await prisma.appointment.findMany({
    where: {
      studioId,
      status: AppointmentStatus.CONFIRMED,
      startTime: { gte: rangeStart, lte: rangeEnd },
      // On-Hold: same pause the built-in cadence applies -- a paused
      // project's session gets no reminders while it is paused, and resumes
      // on its own the next tick after release because this query
      // re-evaluates live status every run.
      inquiryProject: { status: { not: InquiryStatus.ON_HOLD } },
      // Existence of a send row IS the dedup (see the model comment). Doing
      // it in the query rather than per-row keeps one round trip.
      sends: { none: { reminderId: reminder.id } },
    },
    include: {
      client: true,
      artist: { include: { user: true } },
      liabilityWaiver: { select: { status: true } },
    },
  });

  const dueToday = candidates.filter((appt) =>
    appointmentIsDue(appt.startTime, now, timezone, reminder.offsetDays),
  );

  for (const appointment of dueToday) {
    if (!conditionHolds(reminder.condition, appointment.liabilityWaiver)) {
      counts.skippedConditionNotMet += 1;
      continue;
    }

    const artistUser = appointment.artist.user;
    const artistName = artistUser.name ?? artistUser.email;

    // Only mint/extend a waiver when the body actually asks for the link.
    // ensureLiabilityWaiver CREATES a record as a side effect, so calling it
    // unconditionally would manufacture waivers for reminders that never
    // mention one.
    let waiverLink = "";
    if (reminder.body.includes("{{waiverLink}}")) {
      const waiverResult = await ensureLiabilityWaiver(appointment.id, studioId, null, {
        minValidUntil: appointment.endTime,
      });
      waiverLink = waiverResult.ok ? waiverResult.signingUrl : "";
    }

    const body = renderTemplate(reminder.body, {
      clientFirstName: appointment.client.firstName,
      clientName: `${appointment.client.firstName} ${appointment.client.lastName}`.trim(),
      appointmentDate: formatDateInTz(appointment.startTime, timezone),
      appointmentTime: formatTimeInTz(appointment.startTime, timezone),
      artistName,
      waiverLink,
      studioName,
    });

    let sent: SendClientSmsResult | SendStaffSmsResult;

    if (reminder.audience === ReminderAudience.ARTIST) {
      if (!artistUser.phone) {
        counts.skippedNoPhone += 1;
        continue;
      }
      const { conversation } = await getOrCreateStaffConversation(studioId, artistUser.id, null);
      sent = await sendStaffSms({
        studioId,
        userId: artistUser.id,
        conversationId: conversation.id,
        body,
        actorUserId: null,
      });
    } else {
      const { conversation } = await getOrCreateClientConversation(studioId, appointment.clientId, null);
      sent = await sendClientSms({
        studioId,
        clientId: appointment.clientId,
        conversationId: conversation.id,
        body,
        actorUserId: null,
      });
    }

    if (sent.sent) {
      // Written only on success, matching the built-in cadence's *SentAt
      // fields -- a send that failed should be retried on the next tick
      // inside the window, not silently marked done.
      await prisma.appointmentReminderSend.create({
        data: { appointmentId: appointment.id, reminderId: reminder.id },
      });
      counts.sent += 1;
    } else {
      recordSkip(counts, sent.reason);
    }
  }
}

async function runCustomReminders(scheduledFor: Date): Promise<JobDetails> {
  const studios = await prisma.studio.findMany({
    include: { settings: true, reminders: { where: { enabled: true } } },
  });

  const perStudio: Record<string, Counts> = {};

  for (const studio of studios) {
    if (studio.reminders.length === 0) continue;

    const counts = emptyCounts();
    const timezone = studio.settings?.timezone ?? "America/New_York";

    for (const reminder of studio.reminders) {
      if (!isWithinSendWindow(timezone, reminder.sendTime, scheduledFor)) continue;
      await runReminder(reminder, studio.id, studio.name, timezone, scheduledFor, counts);
    }

    perStudio[studio.id] = counts;
  }

  return { perStudio };
}

registerJob({
  name: CUSTOM_REMINDER_JOB_NAME,
  description:
    "Sends the reminders a studio has configured itself under Settings -> Defaults, including the liability-waiver chase for appointments whose waiver is still unsigned.",
  schedule: "*/15 * * * *",
  slotMinutes: 15,
  run: runCustomReminders,
});
