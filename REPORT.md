# Package A — Quick fixes (deposit link, artist picker, appointment modal, calendar default, estimate UI)

Single session on `main`. No schema changes needed. `ConversationsPanel.tsx` untouched.

---

## 1. Deposit form link incorrectly hidden — investigated, **no bug found**

Root cause hypothesis in the task ("hides the deposit link whenever the client has ANY gift card") does **not** match the current code. Checked every place a deposit link/action is gated:

- `apps/api/src/routes/clients.ts` `GET /:id/shareable-links` — `depositLinks` (resend case) gates only on `inquiry.depositForm` existing; `depositFormOptions` (fresh-send case) gates only on `status === 'DEPOSIT_PENDING'`, both price bounds set, and not already signed. Neither reads `client.giftCards` at all — that array only feeds the separate, intentionally-unconditional `giftCardLinks`.
- `apps/web/src/pages/ClientDetail.tsx` `eligibleDepositInquiries` — same per-inquiry rule (`DEPOSIT_PENDING` + both bounds + not signed), no gift-card check.
- `apps/web/src/components/ConversationsPanel.tsx` composer "+" menu renders the two arrays above as-is, no extra client-side gift-card gating.

(`InquiryDetail.tsx`'s `hasAvailableGiftCard` branch is a different, intentional feature — it offers "Attach Gift Card" as an alternative to a *fresh* deposit request, it doesn't hide an existing link.)

**Verified live**: seeded a second `DEPOSIT_PENDING` inquiry (with price bounds, no deposit form yet) for `client2@dev-studio.test` (Bailey Testperson), who already holds 3 active gift cards from unrelated prior work. Both the client page and the inquiry's own Deposit section correctly show **"Send Deposit Form"** — confirmed by screenshot. No code change made; if this bug was seen elsewhere, it isn't reachable through any of the three surfaces above as they stand today.

## 2. Artist assignment picker — fixed

`apps/web/src/pages/InquiryDetail.tsx`'s Assignment card used a native `<select>` rendering `artist.user.email`. Replaced with the same button+listbox dropdown pattern `AppointmentForm.tsx` already uses (avatar image, or initials-circle fallback, next to the name).

Extracted the avatar rendering (`ArtistAvatar`, `artistLabel`) out of `AppointmentForm.tsx` into a new shared `apps/web/src/components/ArtistAvatar.tsx`, imported by both files — one implementation, not two copies.

## 3. "New Appointment" navigating to Calendar — already fixed, no bug found

Commit `95dce18` (already on `main` before this session started) fixed the Projects-tab header button — it now opens `AppointmentForm` in a `Modal`, no `navigate()`. `InquiryDetail.tsx`'s own per-project "New Appointment" action already used `Modal` + `AppointmentForm` with `fixedClientId`/`fixedInquiryId` pre-filled — pre-existing from the UI-4/5 session, untouched by `95dce18`. Verified live: clicking "New Appointment" on the Projects tab opens the modal in place; URL stays on `/inquiries?tab=projects`.

## 4. Calendar default view — fixed

`apps/web/src/pages/Calendar.tsx`: `useState<View>(Views.WEEK)` → `useState<View>(Views.MONTH)`. Verified Week/Day switching still works normally; Month loads first and shows as the active toggle.

## 5. Estimate UI consolidation + permission review

**Consolidation**: `InquiryDetail.tsx` had the price/time range rendered twice — a read-only copy inside the "Assignment" card (regardless of send status), and a second read-only copy inside "Client Response" (only when `estimateSentAt`). Removed the Assignment-card copy entirely; the Assignment card now only shows artist assignment + decline note. Renamed "Client Response" → **"Estimate"** and widened its visibility/read-only-display conditions to key off the range values existing at all, not just `estimateSentAt` — so entering a range now surfaces immediately in the one section that also holds the edit form, Generate & Send action, and the sent→opened→responded timeline. Verified live: exactly one "Estimate" heading, zero "Client Response" headings, "Price estimate low" appears once on the page (was twice).

**Permission gating — investigated, existing scoping is correct, no change made.** The premise ("previously this may have been more restricted") doesn't match how ARTIST already interacts with estimate fields in this codebase:

