import { prisma } from "../prisma";
import { InquiryStatus } from "../../../generated/prisma/enums";
import { truncate, type SystemTask, type TaskSource } from "./types";

async function fetch(studioId: string, _userId: string): Promise<SystemTask[]> {
  const inquiries = await prisma.inquiry.findMany({
    // status SCHEDULING is itself only reachable once the deposit's paid
    // (Phase 3) -- appointmentId null is a belt-and-suspenders check that
    // this project hasn't already been scheduled.
    where: { studioId, status: InquiryStatus.SCHEDULING, appointmentId: null },
    select: { id: true, description: true, assignedAt: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return inquiries.map((inquiry) => ({
    type: "READY_TO_SCHEDULE",
    title: `Ready to schedule: ${truncate(inquiry.description)}`,
    entityType: "Inquiry",
    entityId: inquiry.id,
    dismissalKey: inquiry.id,
    deepLink: `/inquiries/${inquiry.id}`,
    actionableAt: inquiry.assignedAt ?? inquiry.createdAt,
  }));
}

export const readyToScheduleSource: TaskSource = { type: "READY_TO_SCHEDULE", label: "Ready to schedule", fetch };
