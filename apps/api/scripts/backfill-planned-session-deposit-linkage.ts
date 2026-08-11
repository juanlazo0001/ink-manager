// One-time backfill for the Session-Plan/DepositForm linkage bug (see
// lib/estimates.ts's reconcilePlannedSessions, "Linkage bug fix" comment):
// a plan declared/revised on an inquiry that already had an un-planned
// DepositForm left the new PlannedSession row's depositFormId null, even
// when a real DepositForm with the same sessionNumber already existed on
// the same inquiry -- the Session Plan widget then showed that session as
// "Deposit not yet generated" (and kept it fully actionable via Send
// Deposit Form) despite it already being signed or paid.
//
// Going forward, reconcilePlannedSessions itself closes this gap. This
// script is the one-time catch-up for rows that already desynced before
// that fix shipped -- links unambiguously (exactly one DepositForm with a
// matching sessionNumber, on the same inquiry, currently unlinked from any
// PlannedSession); everything else is reported, never guessed at.
//
// Idempotent and safe to re-run: only ever touches a PlannedSession row
// whose depositFormId is currently null, and only ever sets it, never
// clears or overwrites an existing link.
//
// Usage (from apps/api): npx tsx -r dotenv/config scripts/backfill-planned-session-deposit-linkage.ts dotenv_config_path=.env
// Add --dry-run to only report, without writing anything.
import { prisma } from "../src/lib/prisma";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const inquiries = await prisma.inquiry.findMany({
    where: { plannedSessions: { some: { depositFormId: null } } },
    select: {
      id: true,
      studioId: true,
      plannedSessions: { select: { id: true, sessionNumber: true, depositFormId: true }, orderBy: { sessionNumber: "asc" } },
      depositForms: { select: { id: true, sessionNumber: true, signedAt: true, paidAt: true } },
    },
  });

  let unlinkedSessionsChecked = 0;
  let linkedUnambiguous = 0;
  let alreadyCorrect = 0;
  const ambiguous: unknown[] = [];
  const noMatch = { count: 0 };
  const updates: { plannedSessionId: string; depositFormId: string; inquiryId: string; sessionNumber: number }[] = [];

  for (const inq of inquiries) {
    for (const ps of inq.plannedSessions) {
      if (ps.depositFormId != null) {
        alreadyCorrect += 1;
        continue;
      }
      unlinkedSessionsChecked += 1;
      const matches = inq.depositForms.filter((df) => df.sessionNumber === ps.sessionNumber);
      if (matches.length === 0) {
        noMatch.count += 1; // genuinely no deposit form yet -- correct as-is
        continue;
      }
      if (matches.length > 1) {
        ambiguous.push({
          inquiryId: inq.id,
          plannedSessionId: ps.id,
          sessionNumber: ps.sessionNumber,
          candidateDepositFormIds: matches.map((m) => m.id),
        });
        continue;
      }
      linkedUnambiguous += 1;
      updates.push({ plannedSessionId: ps.id, depositFormId: matches[0].id, inquiryId: inq.id, sessionNumber: ps.sessionNumber });
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        inquiriesWithAnyUnlinkedSession: inquiries.length,
        unlinkedSessionsChecked,
        alreadyCorrectlyLinked: alreadyCorrect,
        genuinelyNoDepositFormYet: noMatch.count,
        linkedUnambiguous,
        ambiguousNotTouched: ambiguous,
        updates,
      },
      null,
      2,
    ),
  );

  if (!DRY_RUN && updates.length > 0) {
    await prisma.$transaction(
      updates.map((u) => prisma.plannedSession.update({ where: { id: u.plannedSessionId }, data: { depositFormId: u.depositFormId } })),
    );
    console.log(`Applied ${updates.length} update(s).`);
  } else if (DRY_RUN) {
    console.log("Dry run -- no writes performed.");
  } else {
    console.log("No unambiguous updates to apply.");
  }

  process.exit(0);
}

main();
