import { prisma } from "../prisma";
import { truncate, type SystemTask, type TaskSource } from "./types";

// Actionable when either:
//  - opened, no response yet, and it's been > followUpHours since opening, or
//  - never opened, and it's been > 2x followUpHours since sending.
async function fetch(studioId: string): Promise<SystemTask[]> {
  const settings = await prisma.studioSettings.findUnique({ where: { studioId } });
  const followUpHours = settings?.estimateFollowUpHours ?? 24;
  const openedThresholdMs = followUpHours * 60 * 60 * 1000;
  const unopenedThresholdMs = 2 * followUpHours * 60 * 60 * 1000;
  const now = Date.now();

  const candidates = await prisma.inquiry.findMany({
    where: { studioId, estimateSentAt: { not: null }, estimateRespondedAt: null },
    select: { id: true, description: true, estimateSentAt: true, estimateOpenedAt: true },
  });

  const tasks: SystemTask[] = [];

  for (const inquiry of candidates) {
    const sentAt = inquiry.estimateSentAt as Date;
    let actionableAt: Date;
    let isActionable: boolean;

    if (inquiry.estimateOpenedAt) {
      actionableAt = new Date(inquiry.estimateOpenedAt.getTime() + openedThresholdMs);
      isActionable = now - inquiry.estimateOpenedAt.getTime() > openedThresholdMs;
    } else {
      actionableAt = new Date(sentAt.getTime() + unopenedThresholdMs);
      isActionable = now - sentAt.getTime() > unopenedThresholdMs;
    }

    if (!isActionable) continue;

    tasks.push({
      type: "ESTIMATE_FOLLOWUP",
      title: `Follow up on estimate: ${truncate(inquiry.description)}`,
      entityType: "Inquiry",
      entityId: inquiry.id,
      // Folds estimateSentAt in: a resend (Phase 2) resets estimateSentAt
      // and clears estimateOpenedAt/estimateRespondedAt, so a previously
      // dismissed follow-up for the OLD send becomes a fresh, undismissed
      // key for the new one rather than staying silently dismissed forever.
      dismissalKey: `${inquiry.id}:${sentAt.toISOString()}`,
      deepLink: `/inquiries/${inquiry.id}`,
      actionableAt,
    });
  }

  return tasks;
}

export const estimateFollowupSource: TaskSource = { type: "ESTIMATE_FOLLOWUP", label: "Estimates needing follow-up", fetch };
