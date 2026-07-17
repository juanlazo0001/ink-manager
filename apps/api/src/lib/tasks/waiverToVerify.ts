import { prisma } from "../prisma";
import { LiabilityWaiverStatus } from "../../../generated/prisma/enums";
import { type SystemTask, type TaskSource } from "./types";

async function fetch(studioId: string, _userId: string): Promise<SystemTask[]> {
  const waivers = await prisma.liabilityWaiver.findMany({
    where: { studioId, status: LiabilityWaiverStatus.SIGNED },
    select: { id: true, signedAt: true, appointmentId: true, client: { select: { firstName: true, lastName: true } } },
    orderBy: { signedAt: "asc" },
  });

  return waivers.map((waiver) => ({
    type: "WAIVER_TO_VERIFY",
    title: `Verify waiver: ${waiver.client.firstName} ${waiver.client.lastName}`,
    entityType: "LiabilityWaiver",
    entityId: waiver.id,
    dismissalKey: waiver.id,
    // Waiver detail (health data + ID image, staff-only) is viewed via the
    // appointment detail page (Phase 4), not a standalone waiver route.
    deepLink: `/appointments/${waiver.appointmentId}`,
    actionableAt: waiver.signedAt as Date,
  }));
}

export const waiverToVerifySource: TaskSource = { type: "WAIVER_TO_VERIFY", label: "Waivers to verify", fetch };
