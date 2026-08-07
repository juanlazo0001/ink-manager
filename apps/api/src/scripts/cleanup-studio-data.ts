import "dotenv/config";
import { prisma } from "../lib/prisma";
import { Prisma } from "../../generated/prisma/client";

// One-off (repeatable) studio data wipe -- the seed of the future in-app
// bulk-delete feature. Deletes every CLIENT-SIDE record for one studio
// (clients, inquiries/projects, and everything that hangs off them:
// appointments, deposit forms, gift cards, liability waivers, notes,
// client conversation threads) -- never studio configuration, never staff/
// user/artist accounts, never another studio's data.
//
// DRY RUN is the default and only mode until BOTH --confirm and a retyped
// --confirm-studio=<slug> (must exactly match --studio) are given. A
// second, separate bucket -- anything touched by a real Stripe/Cash
// payment, a signed deposit form or waiver, or a completed session --
// additionally requires --include-protected. All three together (confirm
// + matching slug + include-protected) are required for a full wipe; none
// of the three is ever implied by the others.
//
// Usage (from apps/api):
//   npx tsx src/scripts/cleanup-studio-data.ts --studio=some-slug
//     Dry run only -- prints the full two-section report, deletes nothing.
//   npx tsx src/scripts/cleanup-studio-data.ts --studio=some-slug --confirm --confirm-studio=some-slug
//     Deletes section 1 (standard) only. Section 2 (protected) is left
//     completely untouched, including the client rows it belongs to (a
//     client with even one protected record can't be fully deleted until
//     that record is too -- see "protection is per-client" below).
//   npx tsx src/scripts/cleanup-studio-data.ts --studio=some-slug --confirm --confirm-studio=some-slug --include-protected
//     Full wipe -- both sections.
//
// Same authorization boundary as scripts/create-studio.ts: whoever can run
// this has direct filesystem + DATABASE_URL access already (dev via .env,
// production only as a deliberate one-off pointed at .env.production per
// DEVELOPMENT.md) -- nothing here is reachable over HTTP.
//
// Judgment call -- protection is scoped PER CLIENT, not per inquiry: a
// client with a mix of protected and unprotected inquiries stays fully
// intact (including their unprotected inquiries) until --include-protected
// is used, rather than surgically deleting some of a client's inquiries
// while leaving others. Slicing a single client's history mid-relationship
// is a much easier way to end up in a half-deleted, hard-to-reason-about
// state than "this whole client waits for the protected flag." The report
// still lists every individual protected record so nothing is a surprise.
//
// Judgment call -- AuditLog and TaskDismissal are deliberately left alone.
// Neither has a real foreign key to Client/Inquiry/Appointment (entityId
// is a plain polymorphic string on both, same as ConversationTag's own
// entityId) -- deleting the records they reference cannot violate a
// constraint. AuditLog is the studio's own historical record of who did
// what, when; leaving it referencing a since-deleted entity is the same
// "preserve the record, the thing it pointed at is just gone now"
// precedent already used for Message.authorUserId/GiftCard.issuedById
// when a STAFF account is deleted. TaskDismissal rows for now-deleted
// entities are inert either way -- the derived task they dismissed can
// never be computed again for a row that no longer exists.
//
// Judgment call -- ImportRow.matchedClientId is NULLED, not deleted along
// with the client. ImportRow is the mass-import tool's own operational
// log (what a CSV row looked like, what it matched, what staff decided) --
// not itself "this client's data," and deleting it would erase real
// import history for no benefit once the FK is released.
//
// Judgment call -- a CUSTOMER-role User account tied to a deleted Client
// via Client.userId survives, now pointing at nothing (Client is the
// referencing side; deleting it doesn't touch User at all). This is
// exactly what "must not touch ... user accounts" requires, but it does
// mean a self-serve customer login can outlive the client record it was
// for -- flagged here since it's a real, visible consequence, not because
// this script does anything about it.

interface ParsedArgs {
  studioSlug: string;
  confirm: boolean;
  confirmStudio: string | null;
  includeProtected: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const get = (flag: string): string | null => {
    const prefix = `${flag}=`;
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : null;
  };

  const studioSlug = get("--studio");
  if (!studioSlug) {
    console.error(
      "Usage: npx tsx src/scripts/cleanup-studio-data.ts --studio=<slug> [--confirm --confirm-studio=<slug> [--include-protected]]",
    );
    process.exit(1);
  }

