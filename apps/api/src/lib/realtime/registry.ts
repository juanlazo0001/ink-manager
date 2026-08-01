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
//
// Real-time reliability audit (Part 2): several of these variants are NEW,
// added to close silent-mutation gaps found across the API -- see
// REPORT.md's "Part 2" section for the full route-by-route audit. A few
// (team.changed, locations.changed, service.changed, customPolicy.changed,
// intakeForm.changed's new field-level key) target frontend query keys that
// don't exist as real useQuery calls yet -- those pages fetch via a bespoke
// useEffect+apiFetch today, so invalidateQueries on those prefixes is
// currently a harmless no-op until Part 3 migrates them. Emitting the event
// now, even before its consumer exists, means no route needs to be revisited
// once that migration happens.
export type InvalidationEvent =
  | { type: "conversation.updated"; studioId: string; conversationId: string }
  | { type: "task.changed"; studioId: string }
  | { type: "inquiry.created"; studioId: string }
  // Any status-transition route firing after the initial create (assign,
  // respond, send-estimate, schedule, waitlist, mark-lost, reopen,
  // attach-gift-card) -- the Kanban board (Package E) reuses the exact same
  // ["inquiries"] prefix so cards move live for every viewer, staff and
  // artist alike, without a second query key to keep in sync.
  //
  // Part 3 audit: inquiryId is optional and additive -- when present, it
  // ALSO invalidates the single-inquiry detail key (InquiryDetail.tsx's own
  // ['inquiry', id] useQuery, which is NOT prefix-matched by ["inquiries"]
  // since they're different first segments). This was a real, live-
  // reproduced bug: reassigning an artist on a project while its detail
  // page was open never updated it, for any viewer, connected or not --
  // only the separate Inquiries LIST page ever picked up the change. Most
  // call sites have a single inquiry id in scope and now pass it; the few
  // that don't (a bulk client-delete cascading through many inquiries, a
  // bulk import) correctly omit it and fall back to list-level only, since
  // there's no single "the" inquiry to target there.
  | { type: "inquiry.updated"; studioId: string; inquiryId?: string }
  | { type: "appointment.changed"; studioId: string }
  // NEW below this line (Part 2 of the real-time audit).
  | { type: "client.updated"; studioId: string; clientId: string }
  // Bulk client-import execute: many clients (and their new inquiries) at
  // once, not one -- studio-wide list invalidation only, no single clientId
  // to target (client.updated above is for a real one-client mutation).
  | { type: "client.imported"; studioId: string }
  // GiftCards have no single studio-wide list view -- every real consumer
  // (InquiryDetail's Session Plan widget, ClientDetail's own card table)
  // reads them scoped to one client, so this is client-scoped, not
  // studio-wide, unlike every other event above.
  | { type: "giftcard.changed"; studioId: string; clientId: string }
  | { type: "artist.changed"; studioId: string; artistId: string }
  | { type: "team.changed"; studioId: string }
  | { type: "locations.changed"; studioId: string }
  | { type: "service.changed"; studioId: string }
  | { type: "customPolicy.changed"; studioId: string }
  | { type: "intakeForm.changed"; studioId: string }
  // SMS/EMAIL connect or disconnect -- the one integration status shape
  // actually live-consumed today (ConversationsPanel's composer, to grey
  // out/enable sending). Other channels (Stripe, Bird, Google Calendar)
  // aren't part of that shared read today, so this is deliberately scoped
  // to the two that are, not every integration mutation in the app.
  | { type: "integration.changed"; studioId: string }
  // Flash gallery: any create/edit/retire/status-transition on a
  // FlashPiece -- studio-wide, no single-piece detail view exists yet to
  // target individually (the management page is a flat list, same
  // "no single-item view" shape as team.changed/locations.changed above).
  | { type: "flash.changed"; studioId: string };

function keysFor(event: InvalidationEvent): unknown[][] {
  switch (event.type) {
    case "conversation.updated":
      return [
        ["conversations"],
        ["conversation-thread", event.conversationId],
        // Part 3 audit: ConversationsPanel.tsx's own tag/context panel
        // (['conversation-context', id]) was never in this list -- the
        // tags POST/DELETE routes emit this same event (see Part 2), but
        // without this key the panel showing which entities are tagged
        // never refreshed live even for the SAME staff member's other
        // open tab, let alone a different one.
        ["conversation-context", event.conversationId],
        ["nav-counts"],
        // NEW_CONVERSATION system task depends on conversation state too.
        ["tasks"],
      ];
    case "task.changed":
      return [["tasks"], ["nav-counts"]];
    case "inquiry.created":
      return [["inquiries"], ["nav-counts"]];
    case "inquiry.updated":
      return [
        ["inquiries"],
        ["nav-counts"],
        ...(event.inquiryId ? [["inquiry", event.inquiryId]] : []),
      ];
    case "appointment.changed":
      return [["appointments"], ["nav-counts"]];
    case "client.updated":
      return [["clients"], ["client", event.clientId]];
    case "client.imported":
      return [["clients"]];
    case "giftcard.changed":
      return [["client-gift-cards", event.clientId]];
    case "artist.changed":
      return [["artists"], ["artist", event.artistId]];
    case "team.changed":
      return [["team-users"], ["team-invites"]];
    case "locations.changed":
      return [["locations"]];
    case "service.changed":
      return [["services"]];
    case "customPolicy.changed":
      return [["custom-policies"]];
    case "intakeForm.changed":
      // ["intake-forms"] is a real, already-live-consumed key
      // (lib/useIntakeForms.ts, used by ClientDetail.tsx and
      // ConversationsPanel.tsx's composer) -- this one has a working
      // consumer today, unlike most of the other new variants above.
      return [["intake-forms"]];
    case "integration.changed":
      return [["sms-integration-status"]];
    case "flash.changed":
      return [["flash-pieces"]];
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