- `InquiryDetail.tsx` (the page with the section above) is a **staff-only** page — `GET /inquiries/:id` is `requireRole(OWNER, FRONT_DESK)`, so ARTIST can't load it at all, regardless of any gating inside it.
- ARTIST already has their own, separate, fully-unrestricted flow to enter/edit price and time-estimate ranges: `MyInquiries.tsx` (`/my-inquiries`) → `PATCH /inquiries/:id/respond` (`requireRole(ARTIST)`), scoped to inquiries actually assigned to them (`inquiry.assignedArtistId !== artist.id` → 403). This is how an artist approves an inquiry and sets its estimate today, and it was not restricted before this session.
- Widening `InquiryDetail.tsx`'s generic `PATCH /:id` route to include ARTIST would have been the wrong move: that route also accepts `description`, `placement`, `estimatedSize`, `budget`, `desiredTiming`, and both image arrays — far broader than "the estimate range," and would grant ARTIST edit access to a staff-only page's unrelated fields as a side effect.

Given ARTIST already has adequate, correctly-scoped entry via `MyInquiries.tsx`/`respond`, I left `PATCH /inquiries/:id` and `POST /inquiries/:id/send-estimate` exactly as they were (`OWNER`, `FRONT_DESK` only) — no discrepancy existed between the two to begin with. Flagging this explicitly since the task described it as an expected change: if the actual intent was for ARTIST to gain access to the *staff* `InquiryDetail.tsx` estimate section specifically (not just their own existing flow), that's a materially bigger change — granting a new role read access to a page currently gated to OWNER/FRONT_DESK — and would need a separate, deliberate pass rather than a quick-fix bundled into this session.

## Verification

Playwright against the local dev stack (`apps/web` on :5173, `apps/api` on :4000):
- Deposit link/button correctly shown for a client with unrelated gift cards + a genuine pending deposit (screenshot).
- Artist picker dropdown shows name + avatar (image or initials), no raw emails (screenshot).
- "New Appointment" from Projects tab opens the modal in place, URL unchanged (screenshot).
- Calendar's Month toggle is active by default on load; Week/Day still switch normally.
- Inquiry page shows one "Estimate" section (heading count confirmed, no duplicate "Price estimate low" text).

Test data added to the dev database during verification (a second inquiry for `client2@dev-studio.test`, `[PACKAGE-A TEST] Second project, deposit pending`) was **not** rolled back, per the same convention noted in the prior realtime-updates session — this is the dev database DEVELOPMENT.md describes as being for exactly this kind of testing.

## Typechecks

`npx tsc --noEmit` (api) — clean. `npm run build` (web) — clean.

## Commit

`b602dd3` — Package A quick fixes: artist picker avatar, Calendar month default, estimate section consolidation.

## Cleanup

Dev web server (vite, :5173) that I started for verification was stopped. The API dev server on :4000 was already running from an earlier session (not started by me this session) — left as-is. Scratch seed script (`apps/api/scratch-seed-deposit-test.ts`) deleted after use.

---

# Package E — Kanban view for Inquiries & Projects

Single session on `main`. No schema changes — only additive Prisma `select`/`include` field projections (no migration).

## Columns, verified against the real `InquiryStatus` enum and the existing 5-step pipeline grouping

`InquiryStatus` (from `schema.prisma`): `NEW, ARTIST_ASSIGNED, AWAITING_CLIENT_RESPONSE, BUDGET_NEGOTIATION, SCHEDULING, WAITLISTED, DEPOSIT_PENDING, CONFIRMED, CLOSED_LOST, COLD_LEAD`. No `COMPLETED` value exists on `Inquiry` (that's `AppointmentStatus`, a different model) — the task's example Projects labels ("Scheduling → Confirmed → Completed") don't match reality, per its own "verify, don't assume" instruction.

**Inquiries tab** — reuses `InquiryPipeline.tsx`'s existing `PIPELINE_STEPS` (now exported) rather than a second grouping, its first four steps only (the fifth, `Scheduled`, is the Projects tab's job):
1. Inquiry received — `NEW`
2. Artist assigned — `ARTIST_ASSIGNED`
3. Estimate sent — `AWAITING_CLIENT_RESPONSE`, `BUDGET_NEGOTIATION`
4. Deposit requested — `DEPOSIT_PENDING`
5. Inactive (collapsed, far right) — `CLOSED_LOST`, `COLD_LEAD`