  return {
    studioSlug,
    confirm: argv.includes("--confirm"),
    confirmStudio: get("--confirm-studio"),
    includeProtected: argv.includes("--include-protected"),
  };
}

function printConnectionInfo() {
  const raw = process.env.DATABASE_URL ?? "";
  try {
    const url = new URL(raw);
    console.log(`Connected to database: host=${url.hostname} db=${url.pathname.replace(/^\//, "")}`);
  } catch {
    console.log("Connected to database: (could not parse DATABASE_URL host/db -- refusing to guess, check env)");
    process.exit(1);
  }
}

async function printAllStudios() {
  const studios = await prisma.studio.findMany({
    select: { id: true, name: true, slug: true, _count: { select: { clients: true } } },
    orderBy: { name: "asc" },
  });
  console.log(`\nAll studios in this database (${studios.length}):`);
  for (const s of studios) {
    console.log(`  - ${s.name}  (slug: ${s.slug}, clients: ${s._count.clients})`);
  }
}

// ---- Protection classification -------------------------------------------

interface ClientRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  createdAt: Date;
}

interface ClassifiedClient {
  client: ClientRow;
  inquiries: { id: string; description: string; status: string; createdAt: Date }[];
  appointmentCount: number;
  completedAppointmentCount: number;
  depositFormCount: number;
  signedDepositFormCount: number;
  giftCardCount: number;
  paidGiftCardCount: number;
  waiverCount: number;
  signedWaiverCount: number;
  conversationCount: number;
  protected: boolean;
}

