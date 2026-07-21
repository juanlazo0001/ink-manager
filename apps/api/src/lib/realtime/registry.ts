import { getIo } from "./io";

// One entry per mutation surface that should trigger a live UI update. To
// add a new one: add a variant to InvalidationEvent, add its query-key
// prefixes to keysFor below, then call emitInvalidation(...) from the
// mutation route right after its existing logic succeeds -- nothing else
// changes. Mirrors the TASK_SOURCE_REGISTRY pattern in lib/tasks/registry.ts.
//
// Keys are PREFIXES, not full React Query keys (mirroring the
// appointmentsQueryKey/appointmentsRangeQueryKey prefix-compatibility
// trick already used in apps/web/src/lib/queryKeys.ts) -- e.g. ["tasks"]
// rather than ["tasks", userId]. React Query's invalidateQueries does a
// prefix match by default, and any one client's cache only ever holds ITS
// OWN studioId/userId-scoped queries (baked in by whichever hook created
// them), so a bare prefix here safely and correctly invalidates only that
// recipient's own queries -- the server never needs to know each
// recipient's userId to build a full key. No shared package exists between
// apps/api and apps/web, so these string literals are a hand-kept contract
// with apps/web/src/lib/queryKeys.ts and the ad-hoc keys in
// ConversationsPanel.tsx -- change a key shape on one side, mirror it here.
export type InvalidationEvent =
  | { type: "conversation.updated"; studioId: string; conversationId: string }
  | { type: "task.changed"; studioId: string }
  | { type: "inquiry.created"; studioId: string }
  // Any status-transition route firing after the initial create (assign,
  // respond, send-estimate, schedule, waitlist, mark-lost, reopen,
  // attach-gift-card) -- the Kanban board (Package E) reuses the exact same
  // ["inquiries"] prefix so cards move live for every viewer, staff and
  // artist alike, without a second query key to keep in sync.
  | { type: "inquiry.updated"; studioId: string }
  | { type: "appointment.changed"; studioId: string };

function keysFor(event: InvalidationEvent): unknown[][] {
  switch (event.type) {
    case "conversation.updated":
      return [
        ["conversations"],
        ["conversation-thread", event.conversationId],
        ["nav-counts"],
        // NEW_CONVERSATION system task depends on conversation state too.
        ["tasks"],
      ];
    case "task.changed":
      return [["tasks"], ["nav-counts"]];
    case "inquiry.created":
    case "inquiry.updated":
      return [["inquiries"], ["nav-counts"]];
    case "appointment.changed":
      return [["appointments"], ["nav-counts"]];
  }
}

// Never throws -- a socket-emit failure (or the realtime server not being
// up, e.g. in a script/test context) must never break the REST response of
// the mutation that triggered it. Same "never throws" contract as the job
// registry's runJob.
export function emitInvalidation(event: InvalidationEvent): void {
  try {
    const io = getIo();
    io.to(`studio:${event.studioId}`).emit("invalidate", { keys: keysFor(event) });
  } catch (err) {
    console.error("[realtime] failed to emit invalidation", event.type, err);
  }
}
