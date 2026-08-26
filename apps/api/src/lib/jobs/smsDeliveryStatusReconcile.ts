import { prisma } from "../prisma";
import { IntegrationChannel, IntegrationStatus, MessageChannel, MessageDirection } from "../../../generated/prisma/enums";
import { decryptSecret } from "../secrets";
import { fetchMessageStatus, isTerminalSmsStatus, type TwilioCredentials } from "../twilio";
import { emitInvalidation } from "../realtime/registry";
import { registerJob } from "./registry";

export const SMS_DELIVERY_STATUS_RECONCILE = "smsDeliveryStatusReconcile";

// Why this job exists, concretely: on 2026-08-25, five of nine real
// outbound sends sat at "queued" in this database while Twilio reported
// every one of them as delivered. Twilio's alert log showed no 11200s, so
// it never saw a failure response from us either -- meaning the callbacks
// were not merely rejected, they largely never arrived. The thread
// therefore showed "Queued" indefinitely for messages the client had
// already received, which is precisely the "a stalled send looks identical
// to a healthy one" failure the status column is supposed to prevent.
//
// Rather than guess at the mechanism, this pulls the truth from Twilio on a
// timer. That is robust to every candidate cause at once -- a callback
// never sent, one that arrived before the Message row was committed (the
// send hands off to Twilio BEFORE the row is written, so that window is
// real), or one lost in transit.
//
// The webhook path is untouched. It stays the fast path, so the ordinary
// case still updates within seconds; this only sweeps up what it missed.

// Don't chase a message the moment it's sent -- the callback deserves a
// chance to do its job first, and an in-flight message legitimately reads
// as queued/sending for a short while.
const GRACE_MINUTES = 10;

// Past this, stop asking. A message with no delivery receipt after three
// days is not going to acquire one, and some carriers never return one at
// all -- without this bound, every such message would be re-fetched from
// Twilio on every tick, forever.
const MAX_AGE_DAYS = 3;

// Ceiling on Twilio API calls per tick. Each reconcile is one HTTP request;
// this keeps a backlog (or an incident that stalled many messages at once)
// from turning into a burst against Twilio. Anything not covered in one
// tick is simply picked up by the next.
const MAX_PER_RUN = 200;

interface Candidate {
  id: string;
  studioId: string;
  providerSid: string;
  storedStatus: string | null;
  conversationId: string;
}