async function classifyStudioClients(studioId: string): Promise<ClassifiedClient[]> {
  const clients = await prisma.client.findMany({
    where: { studioId },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const results: ClassifiedClient[] = [];
  for (const client of clients) {
    const [inquiries, appointments, depositForms, giftCards, waivers, conversationCount] = await Promise.all([
      prisma.inquiry.findMany({
        where: { clientId: client.id },
        select: { id: true, description: true, status: true, createdAt: true },
      }),
      prisma.appointment.findMany({ where: { clientId: client.id }, select: { status: true } }),
      prisma.depositForm.findMany({
        where: { inquiry: { clientId: client.id } },
        select: { signedAt: true },
      }),
      prisma.giftCard.findMany({ where: { clientId: client.id }, select: { paymentMethod: true } }),
      prisma.liabilityWaiver.findMany({ where: { clientId: client.id }, select: { status: true } }),
      prisma.conversation.count({ where: { clientId: client.id } }),
    ]);

    const completedAppointmentCount = appointments.filter((a) => a.status === "COMPLETED").length;
    const signedDepositFormCount = depositForms.filter((d) => d.signedAt != null).length;
    const paidGiftCardCount = giftCards.filter((g) => g.paymentMethod === "STRIPE" || g.paymentMethod === "CASH").length;
    const signedWaiverCount = waivers.filter((w) => w.status === "SIGNED" || w.status === "VERIFIED").length;

    results.push({
      client,
      inquiries,
      appointmentCount: appointments.length,
      completedAppointmentCount,
      depositFormCount: depositForms.length,
      signedDepositFormCount,
      giftCardCount: giftCards.length,
      paidGiftCardCount,
      waiverCount: waivers.length,
      signedWaiverCount,
      conversationCount,
      protected:
        completedAppointmentCount > 0 || signedDepositFormCount > 0 || paidGiftCardCount > 0 || signedWaiverCount > 0,
    });
  }
  return results;
}

function printReport(classified: ClassifiedClient[]) {
  const standard = classified.filter((c) => !c.protected);
  const protectedClients = classified.filter((c) => c.protected);

  console.log("\n" + "=".repeat(78));
  console.log("SECTION 1 -- STANDARD (no payment, no signed form/waiver, no completed session)");
  console.log("=".repeat(78));
  console.log(`${standard.length} client(s)`);
  let inquiryTotal = 0;
  let appointmentTotal = 0;
  let depositFormTotal = 0;
  let giftCardTotal = 0;
  let waiverTotal = 0;
  let conversationTotal = 0;
  for (const c of standard) {
    inquiryTotal += c.inquiries.length;
    appointmentTotal += c.appointmentCount;
    depositFormTotal += c.depositFormCount;
    giftCardTotal += c.giftCardCount;
    waiverTotal += c.waiverCount;
    conversationTotal += c.conversationCount;
    console.log(
      `\n  Client ${c.client.id}  "${c.client.firstName} ${c.client.lastName}"  <${c.client.email ?? "no email"}>  created ${c.client.createdAt.toISOString()}`,
    );
    if (c.inquiries.length === 0) {
      console.log("    (no inquiries)");
    }
    for (const inq of c.inquiries) {
      console.log(`    Inquiry/Project ${inq.id}  [${inq.status}]  "${inq.description}"  created ${inq.createdAt.toISOString()}`);
    }
    if (c.appointmentCount || c.depositFormCount || c.giftCardCount || c.waiverCount || c.conversationCount) {
      console.log(
        `    related: ${c.appointmentCount} appointment(s), ${c.depositFormCount} deposit form(s), ${c.giftCardCount} gift card(s), ${c.waiverCount} waiver(s), ${c.conversationCount} conversation thread(s)`,
      );
    }
  }
  console.log(
    `\nSection 1 totals: ${standard.length} clients, ${inquiryTotal} inquiries/projects, ${appointmentTotal} appointments, ${depositFormTotal} deposit forms, ${giftCardTotal} gift cards, ${waiverTotal} waivers, ${conversationTotal} conversation threads.`,
  );

  console.log("\n" + "=".repeat(78));
  console.log("SECTION 2 -- PROTECTED (real payment, signed form/waiver, or a completed session)");
  console.log("=".repeat(78));
  console.log(
    "A client lands here if ANY of their records do -- see the script's own comment on why protection is scoped per client, not per inquiry. Stripe-linked rows: deleting these LOCAL rows does not touch Stripe's own ledger -- those charges/transactions remain in the Stripe dashboard regardless of what happens here.",
  );
  inquiryTotal = 0;
  appointmentTotal = 0;
  depositFormTotal = 0;
  giftCardTotal = 0;
  waiverTotal = 0;
  conversationTotal = 0;
  let signedDepositTotal = 0;
  let paidGiftCardTotal = 0;
  let signedWaiverTotal = 0;
  let completedApptTotal = 0;
  for (const c of protectedClients) {
    inquiryTotal += c.inquiries.length;
    appointmentTotal += c.appointmentCount;
    depositFormTotal += c.depositFormCount;
    giftCardTotal += c.giftCardCount;
    waiverTotal += c.waiverCount;
    conversationTotal += c.conversationCount;
    signedDepositTotal += c.signedDepositFormCount;
    paidGiftCardTotal += c.paidGiftCardCount;
    signedWaiverTotal += c.signedWaiverCount;
    completedApptTotal += c.completedAppointmentCount;
    console.log(
      `\n  Client ${c.client.id}  "${c.client.firstName} ${c.client.lastName}"  <${c.client.email ?? "no email"}>  created ${c.client.createdAt.toISOString()}`,
    );
    for (const inq of c.inquiries) {
      console.log(`    Inquiry/Project ${inq.id}  [${inq.status}]  "${inq.description}"  created ${inq.createdAt.toISOString()}`);
    }
    console.log(
      `    protection trigger(s): ${c.signedDepositFormCount} signed deposit form(s), ${c.paidGiftCardCount} paid (Stripe/Cash) gift card(s), ${c.signedWaiverCount} signed/verified waiver(s), ${c.completedAppointmentCount} completed session(s)`,
    );
    console.log(
      `    related (all): ${c.appointmentCount} appointment(s), ${c.depositFormCount} deposit form(s), ${c.giftCardCount} gift card(s), ${c.waiverCount} waiver(s), ${c.conversationCount} conversation thread(s)`,
    );
  }
  console.log(
    `\nSection 2 totals: ${protectedClients.length} clients, ${inquiryTotal} inquiries/projects, ${appointmentTotal} appointments, ${depositFormTotal} deposit forms (${signedDepositTotal} signed), ${giftCardTotal} gift cards (${paidGiftCardTotal} paid via Stripe/Cash), ${waiverTotal} waivers (${signedWaiverTotal} signed/verified), ${completedApptTotal} completed session(s), ${conversationTotal} conversation threads.`,
  );
  console.log("\n" + "=".repeat(78));

  return { standard, protectedClients };
}

// ---- Deletion --------------------------------------------------------------

async function deleteClients(studioId: string, clientIds: string[]) {
  if (clientIds.length === 0) {
    return { clients: 0, inquiries: 0, appointments: 0, depositForms: 0, giftCards: 0, waivers: 0, conversations: 0 };
  }

  // Guard: refuse if a client OUTSIDE this deletion batch (kept because it's
  // protected, or -- should not happen given studio scoping, but checked
  // anyway -- belongs to a different studio) references one of these
  // clients as a referral/merge target. Silently nulling another client's
  // field that isn't itself being reviewed/deleted this run would be an
  // accidental cascade into a record outside this operation's scope.
  const blockingReferences = await prisma.client.findMany({
    where: {
      OR: [{ referredByClientId: { in: clientIds } }, { mergedIntoId: { in: clientIds } }],
      id: { notIn: clientIds },
    },
    select: { id: true, referredByClientId: true, mergedIntoId: true },
  });
  if (blockingReferences.length > 0) {
    const blockedTargets = new Set(
      blockingReferences.flatMap((b) => [b.referredByClientId, b.mergedIntoId].filter((x): x is string => x != null)),
    );
    console.warn(
      `\nWARNING: ${blockingReferences.length} client(s) outside this deletion batch reference ${blockedTargets.size} of the target clients as a referral/merge target. Excluding those ${blockedTargets.size} referenced client(s) from this run so nothing outside scope gets silently modified. Re-run after resolving manually if they also need to go.`,
    );
    clientIds = clientIds.filter((id) => !blockedTargets.has(id));
  }
  if (clientIds.length === 0) {
    return { clients: 0, inquiries: 0, appointments: 0, depositForms: 0, giftCards: 0, waivers: 0, conversations: 0 };
  }

  const inquiries = await prisma.inquiry.findMany({ where: { clientId: { in: clientIds }, studioId }, select: { id: true } });
  const inquiryIds = inquiries.map((i) => i.id);
  const appointments = await prisma.appointment.findMany({
    where: { clientId: { in: clientIds }, studioId },
    select: { id: true },
  });
  const appointmentIds = appointments.map((a) => a.id);
  const conversations = await prisma.conversation.findMany({
    where: { clientId: { in: clientIds }, studioId },
    select: { id: true },
  });
  const conversationIds = conversations.map((c) => c.id);

  const counts = await prisma.$transaction(async (tx) => {
    // Step 1 -- break internal cycles / release FKs, all scoped to this
    // batch's own clients/inquiries/appointments/conversations only.
    await tx.client.updateMany({
      where: { id: { in: clientIds }, referredByClientId: { in: clientIds } },
      data: { referredByClientId: null },
    });
    await tx.client.updateMany({
      where: { id: { in: clientIds }, mergedIntoId: { in: clientIds } },
      data: { mergedIntoId: null },
    });
    await tx.client.updateMany({
      where: { id: { in: clientIds }, referralRewardGiftCardId: { not: null } },
      data: { referralRewardGiftCardId: null },
    });
    await tx.giftCard.updateMany({ where: { clientId: { in: clientIds } }, data: { derivedFromGiftCardId: null } });
    await tx.giftCard.updateMany({ where: { clientId: { in: clientIds } }, data: { appointmentId: null } });
    await tx.inquiry.updateMany({ where: { id: { in: inquiryIds } }, data: { appointmentId: null } });
    await tx.importRow.updateMany({ where: { matchedClientId: { in: clientIds } }, data: { matchedClientId: null } });
    await tx.prefillDraft.updateMany({ where: { conversationId: { in: conversationIds } }, data: { conversationId: null } });

    // Step 2 -- Appointment-dependent leaves, then Appointments themselves.
    await tx.appointmentNote.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
    await tx.appointmentPhoto.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
    const deletedWaivers = await tx.liabilityWaiver.deleteMany({
      where: { OR: [{ appointmentId: { in: appointmentIds } }, { clientId: { in: clientIds } }] },
    });
    await tx.plannedSession.deleteMany({
      where: { OR: [{ appointmentId: { in: appointmentIds } }, { inquiryId: { in: inquiryIds } }] },
    });
    const deletedAppointments = await tx.appointment.deleteMany({ where: { id: { in: appointmentIds } } });

    // Step 3 -- Inquiry-dependent leaves, then Inquiries themselves.
    const deletedDepositForms = await tx.depositForm.deleteMany({ where: { inquiryId: { in: inquiryIds } } });
    await tx.inquiryNote.deleteMany({ where: { inquiryId: { in: inquiryIds } } });
    const deletedInquiries = await tx.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });

    // Step 4 -- Conversation-dependent leaves (including tags placed on
    // OTHER studio conversations -- e.g. a staff Team thread -- pointing
    // at an Inquiry/Appointment being deleted here), then Conversations.
    await tx.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await tx.conversationParticipant.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await tx.conversationRead.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await tx.conversationTag.deleteMany({
      where: {
        OR: [
          { conversationId: { in: conversationIds } },
          { entityType: "Inquiry", entityId: { in: inquiryIds } },
          { entityType: "Appointment", entityId: { in: appointmentIds } },
        ],
      },
    });
    const deletedConversations = await tx.conversation.deleteMany({ where: { id: { in: conversationIds } } });

    // Step 5 -- Client-dependent leaves, then Clients themselves.
    await tx.clientEmail.deleteMany({ where: { clientId: { in: clientIds } } });
    await tx.clientPhone.deleteMany({ where: { clientId: { in: clientIds } } });
    const deletedGiftCards = await tx.giftCard.deleteMany({ where: { clientId: { in: clientIds } } });
    await tx.dismissedDuplicatePair.deleteMany({
      where: { OR: [{ clientAId: { in: clientIds } }, { clientBId: { in: clientIds } }] },
    });
    const deletedClients = await tx.client.deleteMany({ where: { id: { in: clientIds } } });

    return {
      clients: deletedClients.count,
      inquiries: deletedInquiries.count,
      appointments: deletedAppointments.count,
      depositForms: deletedDepositForms.count,
      giftCards: deletedGiftCards.count,
      waivers: deletedWaivers.count,
      conversations: deletedConversations.count,
    };
  });

  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  printConnectionInfo();
  await printAllStudios();

  const studio = await prisma.studio.findUnique({ where: { slug: args.studioSlug } });
  if (!studio) {
    console.error(`\nNo studio found with slug "${args.studioSlug}". Aborting -- nothing was touched.`);
    process.exit(1);
  }
  console.log(`\nResolved studio: "${studio.name}" (slug: ${studio.slug}, id: ${studio.id})`);

  const classified = await classifyStudioClients(studio.id);
  const { standard, protectedClients } = printReport(classified);

  if (!args.confirm) {
    console.log("\nDRY RUN ONLY -- nothing was deleted. Re-run with --confirm --confirm-studio=<slug> to delete section 1.");
    return;
  }

  if (args.confirmStudio !== args.studioSlug) {
    console.error(
      `\nRefusing to delete: --confirm-studio (${JSON.stringify(args.confirmStudio)}) does not match --studio (${JSON.stringify(args.studioSlug)}). Nothing was touched.`,
    );
    process.exit(1);
  }

  const targetClientIds = args.includeProtected
    ? classified.map((c) => c.client.id)
    : standard.map((c) => c.client.id);

  console.log(
    `\nProceeding to delete ${targetClientIds.length} client(s) ${args.includeProtected ? "(section 1 + section 2, --include-protected)" : "(section 1 only)"} from "${studio.name}"...`,
  );
  if (!args.includeProtected && protectedClients.length > 0) {
    console.log(`${protectedClients.length} protected client(s) will be left completely untouched.`);
  }

  const result = await deleteClients(studio.id, targetClientIds);

  console.log("\nDeleted:");
  console.log(`  clients: ${result.clients}`);
  console.log(`  inquiries/projects: ${result.inquiries}`);
  console.log(`  appointments: ${result.appointments}`);
  console.log(`  deposit forms: ${result.depositForms}`);
  console.log(`  gift cards: ${result.giftCards}`);
  console.log(`  liability waivers: ${result.waivers}`);
  console.log(`  conversation threads: ${result.conversations}`);
  console.log("\nDone. Re-run this script (without --confirm) to verify -- expect the deleted section to show zero.");
}

main()
  .catch((err) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("FATAL (Prisma):", err.code, err.message);
    } else {
      console.error("FATAL", err);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
