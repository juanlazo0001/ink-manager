import { prisma } from "../prisma";
import { fetchExpoReceipts } from "../expoPush";
import { registerJob } from "./registry";

export const PUSH_RECEIPT_CHECK = "pushReceiptCheck";

// Expo's send call returns a TICKET, not a delivery result: "accepted,
// we'll try". The actual outcome arrives minutes later from a separate
// receipts endpoint, and it is the ONLY place DeviceNotRegistered reliably
// shows up -- the signal that a token belongs to an app that has been
// uninstalled, or a device that has been wiped.
//
// Without this job, dead tokens accumulate forever and every notification
// pays to push to them. Worse, a token can be recycled by Expo, so a stale
// row eventually means pushing one person's notifications to a stranger's
// phone. That is the real reason receipts are checked, not delivery
// statistics.

// Receipts are not ready immediately. Asking too early just gets an empty
// answer, and the ticket stays queued for the next tick anyway -- this
// only avoids burning a request to learn that.
const GRACE_MINUTES = 15;

// Past this, give up. Expo documents receipts as available for a limited
// window; a ticket with no answer after a day is not going to acquire one,
// and without a bound these rows would be re-queried on every tick forever.
const MAX_AGE_HOURS = 24;

// Ceiling per tick, so a backlog (or a burst of notifications) cannot turn
// into an unbounded number of requests against Expo in one run. Anything
// left over is simply picked up by the next tick.
const MAX_PER_RUN = 900;

async function run() {
  const now = Date.now();
  const readyBefore = new Date(now - GRACE_MINUTES * 60 * 1000);
  const expiredBefore = new Date(now - MAX_AGE_HOURS * 60 * 60 * 1000);

  // Abandoned tickets first, so they can never crowd out live ones.
  const { count: expired } = await prisma.pushReceipt.deleteMany({
    where: { createdAt: { lt: expiredBefore } },
  });

  const pending = await prisma.pushReceipt.findMany({
    where: { createdAt: { lt: readyBefore } },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_RUN,
    select: { ticketId: true, token: true },
  });

  if (pending.length === 0) {
    return { expired, pending: 0, settled: 0, tokensPruned: 0 };
  }

  const { settledTicketIds, deadTicketIds } = await fetchExpoReceipts(pending.map((p) => p.ticketId));

  // A ticket Expo did NOT answer for is simply not ready yet -- left in
  // the queue rather than deleted, so it gets another pass. Only ids it
  // actually returned a verdict on are cleared.
  const deadTokens = [
    ...new Set(
      pending.filter((p) => deadTicketIds.includes(p.ticketId)).map((p) => p.token),
    ),
  ];

  let tokensPruned = 0;
  if (deadTokens.length > 0) {
    ({ count: tokensPruned } = await prisma.pushToken.deleteMany({ where: { token: { in: deadTokens } } }));
  }

  if (settledTicketIds.length > 0) {
    await prisma.pushReceipt.deleteMany({ where: { ticketId: { in: settledTicketIds } } });
  }

  return { expired, pending: pending.length, settled: settledTicketIds.length, tokensPruned };
}

registerJob({
  name: PUSH_RECEIPT_CHECK,
  description:
    "Collects Expo push delivery receipts for tickets sent earlier and deletes any device token Expo reports as no longer registered.",
  schedule: "*/15 * * * *",
  // MUST match the cron cadence -- see JobDefinition.slotMinutes' own
  // comment on why a sub-daily job left at the default silently runs once
  // per day instead of on every tick.
  slotMinutes: 15,
  run,
});
