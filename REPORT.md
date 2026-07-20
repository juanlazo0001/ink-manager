# Consolidated Session — Staff/Artists split, business hours + calendar shading, quick prefill links, permanent delete

Four parts, one session, on `main`. Each part committed and pushed independently before the next began. `ConversationsPanel.tsx` was touched exactly once, exactly as scoped (Part 3's single new menu item + API call, zero styling changes) — never touched otherwise.

**Standing rule honored at every checkpoint:** `cd apps/web && npm run build` (zero TS errors) and `cd apps/api && npx tsc --noEmit` (zero TS errors) both clean before every commit below.

---

## Part 1 — Staff/Artists tab split + guest artists

Commit `06bdafc`.

Staff tab now filters to OWNER/FRONT_DESK only; artists appear exclusively on the Artists tab (including guests and artists whose guest window has ended). Artists tab gained its own "+ Add Artist" button (the existing two-step User+Artist creation flow), and Staff's "+ Add Team Member" role selector now only offers OWNER/FRONT_DESK (CUSTOMER confirmed already absent, unaffected).

**What was relocated for per-artist parity** (everything that used to live only on Staff rows): contact edit (name/phone/email), active/inactive toggle, location assignment, password reset, and avatar upload. All of it is now reachable per-artist via a new "Edit account" action on the Artists tab, which reuses the *same* edit modal/route the Staff tab already had rather than duplicating it — sourced from the same `/studios/:id/users` fetch already loaded for Staff.

Guest artist support: `Artist.isGuest` (Boolean, default false), `guestStartDate`/`guestEndDate` (nullable DateTime). Create/edit form gained a "Guest artist" toggle revealing Start/End Date pickers (new `DatePickerField.tsx`, extracted from `DateAndTimeRangeFields.tsx`'s existing date-picker interaction). "Guest" / "Guest (ended)" badges on the Artists tab — ended guests stay fully visible there. Calendar excludes ended guests from the default resource-column view (an "Include past guests" toggle restores them), and new-assignment pickers (appointment creation, inquiry assignment) exclude ended guests from default options — existing historical assignments/appointments are never touched or hidden.

A real bug was found and fixed during verification: `ArtistDetail.tsx` was round-tripping `guestStartDate`/`guestEndDate` through `new Date(isoString)` + local getters, which shifted the displayed date back a day in any timezone behind UTC. Fixed by slicing the date portion directly off the ISO string instead.

---

## Part 2 — Studio business hours + calendar grey-shading

Commit `00a2195`.

`StudioSettings.businessHours` (Json, nullable): array of `{dayOfWeek, isOpen, openTime?, closeTime?}`, mirroring `Artist.preferredSchedule`'s shape. Editable in Settings via a new card that reuses ArtistDetail's preferred-schedule editor's exact interaction pattern (checkbox + time inputs, "Closed" when unchecked) rather than inventing a new one. `GET /studio-settings` opened up to ARTIST (was OWNER/FRONT_DESK only) since studio-closed shading applies to their calendar too; `PATCH` stays OWNER-only.

Calendar grey-shading, three independent sources, one `slotPropGetter`/`dayPropGetter` rendering pass:
- Studio-closed time — all columns, whole day if fully closed.
- Artist-unavailable time (outside their own `preferredSchedule`) — their column only. An artist with no schedule configured at all is never shaded (same "advisory, not restrictive by default" convention the schedule field already had).
- Guest artist outside their window — their column not rendered at all outside `guestStartDate`–`guestEndDate`.

**Exact design token reused:** `var(--color-surface-inset)` — the same token `.rbc-off-range-bg` already used, resolving to `#121214` in the dark theme. No new ad-hoc grey was introduced anywhere.

Verified with 19/19 unit-tested logic assertions (a standalone reimplementation of the three shading predicates) plus live DOM slot-count checks on a day where all three sources applied simultaneously — hand-calculated expected shaded-slot counts matched exactly.

Two real, pre-existing bugs surfaced and fixed:
1. `npx prisma migrate dev` didn't leave the already-running dev server's loaded Prisma Client aware of the new `businessHours` column — required an explicit `npx prisma generate` (a recurring pattern from earlier in this session-arc; now the standard workaround whenever a migration lands under a live `tsx watch` process).
2. `.rbc-off-range-bg`'s dark-theme override in `index.css` was losing a load-order tie against react-big-calendar's own shipped light-mode rule whenever no inline style also applied to that cell — invisible before this part because nothing else gave Month view a reason to inline-style an off-range day; `dayPropGetter` now does exactly that for closed days, exposing it. Fixed by scoping the selector under `.rbc-calendar` for deterministic specificity.

---

## Part 3 — Quick prefill link from client record

Commit `b2319f3`.

Two new entry points onto the existing Phase 6C `PrefillDraft` token infrastructure (unchanged: 7-day TTL, single-use, quiet empty-form fallback on invalid/expired/used) — built from a client's on-file contact info instead of an AI-drafted extraction, and deliberately still token-based rather than raw query-string params (a name/phone sitting in a plain URL lands in browser history, referrer headers, and server logs in cleartext).

- **ConversationsPanel.tsx** (the one narrow, scoped exception): one new "Prefilled intake link" item in the existing "+ menu" form-link list, calling `POST /prefill-drafts` with the conversation's client's current firstName/lastName/email/phone, inserting the resulting `?draft=TOKEN` link into the composer like every other link-insert. No styling changes anywhere in the file.
- **ClientDetail.tsx**: a standalone "Copy prefilled intake link" header button for generating one without an active conversation, copying to clipboard with the same "Copied!" toggle-text pattern already used elsewhere for waiver/consent links.

**End-to-end confirmation, both entry points:** verified in a fresh unauthenticated context — name/email/phone prefill correctly and stay editable, submission succeeds, and revisiting the same link afterward loads empty (single-use confirmed). A client with no phone/email on file still generates a clean, non-erroring, mostly-empty link.

---

## Part 4 — Permanent delete (clients & inquiries) + Archive

Commit `2078b9e`.

### Archive (soft, reversible)
`Client.archivedAt` / `Inquiry.archivedAt` (nullable DateTime). `POST /clients/:id/archive|unarchive` and `POST /inquiries/:id/archive|unarchive` — OWNER/FRONT_DESK (same role gate each router already had), audited via `logAudit`. Excluded from default list views via the same `NOT_MERGED`-style exclusion pattern clients already used for merged records; fully intact and directly reachable via the detail URL regardless of archive state. UI: "Archive"/"Unarchive" in the overflow menu, plus a dismissible banner on the detail page while archived.

### Permanent delete — client (`DELETE /clients/:id`, OWNER only)
Requires exact `{confirm: "DELETE"}` in the body (400 otherwise, independent of any UI confirmation). Blocks with a clear 400 if any other client's `mergedIntoId` points at this one (no auto-resolution). Cross-studio or missing → 404.

**Enumerated model list walked** (re-derived from a full, fresh read of the current schema, not trusted from any prior list — the client-merge feature's `repointClientRelations`/`mergeConversations` helpers were read first as the named precedent for this discipline): `Appointment`, `ConsentForm`, `Inquiry`, `GiftCard`, `LiabilityWaiver`, `Conversation` (direct `clientId`), plus everything reachable only through `Conversation` — `Message`, `ConversationRead`, `ConversationTag`, `ConversationParticipant`, `PrefillDraft` (optional FK, no `onDelete: SetNull` declared, so it must be cleared explicitly or Postgres's default `Restrict` blocks the conversation delete) — and `DepositForm`, reachable only through `Inquiry`.

The task's own suggested delete order couldn't be taken literally (it placed `ConversationTag` after "the client's Conversation," which is impossible given `ConversationTag.conversationId` is a required FK) — the actual order executed, one transaction, respects real FK dependencies: conversation's `PrefillDraft`/`Message`/`ConversationRead`/`ConversationTag`/`ConversationParticipant` → `Conversation` itself → `LiabilityWaiver` → `ConsentForm` → `DepositForm` (must precede `GiftCard`, since `DepositForm.giftCardId` optionally points at one) → `GiftCard` → null `Inquiry.appointmentId` (clears the older 1:1 back-reference before appointments are removed) → `Appointment` → `Inquiry` → `Client`. The audit entry (`entityType: "Client"`, `action: "permanently_deleted"`, full snapshot including gift-card details and total active-dollar value) is written immediately after the transaction commits — `logAudit` uses its own non-transactional Prisma client, so writing it *inside* the transaction callback would not actually be atomic with the deletes and risks logging a delete that then rolls back; writing it right after success is the version that's actually correct, and it remains the only surviving trace afterward since `AuditLog` carries no FK to `Client`.

Client-delete does **not** detach gift cards — deleting the client destroys everything, including its money. That's what "permanent" means at this level, and is the deliberate contrast with inquiry-delete below.

### Permanent delete — inquiry (`DELETE /inquiries/:id`, OWNER only)
Same `{confirm: "DELETE"}` requirement, same audit-before-response discipline, scoped to this inquiry's own tree (its appointments, their `LiabilityWaiver`s, its `DepositForm`, and `ConversationTag` rows referencing the inquiry or any of its appointments).

**Gift-card-detach confirmed:** any `GiftCard` attached to one of the inquiry's appointments has `appointmentId` set to `null` — never deleted, status untouched (stays `ACTIVE`). Verified live: created a client + inquiry + appointment + gift card (attached as the appointment's deposit), deleted the inquiry, and confirmed via direct API read afterward that the gift card still existed, `status: "ACTIVE"`, `appointmentId: null`. The audit entry's `changes.giftCardsToDetach` explicitly lists every detached card (id/code/amount), and the response body echoes `detachedGiftCards` back to the caller. Consent forms on the same appointments are likewise unlinked (`appointmentId → null`) rather than destroyed, since a signed legal document outlives the session it was tied to — the same "detach, don't destroy" treatment extended one step further, not called out explicitly in the task but resolved the same way for consistency.

### UI
Client profile / inquiry detail overflow menu (OWNER-only for delete via `useEffectiveUser()`; archive stays available to FRONT_DESK too, matching the route gate): "Archive"/"Unarchive" and "Delete Permanently." Delete modal shows a plain-language breakdown fetched from a new `GET .../delete-preview` endpoint (inquiries, appointments, waivers, consent forms, deposit forms, messages, and — prominently, in danger styling — gift-card count and total active dollar value; inquiry-delete's modal additionally states which gift card(s) will be detached rather than destroyed). The final "Delete Permanently" button stays disabled until an exact-match `DELETE` text input is typed. Success redirects to the relevant list (`/clients` or `/inquiries`) with a dismissible green confirmation banner; failure (e.g. the merged-client block) surfaces the specific server error inline in the modal instead.

### Verification (PowerShell/curl + Playwright, both against the running dev server)
- Merge-block: deleting a client with another client merged into it → 400, nothing deleted.
- Clean client delete: preview counts correct, wrong confirm string → 400 nothing deleted, FRONT_DESK delete attempt → 403, FRONT_DESK archive → 200, archived client excluded from `GET /clients`, unarchive round-trip clears `archivedAt`, correct OWNER delete → 200, client and its gift card both subsequently 404 (client-delete destroys money, as designed), cross-studio/bogus id → 404.
- Inquiry delete: preview correctly lists the gift card to be detached, delete succeeds, gift card confirmed still `ACTIVE` with `appointmentId: null` afterward, appointment and inquiry both subsequently 404.
- Audit rows confirmed present post-delete for both entities, with full snapshots (`permanently_deleted` for both, plus separate `archive`/`unarchive` entries with the correct actor each time).
- Browser: full delete-modal flow on a real disposable client (breakdown → type-DELETE gate disabled→enabled → confirm → redirect to `/clients` with the green "...was permanently deleted." banner); same modal verified live for an inquiry with real history (showed the actual $75 active gift card that would be detached, not destroyed — did not click through, to preserve that test client's real data); archive/unarchive toggle verified in-browser for both Client and Inquiry detail pages.

---

## Final typecheck state
`cd apps/web && npm run build` — clean. `cd apps/api && npx tsc --noEmit` — clean. Confirmed clean after every part above, most recently after Part 4.

## Commits
| Part | Hash | Message |
|---|---|---|
| 1 | `06bdafc` | Staff/Artists tab split + guest artists |
| 2 | `00a2195` | Studio business hours + calendar grey-shading |
| 3 | `b2319f3` | Quick prefill link from client record |
| 4 | `2078b9e` | Permanent delete + archive for clients and inquiries |

All four pushed to `origin/main`. Both dev-server shells (API port 4000, web port 5173) killed after this final verification pass.
