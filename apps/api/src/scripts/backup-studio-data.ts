import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";

// Companion to cleanup-studio-data.ts: a full, restorable-by-inspection
// JSON export of every row that script's deletion would touch for one
// studio, taken immediately before a confirmed run. NOT a substitute for a
// real binary Postgres backup (pg_dump/Railway snapshot) in general --
// used here specifically because neither tool was available in this
// execution environment. Scoped to exactly the tables cleanup-studio-
// data.ts's own relation map covers (see that script's header comment for
// how that map was built and verified).
//
// Usage (from apps/api):
//   npx tsx src/scripts/backup-studio-data.ts --studio=some-slug [--out=path.json]
//
// Same authorization boundary as the other scripts in this directory --
// direct filesystem + DATABASE_URL access already required to run it.
//
// Deliberately writes to disk, not into the repo -- this contains real
// client PII (names, emails, phones). Never commit the output file.

function parseArgs(argv: string[]) {
  const get = (flag: string): string | null => {
    const prefix = `${flag}=`;
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : null;
  };
  const studioSlug = get("--studio");
  if (!studioSlug) {
    console.error("Usage: npx tsx src/scripts/backup-studio-data.ts --studio=<slug> [--out=path.json]");
    process.exit(1);
  }
  return { studioSlug, out: get("--out") };
}

async function main() {
  const { studioSlug, out } = parseArgs(process.argv.slice(2));

  const raw = process.env.DATABASE_URL ?? "";
  let hostLabel = "(unparseable DATABASE_URL)";
  try {
    const url = new URL(raw);
    hostLabel = `${url.hostname}/${url.pathname.replace(/^\//, "")}`;
  } catch {
    // handled below by proceeding with the placeholder label
  }
  console.log(`Connected to database: ${hostLabel}`);

  const studio = await prisma.studio.findUnique({ where: { slug: studioSlug } });
  if (!studio) {
    console.error(`No studio found with slug "${studioSlug}". Aborting -- nothing was exported.`);
    process.exit(1);
  }
  console.log(`Backing up studio: "${studio.name}" (slug: ${studio.slug}, id: ${studio.id})`);

  const clients = await prisma.client.findMany({ where: { studioId: studio.id } });
  const clientIds = clients.map((c) => c.id);

  const inquiries = await prisma.inquiry.findMany({ where: { clientId: { in: clientIds } } });
  const inquiryIds = inquiries.map((i) => i.id);

  const appointments = await prisma.appointment.findMany({ where: { clientId: { in: clientIds } } });
  const appointmentIds = appointments.map((a) => a.id);

  const conversations = await prisma.conversation.findMany({ where: { clientId: { in: clientIds } } });
  const conversationIds = conversations.map((c) => c.id);

  const [
    appointmentNotes,
    appointmentPhotos,
    liabilityWaivers,
    plannedSessions,
    depositForms,
    inquiryNotes,
    messages,
    messageReactions,
    conversationTags,
    conversationParticipants,
    conversationReads,
    prefillDrafts,
    clientEmails,
    clientPhones,
    giftCards,
    dismissedDuplicatePairs,
    importRowLinks,
  ] = await Promise.all([
    prisma.appointmentNote.findMany({ where: { appointmentId: { in: appointmentIds } } }),
    prisma.appointmentPhoto.findMany({ where: { appointmentId: { in: appointmentIds } } }),
    prisma.liabilityWaiver.findMany({
      where: { OR: [{ appointmentId: { in: appointmentIds } }, { clientId: { in: clientIds } }] },
    }),
    prisma.plannedSession.findMany({
      where: { OR: [{ appointmentId: { in: appointmentIds } }, { inquiryId: { in: inquiryIds } }] },
    }),
    prisma.depositForm.findMany({ where: { inquiryId: { in: inquiryIds } } }),
    prisma.inquiryNote.findMany({ where: { inquiryId: { in: inquiryIds } } }),
    prisma.message.findMany({ where: { conversationId: { in: conversationIds } } }),
    prisma.messageReaction.findMany({ where: { message: { conversationId: { in: conversationIds } } } }),
    prisma.conversationTag.findMany({
      where: {
        OR: [
          { conversationId: { in: conversationIds } },
          { entityType: "Inquiry", entityId: { in: inquiryIds } },
          { entityType: "Appointment", entityId: { in: appointmentIds } },
        ],
      },
    }),
    prisma.conversationParticipant.findMany({ where: { conversationId: { in: conversationIds } } }),
    prisma.conversationRead.findMany({ where: { conversationId: { in: conversationIds } } }),
    prisma.prefillDraft.findMany({ where: { conversationId: { in: conversationIds } } }),
    prisma.clientEmail.findMany({ where: { clientId: { in: clientIds } } }),
    prisma.clientPhone.findMany({ where: { clientId: { in: clientIds } } }),
    prisma.giftCard.findMany({ where: { clientId: { in: clientIds } } }),
    prisma.dismissedDuplicatePair.findMany({
      where: { OR: [{ clientAId: { in: clientIds } }, { clientBId: { in: clientIds } }] },
    }),
    // Not deleted by cleanup-studio-data.ts (matchedClientId is only
    // nulled, the ImportRow itself survives) -- captured here purely so
    // the "before" link is recoverable if ever needed.
    prisma.importRow.findMany({ where: { matchedClientId: { in: clientIds } } }),
  ]);

  const snapshot = {
    exportedAt: new Date().toISOString(),
    database: hostLabel,
    studio,
    counts: {
      clients: clients.length,
      inquiries: inquiries.length,
      appointments: appointments.length,
      depositForms: depositForms.length,
      giftCards: giftCards.length,
      liabilityWaivers: liabilityWaivers.length,
      conversations: conversations.length,
      messages: messages.length,
    },
    clients,
    inquiries,
    appointments,
    appointmentNotes,
    appointmentPhotos,
    liabilityWaivers,
    plannedSessions,
    depositForms,
    inquiryNotes,
    conversations,
    messages,
    messageReactions,
    conversationTags,
    conversationParticipants,
    conversationReads,
    prefillDrafts,
    clientEmails,
    clientPhones,
    giftCards,
    dismissedDuplicatePairs,
    importRowLinks,
  };

  const outPath = out ?? path.join(process.cwd(), `backup-${studio.slug}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(snapshot, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2),
  );

  console.log(`\nWrote backup to: ${outPath}`);
  console.log("Row counts:");
  for (const [key, value] of Object.entries(snapshot.counts)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(
    `  appointmentNotes: ${appointmentNotes.length}, appointmentPhotos: ${appointmentPhotos.length}, plannedSessions: ${plannedSessions.length}, inquiryNotes: ${inquiryNotes.length}, messageReactions: ${messageReactions.length}, conversationTags: ${conversationTags.length}, conversationParticipants: ${conversationParticipants.length}, conversationReads: ${conversationReads.length}, prefillDrafts: ${prefillDrafts.length}, clientEmails: ${clientEmails.length}, clientPhones: ${clientPhones.length}, dismissedDuplicatePairs: ${dismissedDuplicatePairs.length}, importRowLinks: ${importRowLinks.length}`,
  );
  console.log(
    "\nThis is real client PII -- do not commit this file to git, and delete/move it somewhere secure once you no longer need it.",
  );
}

main()
  .catch((err) => {
    console.error("FATAL", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