**Projects tab** — one column per status in the page's own existing `PROJECTS_TAB_STATUSES` (already used by the List view's filter dropdown), not the pipeline's collapsed "Scheduled" step:
1. Scheduling — `SCHEDULING`
2. Waitlisted — `WAITLISTED`
3. Confirmed — `CONFIRMED`

No Inactive column on the Projects tab: `PROJECTS_TAB_STATUSES` never included `CLOSED_LOST`/`COLD_LEAD` even before this change (a marked-lost project simply disappears from the Projects tab today, in both List and Kanban) — adding an Inactive column there would have been new behavior the task didn't ask for.

## Drag resolution — every transition, why it's direct/open-flow/reject

No new status-PATCH route was added. `apps/api/src/routes/inquiries.ts` only gained: wider `select`/`include` projections (artist avatar/email, `updatedAt`, price estimate — all for the card), an `?scope=all` param on the existing `GET /assigned-to-me` (artist board only, default behavior unchanged), and an `inquiry.updated` WS invalidation event fired from the *existing* mutation routes (no new mutation logic).

**Inquiries tab:**
| Drag | Kind | Why |
|---|---|---|
| Inquiry received → Artist assigned | open-flow | `PATCH /:id/assign` needs a specific `artistId` — navigates to `/inquiries/:id?openFlow=assign`, which scrolls to the Assignment card (already the only UI for this, already visible for a `NEW` inquiry) |
| Artist assigned → Estimate sent | open-flow | `POST /:id/send-estimate` needs price/time numbers — navigates with `?openFlow=send-estimate`; `InquiryDetail.tsx` already auto-opens that section in edit mode whenever no estimate has been sent yet, so this is a no-op scroll-to in the common case |
| Estimate sent → Deposit requested | **reject** | `DEPOSIT_PENDING` is only reachable through the client's own "Proceed" click on the public estimate page (`apps/api/src/routes/estimates.ts`) — no staff route performs this transition at all, so there's nothing to call |
| any active → Inactive | open-flow | `?openFlow=mark-lost` opens the real "Mark as lost" modal (confirmed/reason dialog), never sets status directly |
| Inactive → any active | open-flow | `?openFlow=reopen` opens the real "Reopen inquiry" modal with its status picker |
| any backward, or any skip-ahead | reject | no route performs it |

**Projects tab:**
| Drag | Kind | Why |
|---|---|---|
| Scheduling → Confirmed | open-flow | `POST /:id/schedule` needs `startTime`, `endTime`, **and `giftCardId`** — navigates to `?openFlow=schedule`, which scrolls to the real Scheduling form. The form's submit button is `disabled` until a gift card is selected, and the backend independently re-validates it via `validateGiftCardForAttachment` — the Kanban board never calls this route itself, so **the gift-card-before-scheduling rule cannot be bypassed by drag**: there is no code path where a drag alone produces a `CONFIRMED` status. Verified live — dragging a `SCHEDULING` card into Confirmed opens the form and leaves the inquiry's status at `SCHEDULING` (checked via a direct API read after the drag). |
| Scheduling → Waitlisted | **direct** | `POST /:id/waitlist` takes only an optional free-text note — genuinely data-free as a drag, the one case on either tab where this applies. Verified live: card moved, and the resulting audit row reads `Status: Scheduling → Waitlisted`. |
| Waitlisted → anything, Confirmed → anything | reject | Neither has a route back into `SCHEDULING`/`CONFIRMED` today (this is a pre-existing gap in the app, not something this feature could or should paper over with a new bespoke endpoint) |

## Artist-side board (`MyInquiries.tsx`)

`GET /inquiries` and `GET /inquiries/:id` are `OWNER`/`FRONT_DESK`-only — an artist has zero access to either, so their board can't reuse `Inquiries.tsx`'s data source or its `/inquiries/:id` navigation targets (no detail page to send them to). Their "existing restricted list view" is `GET /inquiries/assigned-to-me`, previously hardcoded to `status: ARTIST_ASSIGNED` only (the approve/decline inbox `MyInquiries.tsx` already had). Added an opt-in `?scope=all` on that *same* route (default behavior byte-for-byte unchanged) so the artist's Kanban board can see everything currently assigned to them across every status, still fully scoped to `assignedArtistId = them` server-side — never the full studio board.

