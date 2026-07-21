# Real-time live updates + staff presence

Two-part session, both committed and pushed separately, per the task's own instructions. Ran in parallel with an SMS-consent session working in the same checkout (not a separate worktree) — its in-progress, uncommitted edits to `ClientDetail.tsx`, `InquiryDetail.tsx`, `AppointmentDetail.tsx`, and `Inquiries.tsx` were stashed immediately before each `git pull --rebase` and restored immediately after, so neither session's work was ever staged or committed by the other.

---

## Commits

| Hash | What |
|---|---|
| `b112fd7` | Part 1: WebSocket infrastructure + staff presence |
| `f89865a` | Part 2: live updates via WebSocket invalidation |

Both pushed to `origin/main`.

## Part 1 — WebSocket infrastructure + presence

- `apps/api/src/lib/realtime/io.ts`: Socket.IO attached to the same `http.Server` Express already listens on (`apps/api/src/index.ts` now does `createServer(app)` → `initRealtime(httpServer)` → `httpServer.listen(...)`, one port, matching Railway). Handshake auth verifies the same JWT REST requests use (`socket.handshake.auth.token`, `jwt.verify` against `JWT_SECRET`); on success a socket joins `studio:{studioId}` and `user:{userId}`.
- `apps/api/src/lib/realtime/presence.ts`: in-memory `Map`-based presence (`onlineUsers: Map<studioId, Set<userId>>`, plus a connection-refcount map so multiple tabs/devices for one user don't flicker each other's presence). Disconnect triggers an 8-second debounce (`OFFLINE_DEBOUNCE_MS`) before broadcasting `presence:offline`, absorbing a brief reconnect or tab switch. A freshly-connecting socket gets a `presence:snapshot` event with the full current online set for its studio, so a fresh page load is correct immediately rather than waiting for the next live event.
- Frontend: `SocketProvider`/`useSocket()` (`apps/web/src/context/SocketContext.tsx`) connects once authenticated, exposes `onlineUserIds: Set<string>`, and re-syncs from a fresh `presence:snapshot` on every reconnect (Socket.IO's default reconnection is used as-is). It also registers the generic `invalidate` listener Part 2 relies on.
- Presence dots (`apps/web/src/components/PresenceDot.tsx`, green/grey) added to: Team page Staff tab + Artists tab avatars, and conversation participant avatars — but only on STAFF/GROUP threads (gated on `conversation.type !== 'CLIENT'` / the existing `counterpart.participants` signal), never on CLIENT threads since clients have no login.

**Known, accepted limitation (called out in code comments too):** presence and the Part 2 invalidation broadcast both live in a single in-process Socket.IO server + in-memory Maps. Correct for one API instance (what's deployed today). If the API is ever scaled to multiple replicas, a client on replica A would never see a presence/invalidate event emitted by replica B — would need a shared adapter (`@socket.io/redis-adapter`) plus moving presence's Maps to Redis. Same category of limitation already accepted for the Phase 7A in-process job scheduler.

**Verified** (Playwright, two/three real logged-in browser contexts against the local dev stack): two different staff users show as online to each other; closing a tab shows the other user going offline after ~8s (not instant, not never); a third session logging in fresh sees both already-connected users as online immediately on page load, before any live event.

## Part 2 — live updates via WebSocket invalidation

`apps/api/src/lib/realtime/registry.ts` — mirrors the existing `TASK_SOURCE_REGISTRY` pattern:

```ts
export type InvalidationEvent =
  | { type: "conversation.updated"; studioId: string; conversationId: string }
  | { type: "task.changed"; studioId: string }
  | { type: "inquiry.created"; studioId: string }
  | { type: "appointment.changed"; studioId: string };

emitInvalidation(event) // looks up query-key prefixes for event.type, io.to(`studio:${studioId}`).emit("invalidate", { keys })
```

To add a new surface later: add a variant to `InvalidationEvent`, add its query-key prefixes to the `keysFor` switch, call `emitInvalidation(...)` from the mutation route right after its existing logic succeeds. Nothing else changes — same "one new entry, nothing else needs to change" shape as the task-source registry.

**Keys are prefixes, not full React Query keys** — e.g. `["tasks"]` rather than `["tasks", userId]`. This mirrors the `appointmentsQueryKey`/`appointmentsRangeQueryKey` prefix-compatibility trick already in `apps/web/src/lib/queryKeys.ts`. `invalidateQueries` prefix-matches by default, and any one client's cache only ever holds its own studioId/userId-scoped queries, so the server never needs to know each recipient's userId to build a correct key — one static prefix list, broadcast studio-wide, safely invalidates only each recipient's own data. No shared package exists between `apps/api` and `apps/web`, so these string literals are a hand-kept contract with `queryKeys.ts` and the ad-hoc keys in `ConversationsPanel.tsx` — noted in the registry file's own comment.

Wired into (purely additive — existing response bodies/status codes unchanged):
- `apps/api/src/routes/conversations.ts` — `POST /:id/messages`, both the real-Twilio-send early-return and the normal log-only path.
- `apps/api/src/routes/tasks.ts` — `POST /personal` (create) and `PATCH /personal/:id` when the patch is a completion/reopen change.
- `apps/api/src/routes/inquiries.ts` — `POST /` (the single route serving both staff-logged and public-intake-form submissions) and `POST /:id/schedule` (appointment created via the inquiry-scheduling flow).
- `apps/api/src/routes/appointments.ts` — `POST /` (create) and `PATCH /:id` (status change and/or reschedule, same shared handler Calendar drag-and-drop uses).

Nav-count badges (`useNavCounts`, and the duplicated inline poll in `ConversationsPanel.tsx`) needed no code change — they already use `navCountsQueryKey`, which starts with `nav-counts`, a prefix every relevant event includes. They get instant socket-driven updates for free, and the existing 60-second `refetchInterval` poll is untouched as the fallback.

### Live-update verification (Playwright, two simultaneous logged-in browser sessions)

For each of the four surfaces: one session performed the mutation (via the real UI where practical, or a direct authenticated/unauthenticated API call standing in for the public intake form), and the *other, already-open* session was asserted to (a) issue a fresh GET request for the relevant data with **no page navigation/reload** (checked via a `window` marker that a reload would wipe) and (b) show the new data in the DOM — all within a couple seconds, no manual refresh:

| Surface | Trigger | Result |
|---|---|---|
| Conversations | Owner sends a STAFF-thread message | Front desk's already-open thread refetched and rendered the new message live |
| Tasks | Owner creates & assigns a personal task to front desk | Front desk's already-open Tasks page showed it under "Assigned to Me" live |
| Inquiries | Unauthenticated `POST /inquiries` (same code path the public intake form uses) | Front desk's already-open Inquiries list showed the new row live |
| Calendar | Front desk PATCHes a seeded appointment's status | Owner's already-open Calendar issued a live refetch (network-verified; status reverted afterward so seed data is unchanged) |

**Disconnect/reconnect resilience:** set one browser context offline (Playwright `context.setOffline(true)`) — page stayed responsive, no crash. Brought it back online, waited for the socket to reconnect, then triggered another task assignment: it arrived live again, confirming reconnect resumes normal invalidation behavior (a mutation that happened *while* offline is simply missed by the socket, same as any other missed push — nav-counts' 60s poll is the belt-and-suspenders fallback for that gap, same principle as lazy gift-card expiration alongside the active sweep).

## Config notes

- Presence offline debounce: **8 seconds** (`OFFLINE_DEBOUNCE_MS` in `apps/api/src/lib/realtime/presence.ts`).
- Single-instance limitation applies to both features built this session (presence and invalidation broadcast) — see Part 1 section above; not repeated per-feature since it's the same one underlying cause (one in-process Socket.IO server, in-memory state).

## Cleanup

Both dev servers started for verification (API on :4000, web on :5173) were killed at the end of the session. Test data left in the dev database from verification (one extra STAFF conversation + messages, a couple of personal tasks, one extra inquiry/client) was **not** rolled back — this is the dev database DEVELOPMENT.md describes as being for exactly this kind of testing; the one mutation that changed pre-existing seed data (an appointment's status, toggled to prove the live update) was explicitly reverted back to its original value.
