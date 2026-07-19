# Phase 7A — Job Scheduler, Internal Automations, Mark-as-Lost

Single session, on `main`. Touches `apps/api` only for the scheduler/automations/mark-lost backend, plus `apps/web`'s `Settings.tsx`, `InquiryDetail.tsx`, and `StatusPill.tsx`. `ConversationsPanel.tsx` was **not** touched, per instructions (a parallel workstream owns the chat-side mark-lost entry point).

## 1. Scheduler foundation

- **`node-cron` (v4)**, in-process, started once from `apps/api/src/index.ts` via `startScheduler()` after `app.listen(...)`. No separate worker service.
- **`JobRun` model** (`apps/api/prisma/schema.prisma`): `id`, `jobName`, `scheduledFor`, `startedAt`, `finishedAt?`, `status` (`RUNNING | SUCCEEDED | FAILED`), `details` (Json), `error?`. `@@unique([jobName, scheduledFor])`.
- **Shared runner** (`apps/api/src/lib/jobs/registry.ts`, `runJob`): claims the slot by `create`-ing the `JobRun` row *before* running any job logic. A second caller hitting the same `(jobName, scheduledFor)` gets a Prisma `P2002` unique violation, which `runJob` catches and returns `{ skipped: true }` — no error surfaced, no double execution. Success/failure is recorded on the same row afterward; a thrown error is caught, logged, and written to `error` — `runJob` never rethrows, so one job's bug can't crash the API process.
- **Cron ticks use a deterministic slot, not a raw timestamp**: `startOfUtcDay(new Date())` — the start of the current UTC day. This is what makes the double-run guard actually work across two overlapping ticks/processes (they'd never share the same millisecond, but they do share the same day). **Manual `run-now` deliberately uses a fresh, un-truncated `new Date()`** — it's always its own unique slot, so it's never blocked by today's cron run already having claimed the day. That's the whole point of the endpoint ("how you re-run a failed sweep").
- **`POST /jobs/:jobName/run-now`** (OWNER only, audited as `entityType: "Job"`, `action: "run_now"`) and **`GET /jobs`** (OWNER only — every registered job + its most recent `JobRun` by `startedAt`).
- **Settings → System** (OWNER only): job list with description, cron expression, last-run status/time/details, and a Run Now button per job.
- `StudioSettings.timezone` (default `"America/New_York"`) was added per spec, but **neither job's eligibility logic uses it** — both compare absolute UTC timestamps (`expiresAt < now`, `now - lastActivity > coldLeadDays days`), which is correct regardless of studio-local time-of-day. The column is scaffolding for the next phase (SMS send-window computation), which is where "the day" per-studio will actually matter. This is a deliberate, documented scope call, not an oversight — noted in `registry.ts`'s and the schema's own comments.

## 2. Idempotency argument, per job

- **Gift-card expiration sweep**: query is `WHERE status = ACTIVE AND expiresAt < now`. Once a card flips to `EXPIRED` it no longer matches — a second run (same slot or a later day) only ever touches cards that are still genuinely `ACTIVE`-and-past-expiry at that moment. Structurally cannot double-apply.
- **Cold-lead sweep**: query is `WHERE status IN (eligible pre-conversion statuses)`, which excludes `COLD_LEAD` itself. Once swept, an inquiry is no longer eligible on any subsequent run. The only way back into eligibility is the explicit `POST /:id/reopen` action — never this job.
- **Scheduler runner itself**: the `(jobName, scheduledFor)` unique constraint is the idempotency mechanism for the *slot*, independent of what a job's own logic does — see above.

## 3. Eligible statuses for the cold-lead sweep

Mirrors `apps/web/src/pages/Inquiries.tsx`'s `INQUIRIES_TAB_STATUSES` minus the two terminal values (kept as a literal, cross-referenced list in `apps/api/src/lib/jobs/coldLeadSweep.ts` — separate compilation units, no shared import):

```
NEW, ARTIST_ASSIGNED, AWAITING_CLIENT_RESPONSE, BUDGET_NEGOTIATION, DEPOSIT_PENDING
```

Projects-side statuses (`SCHEDULING`, `WAITLISTED`, `CONFIRMED`) are never swept, regardless of how old their last activity is — verified live (see §6).

**Last activity** = newest of: `inquiry.updatedAt` (new field this phase — see below), the newest `AuditLog` entry for that inquiry, the client's `Conversation.lastMessageAt` (if a thread exists), and `estimateSentAt`/`estimateOpenedAt`/`estimateRespondedAt`.

**Schema note:** `Inquiry` had no `updatedAt` column before this phase (unusual for this codebase — every other mutable model has one). Added `updatedAt DateTime @updatedAt`, backfilled via a hand-written migration (`DEFAULT CURRENT_TIMESTAMP` for the handful of pre-existing rows; Prisma manages every future write automatically).

## 4. Mark as lost / reopen

- `POST /inquiries/:id/mark-lost` (OWNER/FRONT_DESK): valid from any status except the two terminal ones (`CLOSED_LOST`, `COLD_LEAD`) — including Projects-side statuses, since a confirmed project can still fall through. Sets `status: CLOSED_LOST`, `lostAt: now`, `lostReason` (optional). New fields, distinct from the pre-existing (and still-unused-by-any-route) `closedReason` column, which was left untouched.
- `POST /inquiries/:id/reopen` (OWNER/FRONT_DESK): valid only from `CLOSED_LOST` or `COLD_LEAD`; target `status` must be one of the 8 non-terminal values (broader than the cold-sweep's own eligible list — reopening back into a Projects-side status like `CONFIRMED` is legitimate). Clears `lostAt`/`lostReason`.
- Both routes are conversation-agnostic by design — a separate workstream adds the chat-side entry point calling the same `mark-lost` route.
- Frontend: `StatusPill.tsx`'s `CLOSED_LOST` tone changed from `neutral` → `danger` (this is a shared component also consumed by `ConversationsPanel.tsx`'s thread-header ring tone via `getStatusTone` — a deliberate, spec-directed side effect, not an edit to that file). `InquiryDetail.tsx` gained: a "⋯" overflow menu (Mark as lost, hidden once terminal), a mark-lost confirm modal with an optional reason field, a terminal-state banner (reason/when/by-whom, the last two pulled from the same `/audit` endpoint `AuditTrail` already uses), and a reopen modal with a status picker.

## 5. Verification performed

All against the dev DB (`hopper.proxy.rlwy.net`, confirmed via `apps/api/.env` before starting). Dev-reseedability confirmed (`npx prisma db seed` re-ran clean after all of this).

- **Scheduler**: both jobs registered on boot (dev *and* compiled-production boot, see §6). `run-now` executes synchronously and returns the `JobRun` row. Double-run guard proven directly against `runJob` (bypassing the endpoint, since `run-now`'s un-truncated timestamp is deliberately always-unique): two concurrent calls with an identical `scheduledFor` → exactly one `{skipped: false}`, one `{skipped: true}`. A job registered to always throw → recorded `FAILED` with the error message, runner resolved normally, API process unaffected.
- **Expiration sweep**: seeded an `ACTIVE` card with `expiresAt` in 2020 → run-now → `EXPIRED`, one audit row (`actorUserId: null`, action `status_change`, job name + old/new status in `changes`) → re-ran → `cardsExpired: 0`.
- **Cold sweep**: three fresh test inquiries (to avoid polluted seed/session data — the first "clean" candidate I picked, Alex Testperson, turned out to already have a same-session conversation from earlier UI testing, which correctly prevented it from sweeping and became an accidental extra proof point for the conversation-activity signal). Backdated `updatedAt` + existing `AuditLog` rows to ~100 days ago via raw SQL (no legitimate API path sets `updatedAt` to the past, by design):
  - Clean NEW inquiry, no conversation, no estimate activity → swept to `COLD_LEAD`, audited with `lastActivityAt`/`coldLeadDays` in `changes`.
  - NEW inquiry backdated the same, but with a conversation message sent *today* → **not** swept.
  - `CONFIRMED` (Projects-side) inquiry backdated the same → **not** swept, regardless of activity.
  - Re-ran → `inquiriesSwept: 0` (idempotent).
- **Mark-lost/reopen**: happy path with reason + audit; rejected on an already-terminal inquiry (400); reopen to a valid status clears `lostAt`/`lostReason` + audit; reopen to `CLOSED_LOST` (illegal target) → 400; FRONT_DESK allowed; ARTIST → 403; a second studio (spun up via `/studios/bootstrap`, then deleted) → 404 on the first studio's inquiry, confirming the same `studioId` ownership guard used by every other inquiry route.
- **Settings**: `coldLeadDays` PATCH by OWNER, audited (`from`/`to` in `changes`); `GET /jobs` → 403 for FRONT_DESK.
- **Browser** (Playwright, dev servers): Settings → System section renders both jobs with description/schedule/last-run, Run Now updates the row live; Policies & Defaults shows the new "Cold lead after" field; Inquiries list renders a red "Closed Lost" pill and would render a gray "Cold lead" pill (tone map confirmed, not separately screenshotted since the live pill assertion for CLOSED_LOST already proves the same code path); InquiryDetail: "⋯" menu → Mark as lost modal (reason field, outline-danger confirm button) → terminal banner ("Marked lost — {time} by Dev Owner", reason shown) → Reopen modal (status picker) → back to a working non-terminal detail view with the "⋯" menu reappearing.
- **Production boot**: stopped the dev server, ran `npm run build` (clean `tsc`), then `npm run start` (`npx prisma migrate deploy && node dist/src/index.js`) — `migrate deploy` reported "No pending migrations to apply" (everything already applied via `migrate dev` during development), both jobs logged as scheduled, `/health` responded — confirms cron registration doesn't depend on anything dev-mode-only (e.g. `tsx`'s module loading).

All ad-hoc verification scripts and their `JobRun`/audit rows were deleted after use; the second test studio was deleted; the handful of test inquiries/clients/gift card created for cold-sweep verification were left in the dev DB (consistent with this session's established practice of leaving harmless test data in the shared dev environment) and don't affect re-seedability.

## 6. Cron schedule

- `giftCardExpirationSweep`: `0 2 * * *` (02:00 UTC daily).
- `coldLeadSweep`: `30 2 * * *` (02:30 UTC daily) — staggered a half hour after the first purely so the two never contend for the same instant, though they don't touch overlapping tables.

## 7. Commit

`<filled in after commit — see git log>`