Only the `Artist assigned` column is interactive for them (`interactiveColumnKeys={['Artist assigned']}` on the Inquiries tab, `[]` on Projects) — every other card renders read-only, since an artist has no route for anything else (staff-only `assign`/`send-estimate`/`schedule`/`waitlist`/`mark-lost`/`reopen` all stay `requireRole(OWNER, FRONT_DESK)`, untouched). The one live transition — `Artist assigned → Estimate sent` — opens the exact existing `openApprove()` modal already defined in `MyInquiries.tsx` (same component, same state, no duplicate approve logic). Declining was deliberately left off the board: it isn't a forward drag to any column on this board (it unassigns back to `NEW`, which never appears here since a `NEW` inquiry has no `assignedArtistId` yet) — it stays exactly where it was, the List view's Decline button.

## Real-time

`inquiry.updated` (new `InvalidationEvent` variant, `apps/api/src/lib/realtime/registry.ts`) is emitted from `/assign`, both branches of `/respond`, `/send-estimate`, `/schedule` (alongside its existing `appointment.changed`), `/waitlist`, `/mark-lost`, `/reopen`, and `/attach-gift-card` — every route that changes an inquiry's status outside of creation. It invalidates the bare `["inquiries"]` prefix, which both `Inquiries.tsx`'s `inquiriesQueryKey` and the new `assignedInquiriesQueryKey` (`['inquiries', 'assigned-to-me', studioId]`) are prefix-compatible with, so both boards (and the List views) refresh live with zero new registry entries needed per board.

## Mobile

Below `md`, the board is replaced entirely (not shrunk/scrolled) by a column-picker `<select>` plus that column's cards as a plain stacked list — no drag surface on touch. Verified at a 390px viewport.

## Library

`@dnd-kit/react` (MIT, Clauderic). Checked current status before adopting: the older `@dnd-kit/core`/`@dnd-kit/sortable` (last published ~2 years ago) is now explicitly documented as the *legacy* API; `@dnd-kit/react` is the actively maintained line the maintainer recommends for new projects (release a month prior to this session) and is what's actually installed here.

Known cosmetic issue: a `useInsertionEffect must not schedule updates` React warning appears in the console during drag operations (library-internal, likely its style-injection plugin). Every tested transition (direct, open-flow, reject, on both boards) completed correctly despite it — noting it here in case a future `@dnd-kit/react` upgrade addresses it, not something I chased further since nothing was actually broken.

## Verification

Playwright against the local dev stack, as both `owner@dev-studio.test` (OWNER) and `artist1@dev-studio.test` (ARTIST), desktop (1500px) and mobile (390px) viewports:
- List/Kanban toggle on both tabs; filters and fetched data are shared between the two render modes (same query, same array).
- `NEW → Artist assigned` drag opens the real Assignment section, scrolled into view, pre-contextualized to that inquiry (screenshot).
- `Estimate sent → Artist assigned` (illegal, backward) rejected with an inline message, card unmoved.
- Drag into Inactive opens the real "Mark as lost" modal (screenshot).
- `Scheduling → Waitlisted` direct drag: confirmed via API read (status flipped) and the resulting Activity History audit row (`Status: Scheduling → Waitlisted`).
- `Scheduling → Confirmed` drag opens the real Scheduling form; confirmed via API read that status stayed `SCHEDULING` (not silently completed).
- `Waitlisted → Confirmed` (illegal) rejected with an inline message.
- Mobile: column-picker + stacked list confirmed, no board/drag surface.
- ARTIST board: filtered to their own assigned inquiries only (verified their board never shows another artist's or an unassigned `NEW` card); `Artist assigned → Estimate sent` drag opens the real Approve modal; `Artist assigned → Inquiry received` (illegal) rejected; Projects tab fully read-only (no draggable cards).

## Typechecks

`npx tsc --noEmit` (api) — clean. `npm run build` (web) — clean (`tsc -b && vite build`).

## Commit

`a29a718` — Package E: Kanban view for Inquiries & Projects.

## Cleanup

Both dev servers (API :4000, web :5174) stopped, including orphaned child processes left by earlier background-task stops in this session (confirmed via `netstat` + explicit `Stop-Process`). Test-data mutations left in the dev database from verification (Bailey Testperson's `SCHEDULING → WAITLISTED`, Alex Testperson's `NEW → ARTIST_ASSIGNED` to Dev Artist One) were **not** rolled back, per the same standing convention noted in prior sessions' reports — this is the dev database DEVELOPMENT.md describes as being for exactly this kind of testing.