async function run(): Promise<Record<string, unknown>> {
  const now = Date.now();
  const olderThan = new Date(now - GRACE_MINUTES * 60 * 1000);
  const newerThan = new Date(now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  const rows = await prisma.message.findMany({
    where: {
      channel: MessageChannel.SMS,
      direction: MessageDirection.OUTBOUND,
      createdAt: { lt: olderThan, gt: newerThan },
    },
    select: { id: true, studioId: true, conversationId: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    // Over-fetch before the in-memory filter below: the non-terminal test
    // reads two keys out of a JSON blob, which is far more awkward (and
    // more brittle) to express as a Prisma JSON filter than to just do
    // here. Bounded, so this stays a small query either way.
    take: MAX_PER_RUN * 5,
  });

  const candidates: Candidate[] = [];
  for (const row of rows) {
    const meta = (row.metadata as { providerSid?: string; deliveryStatus?: string } | null) ?? {};
    if (!meta.providerSid) continue;
    // Staging dry-run sends never existed at Twilio -- fetching them would
    // 404 every time. See isSmsDryRun in lib/clientSms.ts.
    if (meta.providerSid.startsWith("DRYRUN")) continue;
    if (isTerminalSmsStatus(meta.deliveryStatus)) continue;
    candidates.push({
      id: row.id,
      studioId: row.studioId,
      conversationId: row.conversationId,
      providerSid: meta.providerSid,
      storedStatus: meta.deliveryStatus ?? null,
    });
    if (candidates.length >= MAX_PER_RUN) break;
  }

  if (candidates.length === 0) {
    return { checked: 0, updated: 0, unchanged: 0, notFound: 0, errors: 0, studiosSkipped: 0 };
  }

  // Credentials are per-studio, so decrypt once per studio rather than once
  // per message -- a backlog is usually one studio's worth of messages.
  const credentialsByStudio = new Map<string, TwilioCredentials | null>();
  async function credentialsFor(studioId: string): Promise<TwilioCredentials | null> {
    if (credentialsByStudio.has(studioId)) return credentialsByStudio.get(studioId)!;

    const integration = await prisma.studioIntegration.findUnique({
      where: { studioId_channel: { studioId, channel: IntegrationChannel.SMS } },
    });

    let creds: TwilioCredentials | null = null;
    if (integration?.status === IntegrationStatus.CONNECTED && integration.encryptedSecret) {
      try {
        creds = JSON.parse(decryptSecret(integration.encryptedSecret)) as TwilioCredentials;
      } catch {
        creds = null;
      }
    }
    credentialsByStudio.set(studioId, creds);
    return creds;
  }

  let checked = 0;
  let updated = 0;
  let unchanged = 0;
  let notFound = 0;
  let errors = 0;
  const touchedConversations = new Set<string>();
  const studiosSkipped = new Set<string>();

  for (const candidate of candidates) {
    const creds = await credentialsFor(candidate.studioId);
    if (!creds) {
      // A studio that disconnected SMS (or whose secret no longer decrypts)
      // simply can't be reconciled. Not an error -- there is nothing to ask.
      studiosSkipped.add(candidate.studioId);
      continue;
    }

    checked += 1;
    let result;
    try {
      result = await fetchMessageStatus(creds, candidate.providerSid);
    } catch (err) {
      errors += 1;
      console.error(`[${SMS_DELIVERY_STATUS_RECONCILE}] failed to fetch ${candidate.providerSid}`, err);
      continue;
    }

    if (!result) {
      notFound += 1;
      continue;
    }

    if (result.status === candidate.storedStatus) {
      unchanged += 1;
      continue;
    }

    // Re-read inside the update so a status callback that landed between
    // the fetch above and this write isn't clobbered by staler data.
    const current = await prisma.message.findUnique({ where: { id: candidate.id }, select: { metadata: true } });
    const existingMetadata = (current?.metadata as Record<string, unknown> | null) ?? {};
    if (isTerminalSmsStatus(existingMetadata.deliveryStatus as string | undefined)) {
      unchanged += 1;
      continue;
    }

    await prisma.message.update({
      where: { id: candidate.id },
      data: {
        metadata: {
          ...existingMetadata,
          deliveryStatus: result.status,
          // Only recorded when Twilio actually reports one, so a healthy
          // message never acquires an empty error key.
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
          ...(result.errorMessage ? { error: result.errorMessage } : {}),
          // Marks this status as reconciled rather than pushed, so a future
          // investigation can tell which path wrote it.
          deliveryStatusSource: SMS_DELIVERY_STATUS_RECONCILE,
        },
      },
    });

    updated += 1;
    touchedConversations.add(`${candidate.studioId}:${candidate.conversationId}`);
  }

  // One broadcast per affected thread, not per message -- a backlog sweep
  // shouldn't fire dozens of invalidations at the same open thread.
  for (const key of touchedConversations) {
    const [studioId, conversationId] = key.split(":");
    emitInvalidation({ type: "conversation.updated", studioId, conversationId });
  }

  return {
    candidates: candidates.length,
    checked,
    updated,
    unchanged,
    notFound,
    errors,
    studiosSkipped: studiosSkipped.size,
  };
}

registerJob({
  name: SMS_DELIVERY_STATUS_RECONCILE,
  description:
    "Asks Twilio for the real delivery status of outbound SMS still sitting in a non-terminal state, and corrects any this app was never told about.",
  schedule: "*/10 * * * *",
  // MUST match the cron cadence -- see JobDefinition.slotMinutes' own
  // comment on why a sub-daily job that leaves this at the default silently
  // runs once per day instead.
  slotMinutes: 10,
  run,
});
