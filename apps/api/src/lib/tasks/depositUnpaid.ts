import { prisma } from "../prisma";
import { truncate, type SystemTask, type TaskSource } from "./types";

async function fetch(studioId: string): Promise<SystemTask[]> {
  const deposits = await prisma.depositForm.findMany({
    where: { paidManually: false, signedAt: { not: null }, inquiry: { studioId } },
    select: { id: true, signedAt: true, inquiry: { select: { id: true, description: true } } },
    orderBy: { signedAt: "asc" },
  });

  return deposits.map((deposit) => ({
    type: "DEPOSIT_UNPAID",
    title: `Deposit signed, not yet paid: ${truncate(deposit.inquiry.description)}`,
    entityType: "DepositForm",
    entityId: deposit.id,
    dismissalKey: deposit.id,
    deepLink: `/inquiries/${deposit.inquiry.id}`,
    actionableAt: deposit.signedAt as Date,
  }));
}

export const depositUnpaidSource: TaskSource = { type: "DEPOSIT_UNPAID", label: "Deposits signed but unpaid", fetch };
