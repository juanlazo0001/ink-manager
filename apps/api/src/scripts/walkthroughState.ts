// Read-only state dump for the A2P walkthrough -- prints the client's consent
// state, the thread, and the audit trail so each step can be verified from the
// database rather than inferred from a 200 response.
import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const client = await prisma.client.findFirst({
    where: { phone: process.argv[2] ?? "9105550147" },
    select: { id: true, firstName: true, lastName: true, smsOptedOutAt: true, studioId: true },
  });
  if (!client) throw new Error("Walkthrough client not found.");

  console.log("CLIENT:", JSON.stringify(client, null, 2));

  const conv = await prisma.conversation.findFirst({
    where: { studioId: client.studioId, clientId: client.id },
    select: { id: true },
  });

  if (conv) {
    const messages = await prisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "asc" },
      select: { direction: true, body: true, metadata: true, createdAt: true },
    });
    console.log(`\nCONVERSATION ${conv.id} -- ${messages.length} messages:`);
    for (const m of messages) {
      const meta = (m.metadata as { deliveryStatus?: string; providerSid?: string } | null) ?? {};
      const status = meta.deliveryStatus ? ` [${meta.deliveryStatus}]` : "";
      const sid = meta.providerSid ? ` sid=${meta.providerSid.slice(0, 12)}...` : "";
      console.log(`  ${m.direction.padEnd(8)}${status}${sid}\n    "${m.body}"`);
    }
  }

  const audits = await prisma.auditLog.findMany({
    where: { entityType: "Client", entityId: client.id },
    orderBy: { createdAt: "asc" },
    select: { action: true, changes: true, createdAt: true },
  });
  console.log(`\nAUDIT (Client) -- ${audits.length} entries:`);
  for (const a of audits) {
    console.log(`  ${a.action}  ${JSON.stringify(a.changes)}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
