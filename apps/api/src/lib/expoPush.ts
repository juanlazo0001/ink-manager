// Expo push transport. Deliberately a hand-rolled fetch client rather
// than expo-server-sdk: the whole surface is two POSTs to two documented
// endpoints, and the SDK would be a third-party dependency in the API
// process for the sake of chunking an array.
//
// Two things about Expo's model that the shape of this file follows from:
//
//  1. The send call does NOT report delivery. It returns a TICKET per
//     message -- "accepted, we'll try" -- and the real outcome arrives
//     minutes later from a separate receipts endpoint. So sending and
//     learning what happened are two different operations at two
//     different times, which is why PushReceipt exists as a queue and
//     why lib/jobs/pushReceiptCheck.ts is a job rather than an await.
//  2. DeviceNotRegistered is the only reliable signal that a token is
//     dead, and it can come back from EITHER call. Both paths below
//     surface it the same way so the caller has one thing to act on.
//
// Nothing here throws. A push is a courtesy on top of a Notification row
// that has already been persisted and already been pushed down the
// socket -- the bell is correct whether or not Expo is reachable, and a
// provider outage must never turn into a failed HTTP response on the
// message the user was actually sending. Same "never throws" contract
// lib/realtime/registry.ts's emitInvalidation and the job runner both
// hold.

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

// Expo's documented per-request limits. Sending more in one call is
// rejected outright, so these are correctness, not tuning.
const SEND_CHUNK = 100;
const RECEIPT_CHUNK = 300;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  // Delivered to the app as `notification.request.content.data` -- this is
  // the deep link. Kept small: Expo caps the whole message at 4KiB.
  data: Record<string, unknown>;
  badge?: number;
}

export interface ExpoSendResult {
  /** ticketId -> the token it was for, for the receipt pass to look up later. */
  tickets: { ticketId: string; token: string }[];
  /** Tokens Expo rejected outright at send time. Already known dead. */
  deadTokens: string[];
}

// Optional. Expo only REQUIRES it when a project has enhanced security
// enabled; without that, an unauthenticated send to a valid ExponentPush
// token works, which is what a project on Expo Go has. Read at call time
// rather than module load so a deployment can add it without a rebuild.
function authHeaders(): Record<string, string> {
  const token = process.env.EXPO_ACCESS_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// An Expo token always looks like ExponentPushToken[...] or
// ExpoPushToken[...]. Checked before anything is stored or sent, because
// a malformed entry in a chunk makes Expo reject the WHOLE chunk, not
// just that message -- one bad token would silently cost 99 good pushes.
export function isExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(value);
}

export async function sendExpoPushes(messages: ExpoPushMessage[]): Promise<ExpoSendResult> {
  const result: ExpoSendResult = { tickets: [], deadTokens: [] };
  if (messages.length === 0) return result;

  for (const batch of chunk(messages, SEND_CHUNK)) {
    try {
      const res = await fetch(EXPO_SEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders() },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        // A 4xx/5xx from Expo itself (rate limit, outage, bad auth). The
        // Notification rows are already written and already on the socket,
        // so this is logged and dropped rather than retried -- a retry
        // queue for a courtesy channel is not worth the duplicate-push
        // risk it introduces.
        console.error("[push] Expo send failed", res.status, await res.text().catch(() => ""));
        continue;
      }

      const json = (await res.json()) as { data?: unknown };
      const tickets = Array.isArray(json.data) ? json.data : [];

      // Expo returns one entry per message, IN ORDER -- that positional
      // correspondence is the only thing tying a ticket back to a token,
      // since the ticket itself does not name one.
      tickets.forEach((ticket, i) => {
        const token = batch[i]?.to;
        if (!token) return;
        const t = ticket as { status?: string; id?: string; details?: { error?: string } };
        if (t.status === "ok" && t.id) {
          result.tickets.push({ ticketId: t.id, token });
        } else if (t.details?.error === "DeviceNotRegistered") {
          result.deadTokens.push(token);
        } else {
          console.error("[push] Expo rejected a message", JSON.stringify(t));
        }
      });
    } catch (err) {
      console.error("[push] Expo send threw", err);
    }
  }

  return result;
}

export interface ExpoReceiptResult {
  /** Ticket ids Expo answered for at all -- checked, whatever the verdict. */
  settledTicketIds: string[];
  /** Ticket ids whose receipt said the device is gone. */
  deadTicketIds: string[];
}

export async function fetchExpoReceipts(ticketIds: string[]): Promise<ExpoReceiptResult> {
  const result: ExpoReceiptResult = { settledTicketIds: [], deadTicketIds: [] };
  if (ticketIds.length === 0) return result;

  for (const batch of chunk(ticketIds, RECEIPT_CHUNK)) {
    try {
      const res = await fetch(EXPO_RECEIPTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders() },
        body: JSON.stringify({ ids: batch }),
      });

      if (!res.ok) {
        console.error("[push] Expo receipts failed", res.status, await res.text().catch(() => ""));
        continue;
      }

      const json = (await res.json()) as { data?: Record<string, unknown> };
      const receipts = json.data ?? {};

      // A ticket id ABSENT from the response is not an error: Expo has
      // simply not finished with it yet. Only ids it actually answered
      // for are marked settled, so an unready one is left in the queue
      // and picked up on a later tick rather than being dropped.
      for (const [ticketId, raw] of Object.entries(receipts)) {
        const receipt = raw as { status?: string; details?: { error?: string } };
        result.settledTicketIds.push(ticketId);
        if (receipt.details?.error === "DeviceNotRegistered") {
          result.deadTicketIds.push(ticketId);
        } else if (receipt.status === "error") {
          console.error("[push] delivery failed", ticketId, JSON.stringify(receipt));
        }
      }
    } catch (err) {
      console.error("[push] Expo receipts threw", err);
    }
  }

  return result;
}
