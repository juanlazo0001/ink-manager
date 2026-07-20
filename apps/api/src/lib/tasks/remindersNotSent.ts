import { prisma } from "../prisma";
import {
  CLIENT_REMINDER_JOB_NAME,
  ARTIST_REMINDER_JOB_NAME,
  ESTIMATE_FOLLOWUP_JOB_NAME,
} from "../jobs/reminderTicker";
import type { SystemTask, TaskSource } from "./types";

interface ReminderTickerDetails {
  perStudio?: Record<string, { skippedNotConnected?: number }>;
}

const REMINDER_JOB_NAMES = [CLIENT_REMINDER_JOB_NAME, ARTIST_REMINDER_JOB_NAME, ESTIMATE_FOLLOWUP_JOB_NAME];

// Live-computed against the three reminder jobs' own most recent JobRun
// each, same as every other task source -- no separate persistence.
// Folding all three jobs' latest run ids into the dismissalKey (not just
// studioId) means dismissing today's "not sent" notice never silently
// suppresses a fresh occurrence from a later run -- same pattern
// estimateFollowup.ts uses (folding estimateSentAt into its own
// dismissalKey) for the same reason.
async function fetch(studioId: string, _userId: string): Promise<SystemTask[]> {
  const lastRuns = await Promise.all(
    REMINDER_JOB_NAMES.map((jobName) =>
      prisma.jobRun.findFirst({
        where: { jobName, status: "SUCCEEDED" },
        orderBy: { scheduledFor: "desc" },
      }),
    ),
  );

  const runs = lastRuns.filter((run): run is NonNullable<(typeof lastRuns)[number]> => run !== null);
  if (runs.length === 0) return [];

  const skipped = runs.reduce((total, run) => {
    const details = run.details as ReminderTickerDetails | null;
    return total + (details?.perStudio?.[studioId]?.skippedNotConnected ?? 0);
  }, 0);
  if (skipped === 0) return [];

  const mostRecent = runs.reduce((latest, run) => (run.scheduledFor > latest.scheduledFor ? run : latest));

  return [
    {
      type: "REMINDERS_NOT_SENT",
      title: `${skipped} reminder message${skipped === 1 ? " wasn't" : "s weren't"} sent -- SMS isn't connected`,
      entityType: "StudioSettings",
      entityId: studioId,
      dismissalKey: `${studioId}:${runs.map((run) => run.id).join(",")}`,
      deepLink: "/settings",
      actionableAt: mostRecent.finishedAt ?? mostRecent.startedAt,
    },
  ];
}

export const remindersNotSentSource: TaskSource = {
  type: "REMINDERS_NOT_SENT",
  label: "Reminders not sent",
  fetch,
};
