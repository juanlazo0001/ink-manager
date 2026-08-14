// Clears the walkthrough client's conversation, messages, and audit rows so a
// run starts from a genuinely empty thread. Dev-only, same host guard as the
// seed script.
import "dotenv/config";
import { prisma } from "../lib/prisma";

const PHONE = process.argv[2] ?? "9105550162";

function assertDevDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("hopper.proxy.rlwy.net")) {
    throw new Error("REFUSING TO RUN: DATABASE_URL is not the known dev database host.");
  }
}

async function main() {
  assertDevDatabase();

  const client = await prisma.client.findFirst({ where: { phone: PHONE }, select: { id: true, studioId: true } });
  if (!client) throw new Error(`No client with phone ${PHONE}`);

  const convs = await prisma.conversation.findMany({
    where: { studioId: client.studioId, clientId: client.id },
    select: { id: true },
  });
  const convIds = convs.map((c) => c.id);

  if (convIds.length) {
    const delMsgs = await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
    console.log(`Deleted ${delMsgs.count} messages`);
    const delConvs = await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
    console.log(`Deleted ${delConvs.count} conversations`);
  }

  const delAudit = await prisma.auditLog.deleteMany({ where: { entityType: "Client", entityId: client.id } });
  console.log(`Deleted ${delAudit.count} audit rows`);

  await prisma.client.update({
    where: { id: client.id },
    data: { smsOptedOutAt: null, smsConsentGivenAt: new Date() },
  });
  console.log("Client reset to opted-in.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
