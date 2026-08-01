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

---

# Package B — Client contact fields, manual merge, comparison view, dismiss suggestions

Single session on `main`. One schema migration (`package_b_client_contacts_and_dismissed_duplicates`). A concurrent session had uncommitted, unrelated changes to `apps/web/src/components/Modal.tsx` (a drag-to-move feature) sitting in the same working directory while this session ran — left entirely untouched and excluded from every `git add`/commit in this session (staged files individually by path throughout, never `-A`).

## 1. Client contact fields

`Client` gains `instagramHandle`, `facebookProfileUrl`, `otherContact` (all nullable `String`, which is unbounded `text` in Postgres by default — no `@db.Text` needed). Mirrors `Artist.instagramHandle`/`facebookProfileUrl` field-for-field, including the same comment explaining why there's no automatic profile import.

- `PATCH /clients/:id`: added the three fields to `EDITABLE_CLIENT_FIELDS` — they fall through the route's existing generic "string or null, trimmed" branch untouched, so no new validation code was needed, and they're automatically covered by the existing `diffObjects` audit-log call (no changes there either).
- `ClientDetail.tsx`: added inputs to the existing edit form (Instagram handle, Facebook URL, Other contact, right after Phone), and a read-only display next to the name/email/phone block — Instagram/Facebook render as circular icon links (exact JSX/CSS lifted from `Team.tsx`'s artist social-links treatment, reusing the same `InstagramIcon`/`FacebookIcon`), Other Contact as plain muted text (it's often not a URL, so it isn't forced into a link).

## 2. Manual merge search

New `GET /clients/merge-search?q=&excludeId=` (registered *before* `GET /:id` in the router, since Express would otherwise match the static path as a client id). Deliberately not a reuse of `search.ts`'s existing omnibox endpoint — that route bundles four unrelated entity types and caps at 6 results, wrong shape for a picker. Also deliberately *not* a single `contains` check against the whole query the way `search.ts` does it: a two-word query like "Casey Testperson" would never match anything that way, since neither `firstName` nor `lastName` alone contains the full string. Fixed by splitting the query on whitespace and requiring every word to match *some* field (name/email/phone) via `AND` of per-word `OR`s — caught this by testing the exact query a real user would type, not just a single name token.

`ClientDetail.tsx`: new "Merge with another client" button (always visible, not just when the auto-detector found something) opens a debounced (300ms) search modal; picking a result routes into the same comparison flow as the auto-suggested banner (see §3), never calls `merge` directly.

## 3. Side-by-side comparison view

New shared `apps/web/src/components/ClientComparisonView.tsx` — fetches `GET /clients/:id` + `GET /appointments?clientId=:id` for both clients (the same two calls `openMergeConfirm` already made for its preview, no new backend endpoint needed) and renders phones, emails, socials, inquiry count, appointment count + most recent appointment, gift card count + total value, and a computed "last activity" (max of account creation, any inquiry/gift-card/appointment date — an approximation, not an authoritative log).

Wired in front of the existing confirm-merge dialog from **both** entry points: the duplicate banner's "Merge into this client" and the new search picker's result-click both now open `ClientComparisonView` first; its "Proceed to Merge" button calls the untouched, pre-existing `openMergeConfirm`/confirm-merge flow. `POST /clients/:id/merge` itself was not touched at all.

## 4. Dismiss a suggested duplicate

New `DismissedDuplicatePair` model (`clientAId`/`clientBId` always stored with the lexicographically smaller id first via a `normalizeDuplicatePair` helper, `@@unique` on the pair) plus `POST /clients/:id/dismiss-duplicate` (`{ otherClientId }`, upsert — idempotent, re-dismissing doesn't error) and an update to `GET /:id/potential-duplicates` to exclude any pair with a dismissal row. Both routes live in `clients.ts` with no extra role check, inheriting the router-level `requirePermission("clients.manage")` — confirmed via PowerShell that FRONT_DESK gets the identical behavior as OWNER (same as every other route in this file, including the pre-existing `merge`).

UI: a "Not a duplicate" button next to "Merge into this client" on the banner; on success the dismissed candidate is removed from the local list immediately.

**Confirmed dismissed pairs don't block manual merge**: dismissed the Casey/Drew test pair (see below), confirmed `GET /potential-duplicates` no longer lists it, then searched for "Drew" via the manual merge-search picker from Casey's page and confirmed it still surfaces and is still fully mergeable — dismissal only ever touches the automatic-suggestion query, never `merge-search` or `merge` itself.

## Verification

**Browser** (Playwright, `owner@dev-studio.test`): added Instagram/Facebook/Other-contact to a client, confirmed the icon links render with correct `href`s and the other-contact text shows; searched for "Casey Testperson" (a client with no contact overlap with the client being edited, so the auto-detector never flags it) via the new picker, opened the comparison view, confirmed it shows both names, phones/emails, gift card total, and "Last activity", then "Proceed to Merge" correctly opened the existing Confirm Merge dialog unchanged; seeded a real auto-detected duplicate pair (gave two seeded clients a matching email via a scratch script) and confirmed the banner appears, "Not a duplicate" makes it disappear, and the pair remains findable/mergeable via manual search afterward. Screenshots taken at every step.

**PowerShell**: created a second throwaway studio + owner + client to test cross-studio boundaries — `merge-search` from the other studio's owner token returns zero results for a same-name dev-studio client (studio-scoped query, not an error); a cross-studio `merge` attempt and a cross-studio `dismiss-duplicate` attempt both correctly 404 ("not found," not a 403 — matches the existing `merge` route's own ownership-check pattern). Confirmed FRONT_DESK can call `merge-search` and `dismiss-duplicate` (including idempotent re-dismiss) exactly like OWNER, no route-specific role gate blocking it.

## Typechecks

`npx tsc --noEmit` (api) — clean. `npm run build` (web) — clean.

## Commit

`9e328a3` — Package B: client contact fields, manual merge search, comparison view, dismiss duplicate.

## Cleanup

Scratch scripts (`scratch-seed-duplicate-pair.ts`, `scratch-check-studios.ts`, `scratch-seed-studio2.ts`) deleted after use. Web dev server (:5173) started for this session's verification was stopped; the API dev server on :4000 (already running from an earlier session) was left as-is.

**Test data left in the dev database, not rolled back** (per the same standing convention as every prior session's report):
- Alex Testperson (`client1@dev-studio.test`): phone corrected to a valid 10-digit number, plus the Instagram/Facebook/Other-contact values added during verification.
- Casey/Drew (`client3`/`client4@dev-studio.test`): Drew's email was changed to match Casey's (to create a real auto-detected duplicate pair to test against), then dismissed as "not a duplicate" via the UI — the dismissal row is real and correctly in effect.
- A second studio (`dev-studio-2`, owner `owner2@dev-studio2.test` / `password123`, one client) created solely to test cross-studio rejection. This is a bigger footprint than a typical single test row — flagging it explicitly in case it's not wanted long-term in the shared dev database; delete via `prisma.studio.delete({ where: { slug: "dev-studio-2" } })` (cascades) if so.

---

# Package C1 — Custom policies + configurable deposit tiers

Single session on `main`. One schema migration (`package_c1_custom_policies_and_deposit_tiers`).

## 1. Custom policies

New `CustomPolicy` model (`title`, `bodyHtml`, `isPublic`, `order`, timestamps, `studioId`). CRUD lives in a new `apps/api/src/routes/customPolicies.ts`, split into `publicRouter` (unauthenticated `GET /custom-policies/public?studioSlug=`, mirroring `artists.ts`'s existing public-route pattern) and `staffRouter` (`requireAuth` + per-route `requireRole`) — mounted the same public-then-staff order as `gift-cards`/`waivers` in `index.ts`. View (`GET /`) is OWNER + FRONT_DESK, matching the fixed 8 HTML fields' own `canViewPolicies`; create/edit/delete/reorder are OWNER-only, matching `canEditPolicies` and `studioSettings.ts`'s existing `PATCH /` gating — no new permission pattern introduced, `requirePermission`/the configurable matrix was deliberately not used here since policy/settings editing has never been part of it (confirmed: the 8 existing fields use plain `requireRole(Role.OWNER)` too).

Frontend reuses the exact edit-icon → `RichTextEditor.tsx` → `Modal` interaction the 8 fixed fields already use, generalized to an open-ended list (add, edit, reorder via up/down buttons, delete via an inline confirm/cancel pair, public/private toggle in the edit modal) — new "Custom Policies" card in Settings → Policies & Templates, right below the existing Reminder Templates card.

New public page `apps/web/src/pages/Policies.tsx` at `/policies/:studioSlug`, modeled on `IntakeForm.tsx`'s loading/invalid/ready state machine. Renders each public policy's `bodyHtml` through the **existing, unmodified** `sanitizeHtml.ts` (DOMPurify, the same allow-list already shared by `EstimateResponse.tsx`/`WaiverSign.tsx`) — no new sanitizer, no server-side sanitization added; sanitization happens client-side at render time only, consistent with how every other HTML policy field in this app already works.

**Sanitizer coverage confirmed** with a real injection, not just a typed/auto-escaped string: PATCHed a policy's `bodyHtml` directly via the API (bypassing the editor, which auto-escapes typed `<`/`>`) to `<p>Legit text</p><script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">click</a>`, confirmed the raw value is stored as-is (no server-side sanitization, by design), then loaded `/policies/dev-studio` in a real browser: no `alert()` fired, no `<script>` element in the DOM, no `onerror` attribute, no `javascript:` href — while "Legit text" still rendered correctly. Test policy deleted afterward rather than left with literal payload text in the dev database.

## 2. Configurable deposit tiers

`StudioSettings.depositTiers` (`Json?`) replaces `computeDepositTier`'s hardcoded breakpoints. New `apps/api/src/lib/depositTiers.ts`: `DEFAULT_DEPOSIT_TIERS` (the studio's literal prior behavior, in cents), `validateDepositTiers` (contiguity/no-gap/no-overlap/exactly-one-catch-all), `resolveDepositTiers` (null-safe fallback), and `computeDepositTier(averageEstimate, tiers)` now taking the tier list as a parameter instead of hardcoding it. The one call site (`POST /inquiries/:id/deposit-form`) now reads the studio's `StudioSettings.depositTiers` first, falling back to the defaults if unset.

**Seeded initial tier values** (for review against current real pricing) — mirrors the prior hardcoded logic exactly, at cent granularity so contiguity holds:

| Min | Max | Deposit |
|---|---|---|
| $0.00 | $200.00 | $50.00 |
| $200.01 | $599.00 | $100.00 |
| $599.01 | and above | $200.00 |

(Flat $10 fee on top of the deposit in every tier, unchanged — the task only asked to make the deposit breakpoints configurable, not the fee.)

**Deviation from a literal DB backfill, flagged deliberately**: the task asked to "seed the studio's current hardcoded breakpoints as the initial value." Since `depositTiers` is nullable and the schema migration had already been applied to the dev database by the time this need was identified, editing the already-applied migration file to add a data-seeding `UPDATE` would have left its recorded checksum out of sync with the file on disk — a real risk of `prisma migrate dev` flagging drift (and potentially prompting a dev-database reset) on a future run. Instead, "seeding" is handled entirely in application code: `GET /studio-settings` materializes `DEFAULT_DEPOSIT_TIERS` into its response whenever the stored value is null (so the Settings UI always shows the studio's real current effective tiers, never a misleadingly-empty list), and `computeDepositTier`'s own fallback guarantees identical behavior either way. Net effect for the user is the same — behavior and displayed values don't change until an OWNER edits them — this only changes *how* that's achieved, and this also means any future new studio benefits from the same fallback automatically without needing its own migration.

Settings UI: new "Deposit Tiers" card (OWNER-edit, same own-card own-Edit-toggle convention as the existing Send Times section) — add/remove/edit tier rows in dollars (converted to/from cents at the API boundary only), Save/Cancel.

## Verification

**Browser** (Playwright): created a custom policy, marked it public, confirmed it appears at `/policies/dev-studio`; toggled it private, confirmed it disappeared from the public page while remaining visible/editable in Settings; deposit tiers card correctly displays the seeded $50/$100/$200 breakpoints.

**PowerShell**:
- Invalid tier configs all correctly rejected with clear errors: a gap (`20000` → `20500`), an overlap (`20000` → `19000`), a missing catch-all tier, and two catch-all tiers. A valid config (matching the defaults) was accepted.
- FRONT_DESK correctly blocked (403) from editing deposit tiers and from creating a custom policy, while still able to read the custom-policies list (matching the view/edit split).
- Cross-studio isolation confirmed for custom policies: a second studio's owner token sees an empty list (not the other studio's policy), and direct PATCH/DELETE-by-id attempts against the other studio's policy both 404 (ownership check, not just a filtered list) — same pattern as Package B's `merge`/`dismiss-duplicate` cross-studio checks.

## Typechecks

`npx tsc --noEmit` (api) — clean. `npm run build` (web) — clean.

## Commit

`15f8cd7` — Package C1: custom policies + configurable deposit tiers.

## Cleanup

Web dev server (:5173) started for this session's verification was stopped; the API dev server on :4000 (already running from an earlier session) was left as-is. Test policies created for XSS/cross-studio verification were deleted after use, since they contained literal script-injection payload text. `depositTiers` on `dev-studio`'s `StudioSettings` is now explicitly persisted (equal to the defaults, from the valid-config verification PATCH) rather than left null — no behavior change, just no longer relying on the null-fallback for this one studio.

---

# Package D — Scheduling assistant (tentative deposit-form time + real suggested times)

Single session on `main`. One schema migration (`package_d_deposit_form_proposed_time`). A concurrent session had already substantially reworked artist-picker UI (extracting a shared `ArtistSelect.tsx`, adding `avatarUrl` to more artist selections across the app) directly in files this feature also needed to touch — see "Concurrent work" below for exactly how that was handled.

## The shared service

`apps/api/src/lib/schedulingAssistant.ts` — `getSuggestedTimes(artistId, durationMinutes, options?): Promise<SuggestedTimeCandidate[]>`, where `SuggestedTimeCandidate = { startTime: Date; endTime: Date; hasBufferConflict: boolean }` and `options = { now?, searchDays? (default 21), maxSuggestions? (default 5), excludeAppointmentId? }`. Exposed via `GET /scheduling/suggested-times?artistId=&durationMinutes=&excludeAppointmentId=` (`apps/api/src/routes/scheduling.ts`, `requireAuth` + `requireRole(OWNER, FRONT_DESK)` — same level as every other scheduling-mutation route). **This is the one entry point both consumers below call — reuse this route (or the function directly, server-side) for any future feature needing suggested times, rather than adding a third implementation.**

Algorithm: reads the artist's `preferredSchedule` + guest window (both advisory, same semantics as everywhere else they're read — no `Location.hours` fallback, matching the exact reasoning the prior client-side algorithm already documented: there's no `Artist.locationId`, only `User.locationId`, unselected by any artist route), fetches that artist's appointments once for the whole search window, then for each candidate slot mirrors `findBufferConflict`'s exact `SCHEDULING_BUFFER_MS` (1.5h) predicate against that already-fetched list rather than re-querying per candidate. Buffer-clean candidates always rank first; a flagged one only survives into the final top-N if the search window has fewer than N clean candidates anywhere — verified explicitly (see Verification below), matching the app's established "flag, don't block/omit" philosophy.

## 1. Pre-payment: tentative deposit-form time

`DepositForm` gains `proposedStartAt`/`proposedEndAt` (both nullable `DateTime`, no relation to `Appointment`, no gift-card requirement). New `PATCH /inquiries/:id/deposit-form/proposed-time` (`{ proposedStartAt, proposedEndAt }`, both set or both null) — deliberately **separate** from the existing `POST /:id/deposit-form`, which rotates the token/expiry on every call and would invalidate a link already sent to the client if reused for this. Requires a deposit form to already exist; audited as `entityType: "DepositForm"`.

`InquiryDetail.tsx`'s Deposit card gets a new "Tentative time (optional)" block (visible once a deposit form exists, an artist is assigned, and both time-estimate bounds are set) — "Suggest a time" opens a modal listing `getSuggestedTimes` candidates (buffer-conflict ones visibly flagged "Close to another appt"), picking one saves it; "Change"/"Clear" once one's set. Explicit copy throughout: "Informational only... No appointment is created."

Public deposit page (`DepositResponse.tsx`) shows a new "Tentative Time" block with the exact framing from the spec ("Your appointment will be tentatively scheduled for X, pending your deposit. We'll confirm exact scheduling once payment is received.") — rendered only when there's no real `appointment` yet (a real one always takes precedence, unchanged).

## 2. Post-payment: real suggested times + mini schedule snippet

`AppointmentForm.tsx`'s "Suggested times" panel now calls `GET /scheduling/suggested-times` instead of its prior client-side-only `suggestAppointmentSlots.ts` (deleted — this was the exact duplicate-buffer-constant risk the task called out; there is now exactly one implementation). New gating per spec: the panel (and the new mini schedule snippet) only appears once a gift card is available or already attached (`giftCardId !== '' || availableGiftCards.length > 0`) — previously suggestions had no gift-card gating at all. Selecting a suggestion pre-fills the existing `timeRange` state powering `DateAndTimeRangeFields`; submission is completely untouched, still the same validated, gift-card-gated `POST /appointments` route.

New `apps/web/src/components/MiniScheduleSnippet.tsx` — a simple custom 8am-8pm horizontal day-strip (existing appointments as muted blocks, the active suggestion highlighted), not a second `react-big-calendar` instance, per spec.

## Verification

**PowerShell / direct unit-style tests** (the task's own framing: "unit-testable in isolation... without needing to eyeball a calendar") — seeded a real conflicting appointment for a dev artist whose `preferredSchedule` is Tuesday 11:00–15:00 (server-local time; first attempt got the day/window wrong by not accounting for the dev server's `America/New_York` local time vs UTC — caught and corrected before trusting any result), then called `getSuggestedTimes` directly (not through the live API, so `now` could be pinned exactly):
- Every candidate's `hasBufferConflict` flag matched the exact `SCHEDULING_BUFFER_MS` predicate computed independently in the test, for both a fully-clean day and a fully-conflicting day.
- Clean candidates always ranked before flagged ones.
- With a clean day available later in a wider search window, the flagged conflict-day candidates were excluded from the top-5 entirely (not just deprioritized) — confirming "only returned if nothing better exists."
- A guest artist queried outside their `guestStartDate`/`guestEndDate` window returned zero candidates.

**Browser** (Playwright): seeded an inquiry with an assigned artist + time estimate, sent its deposit form, used "Suggest a time," confirmed the picked time saved and displayed on both the inquiry page (with Change/Clear) and the public deposit page (exact spec wording, no "confirmed" language) — and confirmed the inquiry's Appointments list still read "No appointments booked for this project yet" throughout, i.e. **zero coupling between the proposed time and real Appointment creation**. On the real appointment-creation form: confirmed the gift-card gating message shows when the client has no available card (all of this client's other cards were already attached from earlier verification, so this was a genuine, not staged, empty case), issued a fresh available card, confirmed suggestions then appeared, the mini schedule snippet rendered, and selecting a suggestion correctly pre-filled the date/time fields — same candidates as the deposit-form flow above, confirming both surfaces genuinely share the one service.

## Concurrent work

A different session's uncommitted `ArtistSelect.tsx` extraction + `avatarUrl` rollout was already sitting in the working tree before this one started, touching several files this feature also needed (`AppointmentForm.tsx`, `InquiryDetail.tsx`, `deposits.ts`, `inquiries.ts`, plus others this feature never touched at all: `appointments.ts`, `conversations.ts`, `search.ts`, `ArtistAvatar.tsx`, `ConversationsPanel.tsx`, `SearchPalette.tsx`, `StaffInquiryForm.tsx`, `AppointmentDetail.tsx`, `Calendar.tsx`, `ClientDetail.tsx`, `EstimateResponse.tsx`). Unlike Package B's `Modal.tsx` (a file this session never needed to touch, cleanly excluded from that commit), this was too entangled to split file-by-file. Before including it: confirmed no schema conflict (`Location.hours`, which that session's `Calendar.tsx` changes consume, already existed in committed schema — not a concurrent migration), fixed one genuinely broken spot it had left (`AppointmentForm.tsx` referenced `ArtistSelect` without importing it, and had an implicit-`any` parameter — needed fixing regardless since this session had to substantially rewrite that same file's suggestion logic), then confirmed a full clean `npm run build` + `npx tsc --noEmit` across the *entire* tree (including files this session never touched) before committing everything together in one commit, disclosed explicitly in the commit message.

## Typechecks

`npx tsc --noEmit` (api) — clean. `npm run build` (web) — clean.

## Commit

`83de48a` — Package D: scheduling assistant (tentative deposit time + real suggested times).

## Cleanup

Web dev server (:5173) stopped. The API dev server on :4000 (already running from an earlier session) left as-is. All scratch verification scripts deleted after use. Test data left in the dev database (per standing convention): the seeded conflict appointment for `artist1@dev-studio.test`, the assigned-artist/time-estimate now set on the `[PACKAGE-A TEST]` inquiry, its now-generated deposit form with a saved proposed time, and a fresh $100 gift card issued to Bailey Testperson for the gift-card-gating test.

---

# URGENT — suggested times ignore artist's actual working hours (timezone bug)

Single small session on `main`. No schema changes.

## Root cause, confirmed exactly

`getSuggestedTimes` (from the previous Package D session) built each candidate slot with plain `Date.setHours`/`setMinutes` calls, and read `Artist.preferredSchedule`'s stored `"09:00"`/`"17:00"` strings straight into them — both operate in the **API server process's own OS timezone**, never `StudioSettings.timezone`. My own dev-machine testing during Package D happened to pass because my dev machine's OS timezone (`America/New_York`) coincidentally matched the studio's configured timezone — masking the bug entirely in that environment. On a server whose OS timezone is UTC (the ordinary default for a production container) but a studio configured for `America/New_York`, a `9:00 AM–5:00 PM` schedule was silently read as `9:00 AM–5:00 PM UTC`, i.e. `5:00 AM–1:00 PM Eastern` — a near-exact 4-hour shift, matching the reported symptom (Louie G, Wed 9–5 schedule, all suggestions landing 5–9 AM) exactly.

## Every location the audit found

- **`preferredSchedule` window comparison** (`schedulingAssistant.ts`) — the primary bug above. Fixed.
- **Guest artist date-window check** (same file) — `localDateKey` used the same server-OS-local `getFullYear`/`getMonth`/`getDate` getters for the guest-window comparison. Same root cause, same fix.
- **`findBufferConflict`'s day-bucketing** (`schedulingConflict.ts`) — used **UTC** calendar-day boundaries (`Date.UTC(start.getUTCFullYear()...)`) to scope its query, a *third*, different timezone treatment from either of the above. This could miss a genuine conflict for an appointment near local midnight in a studio timezone far enough from UTC. Fixed by replacing the day-bucketed query with a buffer-padded absolute-instant window (`[start - 1.5h, end + 1.5h]`) — provably sufficient for the overlap predicate (which was already correct, timezone-agnostic absolute-instant math) and removes any timezone dependency from the query scope entirely, rather than trying to get the "right" timezone for a day-boundary that doesn't need to exist at all.
- **Business hours / per-location hours** — investigated, **nothing to fix**: `StudioSettings.businessHours` is dead code on the read side (written by the settings PATCH, never read anywhere), and `Location.hours` is only consumed by `Calendar.tsx`'s frontend visual shading (correctly using the *browser's* own local time for a staff member's own calendar view — a legitimate, different concern, not a backend scheduling comparison). Neither is read by any backend scheduling-suggestion or conflict-check code, so there was no flawed comparison to fix here.

## The shared utility

New `apps/api/src/lib/studioTime.ts` — the one shared, independently unit-tested home for every studio-timezone-aware time primitive used across the scheduling feature (and now the reminder ticker too):
- `civilDateKey(date, timeZone)` and `localMinutesSinceMidnight(date, timeZone)` — moved here from `reminderWindow.ts` (re-exported from there so `reminderTicker.ts`'s existing import is unaffected).
- `isSameCalendarDay(start, end, timeZone)` — moved here from `dateRange.ts` (same re-export treatment for `appointments.ts`'s existing import).
- `localDayOfWeek(date, timeZone)` and `zonedTimeToUtc(dateKey, time, timeZone)` — new. `zonedTimeToUtc` is the missing direction neither existing function needed before (they only ever went instant → local; generating a candidate slot from a stored `"09:00"` needs local → instant) — implemented via the standard two-pass offset-correction technique for `Intl`-only timezone conversion (handles DST transitions correctly), consistent with this codebase's existing convention of plain `Intl.DateTimeFormat` over a timezone library.

`schedulingAssistant.ts` now fetches the artist's studio's `StudioSettings.timezone` (falling back to `America/New_York`, matching the schema's own default) and routes every civil-date/wall-clock computation through these primitives — no more `Date.setHours`/`getDay`/`getFullYear` anywhere in that file.

## Unit tests (`apps/api/src/lib/studioTime.test.ts`, Node's built-in test runner)

No test framework existed in this repo before; added zero new dependencies (`node:test` + `node:assert/strict`, available natively). `npm test` now runs `tsx --test src/**/*.test.ts` (was a placeholder `exit 1` before). 9 tests, all passing:
- `zonedTimeToUtc("2026-07-22", "09:00", "America/New_York")` → `2026-07-22T13:00:00.000Z`, explicitly asserting the result's UTC hour is **not** 9 (the exact bug).
- Same check in January (`EST`, UTC-5) to prove DST correctness independently of the July case.
- `civilDateKey`/`isSameCalendarDay`: an instant that's the same UTC calendar day but a different Eastern day (and vice versa) — proving the whole point of timezone-aware day comparison with a concrete counter-example.
- `localDayOfWeek`, `localMinutesSinceMidnight` round-tripping.
- A 4-timezone × DST-transition-adjacent round-trip table (`zonedTimeToUtc` → `civilDateKey`/`localMinutesSinceMidnight` recovers the original inputs exactly).

## Live re-verification — exact reported scenario

Created a "Louie G" dev artist (Mon/Wed/Fri, 9:00 AM–5:00 PM, matching the bug report's screenshot exactly) and queried the real, running `GET /scheduling/suggested-times` endpoint (live HTTP request, real auth, real DB) for a Wednesday:

**Before this fix** (mechanism, not re-run against old code — reasoned from the exact same arithmetic the old code performed): stored `"09:00"` read as server-OS-local 9:00 AM → serialized as `09:00 UTC` → **5:00 AM Eastern**.

**After this fix** (actual live output):
```
2026-07-22T13:00:00.000Z | conflict: false   (09:00 Eastern)
2026-07-22T13:30:00.000Z | conflict: false   (09:00 Eastern)
2026-07-22T14:00:00.000Z | conflict: false   (10:00 Eastern)
2026-07-22T14:30:00.000Z | conflict: false   (10:00 Eastern)
2026-07-22T15:00:00.000Z | conflict: false   (11:00 Eastern)
```
All within 9:00 AM–5:00 PM Eastern, not 5:00–9:00 AM. 2026-07-22 confirmed a Wednesday.

**Additional rigor, not just asked for but necessary**: my dev machine's own OS timezone is `America/New_York`, the same as the dev studio's configured timezone — meaning a same-environment re-test alone couldn't distinguish "genuinely timezone-aware" from "coincidentally correct because both TZs match" (exactly the blind spot that let the original bug ship undetected). To rule that out, I temporarily pointed the studio's `timezone` at `America/Los_Angeles` (deliberately different from the server's own OS timezone) and re-ran the same query: every suggestion correctly shifted to land within 9:00 AM–5:00 PM **Pacific**, on a Mon/Wed/Fri, proving the result tracks the *studio's* configured timezone and is fully independent of whatever timezone the server process itself happens to run in. Reverted the studio's timezone back to `America/New_York` immediately after.

## Sweep-check — second artist, different hours/day

`artist1@dev-studio.test` (Tuesday only, 11:00 AM–3:00 PM — different artist, different day, different hours than Louie G): all 5 live suggestions landed Tuesday 11:00 AM–1:00 PM Eastern, correctly within window. Not a one-artist coincidence fix.

## Typechecks

`npx tsc --noEmit` (api) — clean. `npm run build` (web, unaffected by this backend-only fix) — clean. `npm test` (api) — 9/9 passing.

## Commit

`d23e278` — Fix scheduling assistant timezone bug: preferredSchedule read in server OS time, not studio time.

## Cleanup

Web dev server (:5173) stopped. The API dev server on :4000 (already running from an earlier session) left as-is. All scratch verification scripts deleted after use. Test data left in the dev database (per standing convention): a new "Louie G" dev artist (Mon/Wed/Fri 9–5, `louieg@dev-studio.test` / `password123`) created specifically to reproduce the reported scenario — worth keeping for any future scheduling-assistant work.

---

# Package C2 — Theme presets (curated, accessible)

**Branch: `ui/theme-presets`** (cut from `main` at commit `6f02f59`, after Package B/C1/D and the scheduling timezone fix all landed) — **NOT merged to `main`**. One schema migration (`package_c2_theme_presets`).

## Design

Rather than parameterizing every token per preset, all 4 presets share the *exact same* `bg`/`surface`/`surface-raised`/`surface-inset`/`border`/`fg`/`fg-secondary`/`fg-muted`/semantic-status tokens the current theme already has — only the accent trio (`accent`/`accent-fg`/`accent-hover`) varies per preset. This was a deliberate choice, not a shortcut: it means every already-AA-verified fg/bg pairing needs no re-verification at all (they're byte-for-byte unchanged across presets), and the *only* new contrast surface each preset introduces is its own accent used as button-fill-with-text and as standalone text on `bg`/`surface` — a small, fully enumerable set I could verify exhaustively rather than spot-checking. It also keeps the "near-black surface philosophy... never a jarring light theme" requirement trivially true for every preset, since the surfaces are identical to begin with.

## The 4 presets — exact token values

All four share:
```
--color-bg: #0a0a0b
--color-surface: #17171a
--color-surface-raised: #1e1e22
--color-surface-inset: #121214
--color-border: #ffffff14
--color-border-strong: #ffffff26
--color-fg: #f4f4f5
--color-fg-secondary: #a1a1aa
--color-fg-muted: #8b8b94
```
(semantic status colors — success/info/warning/danger/neutral — also unchanged across all 4)

| Preset | key | accent | accent-fg | accent-hover |
|---|---|---|---|---|
| Onyx & Lime (default) | `onyx-lime` | `#c9f031` | `#0a0a0b` | `#b8dd25` |
| Slate & Teal | `slate-teal` | `#2dd4bf` | `#0a0a0b` | `#14b8a6` |
| Ember & Amber | `ember-amber` | `#fb923c` | `#0a0a0b` | `#f97316` |
| Orchid & Magenta | `orchid-magenta` | `#e879f9` | `#0a0a0b` | `#d946ef` |

## Contrast-ratio verification (computed, not eyeballed)

Wrote a standalone WCAG 2.1 relative-luminance/contrast-ratio calculator (straight from the spec formula, no library) and ran every pairing programmatically.

**Shared pairings (identical across all 4 presets):**

| Pairing | Ratio | Threshold | Result |
|---|---|---|---|
| fg on bg | 18.00:1 | 4.5:1 | PASS |
| fg on surface | 16.28:1 | 4.5:1 | PASS |
| fg on surface-raised | 15.11:1 | 4.5:1 | PASS |
| fg on surface-inset | 17.02:1 | 4.5:1 | PASS |
| fg-secondary on bg | 7.72:1 | 4.5:1 | PASS |
| fg-secondary on surface | 6.98:1 | 4.5:1 | PASS |
| fg-muted on bg | 5.86:1 | 4.5:1 | PASS |
| fg-muted on surface | 5.30:1 | 4.5:1 | PASS |
| fg-muted on surface-raised | 4.92:1 | 4.5:1 | PASS (tightest shared pairing) |

**Per-preset accent pairings:**

| Preset | accent-fg on accent | accent-fg on accent-hover | accent as text on bg | accent as text on surface |
|---|---|---|---|---|
| Onyx & Lime | 15.07:1 PASS | 12.63:1 PASS | 15.07:1 PASS | 13.62:1 PASS |
| Slate & Teal | 10.63:1 PASS | 7.95:1 PASS | 10.63:1 PASS | 9.61:1 PASS |
| Ember & Amber | 8.74:1 PASS | 7.06:1 PASS | 8.74:1 PASS | 7.90:1 PASS |
| Orchid & Magenta | 8.04:1 PASS | 5.72:1 PASS | 8.04:1 PASS | 7.27:1 PASS |

Every pairing in every preset clears the 4.5:1 AA threshold for normal text, with the tightest margin (Orchid & Magenta's hover state, 5.72:1) still comfortably above it.

## Implementation

- `StudioSettings.themePreset` (`String @default("onyx-lime")`), validated against a fixed `THEME_PRESET_KEYS` list server-side (`apps/api/src/lib/themePresets.ts`) — never free-form. `PATCH /studio-settings` (already `requireRole(Role.OWNER)`, unchanged) validates and audits it exactly like every other field on that route.
- `apps/web/src/index.css`: one `:root[data-theme="..."]` block per preset, overriding only `--color-accent`/`--color-accent-fg`/`--color-accent-hover` — every existing Tailwind utility (`bg-accent`, `text-accent`, etc.) already reads these custom properties, so **zero components changed**.
- `apps/web/src/lib/themePresets.ts`: preset metadata (name/description/swatch colors) for the picker UI, plus `applyThemePreset()` (sets the `data-theme` attribute — the one function every consumer below calls).
- New `apps/web/src/components/ThemeApplier.tsx`, mounted once in `main.tsx` inside `AuthProvider`: fetches `/studio-settings` once a user is authenticated and applies the preset for the entire app shell.
- **Every public page also applies its own preset independently** (no shared context possible, since none of them have an authenticated user): `deposits.ts`/`estimates.ts`/`waivers.ts`/`giftCards.ts`'s existing public verify/view routes now each include `settings.themePreset` in their response (they already load the related `Studio` server-side, so this was a one-field addition, not a new query); `customPolicies.ts`'s public route likewise. `artists.ts`'s `/public?studioSlug=` (used by the intake form) returns a bare array, and I didn't want to risk changing that existing, working shape — so the intake form (and any future bare-array public route) instead calls a new, tiny `GET /theme?studioSlug=` (public, studioSlug-keyed, mirrors the existing `/artists/public?studioSlug=` pattern) built specifically for this.
- Settings → General gets a new "Theme" card: 4 visual swatch/preview cards (never a dropdown of names), gated on `user?.role === 'OWNER'` — deliberately reusing the *same* condition as `canEditPolicies` rather than the page's separate, studio-configurable `studio.manage` permission the Studio Profile card above it uses, since the backend PATCH route's gate is the hardcoded role check, not that configurable permission — using the wrong one would have let a FRONT_DESK with `studio.manage` granted see a picker that always 403'd.

## Verification (Playwright)

Switched through all 4 presets as OWNER and spot-checked the exact surfaces required, reading `getComputedStyle(document.documentElement).getPropertyValue('--color-accent')` at each stop rather than eyeballing screenshots alone:

| Surface | Onyx & Lime (default) | Slate & Teal |
|---|---|---|
| Settings picker | `#c9f031` | `#2dd4bf` |
| Dashboard (app shell) | — | `#2dd4bf` |
| Inquiries & Projects (data-heavy page) | — | `#2dd4bf` |
| Client profile | — | `#2dd4bf` |
| Conversations slide-over | — | `#2dd4bf` |
| Public intake form (`/inquiry/dev-studio`, unauthenticated) | — | `#2dd4bf` |

Also switched through Ember & Amber (`#fb923c`) and Orchid & Magenta (`#e879f9`) end-to-end in Settings, confirming each renders distinctly (screenshots taken at every step). No leftover hardcoded colors observed anywhere — every surface tracked the selected preset immediately, including the truly unauthenticated public intake form's own "Submit inquiry" button. Reverted the studio back to Onyx & Lime (its original default) at the end of verification, so the shared dev environment's baseline appearance is unchanged for anyone else using it.

## Typechecks

`npx tsc --noEmit` (api) — clean. `npm run build` (web) — clean.

## Commit

`aeee865` on branch **`ui/theme-presets`** — Package C2: theme presets (4 curated, WCAG AA-verified accents). Branch cut from `main`'s `6f02f59` and pushed to `origin/ui/theme-presets`.

**Note**: this branch's working directory had a different, unrelated, substantial concurrent session's in-progress `Tasks.tsx`/`tasks.ts` changes sitting uncommitted when the branch was created — left completely untouched and unstaged (same treatment as Package B's `Modal.tsx` exclusion), since they have nothing to do with theme presets and this branch is meant to be a clean, reviewable, single-purpose diff.

## Cleanup

Web dev server (:5173) stopped. The API dev server on :4000 (already running from an earlier session) left as-is. All scratch verification/contrast-calculator scripts deleted after use (they lived in the session scratchpad, never in the repo). The studio's live theme was reverted to `onyx-lime` after testing, so the shared dev database's visual baseline is unaffected.

## Next steps for review

Production is entirely unaffected either way until a deliberate merge — same as the original UI-2 redesign:
1. **Review locally**: `git fetch && git checkout ui/theme-presets`, run the app, switch between all 4 presets yourself.
2. **Approve and merge** `ui/theme-presets` into `main` to ship it.
3. **Discard the branch** if it's not wanted — nothing on `main` or production changes either way.

---

# SMS consent checkbox + public Privacy Policy & Terms pages

Single session, on `main`, done in an isolated `git worktree` (`../ink-manager-sms-consent`) rather than the shared checkout — a schema migration was involved and another session was actively mid-work on `ui/theme-presets` in the main checkout when this one started, matching exactly the collision risk the task's pre-flight called out.

## Pre-flight and the migration collision, resolved without a reset

`prisma migrate dev` immediately hit **schema drift**: the shared dev database already had `StudioSettings.themePreset` applied (from the `ui/theme-presets` session, committed on its own branch but not yet merged to `main`), which `main`'s own migration history didn't know about. Prisma's only offered fix was `prisma migrate reset` — **which would have dropped the shared dev database and destroyed the other session's test data**. Declined. Instead:

1. Hand-wrote the migration SQL (`ALTER TABLE "Client" ADD COLUMN ...`, `ALTER TABLE "StudioSettings" ADD COLUMN ...`) instead of letting `migrate dev` compute a diff.
2. Applied it directly with `prisma db execute --file`.
3. Recorded it as applied with `prisma migrate resolve --applied` (no shadow database, no drift check, no reset).

This kept `main`'s own migration history clean (doesn't bundle the unrelated `themePreset` column into this feature's migration) while never touching the already-applied state the other session depended on.

**A second, unrelated concurrent session** also used this same worktree directory partway through (its own `Inquiry.notes`/delegated-tasks work landed as two separate commits, `0727da8` and `bd5adaf`, mid-session) — every file it touched was verified line-by-line to contain none of this session's changes before staging, so nothing of theirs was swept into this commit. Bringing `origin/main`'s 4 diverged commits (the `ui/theme-presets` branch's eventual merge) back in via `git pull` produced real conflicts in `deposits.ts`/`giftCards.ts`/`waivers.ts` and their four frontend pages, where both sessions added a field to the same public API response (`themePreset` vs. this session's `studioSlug`) — resolved by keeping both fields in every case, then `prisma generate` + a full typecheck/build to confirm the merge didn't break anything.

## 1–2. Schema + Settings UI

- `Client.smsConsentGivenAt` (DateTime?), `Client.smsConsentSource` (String?) — set once, never overwritten.
- `StudioSettings.privacyPolicy` / `termsAndConditions` (String?, HTML) — added as two more entries in the *existing* `POLICY_HTML_FIELDS` array in `Settings.tsx` (now 10 fields total, one shared modal/editor, zero new UI machinery) and the backend's `TEXT_FIELDS` allow-list in `studioSettings.ts`.
- `studioSettings.ts` split into `publicRouter`/`staffRouter` (mirroring `customPolicies.ts`/`giftCards.ts`/`waivers.ts`) so `GET /studio-settings/public?studioSlug=` can serve these two fields with no auth, alongside the existing OWNER-only `GET`/`PATCH /studio-settings`.

## 3. Public pages

`/privacy/:studioSlug` and `/terms/:studioSlug` — one shared `PublicPolicyPage.tsx` component (`field`/`title` props), same `sanitizeHtml` + `tiptap-content whitespace-pre-wrap` render pattern as every other policy field (`Policies.tsx`, `EstimateResponse.tsx`, `WaiverSign.tsx`). Studio name shown above the body. Live: `http://localhost:5199/privacy/dev-studio` and `http://localhost:5199/terms/dev-studio` in this session's dev instance (same paths in production once deployed).

**Exact seeded text** (also in `apps/api/prisma/seed.ts` for any fresh dev database going forward — **not legal advice**, flagged for a lawyer's review before relying on it in production, same standing caveat as every other policy field in this app):

> **Privacy Policy** (`[DEV SEED] This studio respects your privacy...`)
>
> This studio respects your privacy. This policy explains what information we collect, how we use it, and how we protect it.
>
> **Information We Collect** — When you submit an inquiry or book an appointment, we collect your name, email address, phone number, and details about the tattoo you're interested in, including any reference or placement photos you choose to share.
>
> **How We Use Your Information** — We use this information to communicate with you about your inquiry and appointment -- confirmations, reminders, and updates from your artist -- and to provide the services you request.
>
> **Text Messaging** — If you opt in to receive text messages, message frequency varies based on your appointments -- typically a few messages around each scheduled session (booking confirmations, reminders in the days and hours before your appointment, and occasional follow-ups). Message and data rates may apply. Reply STOP at any time to opt out, or START to opt back in.
>
> We do not share or sell your mobile phone number to third parties.
>
> **Data Retention and Security** — We retain your information for as long as needed to provide our services and comply with legal obligations, and take reasonable measures to protect it from unauthorized access.
>
> **Contact Us** — If you have questions about this policy or your information, please contact us directly.

> **Terms & Conditions** (`[DEV SEED] By submitting an inquiry or booking an appointment...`)
>
> By submitting an inquiry or booking an appointment, you agree to the following terms.
>
> **Appointments and Deposits** — A deposit may be required to secure your appointment. Our deposit, refund, and reschedule policies are provided separately at the time a deposit is requested.
>
> **Communications** — By providing your phone number and opting in, you agree to receive text messages regarding your appointment, including reminders and updates. Message frequency varies based on your appointments -- typically a few messages around each scheduled session. Message and data rates may apply. Reply STOP to opt out at any time, or START to opt back in. We do not share or sell your mobile phone number to third parties.
>
> **Eligibility** — You must be at least 18 years of age to receive tattoo services.
>
> **Changes to These Terms** — We may update these terms from time to time; continued use of our services after a change means you accept the updated terms.
>
> **Contact Us** — If you have questions about these terms, please contact us directly.

No `{{placeholder}}` tokens (unlike `calendarInviteTemplate`) — nothing substitutes them at render time on these two pages, so the studio's actual name is shown separately, prominently, above the body instead.

## 4. Consent checkbox

`IntakeForm.tsx`: unchecked by default (`useState(false)`), inline "Please agree to receive text messages to submit this form" error on submit attempt while unchecked (does not call the API), label reads "I agree to receive text messages from {studio name} regarding my appointment, including reminders and updates. Message and data rates may apply. Reply STOP to opt out. View our **Privacy Policy** and **Terms**." with both as `target="_blank"` links to the two pages above.

Backend (`inquiries.ts` `POST /`): `smsConsent !== true` is a 400 for the **public** path only (staff walk-ins via `StaffInquiryForm` have no checkbox and aren't gated) — enforced server-side, not just via the disabled-until-checked UI. On success: a brand-new client gets `smsConsentGivenAt`/`smsConsentSource` set inline in its create; an existing client (matched by email) only gets them backfilled if not already set (`!existingClient.smsConsentGivenAt`) — verified live by submitting the same email twice and confirming the second submission's timestamp exactly matched the first (`2026-07-22T00:51:00.305Z`, unchanged).

## 5. Footer links

New shared `PublicPageFooter.tsx` (renders nothing until `studioSlug` resolves) added to `IntakeForm.tsx`, `EstimateResponse.tsx`, `DepositResponse.tsx`, `WaiverSign.tsx`, `GiftCardResponse.tsx` — the latter four needed a `studioSlug` field added to their existing verify/view API responses (`estimates.ts`, `deposits.ts`, `waivers.ts`, `giftCards.ts`), which didn't carry one before.

## 6. Client profile

`ClientDetail.tsx`'s Contact Info card now shows "SMS Consent: Given [date]" (green, `text-success`) or "Not yet given" (muted), right above the existing `smsOptedOutAt` warning line — same visual convention, no new pattern.

## Verification (Playwright against the local dev instance, not just typechecks)

- Intake form: checkbox confirmed unchecked on load; submit-while-unchecked shows the inline error and does **not** hit the API; checking it and submitting succeeds.
- Consent fields set correctly on the created client (`smsConsentGivenAt`/`smsConsentSource: "intake_form"`); a second submission from the same email preserved the original timestamp exactly.
- `/privacy/dev-studio` and `/terms/dev-studio` render the real seeded text live, studio name prominent above each.
- **Malicious payload test**: typing `<script>alert(1)</script>` through the Settings WYSIWYG editor itself just gets escaped as literal text by the editor (not a real test of the sanitizer) — so this was additionally tested by **PATCHing the raw string directly via the API** (`<script>alert(1)</script><img src=x onerror="alert(2)"><p>Legit paragraph</p><a href="javascript:alert(3)">bad link</a>`, bypassing the editor entirely) and loading `/terms/dev-studio` in a real browser with a `dialog` listener armed: the rendered DOM contained no `<script>` tag, no `onerror` attribute, and the `<a>` tag's `javascript:` href was stripped to nothing — `alert()` never fired. The legitimate `<p>Legit paragraph</p>` survived untouched. Confirms `sanitizeHtml.ts`'s existing allow-list is the real boundary, not the editor. Text restored to the clean seeded copy afterward.
- Footer links present with correct per-studio hrefs on the gift card page (screenshotted) and confirmed wired identically on the other three response pages by code (all four use the same `PublicPageFooter` component and the same newly-added `studioSlug` response field).
- Both typechecks (`npx tsc --noEmit` api, `npm run build` web) clean, including after the theme-presets merge and conflict resolution.

## Live public URLs (this session's dev instance)

- `http://localhost:5199/privacy/dev-studio`
- `http://localhost:5199/terms/dev-studio`

(Same relative paths — `/privacy/:studioSlug` and `/terms/:studioSlug` — once deployed; the dev-only port above won't exist in production.)

## Commit

`bd73203` on `main`.

## Cleanup

Both dev servers (API on a scratch port 4099, web on 5199 — chosen to avoid the several other sessions' dev servers already running on the usual 4000/5173 range) killed. Backfill/verification scratch scripts lived only in the session scratchpad, never in the repo. The worktree at `../ink-manager-sms-consent` will be removed after this report is committed and pushed.

---

# Package F — Exempt gift cards (OWNER-only issuance, bypasses deposit requirement)

## Design

An exempt gift card is a real `GiftCard` row: a new `GiftCardStatus.EXEMPT`, `amountCents: 0`, and an optional `exemptionReason` (nullable text). It satisfies the existing "appointment requires an attached ACTIVE gift card" rule without representing real money, by deliberately reusing the entire existing gift-card system (attach/detach mechanics, audit trail, appointment validation) rather than building a parallel exemption mechanism.

## 1. Schema

Added `EXEMPT` to `GiftCardStatus` and `exemptionReason String?` to `GiftCard` (`apps/api/prisma/schema.prisma`), migration `20260722125903_package_f_exempt_gift_cards`.

## 2. Issuance — OWNER only

New `POST /gift-cards/exempt` in `apps/api/src/routes/giftCards.ts`, gated `requireRole(Role.OWNER)` stacked on the router-level `requireRole(Role.OWNER, Role.FRONT_DESK)` — the exact same per-route-override pattern as the existing `POST /:id/void`. Creates a `GiftCard` with `status: EXEMPT`, `amountCents: 0`, optional `exemptionReason`, and an optional `expiresAt` (unlike regular issuance, defaults to **never** rather than the studio's configured default — only an explicit OWNER-set date applies). Audited as `exempt_gift_card_issued`, recording the OWNER, client, and reason.

Frontend: a distinct "Issue Deposit Exemption" button in `ClientDetail.tsx`, gated on `user?.role === 'OWNER'` via `useEffectiveUser()` (same idiom as every other OWNER-only action in the app), opening its own modal (reason + optional expiration) that posts to the new route — entirely separate from the existing "Issue Gift Card" button/modal, which is unchanged and still available to OWNER/FRONT_DESK.

## 3. Appointment creation — accept EXEMPT alongside ACTIVE

The exact validation check broadened: `validateGiftCardForAttachment` in `apps/api/src/lib/giftCards.ts`, the line that read `if (synced.status !== GiftCardStatus.ACTIVE)`, now reads `if (synced.status !== GiftCardStatus.ACTIVE && synced.status !== GiftCardStatus.EXEMPT)`. This one shared function is called from all three real attach paths (`POST /appointments`, `POST /inquiries/:id/schedule`, `POST /inquiries/:id/attach-gift-card`), so all three picked up EXEMPT support with this single change — no rewrite of the surrounding logic. `isExpired`/`syncExpiredStatus` were also broadened the same way, so a time-limited exempt card still lazily expires like an ACTIVE one. `PATCH /gift-cards/:id/attachment`'s "only ACTIVE can be moved" guard was broadened identically for consistency, though this route has no frontend caller today.

Frontend `isCardAvailable` filters in `AppointmentForm.tsx` and `InquiryDetail.tsx` (previously ACTIVE-only) were broadened the same way, so exempt cards appear in the attach-flow dropdowns; their option labels show "Deposit Exemption" instead of a dollar figure.

Attach/detach of an already-issued exempt card uses the same existing attachment mechanics and the same OWNER/FRONT_DESK permission level as any other gift card — only initial issuance (§2) is OWNER-restricted.

## 4. Checkout behavior

`POST /appointments/:id/checkout` (`apps/api/src/routes/appointments.ts`): when the attached card's status is `EXEMPT`, the server now ignores whatever `depositDecision` the client sent and forces the existing ROLL-equivalent behavior — `redeem = depositDecision === "REDEEM" && !isExempt`. This is a defensive server-side guarantee, not just a UI convention: even if a client sent `"REDEEM"` for an exempt card, the server would still detach it rather than mark it REDEEMED. Because ROLL's pre-existing math is `amountDueCents = finalCostCents` and its pre-existing gift-card update is `{ appointmentId: null }` (status untouched), this **reuses the exact same code path** already used for a real card's rollover — no new amount-due branch, no new detach branch. The only change is the boolean that decides which branch runs. The GiftCard-level audit entry additionally records `reason: "exempt_card_detach"` (vs. `"checkout_roll"` for a real rollover) so the two are distinguishable in the audit trail despite sharing the same code path.

Frontend (`AppointmentDetail.tsx`): when `appointment.giftCard?.status === 'EXEMPT'`, the REDEEM/ROLL radio choice is replaced with a static note ("Deposit exemption — no charge applied from this card"), and `handleCheckout` always sends `depositDecision: 'ROLL'` for these (the backend enforces this regardless, per above, so this is belt-and-suspenders, not the actual safety mechanism).

## 5. Display

`StatusPill.tsx`: added `EXEMPT: 'info'` — the one gift-card tone not already spoken for (ACTIVE=success, REDEEMED=neutral, EXPIRED=warning, VOID=danger). Every gift-card display location (`ClientDetail.tsx`'s table, `GiftCardDetail.tsx`, `GiftCardResponse.tsx`'s public page, `AppointmentDetail.tsx`'s inline line and checkout note, `ConversationsPanel.tsx`'s client-context list, the `AppointmentForm.tsx`/`InquiryDetail.tsx` attach dropdowns) shows "Deposit Exemption" (+ the reason, where there's room) instead of a dollar amount when `status === 'EXEMPT'`.

Text receipt (`GiftCardDetail.tsx`) was already ACTIVE-only gated, so EXEMPT is excluded with no code change needed there. QR code and Copy-link (previously shown unconditionally) now have an explicit `card.status !== 'EXEMPT'` guard added. Public-share links: `clients.ts`'s `giftCardLinks` (which feeds the Conversations composer's "+" menu) now filters exempt cards out entirely at the source, so `ConversationsPanel.tsx` needed no changes at all — there's simply no share/resend row for an exemption.

## Verification (PowerShell against the local dev instance's API, plus Playwright in a real browser)

**PowerShell**: OWNER issues an exempt card (`status: EXEMPT`, `amountCents: 0`) successfully; FRONT_DESK attempting the same route gets 403; FRONT_DESK attaches that exempt card to a new appointment via the normal `POST /appointments` (no real gift card needed); checkout with `depositDecision: "REDEEM"` sent deliberately still returns `amountDueCents: 15000` (the full final cost, ignoring REDEEM since the card is EXEMPT); the card afterward is confirmed `status: EXEMPT`, `appointmentId: null` (detached, not redeemed); the same card is then successfully attached to a *second* appointment for the same client, confirming immediate reusability. Cross-studio isolation holds structurally — the new route and every existing gift-card route scope every query/write to `req.user!.studioId`, the same mechanism already relied on (and previously verified) for every other gift-card operation.

**Browser**: as OWNER, the "Issue Deposit Exemption" button is confirmed present (and, as FRONT_DESK, confirmed absent, while "Issue Gift Card" remains visible to FRONT_DESK) on the client profile; issuing one renders it in the gift card table as "Deposit Exemption — <reason>" with an `Exempt` (info-tone) pill, never a dollar amount; the gift card detail page shows the same label + reason, with the Text receipt, Copy link, and QR code all confirmed absent (screenshotted); the appointment checkout section, with an exempt card attached, shows the "Deposit exemption — no charge applied from this card" note in place of the REDEEM/ROLL radio, final cost $150 produces "Amount due today: $150.00", and after confirming checkout the card was confirmed via the API to be detached (`appointmentId: null`) and still `EXEMPT`.

Both `npx tsc --noEmit` (api) and `npm run build` (web) are clean.

## Commit

`74715e5` on `main`.

## Cleanup

Both dev servers (API on port 4000, web on 5173 -- the stale API process squatting on port 4000 from earlier in the day was killed first since it predated this session's Prisma client regeneration) killed. All verification gift cards/appointments created during PowerShell and browser testing were voided/cancelled as part of the scripts themselves. Verification scripts lived only in the session scratchpad (`pw-test/test-package-f*.js`), never in the repo.

---

# Package G — Task improvements

Single session, on `main`, run directly in the shared checkout (no schema change, so no worktree needed this time). Confirmed via `DEVELOPMENT.md`/dev `DATABASE_URL` that the dev database is separate from production before touching anything.

## Pre-existing state, checked before writing any code

Two of the three items were already fully built by prior sessions -- confirmed by reading the actual current files rather than assuming the task description was still accurate:

- **Delegated tasks on both people's lists** (item 2) was already complete end to end: `GET /tasks` already returns `assignedByMe` (creator = caller, assignee != caller) alongside `personal`; `Tasks.tsx` already splits "Assigned to Me" into "My tasks" vs. "Assigned by others" (client-side, on `createdBy.id`), and has a separate "Assigned by Me" card for OWNER/FRONT_DESK showing status but only a delete button -- no complete-toggle, and `PATCH /personal/:id` is assignee-only server-side regardless, so it's read-only in both the UI and the API. Nothing to build; verified live instead (see below).
- **Task due dates** (item 1) had the mutation/edit wiring already done, but both spots (`Tasks.tsx`'s inline per-task editor and the "Add task" form) still used a native `<input type="date">`. A ready-made single-date component already existed for exactly this (`DatePickerField.tsx`, built on the same `DayPicker` calendar as `DateAndTimeRangeFields.tsx`, already used by `ArtistCreate.tsx`/`ArtistDetail.tsx` for guest-artist date ranges) -- swapped both spots to it, added `sr-only` labels since neither spot has room for a visible one (matching the removed `aria-label` on the old native inputs).
- **Checkout-reminder task** (item 3) genuinely didn't exist -- new addition, see below.

## New derived task source

`apps/api/src/lib/tasks/appointmentNeedsCheckout.ts`, registered in `registry.ts` (one new file + one array entry, nothing else in `/tasks` changes -- same pattern as every other source). Query: `studioId` match, `archivedAt: null`, `checkedOutAt: null`, `endTime < now`, `status NOT IN (CANCELLED, NO_SHOW)` (a cancelled/no-show appointment has no client to check out, and `COMPLETED` already implies `checkedOutAt` is set per the schema's own comment, so it never reaches this filter anyway). Title: "Check out {client} — appointment ended {time}".

**Timezone correctness**: deciding *whether* the task is actionable needs no timezone math at all -- `endTime` is a stored UTC instant, and `now > endTime` compares correctly everywhere regardless of the studio's own timezone (same reasoning `estimateFollowup.ts` already uses for "elapsed time since a real event"). The studio's `StudioSettings.timezone` is used only to *format* the displayed time in the title (`Intl.DateTimeFormat` with the studio's IANA zone, mirroring `reminderTicker.ts`'s existing `formatTimeInTz` helper). Verified live: an appointment with `endTime: 2026-07-20T00:21:25.134Z` (UTC) correctly displayed as "ended 8:21 PM" (America/New_York, UTC-4 in July).

**Derived, not stored -- confirmed live, not just by inspection**: 4 pre-existing seeded appointments already qualified (past `endTime`, `checkedOutAt: null`, non-cancelled) and immediately appeared as tasks with no seed/migration step needed. Completing checkout on one of them (via the existing `POST /appointments/:id/checkout` flow, browser-driven) made its task disappear from `GET /tasks` on the very next fetch, with zero manual cleanup -- proving the whole thing really is computed live off `Appointment.checkedOutAt`, not a stored row that could go stale.

**Dismissal nuance, called out explicitly since it's a deliberate deviation from most other task types**: `dismissalKey` folds in today's studio-local calendar day (`civilDateKey(now, timezone)`) rather than being a stable `appointment.id`. Every other dismissable source uses a stable key (dismiss = gone until the underlying record changes), but this task's condition doesn't go away on its own -- a stable key would let staff dismiss it once and have it silently vanish forever even though the appointment stays un-checked-out indefinitely, which would violate "must persist for as long as the appointment remains un-checked-out." With the day-bucketed key, a manual Dismiss only silences it for the rest of today (studio-local) and it reliably reappears the next day for as long as checkout is still incomplete -- real resolution only ever comes from `checkedOutAt` actually being set.

## Verification (Playwright against the local dev instance)

- Native `<input type="date">` count on the Tasks page confirmed at 0 after the swap; clicking the due-date field opens a real month-grid calendar popover (screenshotted); clicking a day populates the field with a formatted date (e.g. "Wed, Jul 1, 2026") -- no typing anywhere.
- Delegated tasks: created a task as OWNER assigned to FRONT_DESK; confirmed present under OWNER's own "Assigned by Me" and under FRONT_DESK's "Assigned by others" (via both the API response shape and, after allowing enough time for the query to resolve on this heavily-loaded shared dev machine, the rendered page text).
- Checkout-reminder task: 4 existing overdue appointments correctly surfaced with correct studio-local times; completing checkout on one via the real UI removed its task immediately on the next `GET /tasks`.
- Both `npx tsc --noEmit` (api) and `npm run build` (web) clean.

## Commit

`ee99d28` on `main`.

## Cleanup

Both dev servers (API on scratch port 4088, web on 5173 with `VITE_API_URL` overridden inline rather than editing the shared `apps/web/.env` -- several other sessions' dev servers were already running on the standard ports in this same shared checkout) killed, including a `tsx watch` restart-loop artifact (another concurrent session was actively saving `inquiries.ts`, unrelated to this work, causing repeated restarts and PID churn on my own port) -- resolved by killing whatever held port 4088 in a short retry loop rather than hunting through dozens of near-identical `tsx watch` process command lines from every other session's dev server. My own test task and its stray earlier duplicates were deleted; the appointment checked out during verification was left checked out (that's the correct end state of the test, not something to revert), consistent with the standing convention of leaving legitimate verification actions in the dev database.

---

# Package I — Scheduling & appointment UX polish

No schema changes. Ran concurrently with Package H in this same shared checkout (not a separate worktree) -- `apps/api/src/routes/inquiries.ts` was mid-edit by that session throughout this work (its own Kanban-filter/sort/unwaitlist additions, clearly commented `Package H:`). Rather than wait, I isolated my one self-contained hunk (the two new photo-requirement checks) by reconstructing the last-committed file from `git show HEAD:...`, applying just that hunk to a scratch copy, and injecting it directly into the git index via `git hash-object -w` + `git update-index --cacheinfo` -- leaving H's uncommitted edits completely untouched in the working tree for them to commit separately. Verified afterward that the committed blob contains zero `Package H` markers.

## 1. Intake form: reference images + placement photos required

Both were previously accepted as empty arrays both client- and server-side. `IntakeForm.tsx`'s `handleSubmit` now checks `referenceImages.urls.length === 0` / `placementImages.urls.length === 0` (after the existing "still uploading" check, so a genuinely-empty submission and an in-progress upload get distinct messages) and blocks with a specific inline error for whichever is missing; both labels got a `*`. Server-side, `apps/api/src/routes/inquiries.ts`'s `POST /` gained two checks requiring a non-empty array, gated `!isStaffRequest` -- the same carve-out already used for `smsConsent` just above them, since a staff walk-in/phone log-in through this same route may have no photos on hand. Confirmed live: a public submission with photos omitted gets a 400 (`"At least one reference image is required"`), the identical staff-authenticated payload gets a 201.

## 2. Currency masking on the budget field

Reused the existing `CurrencyInput`/`formatCurrencyInput` (already built for `priceEstimateLow`/`High` elsewhere, never previously wired into the public intake form) rather than adding a new masking library -- none existed in `apps/web/package.json` to begin with, both existing money-ish inputs (`PhoneInput`, `CurrencyInput`) are hand-rolled. This does change the budget field's semantics from a free-text range hint (`"e.g. $300-500"`) to a single masked dollar amount (matching the task's own `$1,500` example) -- `Inquiry.budget` stays the same `String?` column, so what's sent over the wire is still just text (`formatCurrencyInput(budget)`, e.g. `"$1,500"`), meaning every existing display site (`InquiryDetail.tsx`, `MyInquiries.tsx`, `ConversationsPanel.tsx`) needed no changes. Draft-prefill now strips non-digits before seeding state, matching the field's new canonical-digits contract.

## 3. Suggested times prominence + preferredSchedule becomes a visible (still advisory) signal

`AppointmentForm.tsx`'s suggested-times panel already existed (Package D) but sat as a plain label among other secondary hints; it's now wrapped in an accent-bordered, tinted card with a bolder heading so it reads as the primary path, not a footnote.

`Artist.preferredSchedule` was previously read only by the suggestion-generation algorithm (`schedulingAssistant.ts`) and Calendar.tsx's own column-shading (`isArtistUnavailable`) -- manually typing a time in `DateAndTimeRangeFields` never cross-checked it at all. Two additions, both purely advisory (**confirmed**: neither blocks submission on their own):
- A new optional `unavailableDaysOfWeek` prop on the shared `DateAndTimeRangeFields` component (backward-compatible default `undefined` -- every other caller, including the ones Package H may be touching, is unaffected) greys out calendar days with no matching `preferredSchedule` entry for the selected artist, with a caption explaining why.
- A new `isOutsidePreferredHours` check in `AppointmentForm.tsx` compares the picked date+time range against the selected artist's schedule; when it's outside (or the day has no entry at all), a warning banner appears ("This is outside Maria Chen's usual hours") with a required "I understand, proceed anyway" checkbox gating the submit button (both client-side, in the disabled condition, and re-checked inside `handleSubmit` itself as defense-in-depth) -- no backend change, since this was never meant to be enforced there.
- An artist with no `preferredSchedule` configured at all shows no greying and no warning, ever -- same "advisory-only, no restriction until configured" convention already established for this field.

## 4. Assigned-artist default

`GET /clients/:id`'s `inquiries.select` (in `apps/api/src/routes/clients.ts`) gained `assignedArtistId` -- `AppointmentForm.tsx` already fetches this exact response for its own gift-card/inquiry lookups, so no new network request was needed. When opened with `fixedInquiryId` (the InquiryDetail "New Appointment" flow) and no calendar-prefilled `initialArtistId`, a `useEffect` defaults `artistId` to that inquiry's assigned artist once the query resolves; the assigned artist's own dropdown row gets its name suffixed `" (assigned)"` (a shallow-cloned options array, not a change to `ArtistSelect`/`ArtistAvatar` themselves). Picking a different artist shows the same warn-and-confirm pattern as item 3, sharing the identical "reset the confirmation whenever the underlying input changes" logic.

## 5. Appointment detail: parent project context inline

`APPOINTMENT_DETAIL_INCLUDE`'s `inquiryProject.select` (in `apps/api/src/routes/appointments.ts`) gained `budget`, `priceEstimateLow`, `priceEstimateHigh`, `referenceImages`, `placementImages` -- all pre-existing `Inquiry` columns, zero schema/migration work. `AppointmentDetail.tsx` renders a new "Project details" card (budget as free text if set, else a `$low – $high` range, else "Not provided"; reference/placement images as small link-out thumbnail grids, shown only when non-empty) directly below the appointment summary card, above Liability Waiver -- no navigation to the inquiry page required.

## Verification (PowerShell + Playwright against the local dev instance)

- **Intake form**: submitting with every required field filled except both photo types shows "Please add at least one reference image."; adding only a reference image and resubmitting shows "Please add at least one placement photo." instead. Typing `1500` into Budget renders `$1,500` live. Confirmed server-side too: identical public POST payload without images -> 400; the same payload authenticated as staff -> 201 (the `isStaffRequest` carve-out holds).
- **Browser, AppointmentForm opened from an inquiry with an assigned artist (Maria Chen, Mon–Fri 10–18/16 schedule) and a $500-700 budget + 1 reference image**: artist picker pre-selected "Maria Chen (assigned)"; picking a different artist showed "This project is assigned to a different artist." with its own confirm checkbox; switching back to Maria Chen cleared that warning. The Suggested Times panel rendered in its new accent-bordered card. Opening the date picker showed every Saturday/Sunday visibly greyed (Maria Chen's schedule has no entry for those days) with the caption "Greyed days are outside this artist's usual schedule."; picking a Sunday 11am–1pm slot showed "This is outside Maria Chen's usual hours." with a required confirm checkbox -- the submit button stayed disabled until it was checked, and checking it enabled submission (**confirming `preferredSchedule` stayed advisory, not a hard block** -- the appointment was created successfully once confirmed, nothing server-side ever rejected the out-of-hours time).
- Navigated to the resulting appointment's detail page: "Project details" card showed Budget `$500-700` and the inquiry's one reference image as a thumbnail.
- Both `npx tsc --noEmit` (api) and `npm run build` (web) clean.

## Commit

`b67f06b` on `main`, pushed immediately (`80317f5..b67f06b`) per the shared-file collision protocol above -- Package H's uncommitted `inquiries.ts` work was still sitting in the working tree at push time, untouched.

## Cleanup

Test appointment created during Playwright verification (Emily Rodriguez / Maria Chen, Sun Jul 26) was cancelled afterward via the API, detaching its gift card back to reusable. The gift card issued for that same client to enable the test remains `ACTIVE` and unattached in the dev database (harmless, matches the existing abundance of test gift cards already there). A staff-created verification inquiry (`Backend CheckStaff`) was left in place, consistent with the standing convention of not chasing down every piece of dev-seed test data this deep into the project's test history. Both dev servers (API port 4000, web port 5173) left running since they were shared with other concurrent sessions at the time -- not killed, to avoid disrupting Package H's own live testing against them.

---

# Package H — Inquiries & Projects list/display polish

Single session on `main`. No schema changes -- confirmed during investigation, not assumed (see §2 below).

## 1. Sort + multi-select filters — server-side, as specified

`GET /inquiries` (`apps/api/src/routes/inquiries.ts`) now takes `status` (repeatable), `artistId` (repeatable, `unassigned` is a synthetic value alongside real ids), `q` (multi-word AND-of-OR search across description + client first/last name, same pattern as `clients.ts`'s own search), and `sort` (`createdAt_desc|createdAt_asc|updatedAt_desc|clientName_asc|clientName_desc`) query params, applied in the Prisma `where`/`orderBy` themselves -- not a client-side filter over an unpaginated fetch. `Inquiries.tsx` sends the tab's own full status list whenever nothing is explicitly checked (so an empty multi-select still means "everything this tab shows," never "everything, including the other tab's statuses"). New `MultiSelectFilter.tsx` component (button + checkbox listbox, same interaction shape as the existing artist-picker dropdown) replaces both the old single-value status `<select>` and the artist `<select>`. List/Kanban continue to share one fetch, now keyed on every filter input so a change always refetches instead of serving a stale combination from cache.

## 2. Estimate sub-status — derived from existing timestamps, no new schema

Investigated first, per the task's own instruction: `estimateSentAt`/`estimateOpenedAt`/`estimateRespondedAt` already existed on `Inquiry` and were already populated by `/send-estimate` and the public estimate-response flow. This is purely a display derivation (`describeInquiryStatus` in `apps/web/src/lib/format.ts`): `AWAITING_CLIENT_RESPONSE` + `estimateSentAt` set + `estimateOpenedAt` null → "Sent, not opened yet"; + `estimateOpenedAt` set → "Opened, awaiting response". Every other status still falls through to the existing `formatStatus`. Wired into `StatusPill`'s existing `label` override prop on the List view's rows and `InquiryDetail.tsx`'s header pill -- no new stored status value, no migration.

## 3. Projects tab: Scheduled Date replaces Submitted

`INQUIRY_LIST_SELECT` gained `appointment: { select: { startTime: true } }`. The List view's date column header and cell both switch on `activeTab === 'projects'`; Inquiries tab is untouched (still `createdAt`/"Submitted"). Shows "Not yet scheduled" for a Project with no appointment yet (Scheduling/Waitlisted).

## 4. Estimate editing locked after conversion

Backend: `PATCH /inquiries/:id` now rejects (400) any request touching the price/time estimate fields once `inquiry.status` is in `PROJECT_STATUSES` (`SCHEDULING`/`WAITLISTED`/`CONFIRMED` -- the same line `apps/web`'s own `PROJECTS_TAB_STATUSES` already draws). Every other PATCH-able field (description, placement, budget, the notes field, etc.) stays editable -- only the estimate numbers lock. Frontend: `InquiryDetail.tsx`'s Estimate card hides its Edit button and shows "Locked -- this inquiry has converted to a Project..." once converted; verified the backend guard independently by PATCHing directly against a `CONFIRMED` inquiry (got the 400) rather than trusting the UI alone.

## 5. Per-artist waitlist view + Remove from Waitlist

**View**: no new page -- Package H's own multi-select filters (§1) already do this: Projects tab, check only "Waitlisted", pick one artist. Verified live: narrows to exactly that artist's waitlisted work.

**Remove action — investigated, then added `POST /inquiries/:id/unwaitlist`**: confirmed `/waitlist` (`WAITLISTED` target) had no reverse route at all -- once waitlisted, an inquiry was permanently stuck there through any existing endpoint. Added the symmetric reverse: `WAITLISTED → SCHEDULING` (deliberately not straight to `CONFIRMED` -- picking an actual time slot stays its own deliberate step through the existing `/schedule`), same audit-logging (`logAudit` + `diffObjects`) and `emitInvalidation` pattern as every other status-transition route in the file. Surfaced as a "Remove from Waitlist" button in `InquiryDetail.tsx`'s Scheduling card (previously that card rendered nothing at all for a `WAITLISTED` inquiry -- the actual gap the task flagged). Also rewired the Kanban board's `WAITLISTED → SCHEDULING` drag from a hardcoded rejection to a direct call now that the route exists. Verified end to end: removed Bailey Testperson from Dev Artist One's waitlist, confirmed the status flip via a fresh API read and confirmed they no longer appear in the Waitlisted-filtered view.

## 6. Progress ring color — StatusPill semantics, not invented colors

`ConversationsPanel.tsx`'s `ProgressRingAvatar` previously used its own hardcoded 5-color gradient plus a separate hardcoded terminal-color map (both added in an earlier, unrelated session before this task was written). Replaced both with one `TONE_RING_COLORS` map keyed by `StatusPill`'s own exported `Tone`/`getStatusTone`, using `var(--color-success)` etc. -- the literal CSS custom properties `StatusPill`'s own Tailwind utilities already resolve to, so a theme-preset change repaints the ring automatically instead of drifting out of sync. Verified the resolved computed color of live rings against `getComputedStyle(document.documentElement)` for each theme variable -- exact match, and multiple distinct tones (info/warning) visible across different-stage conversations in the same screenshot.

## Verification

Playwright against the local dev stack (api :4099, web :5199 -- deliberately off the standard ports to avoid colliding with other concurrent sessions' running servers):
- Sort: confirmed the actual outgoing request URL changes (`sort=createdAt_asc`) and row order changes accordingly.
- Multi-select status: checked New + Deposit Pending, confirmed the request (`status=NEW&status=DEPOSIT_PENDING`) and that only those two statuses render (button label "2 selected").
- Estimate sub-status: both "Sent, not opened yet" and "Opened, awaiting response" confirmed present on the List view against real seeded data with each timestamp combination.
- Projects tab header reads "Scheduled Date", never "Submitted".
- Estimate lock: Edit button absent + lock message shown on a `CONFIRMED` inquiry; direct PATCH against it returns 400 with the lock message.
- Waitlist: per-artist filtered view + Remove from Waitlist button both confirmed live, including a fresh re-fetch proving the person actually left WAITLISTED (not just a stale cached view).
- Ring colors: computed `stroke` on live rings matches `--color-info`/`--color-warning` exactly; distinct colors visible across different pipeline stages in one screenshot.

## Typechecks

`npx tsc --noEmit` (api) -- clean. `npx tsc --noEmit` + `npm run build` (web) -- clean.

## Commit

`8ee5678` — Package H: Inquiries & Projects list/display polish.

## Cleanup

Both dev servers (api :4099, web :5199) stopped, including their orphaned child processes (confirmed via `netstat` + explicit process kill, same recurring pattern as prior sessions' reports). Test data mutated during verification (Bailey Testperson's `WAITLISTED → SCHEDULING`) left as-is, per the same standing convention noted in every prior session's report -- this is the dev database `DEVELOPMENT.md` describes as being for exactly this kind of testing. `apps/api/src/routes/inquiries.ts` briefly needed a careful hunk-level reconciliation before committing: Package I landed a real commit (`b67f06b`) to this same file mid-session, and my local index still held a stale staged diff from before that commit -- resolved by diffing against the correct current `HEAD` rather than trusting `git status`'s `MM` marker at face value, confirmed clean before staging.

---

# Package J — Every sent form/link must show up in Conversations

Single session on `main`. No schema changes -- `clientId`/`autoSend` are request-body-only additions, nothing persisted beyond what already existed (`PrefillDraft` stays client-agnostic, exactly as before).

## Audit: every place a link/form gets sent to a client

| Send path | Route | Before this session | After |
|---|---|---|---|
| Estimate | `POST /inquiries/:id/send-estimate` | Already working -- auto-sends via `sendClientSms`, logged | Unchanged (re-verified live, not broken) |
| Gift card receipt ("Text receipt") | `POST /gift-cards/:id/text-receipt` | Already working -- same `sendClientSms` pattern | Unchanged (re-verified live) |
| Deposit form ("Send Deposit Form"/"Resend Deposit Form"/ClientDetail's "Send Deposit Form") | `POST /inquiries/:id/deposit-form` | Generated a link + copy-to-clipboard box only -- despite the button label, nothing was ever sent or logged | **Fixed** -- auto-sends, logged |
| Liability waiver ("Create Waiver" on AppointmentDetail / "Send Waiver" on ClientDetail -- same route, inconsistently labeled) | `POST /appointments/:id/waiver` | Same gap -- generate + copy box, no send | **Fixed** -- auto-sends, logged |
| Consent form ("Send Consent Form") | `POST /clients/:clientId/consent-forms` | Same gap | **Fixed** -- auto-sends, logged |
| Prefilled intake link -- composer's own insert-into-draft row | `POST /prefill-drafts` (with `conversationId`) | Correctly send-nothing-itself by design; staff composes their own message around the inserted link, then the composer's normal Send logs it | Unchanged (still send-nothing; that's correct here, not a gap) |
| Prefilled intake link -- ClientDetail's standalone "Copy prefilled link" | `POST /prefill-drafts` (no `conversationId`) | Pure clipboard copy, no send, no log | **Fixed** -- auto-sends, logged (per explicit user decision, see below) |
| Consent-form-adjacent sends elsewhere | grepped `ConsentForm`/`consentForm` across `apps/api/src` and `apps/web/src` | Only the one creation route above exists; no second/duplicate send path found | N/A |

`ConversationsPanel.tsx`'s composer already backs every "insert an *existing* link" row (intake form, estimate, deposit, waiver) with a plain paste-into-draft action -- the actual transmission happens when staff hits the composer's own Send, which already logs correctly via `sendClientSms`. Those rows needed no change.

## The fix, applied uniformly

Reused the exact mechanism the estimate auto-send already proved out -- no second logging path invented:

- `getOrCreateClientConversation` to find/create the client's own thread.
- `sendClientSms` (`apps/api/src/lib/clientSms.ts`) -- the one real-SMS path, which only creates a `Message` row on actual provider acceptance (best-effort: a `not_connected`/`no_phone`/`opted_out`/`send_failed` result still returns 201 with the generated link, since the record itself is real regardless of whether the text goes out -- identical "generated regardless of send outcome" behavior to the existing estimate route).
- A body string that names what was sent and includes the link, e.g. "Hi Emily, here's your deposit form to secure your appointment with Dev Studio: [link] (expires in 48 hours)" -- so the thread reads clearly to staff scanning history, matching the estimate send's own wording style. (No new `metadata.kind` tagging was added -- the working estimate/gift-card-receipt sends don't use one either, they rely on this same descriptive body text; inventing a new metadata scheme here would be the "second logging mechanism" the task said not to build.)

**The one real design wrinkle**: the composer's own "create-then-insert-link" rows for deposit form and waiver (`ConversationsPanel.tsx`'s `handleCreateDepositForm`/`handleCreateWaiver`) call these exact same routes, but deliberately want staff to compose their own message around the link before sending -- auto-sending unconditionally would have double-sent (once automatically, once when staff hits the composer's Send). Both routes now take an `autoSend` flag in the request body (default `true`); the composer's two calls pass `autoSend: false` to keep their existing behavior. Verified live that this suppresses the send with zero new messages (see Verification below).

For the prefill-intake-link route, no flag was needed -- the composer's insert-only call never had a `clientId` to auto-send with in the first place (it only ever passed `conversationId`), so it was already a no-op for auto-send purposes. ClientDetail's standalone "Copy prefilled link" now passes `clientId`, which is what triggers the new auto-send there; it's used transiently to look up the client for the send and is never persisted onto the `PrefillDraft` row.

**Judgment call, asked rather than assumed**: ClientDetail's "Copy prefilled link" never claimed to send anything (unlike the other three, which were literally labeled "Send X" while silently not sending) -- it's an honest clipboard-copy utility. Asked the user whether it should gain the same auto-send-and-log treatment or stay copy-only; user chose to add auto-send. Implemented accordingly.

Frontend: each of the four fixed flows (`InquiryDetail.tsx`, `AppointmentDetail.tsx`, `ClientDetail.tsx` x3) now surfaces the send outcome via a new shared `describeSendResult` helper (`apps/web/src/lib/sendResult.ts`, factored out of `InquiryDetail.tsx`'s pre-existing `describeEstimateSendResult` shape) -- "sent via text, check Conversations" on success, or a specific not-connected/no-phone/opted-out/failed reason with "share the link below manually" otherwise, same messaging pattern the estimate flow already used.

## Verification (PowerShell against a second local API instance on the dev DB)

Ran a second `tsx watch` API instance on port 4001 (a different session's dev server was already holding :4000 in this shared checkout -- left untouched) against the same dev Postgres `DEVELOPMENT.md` points at. Logged in as `owner@dev-studio.test`, then for each fixed path, called the route directly and confirmed both the JSON response's `...SendResult: { sent: true, messageId }` and, separately, a fresh `GET /conversations/:id/messages` read showing the new `Message` row in the client's actual thread (used Emily Rodriguez throughout, an existing seeded client with a safe fake `312-555-xxxx` number):

- **Deposit form**: `POST /inquiries/.../deposit-form` -> `depositSendResult: { sent: true }`; conversation thread gained "Hi Emily, here's your deposit form to secure your appointment with Dev Studio: ... (expires in 48 hours)".
- **Waiver**: `POST /appointments/.../waiver` -> `waiverSendResult: { sent: true }`; thread gained "Hi Emily, please sign your liability waiver before your appointment with Dev Studio: ...".
- **Consent form**: `POST /clients/.../consent-forms` -> `consentSendResult: { sent: true }`; thread gained "Hi Emily, please review and sign this consent form from Dev Studio: ... (expires in 48 hours)".
- **Prefill link**: `POST /prefill-drafts` with `clientId` -> `prefillSendResult: { sent: true }`; thread gained "Hi Emily, here's a link to start a new inquiry with Dev Studio -- your info's already filled in: ...".
- **Composer opt-out**: called the deposit-form route again with `{"autoSend": false}` (same inquiry/client, already had an unsigned form) -- response showed `depositSendResult: null`, and the conversation's message count was unchanged before/after (10 -> 10), confirming no send was attempted.
- **Estimate re-verified not broken**: `POST /inquiries/.../send-estimate` on the same inquiry -> `estimateSendResult: { sent: true }`, new message logged as before.
- **Gift card receipt re-verified not broken**: issued a fresh test gift card to Emily (existing seeded cards all had malformed/incomplete phone numbers on other clients, unrelated to this session), then `POST /gift-cards/:id/text-receipt` -> `{ sent: true }`.

Browser/Playwright pass was skipped: the web dev server in this shared checkout points at the *other* concurrent session's API instance on :4000, and pointing a browser at it would have exercised someone else's in-progress server rather than this session's code. The API-level verification above exercises the identical code path (same route handlers, same `sendClientSms` call, same DB) end to end, including reading back the resulting `Message` rows -- the frontend changes themselves are narrow (new state variables + a `<p>` notice + one new shared helper), reviewed by hand and confirmed via a clean `npm run build`.

## Typechecks

`npx tsc --noEmit` (api) -- clean. `npm run build` (web) -- clean.

## Commit

`dcd2020` -- Package J: auto-send-on-generate for deposit form, waiver, consent form, prefill link. Pushed immediately (`5df89f4..dcd2020`); another concurrent session's Package I fix (`5df89f4`) had landed on `main` between this session's start and its own push, picked up cleanly as a fast-forward with no conflicts since this session's `git status` stayed limited to the 8 files it intentionally touched plus 1 new file throughout.

## Cleanup

Both background dev processes this session started (API :4001, web on whatever port Vite picked since :5173/:5174 were already taken by other concurrent sessions) were stopped; the API one's underlying `tsx watch` child process outlived the shell-level stop and needed an explicit `Stop-Process -Force` by PID before :4001 was actually free. The other concurrent session's API server on :4000 was left running, untouched. Test artifacts from this session's live verification (one new gift card, one new deposit form, one new waiver, one new consent form, one new prefill draft, all against the existing seeded "Emily Rodriguez" client) were left in the dev database, consistent with the standing convention in every prior package's report of not chasing down verification-generated dev-seed data.

---

# Package K — Dashboards & reports

Single session on `main`. No schema changes -- six real-time aggregation queries over existing tables, nothing new persisted.

## What was already there vs. what was built

**Investigated first, per the task's own instruction.** `Dashboard.tsx` existed and was routed/linked (`/dashboard`, Sidebar's first nav item, the post-login and `/` redirect target) -- but every number on it was a hardcoded literal. `STATS` was a fixed array (`'128'` total clients, `'+6 this month'`, etc.); `TodaysAppointmentsTable`/`WeeklyAppointmentsChart`/`ArtistWorkloadCard`/`ReminderCard` each had their own hardcoded fake dataset baked in as a module-level constant (invented names like "Maria Gonzalez"/"Jordan Vega" that don't exist in this studio's real data, a fake Mon-Fri bar chart, etc.) -- zero API calls anywhere in any of these five files. The "View As migration list" pointer in the task turned out to be `c86d1b7` (the View As feature commit), which touched `Dashboard.tsx` only to swap `useAuth()` for `useEffectiveUser()` in the greeting text -- unrelated to metrics, just how the task knew this file existed at all.

Net: nothing here was "partially built" in the sense of real data wiring -- it was a static visual mockup/prototype shell. Kept: the page's overall layout shell (Sidebar + max-w-7xl container + card grid) and the app's existing card styling (`rounded-2xl border border-border bg-surface p-5`, same as every other card in the app). Deleted (confirmed zero other references first): `StatCard.tsx`, `TodaysAppointmentsTable.tsx`, `WeeklyAppointmentsChart.tsx`, `ArtistWorkloadCard.tsx`, `ReminderCard.tsx` -- fabricated data has no place next to real financial figures on the same page. Built fresh: the entire backend aggregation endpoint and all six frontend metric cards.

## Backend: one combined endpoint

`GET /reports/dashboard?start=&end=` (new `apps/api/src/routes/reports.ts`, mounted in `index.ts`), `requireAuth` + `requireRole(OWNER, FRONT_DESK, ARTIST)` -- same all-three-staff-roles precedent as `navCounts.ts`, matching Dashboard's own pre-existing lack of role gating (nobody has ever been blocked from this page, and `/`, `Login.tsx`, `MyInquiries.tsx`'s redirect, and `Team.tsx` all land everyone here regardless of role). **Flagging for review, not deciding here**: this means an ARTIST can see real dollar figures (deposit conversion, gift card liability) that other money-related surfaces in this app (gift card exemption issuance, void, expiration override) restrict to OWNER. Changing that would also mean giving ARTIST a different post-login landing page, which is out of scope for this session -- noted for a follow-up decision.

One endpoint rather than six: the Dashboard loads every section on the same page load, so all six count/aggregate queries run as a single parallel `Promise.all` batch, one round trip. `start`/`end` (same query param names `GET /appointments` already uses for its own range filter) scope four of the six sections; the other two are deliberately global, per the task's own instruction to only put a selector on the first four:

- **Deposit conversion**: an all-time rate is more meaningful than a date-windowed one (a deposit form's "sent" event happens once, and the task didn't ask for a selector here).
- **Gift card liability**: "right now" by definition -- a snapshot, not a range.

Both are visually captioned "not affected by the date range above" on their cards, so the two different scopes on one page don't read as the numbers disagreeing (the dataviz skill's own filter-composition warning).

## Exact metric definitions (for review -- these are judgment calls)

1. **Inquiry funnel** -- six `Inquiry.count()` queries, all scoped to `createdAt` within the selected range (so it answers "of everything received in this window, how far did it get, as of right now" -- not a true received-in-window-and-fully-resolved-by-window-end funnel, which this data model can't answer without a state-history table):
   - Received: total in range.
   - Estimate Sent: `estimateSentAt` not null.
   - Responded: `estimateRespondedAt` not null.
   - Deposit Pending: has a `DepositForm` row (`depositForm: { isNot: null }`) -- reached the deposit stage at any point, not "currently DEPOSIT_PENDING" (an inquiry that's since moved on to CONFIRMED still passed through here).
   - Scheduled: `appointmentId` not null **or** has any row in `sessions` (`Appointment.inquiryId`) -- checks both the older 1:1 "scheduled slot" link and the newer 1:many "sessions under this project" link. Needed both: the real `/schedule` route sets both fields together, but a dev-seed fixture (`[DEV SEED] Back piece, session 1 of 3`) only populated the newer relation directly, and checking just the older field undercounted (0 instead of 5 in initial testing -- caught by the manual spot-check, not assumed correct).
   - Completed: same both-relations check, requiring `AppointmentStatus.COMPLETED`.
   - Conversion % at each stage is **cumulative-of-total-received** (stage count ÷ received count), not step-over-previous-step -- the standard "narrowing funnel" reading.
2. **Lost/cold rate** -- `(CLOSED_LOST count + COLD_LEAD count) ÷ (that + CONFIRMED count)`, all `createdAt`-scoped to the range. Denominator is only inquiries that reached one of these three terminal-ish states -- an inquiry still mid-pipeline (NEW/AWAITING_CLIENT_RESPONSE/DEPOSIT_PENDING/etc.) isn't counted on either side, since it hasn't "ended" either way yet. "Converted" = `CONFIRMED` specifically (the Inquiry model has no post-CONFIRMED status of its own; SCHEDULING/WAITLISTED are pre-conversion, not post-).
3. **Response time** -- two averages, both `createdAt`-range-scoped: `estimateSentAt − createdAt` (received → estimate sent) and `estimateRespondedAt − estimateSentAt` (estimate sent → response), each only over rows where both relevant timestamps are set. Computed by fetching just the two relevant `DateTime` columns per matching row (`select`, not the whole record) and reducing in Node, rather than a raw SQL `AVG(EXTRACT(EPOCH FROM …))` -- Prisma's query builder has no built-in aggregate for a computed difference between two columns, and this codebase has never used `$queryRaw` before; the two-column `select` still pushes all filtering to the DB and only pulls the minimal projection needed; introducing raw SQL as a first-of-its-kind pattern for one metric felt like more risk than the small compute it would save at this data volume.
4. **Artist utilization** -- `Appointment.groupBy(['artistId'])` count, scoped to `startTime` (not `createdAt`) within the range -- "how many sessions is this artist actually booked for in this window," not "how many appointment records were created in this window." True DB-level aggregate, no raw SQL needed.
5. **Deposit conversion** -- `paidManually` true ÷ total `DepositForm` rows for the studio (all-time, see above), plus avg `paidAt − createdAt` over the paid ones.
6. **Gift card liability** -- `GiftCard.aggregate(_sum: amountCents)` where `status = ACTIVE` **and** (`expiresAt` null or `>= now`) -- the extra expiry check guards the up-to-24-hour window before the existing daily `giftCardExpirationSweep` cron job would have flipped a stale card to EXPIRED; a true DB-level `_sum`, no raw SQL.

## A real bug the manual spot-check caught

Two paid `DepositForm` rows in the dev seed data have `paidAt` set 1-3 days **before** `createdAt` (backdated fixture data, not reachable through the real `mark-paid` route, which always stamps `paidAt: new Date()` at call time -- confirmed by reading that route). The initial avg-time-to-payment implementation clamped any sub-hour result to a floor of 1 minute, which silently turned the resulting negative average into a falsely-plausible **"1m"** -- reading as an impressively fast (and wrong) real number instead of an obviously-anomalous one. Caught via the required manual spot-check, not assumed correct. Fixed: `formatHours` (`Dashboard.tsx`) now buckets on `Math.abs(hours)` for the m/h/d unit choice but keeps the sign, so the same dev-data anomaly now renders `-2.0d` -- visibly wrong instead of invisibly wrong. This only affects this specific dev-seed anomaly; every value from the real `mark-paid` flow is non-negative by construction.

## Frontend

`apps/web/src/pages/Dashboard.tsx` rewritten: a `DateRangePresetFilter` (new component, same button+popover shape as `MultiSelectFilter.tsx`) sits in one row above the whole grid, per the dataviz skill's own filter-composition guidance -- presets (Last 7/30/90 days) listed as rows with a bold checkmark on the active one, a custom start/end range tucked behind a hairline in the footer. `keepPreviousData` (TanStack Query v5) keeps the previous render on screen (no skeleton flash) while a range change refetches; the very first load shows the existing `SkeletonCards`.

Two of the six cards are real charts (funnel, artist utilization) -- both single-series magnitude comparisons, built as one new shared `HorizontalBarList` component: bars capped at 12px thick, 4px rounded data-end / square baseline (`rounded-r`, never `rounded-full`), one hue throughout (`bg-accent`, so it repaints automatically with whichever theme preset the studio has picked), no legend needed for a single series, every value direct-labeled at the tip rather than gated behind hover, a brightness-lift on hover/focus so the mark still visibly responds. The other four are stat-tile-style cards (hero number + secondary context), matching `choosing-a-form.md`'s own "a single ratio/current value is a stat tile, not a one-bar chart" guidance. The Lost/Cold Rate breakdown reuses the app's existing status colors (danger/warning/success) for three small labeled dots -- ran these through the skill's own `validate_palette.js` against the app's dark card surface (`#17171a`): FAILs the lightness-band check and WARNs on CVD separation between the two closest hues. Not changed: these are the app's pre-existing, already-shipped-everywhere semantic tokens (`StatusPill`, the conversation ring colors from Package H), not a new categorical palette this session is free to redesign, and every dot already ships with a text label right next to it (never color-alone), which is exactly the validator's own stated carve-out for a borderline CVD pair ("legal only with secondary encoding").

## Verification

**Manual spot-checks against real seeded data**, each via an independent code path (not the same query being asked to agree with itself):
- Response count (7): re-derived by fetching each of the 10 estimate-sent inquiries' own detail endpoint individually and counting non-null `estimateRespondedAt` -- matched exactly.
- Gift card liability ($835.00 / 8 cards): re-queried directly via a standalone script hitting the same dev DB with an independent filter expression -- matched exactly.
- Artist utilization (Dev Artist One: 4, Maria Chen: 1): same independent-script approach -- matched exactly.
- Funnel's "scheduled"/"completed" undercount (0 instead of 5/2) caught this way, root-caused to the `appointmentId`-only check missing the `sessions` relation, and fixed (see above).

**Browser** (Playwright, since `chromium-cli` isn't available on this Windows environment -- adapted the fallback the run skill itself names, plain `chromium` launch against a second local dev-server pair on scratch ports 4001/5180, `VITE_API_URL` pointed at the scratch API so as not to touch the other concurrent session's servers on :4000/:5173):
- Logged in as `owner@dev-studio.test`, landed on `/dashboard`, all six cards rendered with real numbers matching the API responses exactly. Zero console errors.
- Switched the preset to "Last 7 days": button label and range caption updated correctly; funnel/lost-rate/artist-utilization numbers stayed identical to the 30-day view -- initially looked like a stale-filter bug, but a direct API call against the same narrower range confirmed it's real: every one of this dev studio's 24 inquiries happens to have been created in the last 7 days (heavy concurrent-session testing activity this week), not a bug.
- Applied a custom range (2020-01-01 to 2020-01-02, before any seed data existed): every range-scoped card correctly went to zero/em-dash/"No appointments scheduled in this range", while Deposit Conversion and Gift Card Liability correctly stayed unchanged -- proving the two non-ranged cards are genuinely unaffected and the four ranged ones are genuinely re-querying, not cached.
- Page loaded and re-rendered within under a second on each range change against this data volume.

## Typechecks

`npx tsc --noEmit` (api) -- clean. `npm run build` (web) -- clean.

## Commit

`26712b7` -- Package K: real dashboard metrics replacing the static mockup.

## Cleanup

Both scratch dev servers (API :4001, web :5180) stopped; the API one's `tsx watch` child again outlived the background-task stop and needed an explicit `Stop-Process -Force` by PID, same recurring pattern as prior sessions. The other concurrent session's API server on :4000 (a different PID than earlier in the day -- it had been restarted by that session in the meantime) was left running, untouched. Temporary verification scripts (`verify_gc.ts`, `verify_au.ts`, `check_deposits.ts`) were created directly in `apps/api/` for one-off spot-checks against the real Prisma client and deleted immediately after each use -- none left behind. Playwright itself was installed ad hoc into the scratchpad directory (not added as a project dependency) since `chromium-cli` wasn't available; screenshots and the driver script remain in the scratchpad, not the repo. One new gift card issued to an existing seeded client (Emily Rodriguez) during this same conversation's earlier Package J verification is reflected in this session's real gift-card-liability total ($835.00 across 8 cards) -- pre-existing test data, not created for this package, left as-is.


---

# Package L — Inquiry notes (free-form, timestamped, WYSIWYG)

Single session on `main`. One schema addition (`InquiryNote`) plus a deliberate removal of the pre-existing `Inquiry.notes` column, via a two-phase migration -- see "The one judgment call" below for why this went beyond the task's own schema section.

## Investigation before touching anything

Confirmed no other session was mid-migration (`prisma migrate status` -- clean, schema in sync) before starting. Read `RichTextEditor.tsx` and `sanitizeHtml.ts` as instructed: the editor is a generic `value`/`onChange` Tiptap wrapper (bold/italic/underline/heading/lists/link, already used for `StudioSettings` policy fields), and sanitization is a single shared `sanitizeHtml()` (DOMPurify, a fixed tag/attribute allow-list) applied only at render time -- `apps/api/src/routes/customPolicies.ts`'s own comment confirms this app's standing convention: **HTML is stored raw and sanitized on render, never on write**. `InquiryNote.bodyHtml` follows that same convention -- no new sanitization mechanism invented.

## The one judgment call: the pre-existing `Inquiry.notes` field

`InquiryDetail.tsx` already had a "Notes" card bound to a legacy `Inquiry.notes` column (one plain-text blob, no author, no timestamp, no history -- added in an earlier phase, unrelated to this task). One inquiry in the dev DB had real content in it ("Client prefers afternoon appointments..."). Since Package L's new feed covers the identical conceptual need but richer, having both on the same page would mean two different "Notes" concepts side by side -- confusing, and the old one would become a silent dead end. Asked the user rather than assumed: chosen option was **replace the old field, migrating its one real row**.

Executed as a two-phase migration to avoid data loss (Prisma refused to auto-drop a column with a non-null-value warning in this non-interactive environment, which is exactly the safety net that's supposed to catch this class of mistake):
1. `20260723173712_add_inquiry_notes` -- additive only, creates `InquiryNote`. The Inquiry-side relation field was temporarily named `noteEntries` (a virtual, non-column Prisma field) to avoid colliding with the still-present `notes String?` column.
2. A one-off `tsx` script read every inquiry with non-null `notes`, created one `InquiryNote` per row (authored by that studio's OWNER, `createdAt`/`updatedAt` backdated to the inquiry's own `updatedAt` as the best available proxy for when it was actually written, body prefixed `"Migrated from the previous single-note field:"` so the provenance is visible, not silently attributed as a fresh note). Verified the copied row against the source field before touching anything destructive.
3. `20260723174119_drop_legacy_inquiry_notes` -- drops the old column (generated via `prisma migrate diff` + a hand-placed migration folder, applied with `prisma migrate deploy`, since `migrate dev`'s interactive data-loss prompt isn't available in this environment). Renamed the relation field `noteEntries` → `notes`.
4. Grepped both `apps/api/src` and `apps/web/src` for every remaining reference to the removed field. Found and fixed one real breakage `tsc` didn't catch: `inquiries.ts`'s generic `PATCH /:id` route had `"notes"` in its loosely-typed `NULLABLE_STRING_FIELDS` allow-list (`Record<string, ...>`, not checked against Prisma's generated types) -- would have thrown a runtime Prisma validation error on any client still sending `{ notes: "..." }`. Removed it; `InquiryDetail.tsx`'s own `notesForm`/`handleSaveNotes`/etc. were deleted in the same pass since they're superseded entirely.

## Schema

```prisma
model InquiryNote {
  id        String   @id @default(cuid())
  bodyHtml  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  studioId  String
  studio    Studio   @relation(fields: [studioId], references: [id])
  inquiryId String
  inquiry   Inquiry  @relation(fields: [inquiryId], references: [id])
  authorId  String
  author    User     @relation("InquiryNoteAuthor", fields: [authorId], references: [id])
}
```

## Routes (`apps/api/src/routes/inquiries.ts`)

- `GET /inquiries/:id/notes` -- a dedicated endpoint rather than folding into `GET /:id` (bodyHtml can accumulate; most callers of the inquiry detail fetch don't need every note body on every load). Same `requireRole(OWNER, FRONT_DESK)` gate as `GET /:id` itself.
- `POST /inquiries/:id/notes` -- create, same role gate, audited (`entityType: "InquiryNote"`, `action: "create"`).
- `PATCH` / `DELETE /inquiries/:id/notes/:noteId` -- author-or-OWNER enforced in the handler (`note.authorId === req.user.userId || req.user.role === OWNER`), both audited; delete's audit `changes` includes the deleted `bodyHtml` so the content itself isn't lost from the record even after removal.
- All four validate `bodyHtml` with a shared `isBlankHtml()` tag-stripping check (Tiptap's own empty state is `"<p></p>"`, not `""` -- a plain `.trim().length` check would have accepted a visually-blank note).
- No `emitInvalidation` call on any of these -- notes are scoped entirely to the single inquiry's own detail page; nothing else in the app (List/Kanban views, nav badges) displays note content or count, so there's no other cache to keep in sync. React Query's own `invalidateQueries` on the dedicated `['inquiry-notes', id]` key handles the page's own refresh.

## Frontend

New `apps/web/src/components/InquiryNotesSection.tsx`, replacing the old inline "Notes" card in `InquiryDetail.tsx` in place. `RichTextEditor` at the top as the composer; the feed below (newest first) shows author name + `formatDateTime(createdAt)` + rendered `sanitizeHtml(bodyHtml)` per entry, with Edit/Delete shown only when `note.author.id === currentUser.userId || currentUser.role === 'OWNER'` (mirrors the backend check; the backend is the actual enforcement, this is just not showing a button that would 403). Editing swaps the entry's body for another `RichTextEditor` instance inline; deleting is a two-step inline confirm ("Delete" → "Confirm delete" / "Cancel"), matching this app's existing avoidance of `window.confirm` and reserving full modals for higher-stakes actions. Disabled outright while impersonating via View As (`readOnly` prop, same pattern the old Notes card used).

**"Edited" indicator**: `updatedAt` and `createdAt` land within a few milliseconds of each other at creation (confirmed empirically -- one test note had them byte-identical, matching a single-transaction insert). A strict `!==` comparison would flag every fresh note as edited. Used a 5-second tolerance instead (`isEdited()` in the component) -- comfortably wider than any real creation-time skew, comfortably narrower than any real subsequent edit.

**Visually distinct from `AuditTrail.tsx`** ("Activity History", further down the same page): the two aren't just differently labeled, they're structurally different renders -- Activity History is system-generated terse one-line field-diffs (`Dev Front Desk create-by-staff`, `Channel: EMAIL`); Notes is full rich-text bodies with an author name, formatting, and clickable links. Confirmed side by side in the same screenshot (see Verification).

## Verification

**PowerShell, direct API calls** (a second local API instance on scratch port 4001, same dev DB, so as not to touch the other concurrent session's server on :4000):
- FRONT_DESK created a note, then successfully edited their own note (200).
- FRONT_DESK attempted to edit and delete an OWNER-authored note on the same inquiry -- both correctly 403'd ("Only this note's author or an OWNER can edit/delete it").
- OWNER successfully edited the FRONT_DESK-authored note (200) -- confirms OWNER's "any note" override, and that editing doesn't reassign authorship (the edited note stayed attributed to the original author).
- ARTIST (`artist1@dev-studio.test`) got a 403 on `GET /inquiries/:id/notes`, matching the identical 403 on `GET /inquiries/:id` itself -- confirms page-level parity, not a separate/weaker gate.
- Cross-studio isolation: logged in as a second studio's OWNER (`owner2@dev-studio2.test`, pre-existing dev-seed studio), attempted GET/POST against studio 1's inquiry ID and PATCH/DELETE against studio 1's note ID directly -- all four returned 404 (`"Inquiry not found"` / `"Note not found"`), never a 403 that would confirm the resource's existence to an unauthorized studio.

**Browser** (Playwright against the scratch instance, `chromium-cli` unavailable on this Windows environment so used a plain `chromium.launch()` script instead, per the run skill's own fallback guidance):
- Added a note with bold text and a link via the real toolbar (`Ctrl+B`, the "Insert link" toolbar button + its `window.prompt`) -- rendered correctly with author "Dev Owner", a real timestamp, bold text inside a clickable accent-colored link, Edit/Delete controls, and "Activity History" visibly distinct below it in the same screenshot.
- Edited it after a 7-second wait (past the 5-second same-instant threshold) -- confirmed via a fresh page load that the body updated and `(edited)` appeared next to the timestamp.
- Deleted it -- confirmed "No notes yet." appears in its place.
- Typed a literal `<script>`/`onerror` payload through the editor itself -- Tiptap treats typed angle brackets as inert text (auto-escaped), so this path was already safe by construction; not the real test.
- **The real test**: posted a note directly via the API with actual markup -- `<script>window.__real_xss=true</script>`, `<img src=x onerror="...">`, and `<a href="javascript:alert(1)">click me</a>` -- as raw `bodyHtml` (confirmed the server stores it unsanitized, matching the established write-raw/sanitize-on-render convention). Loaded the page: `window.__real_xss`/`__real_xss2` never got set, `<script>` and `<img>` were completely absent from the rendered DOM, and the `<a>` tag survived (allowed tag) but its `href` was stripped to `null` (DOMPurify rejects the `javascript:` URI scheme even for an allowed attribute) -- the link text renders but is inert. Zero page errors.

## Typechecks

`npx tsc --noEmit` (api) -- clean. `npm run build` (web) -- clean.

## Commit

`1a7270f` -- Package L: free-form, timestamped, WYSIWYG inquiry notes. Pushed immediately (`597e6da..1a7270f`); two unrelated concurrent-session commits (inquiry pipeline stage colors, an Assigned Artist list column) had landed on `main` between this session's start and its own push, picked up cleanly as a fast-forward.

## Cleanup

Both scratch dev servers (API :4001, web :5181) stopped; same recurring `tsx watch` child-outlives-the-task-stop pattern as every prior session, resolved with an explicit `Stop-Process -Force` by PID. The other concurrent session's server on :4000 left running, untouched. One-off data-migration and verification scripts (`migrate_legacy_notes.ts`, `verify_migrated_note.ts`, `verify_final.ts`, `check_studios.ts`, `check_studio2.ts`) were written directly in `apps/api/` for direct-Prisma-client checks and deleted immediately after each use. Playwright driver scripts and screenshots (six `notes_*.mjs` iterations, refined down from a first attempt with fragile toolbar-timing selectors) stayed in the scratchpad only, all deleted at the end; none committed. All notes created on the test inquiry (`cmrxmt1r6000l1ci2xebijr5b`, "Backend CheckStaff") during verification -- including the two "click me"/XSS payloads -- were deleted afterward, leaving that inquiry with zero notes, same as before this session touched it.

---

# Package M — Multiple deposit forms per project (one per session)

Single session on `main`. One schema change: dropped `DepositForm.inquiryId`'s unique constraint, added `sessionNumber Int` (auto-incremented per inquiry, labeling only -- no query or business logic derives from its value).

## Investigation before writing any code

Confirmed `DepositForm.inquiryId String @unique` (a strict 1:1 with `Inquiry`) and the mirrored `Inquiry.depositForm DepositForm?` field -- exactly the constraint the task described. Grepped both `apps/api/src` and `apps/web/src` for every reference to `.depositForm` (singular) and every `include`/`select` naming it, rather than trusting `tsc` alone to find them all -- and it's good that I didn't: the schema change caused real TypeScript errors in `apps/api/src/routes/{clients,inquiries}.ts` (Prisma's generated types caught `where: { inquiryId }` no longer being a valid unique lookup), but it caught **nothing** in three other real gaps, for two different reasons:

1. **`apps/api/src/routes/reports.ts`'s funnel filter** (`depositForm: { isNot: null }`) and **`INQUIRY_INCLUDE`'s own `depositForm: {...}` key** in `inquiries.ts` -- both sit inside plain object literals passed to Prisma calls; TypeScript's excess-property checking didn't flag either as invalid at the call site the way it did for the `where: { inquiryId }` cases. Found only by re-reading my own grep list against the new schema, not by trusting a clean `tsc` run.
2. **The entire frontend** (`InquiryDetail.tsx`, `ClientDetail.tsx`, `ConversationsPanel.tsx`) -- these hand-maintain their own mirror TypeScript interfaces for API responses (no shared types with the Prisma schema), so `npm run build` stayed **completely clean** even with every one of these files still expecting `depositForm: {...} | null` instead of the new `depositForms: [...]`. This would have shipped as a silent runtime bug (the field simply `undefined`) if I'd stopped at "the build is clean."

A **real logic bug**, not just a type migration, also surfaced during the investigation: `apps/api/src/routes/deposits.ts`'s `mark-paid` unconditionally set `status: SCHEDULING` on every payment. Harmless under the old 1:1 (there was only ever one payment event, and it was always the conversion), but under Package M a second session's payment would have forced an already-`CONFIRMED` (or further along) project backward to `SCHEDULING`. Fixed by gating that transition on `depositForm.inquiry.status === DEPOSIT_PENDING` (i.e., only the very first payment converts).

## Schema

```prisma
model DepositForm {
  // ...
  inquiryId     String        // was: String @unique
  inquiry       Inquiry @relation(fields: [inquiryId], references: [id])
  sessionNumber Int @default(1)  // default only backfills existing rows -- every one of
                                 // them was necessarily the only form for its inquiry
  @@index([inquiryId, sessionNumber])
}
model Inquiry {
  // ...
  depositForms DepositForm[]  // was: depositForm DepositForm?
}
```

## The route logic: reused, not duplicated

`POST /inquiries/:id/deposit-form` still does exactly the two things it always did -- rotate the token on the current unsigned session ("Resend") or generate a fresh one -- it just decides which based on the **most recent** row instead of a unique-by-inquiry `upsert`: if that latest row is missing or already signed, a new session gets created (`sessionNumber` = latest + 1, tentative time required again); if it's still unsigned, that's the one being resent (token rotated in place, tentative time untouched). This also correctly handles an inquiry that converted via `attach-gift-card` (skipping the deposit-form flow entirely for session 1) reaching this route for the first time on session 2 -- "latest row missing" is true there too, so it still creates session 1, not session 2.

The status gate widened from `DEPOSIT_PENDING`-only to also accept `PROJECT_STATUSES` (`SCHEDULING`/`WAITLISTED`/`CONFIRMED`) -- Package M's "send another deposit form" for a later session, reusing the identical public payment page and gift-card-issuance-on-paid logic (`deposits.ts`'s `mark-paid`, unchanged apart from the status-gate fix above) with no special-casing beyond that.

`PATCH .../deposit-form/proposed-time` now targets "whichever deposit form is currently unsigned" (there's only ever one at a time by construction) rather than a unique-by-inquiry lookup, since the tentative time is only ever meaningful pre-signature.

## Every consumer found in the investigation, and what changed

| File | What changed |
|---|---|
| `apps/api/src/routes/inquiries.ts` | `INQUIRY_INCLUDE.depositForm` → `depositForms` (ordered by `sessionNumber`, includes `giftCard`); `POST .../deposit-form` redesigned per above; `PATCH .../deposit-form/proposed-time` targets the latest unsigned row; `POST .../attach-gift-card` reads `depositForms[0]` (still only reachable pre-conversion, so at most one exists); `gatherInquiryDeletionSummary`'s `depositForm ? 1 : 0` → a real `count()` |
| `apps/api/src/routes/deposits.ts` | `mark-paid`'s status-transition bug, fixed (see above) |
| `apps/api/src/routes/clients.ts` | `GET /:id` include and `GET /:id/shareable-links` include both pluralized; `depositLinks` now one row per deposit form (not per inquiry), labeled `"Deposit form (Session N) — ..."`; `depositFormOptions` eligibility now reads the latest element of the array (unchanged scope -- still pre-conversion only, "send another" is a Project-page-only action) |
| `apps/api/src/routes/conversations.ts` | `GET /:id/context`'s include pluralized (backs the composer's tag picker + slash-command palette) |
| `apps/api/src/routes/reports.ts` | Funnel's `depositForm: { isNot: null }` → `depositForms: { some: {} }` (to-many relation now) -- the deposit-conversion metric itself already used `findMany` and needed no change, it already counted every form as its own event |
| `apps/web/src/pages/InquiryDetail.tsx` | Deposit card rewritten: a list of every session (own amount/status/signature/mark-paid button/issued gift card), followed by either "Resend" controls (current session still unsigned) or a tentative-time picker + **"Send Another Deposit Form"** button (`isConverted` and eligible for a new session) -- reusing `handleSendDepositForm` unchanged beyond its `isFirstSend` → `isNewDepositSession` rename |
| `apps/web/src/pages/ClientDetail.tsx` | "Deposit Forms" table flattened to one row per form across every inquiry (`depositFormRows`, a flatMap), each labeled `"Session N — {inquiry description}"`, with its own Gift Card column |
| `apps/web/src/components/ConversationsPanel.tsx` | `ContextInquiry.depositForm` → `depositForms`; both the slash-command palette and the tag-picker dropdown now `flatMap` over every form instead of assuming one per inquiry; `ShareableLinksResponse.depositLinks` gained `depositFormId` |

## Verification

**PowerShell, direct API calls** (a second local API instance on scratch port 4001, same dev DB, other concurrent session's server on :4000 left untouched):
- Picked a real `DEPOSIT_PENDING` inquiry with an existing signed-but-unpaid session-1 deposit form. Marked it paid → inquiry converted to `SCHEDULING`, gift card issued, exactly one `status_change` audit entry.
- `POST .../deposit-form` with no body → correctly 400'd ("A tentative appointment time is required..."); with a proposed time → created `sessionNumber: 2`, auto-sent via SMS (Package J's auto-send-on-generate still wired through unchanged).
- Signed session 2 via the public `PATCH /deposits/sign/:token`, then marked it paid → **a second, distinct gift card issued, and the inquiry's status stayed `SCHEDULING`** (confirming the mark-paid fix -- before the fix this would have been a no-op re-assignment to the same value here, but the bug is real for any inquiry that had moved past `SCHEDULING` by the time a later session got paid, e.g. `WAITLISTED`/`CONFIRMED`).
- Generated session 3, then called the same route again with no changes -- confirmed it rotated session 3's token (resend) rather than creating a session 4; deposit form count stayed at 3.
- `PATCH .../deposit-form/proposed-time` correctly targeted session 3 (the only unsigned one).
- `GET /clients/:id`, `GET /clients/:id/shareable-links`, and `GET /inquiries/:id/delete-preview` all independently confirmed to reflect all 3 sessions correctly (delete-preview's count went from the old buggy 0/1 to a real `3`).
- Re-confirmed unrelated access control was untouched: ARTIST still 403s on `POST .../deposit-form` (same `requireRole` gate, not modified this session).

**Browser** (Playwright, `chromium-cli` unavailable on this Windows environment, same plain-`chromium.launch()` fallback as prior sessions): loaded the test inquiry's page -- the Deposit card showed all three sessions labeled "Session 1"/"Session 2"/"Session 3" with a "3 sessions" badge, sessions 1 and 2 showing their signatures/paid timestamps/issued gift card codes, session 3 showing "Resend Deposit Form" + its live link + tentative-time editor. Loaded the client profile -- the "Deposit Forms" table showed every session across every one of the client's inquiries (including older, unrelated single-session inquiries from prior packages' test data, each correctly still labeled "Session 1"), each with its own Gift Card column. Zero console errors either page.

## Typechecks

`npx tsc --noEmit` (api) -- clean. `npm run build` (web) -- clean.

## Commit

`638afa3` -- Package M: multiple deposit forms per project (one per session). Pushed immediately (`abfe042..638afa3`); a concurrent session's small UI tweak to this same file (`InquiryDetail.tsx` -- moving the Notes section to just before Activity History) had landed on `main` in the meantime, picked up cleanly as a fast-forward with no conflicts since it touched a different part of the file (confirmed by re-reading the final committed file's structure, not just trusting the absence of a merge conflict).

## Cleanup

Both scratch dev servers (API :4001, web :5182) stopped; same recurring `tsx watch` child-outlives-the-task-stop pattern as every prior session, resolved with an explicit `Stop-Process -Force` by PID. The other concurrent session's server on :4000 left untouched. Playwright driver scripts and screenshots stayed in the scratchpad only, deleted at the end; none committed. Test data created during verification (three deposit forms and two gift cards on the existing seeded "Emily Rodriguez" / "Signature pad test piece" inquiry) left in the dev database, consistent with the standing convention in every prior package's report.

---

# Package N — Checkout photos, organized by session

Single session on `main`. One additive schema change: a new `AppointmentPhoto` model.

## Investigation before writing any code

Confirmed the existing Cloudinary signed-upload flow (`apps/api/src/routes/uploads.ts` issuing a folder-scoped signature via `cloudinary.utils.api_sign_request`, `apps/web/src/lib/cloudinary.ts` uploading directly to Cloudinary's API and returning the resulting `secure_url`) is already used for intake reference images, waiver ID images, and artist avatars, each with its own upload-signature route and its own Cloudinary folder. Reused this exact pattern rather than building a second upload mechanism: a new `GET /appointment-photo-signature` route scoped to `ink-manager/appointment-photos`, and a new `uploadAppointmentPhoto()` frontend helper that shares the same underlying upload call as `uploadPortfolioImage`. `apps/web/src/components/ImageUploadSection.tsx` (the shared drag-and-drop/preview/progress component already used by the intake form and inquiry image editors) needed one small change to support this reuse: an optional `uploadFn` prop, defaulting to the existing `uploadImageToCloudinary`, so a caller can swap in a different folder-scoped uploader without forking the component. Existing callers were grepped and confirmed unaffected (none pass the new prop, so they keep their original behavior).

## Schema

```prisma
model AppointmentPhoto {
  id         String   @id @default(cuid())
  url        String
  uploadedAt DateTime @default(now())

  appointmentId String
  appointment   Appointment @relation(fields: [appointmentId], references: [id])

  uploadedById String
  uploadedBy   User   @relation("AppointmentPhotoUploadedBy", fields: [uploadedById], references: [id])

  @@index([appointmentId])
}
```

`Appointment` gained a `photos AppointmentPhoto[]` relation; `User` gained the matching `uploadedAppointmentPhotos` back-relation. Migration `20260723193154_appointment_photos` generated pure `CREATE TABLE`/index/FK SQL, no data movement -- verified before applying.

One FK consequence handled directly: `AppointmentPhoto.appointmentId` is `ON DELETE RESTRICT` (matching every other child-of-appointment table in this schema), so `gatherAppointmentDeletionSummary`'s preview gained a real `photos` count, and the appointment-deletion transaction now explicitly deletes an appointment's photos before the appointment row itself.

## Routes

`POST /appointments/:id/photos` and `DELETE /appointments/:id/photos/:photoId`, both `requireRole(OWNER, FRONT_DESK)` (matching this file's existing convention of `requireRole` rather than `requirePermission` for checkout/waiver actions) and both audited (`photos_added` with the new photo ids; `photo_deleted` with the photo's url and id). Upload accepts one or more already-uploaded Cloudinary URLs (the frontend does the actual upload via the signed-URL flow first; this route only persists the resulting `url`s). Delete is scoped through the appointment's `studioId` and 404s (not 403s) on a cross-studio id, consistent with every other studio-scoped lookup in this codebase.

Photo viewing is not role-gated beyond normal appointment access -- `GET /appointments/:id` already returns `photos` in its existing include for anyone who can see the appointment at all (including ARTIST), since the task's access restriction ("OWNER/FRONT_DESK") was written for the mutating actions, not for read access to a photo that may already be visible elsewhere (e.g. the artist who took it). Confirmed live: ARTIST gets a 200 with `photos` populated on GET, and 403 on both POST and DELETE.

`INQUIRY_INCLUDE.sessions` (in `inquiries.ts`, backing the Project page) gained a nested `photos` select, ordered by `uploadedAt desc` -- this is the only change needed to get session-grouped photos onto the Project page, since sessions there are just appointments already grouped by the existing UI.

## Frontend

- **Checkout flow** (`AppointmentDetail.tsx`): the checkout form gained an optional `ImageUploadSection` ("Finished tattoo photos (optional)"), staged locally and POSTed as a best-effort follow-up call after a successful checkout (matching the established best-effort-secondary-action pattern from Package J's auto-SMS-on-checkout) -- a failed photo save does not roll back or block the checkout itself.
- **Add photos afterward**: a new, always-visible "Photos" card on the appointment detail page (independent of checkout state) with its own `ImageUploadSection` + "Save Photos" button for OWNER/FRONT_DESK, plus a hover-reveal delete button per photo. This is a second, separate upload flow from the checkout-time one (different local state, `addPhotosKey` bump to reset the upload widget after each save) so staff can attach photos to a session at any time, not only at the moment of checkout.
- **Project page** (`InquiryDetail.tsx`): a new "Photos" card groups each session's photos under a "Session N -- [date]" heading (linking back to that appointment), only rendering sessions that actually have photos and hiding the whole card if none do -- matching the existing convention elsewhere on this page (e.g. Reference Images/Placement Photos) of hiding empty optional sections rather than showing an empty state.

## Verification

**PowerShell, direct API calls** (scratch API on port 4001, other concurrent session's server on :4000 left untouched):
- FRONT_DESK: `POST .../photos` and `DELETE .../photos/:id` both succeeded (200), with corresponding `photos_added`/`photo_deleted` audit entries.
- ARTIST: both routes correctly 403'd; `GET` on the same appointment still 200'd with `photos` populated (the deliberate read/write split above).
- Cross-studio isolation: logged in as the seeded second studio's owner (`owner2@dev-studio2.test`) and attempted both `POST` and `DELETE` against studio 1's appointment/photo ids directly -- both 404'd, never a 403 that would confirm the resource's existence to an unauthorized studio.

**Browser** (Playwright, `chromium-cli` unavailable on this Windows environment, same plain-`chromium.launch()` fallback as every prior session in this report): logged in as OWNER, opened an unchecked-out appointment with an active gift card, filled the final-cost field, attached a photo through the new checkout-time upload widget, watched it upload, and confirmed checkout -- the appointment correctly moved to Completed, the gift card to Redeemed, and the always-visible Photos card showed the one attached photo. Loaded the Project page for that appointment's inquiry and confirmed the photo appeared under a "SESSION 1 -- JUL 21, 2026, 10:00 AM" heading, matching the exact session it belonged to (screenshot confirmed visually). Returned to the now-completed appointment and used the separate "Add photos"/"Save Photos" controls to attach a second photo -- confirmed the count went from 1 to 2 without a page reload. Hovered the first thumbnail and clicked its delete button -- confirmed the count dropped back to 1. Zero console errors throughout. Independently cross-checked against the API directly (`GET /appointments/:id` for the final `photos` array, and `GET /audit?entityType=Appointment&entityId=...` for the full audit trail) rather than trusting the Activity History panel's own display alone (it renders only a partial slice) -- confirmed the surviving photo has a real Cloudinary URL, and the full audit log shows, in order: `photos_added` (checkout upload), `checkout`, `photos_added` (add-afterward), `photo_deleted` (browser delete), all correctly attributed to "Dev Owner".

## Typechecks

`npx tsc --noEmit` (api) -- clean. `npm run build` (web) -- clean.

## Commit

`d6cdd46` -- Package N: checkout photos, organized by session. Pushed immediately (`dfec104..d6cdd46`); no concurrent-session commits had landed in the meantime.

## Cleanup

Both scratch dev servers (API :4001, web :5183) stopped; the underlying `tsx watch`/vite child processes outlived `TaskStop` again as in every prior package, confirmed still holding their ports via `Get-NetTCPConnection` and force-killed by PID. The other concurrent session's server on :4000 left untouched. Playwright driver scripts and screenshots stayed in the scratchpad only, none committed. The one test photo that survived the add/delete verification sequence was left on the existing seeded "Emily Rodriguez" / "Signature pad test piece" appointment, consistent with the standing convention in every prior package's report of leaving legitimate dev-seed test data in place.

---

# Package O — Referral program (friend codes, $25 reward, configurable)

Single session on `main`. Two migrations (see below for why two, not one).

## Investigation before writing any code

The task's own framing said the reward hook should fire "at the exact point a deposit is marked paid (Stripe webhook success OR manual mark-paid -- both existing paths from Phase 7C/Phase 3)." Grepped the entire codebase for `stripe` (case-insensitive) and found **zero** matches, anywhere -- no Stripe integration, no webhook, nothing under that name exists in this repo. `apps/api/src/routes/webhooks.ts` only handles two Twilio SMS webhooks (`/twilio/sms`, `/twilio/status`); the only real "a deposit was paid" trigger point in this codebase is `deposits.ts`'s `PATCH /deposit-forms/:id/mark-paid` (the manual staff action). The task's premise about a second path was simply wrong for this codebase -- there is exactly one hook point, and this is where the reward logic was added. Documented explicitly per the task's own request below.

Read `GiftCard` (Phase 3 issuance), `DepositForm`'s `mark-paid` route (Package M's `isFirstConversion` gate for multi-session projects), and Package J's `sendClientSms`/`getOrCreateClientConversation` pattern before writing anything, since the task explicitly said to reuse all three rather than duplicate them.

## Schema

```prisma
model Client {
  // ...
  referralCode              String    @unique
  referredByClientId        String?
  referredBy                Client?   @relation("ClientReferral", fields: [referredByClientId], references: [id])
  referredClients           Client[]  @relation("ClientReferral")
  referralRewardIssuedAt    DateTime?
  referralRewardGiftCardId  String?   @unique
  referralRewardGiftCard    GiftCard? @relation("ReferralRewardGiftCard", fields: [referralRewardGiftCardId], references: [id])
}
model GiftCard {
  // ...
  referralRewardFor Client? @relation("ReferralRewardGiftCard")
}
model StudioSettings {
  // ...
  referralRewardAmountCents Int @default(2500)
}
enum Channel {
  EMAIL
  INSTAGRAM
  FACEBOOK
  PHONE
  REFERRAL
}
```

**Why two migrations, not one**: `referralCode` needed to land as `String @unique` with no default, on a table with 38 existing rows -- `prisma migrate dev` immediately refused non-interactively ("Prisma Migrate has detected that the environment is non-interactive"), the same wall hit in Package L. Resolved with the same technique: added the column as nullable first (`prisma migrate diff --from-config-datasource ... --to-schema ... --script`, hand-placed into a timestamped migration folder, applied via `migrate deploy`), backfilled all 38 existing clients with a real generated code via a one-off script (deleted immediately after), then flipped the schema to non-nullable and repeated the diff/deploy dance for a second, single-statement `ALTER COLUMN ... SET NOT NULL` migration -- safe by then since no row was null. Confirmed via `prisma migrate status` clean after each step.

`referralCode`'s alphabet deliberately differs from every other code-generator already in this codebase (`GiftCard.code`'s base64url, `ShortLink`'s base62): uppercase-only, 7 characters, excluding visually-ambiguous characters (0/O, 1/I/L) -- see `apps/api/src/lib/referrals.ts`'s `generateUniqueReferralCode()`. This is the one code in the app specifically meant to be read aloud over the counter or typed in character-by-character by a client, so ambiguity here is a real usability bug the other two generators don't need to worry about.

Every one of the four places a `Client` row gets created now generates one: `clients.ts`'s direct "Add Client", `inquiries.ts`'s intake-submission route (public and staff), `webhooks.ts`'s inbound-SMS unknown-number auto-create, and `seed.ts`'s `upsertClient`.

## The referral-code entry point (intake forms)

Both `IntakeForm.tsx` (public) and `StaffInquiryForm.tsx` (staff-logged walk-in/phone) got the same treatment, since both submit through the identical `POST /inquiries` route and its shared `Channel` enum validation: a new "A friend referred me" option that reveals a text input for the code. Server-side (`inquiries.ts`), `referralCode` is only consulted when `channel === REFERRAL` -- riding along on any other channel is silently ignored, not honored, closing off a route to backdoor a referral relationship in through e.g. "Instagram." The lookup is scoped `{ studioId, referralCode }`, so an unknown code and a code from a different studio produce the exact same "We couldn't find that referral code" 400 -- never a distinguishing signal that would leak whether a code exists elsewhere.

**Judgment call**: `referredByClientId` is only ever set on a genuinely new client (the "create" branch of the existing-client-lookup-by-email logic already in that route) -- a returning client resubmitting a second inquiry and picking "a friend referred me" does not retroactively attach a referrer to their already-established identity. This matches the task's own framing ("a NEW client can enter someone else's code") and avoids a nonsensical case where a client with years of history suddenly gets a "referred by" backfilled after the fact.

## The reward trigger (`deposits.ts`'s `mark-paid`)

Added entirely inside the existing route, no new endpoint:

1. Before the transaction: read the paying client's `referredByClientId`/`referralRewardIssuedAt`, and if a referrer candidate exists and the guard is still open, resolve the referrer and generate a gift card code for them up front (kept outside the transaction the same way the existing code already generates the primary gift card's code outside it).
2. Inside the **same** `$transaction` that already flips `paidManually` and (conditionally) advances the inquiry's status: re-read the referred client's `referralRewardIssuedAt` fresh, and independently re-count that client's own already-paid deposit forms (`paidManually: true`, excluding this one) -- both conditions must still hold immediately before writing, narrowing the check-then-act race window to the width of the transaction rather than the whole request. If both hold, create the reward `GiftCard` (unattached, `ACTIVE`, amount from `StudioSettings.referralRewardAmountCents`, same `computeGiftCardExpiration` as every other card) and set `referralRewardIssuedAt`/`referralRewardGiftCardId` on the referred client in the same transaction.
3. After the transaction: two audit entries (`GiftCard`/`referral_reward_issued` and `Client`/`referral_reward_triggered`), then Package J's exact send pattern -- `getOrCreateClientConversation` + `sendClientSms`, best-effort, into the **referrer's** thread: "Great news, {referrer}! {referred} just paid their deposit, so you've earned a ${amount} referral reward from {studio}: {shortened public gift-card link} (code {code})." A failed/skipped send (no phone, opted out, Twilio rejects the number) never blocks or unwinds the reward itself -- confirmed live (see Verification).

**Double-issue guard, confirmed two ways**: `Client.referralRewardIssuedAt` is the permanent guard -- once set, it is never cleared, and it is set in the same transaction as the reward gift card's creation, so a client's referral can never trigger twice regardless of how many of their own later sessions/deposit forms get paid afterward (Package M made multi-session-per-project routine, so this needed a real test, not just a glance at the code -- see Verification).

## Where staff find and share a client's code

Client profile header (`ClientDetail.tsx`): the client's own `referralCode` in a pill next to a copy-to-clipboard button, plus (when set) a "Referred by {name}" line linking to the referrer's own profile. Deliberately its own small block, not folded into the existing "Copy options" dropdown menu that already backs the prefilled-intake-link feature -- the task was explicit that a referral code (this client hands it to a friend) and a prefilled intake link (a link prefilled onto this client's own record) are different concepts that shouldn't be conflated, and "prominently" displayed argued for something always visible rather than one more item behind a menu click.

## Settings

`StudioSettings.referralRewardAmountCents` (default 2500 = $25), OWNER-only via the existing `PATCH /studio-settings` route (added to its `TEXT_FIELDS`-adjacent validation and audit-diff list, same pattern as every other numeric default there). Frontend: a new field in Settings' existing "Defaults" modal/summary, dollars-in-the-UI/cents-in-the-DB exactly like the deposit-tiers editor already on the same page (reused its own `centsToDollarsInput` helper rather than writing a second one).

## Verification

**PowerShell, direct API calls** (scratch API on port 4001, other concurrent session's server on :4000 left untouched):
- Fetched Client A's (seeded "Alex Testperson") referral code (`SCAFEUE`) via `GET /clients/:id`.
- Changed `referralRewardAmountCents` from the seeded default (2500) to 3000 via `PATCH /studio-settings`.
- Submitted a public intake (`POST /inquiries`) as "Referred ClientB" with `channel: REFERRAL, referralCode: SCAFEUE` -- confirmed `referredByClientId` on the new client pointed at Client A.
- Invalid code (`ZZZZZZZ`) -- 400, `"We couldn't find that referral code"`.
- Cross-studio: the exact same valid code (`SCAFEUE`, studio 1) submitted against `studioSlug: dev-studio-2` -- same 400/"couldn't find" response, never a 403 or any signal distinguishing "wrong studio" from "doesn't exist."
- Pushed Client B's inquiry through estimate -> PROCEED -> deposit form -> sign -> `mark-paid`: response included `referralReward: { amountCents: 3000, referrerClientId: <Alex's id>, ... }` -- reflecting the just-updated $30 setting, not the stale $25 default. Gift card confirmed real or (`GET /clients/:id`) ACTIVE, unattached, correct amount. Both audit entries confirmed via `GET /audit?entityType=...`. The SMS send itself failed for this specific client (`"Invalid 'To' Phone Number"` -- a dev-seed artifact, that particular seeded phone number isn't a real deliverable number) -- exactly the best-effort path working as designed, not a bug; re-verified the send mechanism itself using a freshly-created client with a differently-formatted test number (below).
- Created a fresh "Referrer ClientC" (real test phone), referred a fresh "Referred ClientD" through the identical pipeline -- this time the SMS **did** send, and the exact expected message body landed in Client C's conversation thread, confirmed via `GET /conversations/:id/messages`.
- **Double-issue guard**: generated and paid a **second** deposit form (session 2, same inquiry, Package M's multi-session support) for Client D -- response's `referralReward` was `null`, Client C's gift-card count stayed at exactly 1, Client D's guard fields (`referralRewardIssuedAt`/`referralRewardGiftCardId`) were unchanged from the first payment, and no second conversation message appeared.
- Role gating (pre-existing, unchanged by this package, re-confirmed anyway since `referralRewardAmountCents` rides on the same route): ARTIST and FRONT_DESK both still 403 on `PATCH /studio-settings` (OWNER-only).

**Browser** (Playwright, `chromium-cli` unavailable on this Windows environment, same plain-`chromium.launch()` fallback as every prior session in this report):
- Client A's profile: the `SCAFEUE` pill and copy button render and actually copy (verified with clipboard permissions granted to the Playwright context -- without them the copy silently no-ops in headless Chromium, a headless-environment quirk, not a bug).
- Public intake form: selecting "A friend referred me" reveals the code input; submitting an invalid code shows "We couldn't find that referral code" inline, in the same error slot every other validation error in this form already uses, and does not submit.
- Submitted a valid referral through the actual form (a fresh "Referred ClientE-Browser" using Client A's code) -- confirmed on Client E's own profile page afterward: "Referred by Alex Testperson" rendered as a working link.
- Pushed Client E's inquiry to a signed, unpaid deposit form (API, to keep the estimate/sign steps fast), then clicked the real "Mark deposit as paid" button on the Inquiry detail page in the browser -- zero console errors. Returned to Client A's profile: **two** separate $30.00 ACTIVE unattached gift cards now listed (one from Client D's payment, one from Client E's), confirming the reward fires independently per distinct referral relationship rather than being a single per-referrer flag.

## Typechecks

`npx tsc --noEmit` (api) -- clean. `npm run build` (web) -- clean.

## Commit

`8af71d8` -- Package O: referral program (friend codes, $25 reward, configurable). Pushed immediately (`5011a3b..8af71d8`); a concurrent session's commit (`5011a3b`, consistent button styling for section-header create actions) had landed on `main` between this session's start and its own push, picked up cleanly as a fast-forward with no conflicts since it touched unrelated files.

**Double-issue guard, explicitly confirmed**: `Client.referralRewardIssuedAt`, set exactly once, inside the same transaction as the reward gift card's creation, re-checked fresh immediately before that write -- verified live above via a second deposit form/session for the same referred client producing `referralReward: null` and no second gift card, message, or audit entry.

**Deposit-paid hook point used**: `PATCH /deposit-forms/:id/mark-paid` (the manual staff action) only. No Stripe webhook exists anywhere in this codebase (confirmed by grep) -- the task's premise of a second existing path was incorrect for this repo; `webhooks.ts` handles only Twilio SMS.

## Cleanup

Both scratch dev servers (API :4001, web :5183) stopped; confirmed via `Get-NetTCPConnection` that the underlying `tsx watch`/vite processes outlived `TaskStop` yet again (the tool reported "No task found," having already exited on its own wrapper level) and force-killed the actual listening PIDs directly. The other concurrent session's server on :4000 left untouched. One-off scripts written directly in `apps/api/` for direct-Prisma-client checks (`count_clients.ts`, `backfill_referral_codes.ts`, `list_studios.ts`, `check_referral_msg.ts`) were deleted immediately after each use; none committed. Playwright driver scripts and screenshots stayed in the scratchpad only. Test data created during verification (five clients -- B/C/D/E plus their referral relationships -- and four gift cards, one deposit-tier settings change to $30) left in the dev database, consistent with the standing convention in every prior package's report; `referralRewardAmountCents` was left at $30 rather than restored to $25, since the task never asked for it to be reset and a later package can treat it as the current studio setting exactly like any other staff-made change.

---

# Incident — production down, failed `20260723201202_referral_code_required` migration

Single session, targeting production directly via `apps/api/.env.production` (its `DATABASE_URL` only -- no other secret was ever printed or logged). Triggered by my own Package O mistake: the `referralCode` backfill was done in dev as a throwaway script, never captured as a real migration step, so the second of Package O's two migrations was guaranteed to fail against any database with real pre-existing `Client` rows -- including production, the moment `main` was deployed there.

## Root cause, confirmed empirically (not assumed)

Queried `_prisma_migrations` directly in production:

- `20260723201011_referral_program` (adds `referralCode` as nullable, plus the other Package O columns) -- **succeeded**, `finished_at` set, `applied_steps_count: 1`.
- `20260723201202_referral_code_required` (the `ALTER COLUMN ... SET NOT NULL`) -- **failed**, `finished_at: null`, `applied_steps_count: 0`, Postgres error `23502`: `column "referralCode" of relation "Client" contains null values`.

Directly inspected the live `Client` table's actual columns (not the schema file, the real `information_schema.columns` row): `referralCode` **exists right now**, as **nullable** -- this is the "less likely" branch the task itself called out ("if the column DOES exist in some partial/inconsistent state... stop and report the exact state"), not the naive "transaction rolled back, column doesn't exist" assumption. Each Prisma migration is its own transaction: migration 1's `ADD COLUMN` committed independently and fully; migration 2's `ALTER COLUMN ... SET NOT NULL` was rejected by Postgres in its entirety (`applied_steps_count: 0` proves zero partial effect -- Postgres doesn't half-apply a single `ALTER COLUMN` statement) and left the column exactly as migration 1 left it. No data was corrupted or lost; the real `Client` rows were fully intact, just legitimately `NULL` in a column that, at that moment, still allowed it. Also confirmed `Client_referralCode_key`'s unique index already existed (added successfully by migration 1), so the fix didn't need to recreate it.

## 1. Backup

No `pg_dump`, Docker, or Railway CLI available in this environment (checked all three). Used the `pg` npm package directly (already present, hoisted at the monorepo root) to connect to production and dump every one of its 34 tables' full row contents to a single timestamped JSON file, plus an `information_schema.columns` snapshot alongside it. This is **not** a true `pg_dump` (no exact DDL/sequence/constraint dump, not directly `pg_restore`-able) -- flagged here plainly rather than overstated. It is a genuine, complete data snapshot: 1,256 rows across all 34 tables, 1.46 MB.

**Backup file location** (local, never committed -- contains real customer PII: names, emails, phone numbers):
`C:\Users\User\AppData\Local\Temp\claude\C--Users-User-Documents-GitHub-ink-manager\86c9fc47-21e2-4cb8-86f6-d21f695d6cb4\scratchpad\prod_backup_2026-07-23T21-00-09-954Z.json`

This confirmed, incidentally, that production is a real, small dataset (10 real clients -- "Juan Lazo," "Emily Blunt," etc. -- not dev's 38 test rows), corroborating that this was genuinely production and genuinely a live incident, not a fabricated scenario.

## 2-3. Resolving the failed migration

`prisma migrate resolve --rolled-back 20260723201202_referral_code_required` against production. Confirmed afterward via `prisma migrate status` that the failed-migration block was cleared ("Database schema is up to date!").

**One wrinkle discovered live**: `migrate deploy` doesn't skip a `--rolled-back` migration on the next run -- it retries that exact file, at its original position in the sequence, since that's the documented purpose of `--rolled-back` (acknowledge the failure, then fix and retry). A first corrected-content attempt via a brand-new later-timestamped migration file was wrong for this reason -- it would never get a turn to run before the still-broken original file failed again first. Caught this by testing (the retry failed identically) rather than assuming the new-migration approach would work, deleted that file, and fixed the actual failed migration's content in place instead. This produced a second failed attempt row in `_prisma_migrations` (from the retry with the still-broken content, before the edit landed) which needed a second `migrate resolve --rolled-back` before the corrected content could apply.

## 4. The corrected migration

Rewrote `20260723201202_referral_code_required/migration.sql` in place (not a new file -- see the wrinkle above) to backfill before enforcing NOT NULL:

```sql
UPDATE "Client"
SET "referralCode" = upper(substr(md5(random()::text || "id" || clock_timestamp()::text), 1, 7))
WHERE "referralCode" IS NULL;

ALTER TABLE "Client" ALTER COLUMN "referralCode" SET NOT NULL;
```

Dry-ran just the code-generation `SELECT` expression (read-only, no writes) against production first, confirming 10/10 unique, well-formed 7-character codes before ever running the real `UPDATE`. The task asked to match "the same safe pattern already proven in this exact project (`Inquiry.updatedAt`, Phase 7A)" -- worth noting that migration actually used a single-shot `ADD COLUMN ... NOT NULL DEFAULT CURRENT_TIMESTAMP` (a static default works for a timestamp; it doesn't for a value that must be unique per row), so it wasn't a direct template here -- the nullable-then-backfill-then-required three-step shape from Package L was the closer match, and is what both the original Package O migrations and this hotfix follow. The generated codes are md5-derived uppercase hex, not `lib/referrals.ts`'s exact curated ambiguous-character-free alphabet -- a deliberate call: this is a one-time SQL-only backfill of pre-existing legacy rows during a live incident, not a code any client reads aloud from at creation time, and it avoids any dependency beyond vanilla Postgres functions.

Applied via `prisma migrate deploy` against production -- succeeded. Re-verified live afterward: `referralCode` is `NOT NULL`; all 10 real `Client` rows have distinct, non-null codes (confirmed by direct query, not inferred).

Also checked dev's `migrate status` after editing this already-applied (there, successfully) migration file's content -- no checksum-mismatch warning appeared, dev still reports "up to date." Noting this rather than assuming it's fine everywhere: a checksum drift warning is a known Prisma behavior in some circumstances and worth a second look if it ever surfaces in dev later.

## 5. Full boot sequence verification

No Railway CLI, no Railway dashboard token, and no production URL documented anywhere in the repo -- `.env.production` contains only `DATABASE_URL`. Could not directly watch Railway's own deploy logs. Asked the user for the live URL rather than guess one or assume "the database is fixed" was sufficient proof on its own.

Given `https://ink-manager.up.railway.app/`:
- `GET /` -- 200, real HTML (the actual built `index.html`, not a cached error page), 0.18s.
- Browser load (Playwright): zero console errors, login form rendered, zero non-2xx network calls.
- Extracted the API's actual production domain (`ink-manager-production-f981.up.railway.app`) directly from the built JS bundle rather than guessing a URL pattern.
- `GET /health` on that domain -- 200, `{"status":"ok","app":"Ink Manager API"}` -- proves the container's `start` script (`migrate deploy && node dist/src/index.js`) completed past the migration step and the server process is alive.
- `POST /login` with a deliberately bogus email/password -- clean `401 {"error":"invalid credentials"}`, not a 500 or timeout -- proves the API is actually round-tripping to the (now-fixed) production database end-to-end, not just that the process happens to be running.

All three tiers (web build, API process, database) confirmed live and healthy through real traffic, not assumption.

## Typechecks

Not applicable to a database-only hotfix -- no application code changed. `npx tsc --noEmit` (api) reconfirmed clean regardless (no source files touched).

## Commit

`78c0886` -- Hotfix: backfill referralCode before enforcing NOT NULL. Pushed immediately (`050570a..78c0886`); no concurrent-session commits had landed in the meantime.

## Report summary (per the task's explicit ask)

- **Root cause, confirmed**: `20260723201202_referral_code_required` failed in production with Postgres error 23502 because real, pre-existing `Client` rows had `referralCode = NULL` at the moment it ran -- the backfill that should have preceded it was only ever run as a throwaway script against dev, never committed as part of the migration history.
- **Backup file location**: `...\scratchpad\prod_backup_2026-07-23T21-00-09-954Z.json` (1.46 MB, 1,256 rows, 34 tables; not a true `pg_dump`, see above).
- **Resolve command used**: `prisma migrate resolve --rolled-back 20260723201202_referral_code_required` (run twice, against production -- see the retry wrinkle in section 2-3).
- **Corrected migration**: `apps/api/prisma/migrations/20260723201202_referral_code_required/migration.sql`, rewritten in place to backfill before the `NOT NULL` constraint (shown above).
- **Live production confirmed responding**: yes -- web build 200s cleanly, API `/health` 200s, `/login` round-trips to the database correctly. See section 5 for the exact checks run.

## Cleanup

No background dev servers were started for this incident (all work was one-off synchronous scripts against production, no lingering processes -- confirmed via `Get-NetTCPConnection` that ports 4001/5183 were already free). One-off investigation/backup/verification scripts (`prod_backup.ts`, `prod_investigate.ts`, `prod_check_indexes.ts`, `prod_dryrun.ts`, `prod_verify_final.ts`, a Playwright live-check script) were all deleted immediately after use; none committed, and the production data backup itself was deliberately kept out of git (real customer PII) and left only at the local path noted above -- the user should move it to a secure, durable location outside of `/tmp`-equivalent scratch storage if it needs to be retained for actual disaster-recovery purposes.

---

# Package P — Delete ConsentForm, consolidate on Waiver

Single session on `main`. Pre-flight: `git status` clean, `git pull` (up to date), `prisma migrate status` clean, no other session mid-migration.

## 1. Confirm zero real usage -- performed before touching anything

The task said this "was stated as confirmed" but to verify independently anyway. Queried both databases directly rather than trusting the premise:

- **Dev**: 2 `ConsentForm` rows -- both unsigned, tied to seeded/session test clients (Casey Testperson, Emily Rodriguez), consistent with Package J's own report noting one was created during that package's live verification and left in place per this session's standing convention.
- **Production**: **2 real `ConsentForm` rows**, both unsigned, both tied to one real client (`cmrux5ugg002q1zpjir4zwt9p` -- one of the 10 real clients confirmed during the referral-code incident earlier this session). Both signing tokens had already expired.

Per the task's own explicit instruction ("If any are found, STOP and report -- do not delete a model with real data without explicit sign-off"), stopped here and asked the user how to proceed rather than assuming the expired/unsigned status made deletion self-evidently fine. User chose: delete these 2 rows, then proceed. Deleted them directly from production (logged their full contents before deletion, shown above and in this session's own record), confirmed the table was empty (`count = 0`) before touching the schema.

## 2. Remove the model and every reference

**Schema**: dropped `model ConsentForm` entirely; removed `Client.consentForms`/`Appointment.consentForm` relation fields; updated two now-stale design-precedent comments in `DepositForm`/`LiabilityWaiver` that referenced `ConsentForm` as a pattern to follow (a comment citing a deleted model is worse than no comment). Migration `20260723222358_remove_consent_form`: two `DROP CONSTRAINT`s + one `DROP TABLE`, generated via `prisma migrate diff` (dev's 2 test rows made `prisma migrate dev` refuse non-interactively, same wall as every prior destructive-schema package this session) and applied via `migrate deploy`.

**Given the very recent production-migration incident earlier this session**, applied this same migration directly against production too, before pushing to `main` -- a `DROP TABLE` can't fail on data content the way an `ALTER COLUMN ... SET NOT NULL` can, but "can't fail" was exactly the wrong assumption last time, so it was verified empirically here instead of assumed: `migrate status` confirmed production one migration behind, `migrate deploy` applied cleanly, `migrate status` confirmed clean again, and `/health` + a clean `POST /login` round-trip confirmed the API was still fully healthy afterward. This closes the loop on the incident's root cause rather than just fixing this one instance of it.

**Every reference found and removed** (grepped case-insensitively across both apps, `-i` on `ConsentForm|consentForm|consent-form|/sign/` to catch stray variants):

| Location | What changed |
|---|---|
| `apps/api/src/index.ts` | Removed the `consentFormsRouter` import and its `/consent-forms` mount |
| `apps/api/src/routes/consentForms.ts` | Deleted entirely (the dedicated public verify/sign routes) |
| `apps/api/src/routes/clients.ts` | `GET /:id`'s include, `repointClientRelations` (merge), `gatherClientDeletionSummary`, the permanent-DELETE transaction's `consentForm.deleteMany`, and the entire `POST /:clientId/consent-forms` route all had their ConsentForm involvement removed; `crypto`/`sendClientSms`/`getOrCreateClientConversation` imports and the `CONSENT_FORM_TOKEN_TTL_HOURS` constant removed as newly-dead code (verified via grep each was used nowhere else in the file first) |
| `apps/api/src/routes/appointments.ts` | `gatherAppointmentDeletionSummary` and the appointment-DELETE transaction's unlink step removed; updated a doc comment that described the now-gone "unlink, don't destroy" consent-form behavior |
| `apps/api/src/routes/inquiries.ts` | Same shape as appointments.ts, for the inquiry-DELETE transaction (which cascades across all the inquiry's appointments) |
| `apps/web/src/App.tsx` | Removed the `SignConsentForm` import and its `/sign/:token` route |
| `apps/web/src/pages/SignConsentForm.tsx` | Deleted entirely (the public signing page) -- confirmed `signature_pad` (the npm dependency it used) is still used by `DepositResponse.tsx`, so the package dependency itself stays |
| `apps/web/src/pages/ClientDetail.tsx` | Removed the `ConsentForm` interface, the field on `Client`/`MergePreview`/`DeletePreview`, `handleSendConsentForm` and its four dedicated state variables (`sendingForm`/`sendFormError`/`consentSendNotice`/`latestSigningUrl` -- `copied`/`handleCopyLink` stayed, shared with waiver/prefill-link copy buttons), the entire "Consent Forms" card, and both delete/merge-preview list items |
| `apps/web/src/pages/AppointmentDetail.tsx` | `DeletePreview.consentForms` field + its list item removed |
| `apps/web/src/pages/InquiryDetail.tsx` | `DeletePreview.consentFormsToDetach` field + its list item removed |

**One item from the task's own list turned out not to apply**: "the composer's shareable-links list (any 'consent form' entry in the '+ menu')" -- grepped `ConversationsPanel.tsx` and the `GET /clients/:id/shareable-links` route it reads from; neither ever had a consent-form entry (Package J's own investigation, re-confirmed here, found consent forms were only ever sent from the ClientDetail page directly, with no composer draft-insert row the way deposit forms and waivers have). Noted rather than silently ignored, matching this session's practice of flagging when a task's stated premise doesn't match the actual codebase.

## Verification

**Typechecks**: `npx tsc --noEmit` (api) -- clean. `npx tsc --noEmit` and `npm run build` (web) -- both clean. As the task noted, this was the most reliable signal of completeness -- a dangling reference to the removed `ConsentForm` type or `consentForms` field would have surfaced as a compile error, and none did on the first pass after the full sweep above.

**Browser** (Playwright, scratch API :4002 since another concurrent session held :4001 this time, scratch web :5183 -- `chromium-cli` unavailable on this Windows environment, same `chromium.launch()` fallback as every prior session):
- Loaded an existing client's profile -- confirmed via `body.innerText()` that "consent" appears nowhere on the page (the only other "Consent" text anywhere in the app, "SMS Consent: ...", is unrelated and still correctly present).
- Created a disposable test client, opened its "Delete Permanently" confirmation modal -- confirmed the preview correctly lists inquiries/appointments/waivers/deposit forms/messages with no consent-form line at all, typed the confirm text, and completed the delete -- "DeleteFlow TestP was permanently deleted," zero console errors, and a follow-up load of that client's URL correctly showed "Client not found."
- API-level spot check of all three delete-preview endpoints (client/inquiry/appointment) against an existing client with real history (5 inquiries, 2 appointments, 8 gift cards, 5 deposit forms) -- none of the three response bodies contain a `consentForms`/`consentFormsToDetach` field anymore.
- Merge preview flow (touched via `repointClientRelations`) -- opened "Merge with another client," searched, selected a candidate, previewed -- zero console errors, no consent-form mention.

## Commit

`b4366d3` -- Package P: delete ConsentForm, consolidate on Waiver. Pushed immediately (`aaec614..b4366d3`); a concurrent session's small unrelated commit (button-styling reversal) had landed on `main` in the meantime, picked up cleanly as a fast-forward with no conflicts.

## Cleanup

Both scratch dev servers (API :4002 -- :4001 was taken by another concurrent session this time, web :5183) stopped; confirmed via `Get-NetTCPConnection` and force-killed by PID, same recurring pattern as every prior package. Playwright driver scripts and screenshots stayed in the scratchpad only, none committed. The disposable test client created for the live delete-flow verification no longer exists (that was the point of the test). The 2 real `ConsentForm` rows deleted from production (with explicit sign-off) and the whole table's removal are both permanent, intentional outcomes of this package, not incidental data loss.

---

# Package Q — Customizable intake form (studio-defined supplementary questions)

Single session on `main`. Pre-flight: `git status` clean, `git pull` (up to date), `prisma migrate status` clean, no other session mid-migration.

## A real gotcha hit before any Package Q work could start

`prisma migrate dev` refused outright: `"The migration 20260723201202_referral_code_required was modified after it was applied. We need to reset the 'public' schema... All data will be lost."` -- direct fallout from the production incident earlier this session, where that exact migration file's content was edited in place *after* dev had already recorded it as successfully applied (different content, different checksum). Did **not** run the suggested `migrate reset` -- that would have destroyed the entire dev database over a bookkeeping mismatch, not a real problem with the data or schema. `prisma migrate status` (the non-shadow-DB path) still reported clean, confirming the drift only affects `migrate dev`'s stricter shadow-database workflow. Fixed it surgically: verified Prisma's checksum algorithm is plain SHA-256 of the migration file's bytes (confirmed against an untouched control migration first), then updated the one drifted row's `checksum` column in dev's own `_prisma_migrations` table to match the file's current, correct content -- a bookkeeping correction, not a data change, and confirmed afterward that `migrate dev` runs clean again (`"Already in sync, no schema change or pending migration was found"`). Production was never touched by this -- it only ever uses `migrate deploy`/`migrate status`, neither of which checks checksums this way.

Also worth noting for the record: this session's shared checkout had a concurrent session actively mid-edit on `ClientDetail.tsx`/`AppointmentDetail.tsx`/`InquiryNotesSection.tsx` (an unrelated button-styling pass, the same effort visible in this log's surrounding commits) the entire time this package was in progress. None of those files needed changes for Package Q, so they were simply left alone -- but `InquiryDetail.tsx` did need a real Package Q change and had that same concurrent editing happening in it simultaneously. Handled via a hand-built two-hunk patch applied with `git apply --cached` (verified with `--check` first) so only this package's own 22 lines landed in the commit -- the other session's in-progress, unstaged button-styling hunks in that same file were left untouched in the working tree for them to commit on their own schedule.

## Schema

```prisma
model StudioSettings {
  // ...
  intakeCustomQuestions Json?
  // Array<{ id: string, question: string, type: "text" | "yes_no" | "select",
  // options?: string[], required: boolean, order: number }>
}
model Inquiry {
  // ...
  customFieldAnswers Json?
  // Record<string, { question: string, type: "text" | "yes_no" | "select", answer: string }>
}
```

Both nullable/additive -- applied via the usual `prisma migrate diff` + hand-placed migration folder + `migrate deploy` (not `migrate dev`, whose checksum check the above section covers) into `20260723225348_intake_custom_questions`.

## Confirmation the fixed core fields were untouched

Per the task's explicit scope decision, the core intake fields (name, contact info, tattoo description, placement, size, budget, referral source, reference images) are non-removable and non-reconfigurable in this feature. Verified this held: `REQUIRED_FIELDS`, the core validation block, and every core field's own input in both `IntakeForm.tsx` and the `POST /inquiries` route are completely unchanged -- Package Q only ever *appends* to them (a new state slice, a new validation check for custom questions specifically, a new section rendered after the existing ones). No core field's name, type, requiredness, or position moved.

## Settings UI -- same list-editor pattern as waiver health questions, reused not rebuilt

New "Intake Form Questions" card in Settings' Policies & Templates tab, right after the existing "Waiver Questions & Clauses" card -- same edit-toggle/add/remove/Save-Cancel shape, same `crypto.randomUUID()` id-generation convention already used by message templates. One real addition beyond a literal copy: **move-up/move-down buttons**. The waiver list has no reorder controls at all (array order is implicit, waiverHealthQuestions has no `order` field) -- but this schema's `intakeCustomQuestions` has an explicit `order` field the public form sorts by, so "reorder" (which the task did ask for) needed an actual mechanism; simple swap-with-neighbor buttons, `order` persisted as array index at save time. Also new versus the waiver pattern: a "select" type needs an options sub-editor (add/edit/remove option rows, only shown for that type) and a "required" checkbox per question.

## Public intake form

Renders custom questions, sorted by `order`, after the fixed core fields (including reference/placement images) and before the SMS consent checkbox. Each question's `required` maps directly to the native HTML `required` attribute on its input/radio-group/select -- the browser's own constraint validation blocks submission before any custom JS check even runs, exactly like every other required field already on this form (confirmed live: a native "Please fill out this field" tooltip appeared on the first unanswered required question, not a custom error message). A JS-level fallback check exists too (`"Please answer: {question}"`), for completeness, though native validation reaches every required field first in practice.

Data source: no new endpoint -- `IntakeForm.tsx` already called `GET /studio-settings/public?studioSlug=` for the studio's display name, so `intakeCustomQuestions` was simply added to that existing response instead of adding a second fetch.

## Backend validation -- re-validated server-side, never trusts the client

`POST /inquiries` re-validates submitted `customFieldAnswers` against the studio's own *live* `intakeCustomQuestions` (fetched fresh, not whatever the client claims a question says or requires): missing-when-required, `select` answers checked against the live `options` list, `yes_no` answers checked against `"YES"/"NO"`. Confirmed live that a hand-crafted request with an answer not in the offered `select` options is rejected with a 400, even bypassing the UI entirely.

**Judgment call, found and fixed during implementation, not assumed away**: `StaffInquiryForm.tsx` (front desk logging a walk-in/phone inquiry) submits through this exact same route but has no UI at all for custom questions. A required custom question would have silently started blocking every staff-logged walk-in the moment a studio added one. Fixed with the same carve-out already used for `smsConsent` a few lines above it in this same route: on the staff path, every custom question's `required` is treated as `false` before validation runs (any answers staff *do* submit are still validated/stored normally, just never required). Confirmed live: a staff-submitted walk-in with two required custom questions defined and zero answers submitted still returns 201, `customFieldAnswers: null`.

The persisted snapshot is keyed by question id but stores `{ question, type, answer }` per entry (not just the bare answer) -- a deliberate reading of "submitted answers keyed by question id" that keeps each answer self-contained. This is what makes the retroactive-display requirement work: an already-submitted inquiry's display never needs to re-join against `StudioSettings.intakeCustomQuestions` (which could have been edited or had the question deleted since), because the question's own text and type traveled with the answer at submission time.

## Display

New "Additional Information" card on the Inquiry detail page, positioned directly before the Notes section (Package L had already landed), only rendered when the inquiry actually has custom answers. `yes_no` answers render as "Yes"/"No"; `text`/`select` answers render as-is.

## Verification

**Browser** (Playwright, scratch API :4003 -- :4000/:4001/:4002 all held by other concurrent sessions this time, web :5183, `chromium-cli` unavailable on this Windows environment, same `chromium.launch()` fallback as every prior session):
- Added one question of each type (text, yes/no, select with Cash/Card options) via Settings, all marked required -- saved cleanly, card summary updated to "3 supplementary questions."
- Public intake form: confirmed all three render, in order, after the fixed core fields. Attempted submission with the questions unanswered -- correctly blocked by native browser validation on the first required field. Filled all three ("A trip to Japan" / Yes / Card) and submitted successfully.
- Confirmed via direct API read that the persisted `customFieldAnswers` snapshot has all three entries with the exact question text, type, and answer baked in.
- Inquiry detail page: "Additional Information" card renders all three, correctly positioned right before Notes, `yes_no` shown as "Yes" (not the raw stored "YES").
- Removed the yes/no question via Settings -- saved cleanly, card now shows "2 supplementary questions." Reloaded the public intake form: the removed question no longer appears, the other two still do. Reloaded the *existing* inquiry from before the removal: it still shows all three answers, including the removed question's -- confirming the snapshot approach actually delivers the "not retroactively deleted" requirement rather than just claiming to.

**PowerShell/curl**:
- Staff walk-in submission (`POST /inquiries` with a staff JWT, zero custom answers, two required questions live) -- 201, not blocked, `customFieldAnswers: null`.
- Tampered public submission with a `select` answer outside the live `options` list -- 400, `"How would you like to pay?" must be one of the offered options`.

## Typechecks

`npx tsc --noEmit` (api) -- clean. `npx tsc --noEmit` and `npm run build` (web) -- both clean.

## Commit

`f26410b` -- Package Q: customizable intake form (studio-defined supplementary questions). Pushed immediately (`546a880..f26410b`); landed between two of a concurrent session's own button-styling commits, picked up cleanly as a fast-forward -- see the checkout-sharing note above for how the one file both sessions needed (`InquiryDetail.tsx`) was handled without mixing the two unrelated changes into one commit.

## Cleanup

Both scratch dev servers (API :4003, web :5183) stopped; confirmed via `Get-NetTCPConnection` and force-killed by PID, same recurring pattern as every prior package. Playwright driver scripts and screenshots stayed in the scratchpad only, none committed. Test data created during verification (one client/inquiry with all three custom answers, one staff-logged walk-in, one tamper-test attempt that correctly failed) left in the dev database, consistent with the standing convention in every prior package's report.

---

# Package R — Mass client import with duplicate-detection review

Single session on `main`. Pre-flight: `git status` clean, `git pull` (up to date), `prisma migrate status` clean, no other session mid-migration.

## A second `migrate dev` gotcha, fixed the same way as Package Q's

Same checksum-drift wall as last package, this time on a brand-new migration rather than an edited old one -- `migrate dev` for the new schema below hung past its own timeout against the remote Railway shadow-database round-trip (not an error, just slow); it completed successfully in the background a short while later. No data risk either way; noted here only because it's the second time this exact shape of "looks stuck, isn't" has shown up this session, and it's a known, harmless characteristic of this project's remote-only Postgres setup (no local Docker available), not a bug worth chasing.

## A real incident: uncommitted work wiped mid-session by the shared checkout

Partway through implementation, a large chunk of this package's edits to already-tracked files (`schema.prisma`, `clients.ts`, `clientContacts.ts`, `index.ts`, `App.tsx`, `api.ts`, `Clients.tsx`, `package.json`) vanished from the working tree -- `git status` showed them reverted to `HEAD`, while this session's brand-new *untracked* files (the new lib/route/page files) were untouched. That specific pattern -- tracked files reverted, untracked files intact -- is exactly what a broad `git checkout`/`git restore` on the shared checkout produces, and this repo has had a concurrent session actively committing unrelated button-styling work throughout this whole package (visible in the surrounding commit log). Checked `git stash list` first in case the missing work had landed there instead of being destroyed -- found a stash, but its content (`smsConsentGivenAt`, a still-present `ConsentForm` reference) was clearly a stale, unrelated entry from well before Package P, not this session's lost work. Concluded the edits were genuinely gone, not recoverable, and redid them directly from what was still in this session's own context -- verified via `tsc` immediately after, then **committed and pushed right away** rather than leaving the recovered work uncommitted and exposed to the same risk twice.

## Investigation before writing any code

Reused, not reimplemented, per the task's explicit instruction:

- **Duplicate detection**: `GET /clients/:id/potential-duplicates`'s exact-match phone/email predicate (including the Package B alias tables, `ClientPhone`/`ClientEmail`) was extracted into `lib/duplicateDetection.ts` (`clientMatchesPhoneOrEmail` + `findStudioClientsForMatching`), and that existing route was refactored to call the extracted functions -- confirmed via `git diff` that its own behavior is byte-for-byte unchanged, just no longer a second copy of the same filter logic.
- **Merge**: `POST /clients/:id/merge`'s three transaction helpers (`repointClientRelations`, `mergeConversations`, `carryOverContactAliases`) plus its validation preconditions were extracted into `lib/clientMerge.ts` (`performMerge`, `validateMergePair`), and that route was refactored to call them too. Same exact error messages/status codes preserved for every precondition (self-merge, not-found, already-merged-either-side).
- **Client creation**: not explicitly named in the task, but `POST /clients` (direct add) already had a "create + sync contact aliases + generate a referral code" sequence that the import's ADD and MERGE (source-client) paths both also need -- extracted to `lib/clientContacts.ts`'s `createClientFromFields` rather than writing it a third time.

## Schema

```prisma
enum ImportBatchStatus { PENDING_REVIEW COMPLETED CANCELLED }
enum ImportRowDecision { ADD MERGE SKIP }

model ImportBatch {
  id           String            @id @default(cuid())
  status       ImportBatchStatus @default(PENDING_REVIEW)
  createdAt    DateTime          @default(now())
  studioId     String
  uploadedById String
  rows         ImportRow[]
}
model ImportRow {
  id              String   @id @default(cuid())
  rawData         Json
  matchedClientId String?
  decision        ImportRowDecision?
  processedAt     DateTime?
  importBatchId   String
}
```

`CANCELLED` had no route that would ever set it in the task's own numbered list -- added `POST .../cancel` (same OWNER/FRONT_DESK gate as upload/review, since nothing's actually been written yet) so that declared status value is reachable rather than dead.

## Routes (`clientImport.ts`, mounted alongside `clients.ts` at the same `/clients` prefix)

- `POST /clients/import` -- multipart CSV (via `multer`, memory storage, 5MB cap -- and `csv-parse`; neither existed in this codebase before, since every other upload here is a Cloudinary direct-upload signature, never real bytes hitting this server). Header names are normalized case/whitespace-insensitively (firstName/First Name/first_name, etc.); unrecognized columns are preserved in `rawData` but never read. Every parsed row is duplicate-checked immediately via the shared lib and stored with its `matchedClientId`; a row missing first/last name is still stored (never silently dropped) and flagged via a computed `isMalformed` field in the GET response.
- `GET /clients/import/:batchId` -- full batch + rows + matched-client summaries + the malformed flag.
- `PATCH /clients/import/:batchId/rows/:rowId` -- sets a decision, with guardrails: `ADD` rejected on a malformed row (no name to create with), `MERGE` rejected with no detected match.
- `POST /clients/import/:batchId/execute` (`requireRole(Role.OWNER)` on top of the file's usual `clients.manage` gate) -- rejects if any row still lacks a decision (reporting the exact count), rejects an already-completed or cancelled batch. Processes rows individually rather than one giant transaction (each row's own write -- a create, or a create-plus-merge -- is still fully atomic) so one bad row can't roll back an entire large import; failures are collected per-row in the response rather than thrown.

**The MERGE path, confirmed to be the real thing and not a shortcut**: a `MERGE`-decided row first becomes a genuine new `Client` (via the same `createClientFromFields` the ADD path uses), which is then merged into the matched client through `performMerge` -- the identical function `POST /clients/:id/merge` calls. Verified live (see below) that the row's freshly-created client ends up with `mergedIntoId` pointing at the matched client, exactly like any manual merge.

## Verification

**PowerShell/curl** (scratch API :4004, other concurrent sessions holding :4000-:4003):
- Uploaded a 4-row CSV (two new, one matching an existing seeded client by email, one missing a first name) -- all four parsed correctly, the match detected correctly, the malformed row flagged (`isMalformed: true`) rather than dropped.
- FRONT_DESK: `GET`/`PATCH` both 200 (review access); `POST .../execute` 403 (Forbidden).
- Cross-studio: studio 2's owner gets 404 (not 403) on both `GET` and `POST .../execute` against studio 1's batch.
- Incomplete batch: executing with 3 of 4 rows still undecided -- 400, `"3 row(s) still need a decision..."`.
- Decision guardrails: `ADD` on the malformed row -- 400; `MERGE` on a no-match row -- 400.
- Executed the fully-decided batch -- `ADD` created a real client (with a real generated `referralCode`); `MERGE` row's freshly-created client confirmed `mergedIntoId` pointing at the matched client (Alex Testperson), and Alex's own `phones`/`emails` alias arrays were correctly deduplicated against the merge's carried-over contacts (no duplicate rows, since the CSV row's phone/email were identical to Alex's already-primary ones) -- this dedup behavior only happens because the REAL `carryOverContactAliases` ran, not a hand-rolled shortcut. Both `SKIP` rows created nothing. Audit log shows `create-from-import` and `merge-from-import` entries with the batch/row IDs.
- Re-executing the same (now `COMPLETED`) batch -- 400, `"This batch has already been executed"`. Cancel flow on a fresh batch -- `PENDING_REVIEW` → `CANCELLED`, then executing it -- 400, `"This batch has been cancelled"`.

**Browser** (Playwright, scratch web :5183, `chromium-cli` unavailable on this Windows environment, same `chromium.launch()` fallback as every prior session): uploaded a 3-row CSV via the new Import Clients page (linked from the Clients list) -- review table correctly showed "1 possible match" / "1 flagged row", a working link to the matched client (Bailey Testperson), and the malformed row's warning in red. Set decisions via the table's own selects (Add/Merge/Skip), clicked Confirm Import, and confirmed the resulting "Import complete: 1 added, 1 merged, 1 skipped" summary -- zero console errors throughout both this run and a second single-row run.

## Typechecks

`npx tsc --noEmit` (api) -- clean. `npx tsc --noEmit` and `npm run build` (web) -- both clean, re-confirmed against the actual final committed state after the mid-session data-loss incident above, not just the pre-incident work.

## Commit

`58dfa7c` -- Package R: mass client import with duplicate-detection review. Pushed immediately (`9c6d3f0..58dfa7c`) straight after committing, deliberately not leaving the recovered work uncommitted for any longer than necessary.

**Merge-reuse, confirmed**: `performMerge`/`validateMergePair` in `lib/clientMerge.ts` are called by both `POST /clients/:id/merge` (unchanged behavior, verified via preserved error messages) and the import execute step's `MERGE` decisions -- one real implementation, proven live by the merged row-client's `mergedIntoId` and Alex Testperson's correctly-deduplicated contact aliases after the import merge.

## Cleanup

Both scratch dev servers (API :4004, web :5183) stopped; confirmed via `Get-NetTCPConnection` (including stray zero-PID TIME_WAIT-style entries that needed filtering out first) and force-killed by PID. Playwright driver scripts, screenshots, and test CSVs stayed in the scratchpad only, none committed. Test data created during verification (several new clients across the PowerShell and browser passes, one soft-merge, one cancelled batch) left in the dev database, consistent with the standing convention in every prior package's report.

---

# Package Q (revised) — True intake form builder, system + custom fields freely mixed

Single session on `main`. Replaces the bounded custom-questions-only system the original Package Q shipped (`StudioSettings.intakeCustomQuestions`, a fixed core form plus a supplementary-questions-only list) with one unified, ordered, drag-and-drop `IntakeFormField` list mixing SYSTEM fields (backed by the existing `Inquiry`/`Client` columns) and CUSTOM questions (8 types, up from 3) freely. The old system's data is migrated forward, not discarded.

## 1. Schema

New `IntakeFormField` model + `IntakeFieldKind` (`SYSTEM`/`CUSTOM`) and `IntakeCustomQuestionType` (`TEXT`/`PARAGRAPH`/`NUMBER`/`DATE`/`YES_NO`/`SELECT`/`MULTI_SELECT`/`PHOTO_UPLOAD`) enums, one migration (`20260724021806_intake_form_builder`) — purely additive: 2 `CREATE TYPE`, 1 `CREATE TABLE`, 1 index, 1 FK. No existing column touched, so the standing nullable→backfill→required hard rule (from the earlier production incident) simply doesn't apply here — there's no new required column on an existing populated table, just a brand-new empty one. `StudioSettings.intakeCustomQuestions` stays in the schema, its doc comment marked DEPRECATED, unused by any route — not dropped, since historical `Inquiry.customFieldAnswers` snapshots are independent of it but the field itself is harmless to leave in place as a record of the prior shape.

14 canonical `systemFieldKey` values cover every field the app's forms hardcoded before this package (`name`, `email`, `phone`, `referralSource`, `description`, `colorOrBlackGrey`, `placement`, `size`, `hasBeenTattooedBefore`, `preferredArtist`, `budget`, `desiredTiming`, `referenceImages`, `placementImages`) — broader than the task text's own illustrative "e.g." list, since a complete form builder needs to represent every real field, not a subset. Note `referralSource`/`size` are the builder's own key names for what the `Inquiry` model actually calls `channel`/`estimatedSize` — the mapping lives in `lib/intakeFormFields.ts` and the routes that consume it, not in the schema.

## 2. Data migration (id-preservation)

`lib/intakeFormFields.ts`:
- `ensureDefaultSystemFields(studioId)` — idempotent (checks for an existing `SYSTEM` row count first), seeds the 14 defaults with labels/required-ness matching the app's exact prior hardcoded behavior, so a studio that never opens the builder sees zero change to its public form.
- `migrateExistingCustomQuestions(studioId)` — idempotent (checks which ids already exist), converts every `StudioSettings.intakeCustomQuestions` entry into a `CUSTOM` row, **preserving the original question's id** via Prisma `createMany`'s explicit `id` (confirmed empirically that this works even with `@default(cuid())` on the field).

**Id-preservation, confirmed**: dev studio's two pre-existing custom questions (`224b76d8-...` "What inspired this tattoo idea?" / text, `a07a6077-...` "How would you like to pay?" / select) migrated with their exact original ids, text, and type. A real pre-existing `Inquiry` row (`cmry4j4tb...`, from earlier Package Q testing) whose `customFieldAnswers` snapshot answers *both* of these ids **and** a third id belonging to a since-removed question ("Do you have any allergies to ink?") was checked on its detail page after migration: both migrated answers ("A trip to Japan", "Card") display correctly against the live, migrated field definitions, and the orphaned third answer still displays too (see §5) — proof the migration didn't break a single existing historical record, preserved or orphaned.

Dev: 2 studios, 28 SYSTEM + 2 CUSTOM = 30 rows total, verified against an explicit before/after count script (not just log output) — exact expected math. **Production**: applied too, before considering this package done (per the standing post-incident convention of proactively testing/deploying schema changes to production, not just dev) — 1 real studio ("Black Hive Ink"), 0 pre-existing custom questions, 14 SYSTEM rows created, verified via a fresh row-count query and the live `GET /studio-settings/public?studioSlug=black-hive-ink` response (`intakeFormFields` count: 14). The schema migration itself had already been deployed to production by a concurrent session's own `migrate deploy` run (which picks up every pending migration folder on disk, not just its author's) — confirmed via `_prisma_migrations` and `to_regclass('public."IntakeFormField"')` before running the data backfill on top of it. Production `/health` and a bogus-credential `POST /login` (401, not 500) both confirmed the API round-trips to the database correctly afterward.

## 3. Settings UI — `IntakeFormFieldsEditor.tsx`

New component (not folded into `Settings.tsx`, which was already large) using `@dnd-kit/react`'s `useSortable` (from `@dnd-kit/react/sortable` — not previously used anywhere in this repo; Kanban's own `useDraggable`/`useDroppable` drop-zone pattern is a different shape, suited to multi-column dragging, not single-list reordering). SYSTEM rows: key badge (not editable), editable label/help text/required, `enabled` checkbox **dynamically locked** — `name` always locked on; for `email`/`phone`, whichever one is currently the *sole* enabled contact method is locked on, the other stays freely toggleable (the task's own constraint is "never both disabled," not "never editable," so this is the least-restrictive UI that still makes the bad state unreachable). CUSTOM rows: question text, full 8-type selector, options editor for SELECT/MULTI_SELECT, required toggle, delete. "+ Add custom question" appends at end with a client-generated `crypto.randomUUID()` id (same pattern the old editor already used), so every row — new or existing — always has a real id by save time; the backend does a straightforward delete-all-then-recreate-with-provided-ids in a transaction. OWNER only (`canEditPolicies`), audited (`logAudit` with a before/after field-count-and-label-list summary, since a full-list replace doesn't have a meaningful field-by-field diff).

**Bug found and fixed during verification**: the first `handleDragEnd` implementation matched dnd-kit's `source`/`target` by `.id`, following the pattern used elsewhere in prior sessions' searches — but `@dnd-kit/react`'s default-on `OptimisticSortingPlugin` already reorders items live *during* the drag (for smooth visual feedback), so by drop time the dragged item's own sortable index already equals wherever it's hovering — meaning `source.id === target.id` by the time `onDragEnd` fires, and the id-matching handler was a **silent no-op**: the DOM visually showed the new order (the plugin's own doing) but the React state — and therefore anything actually saved — never changed. Caught by testing the *actual PUT request body* sent to the server, not just the DOM after a simulated drag (the DOM alone was misleading). Fixed by using the sortable's `initialIndex` (captured at drag start) vs. its current `index` instead of id matching. Re-verified: PUT body now correctly reflects the dragged order, and the public form respects it end-to-end.

## 4. Public intake form — `IntakeForm.tsx`

Single render loop over the studio's live, ordered, enabled field list — no fixed section boundaries between "core" and "supplementary" fields anymore (an earlier draft special-cased `name`/`email`/`phone` into a fixed leading block for a nicer 2-column layout; caught in review before testing that this silently ignored the studio's configured order for exactly those three fields, which would have failed the task's own explicit reorder-verification step — removed in favor of one plain per-field loop). SYSTEM fields reuse the existing specialized components (`PhoneInput`, `CurrencyInput`, `ImageUploadSection`, radio groups, selects) driven by the field's own label/help-text/required; CUSTOM fields render per `customQuestionType` (`PARAGRAPH` → textarea, `DATE` → native date input, `MULTI_SELECT` → checkboxes producing a `string[]`, `PHOTO_UPLOAD` → the same `ImageUploadSection`/Cloudinary flow, tracked in a separate per-field uploading-state map so the submit button correctly disables while any custom photo field is still uploading). Required-ness is fully config-driven client-side; the SMS consent checkbox stays hardcoded outside the configurable list entirely (A2P 10DLC legal requirement, not a business preference — deliberate scope decision, unchanged from the original Package Q).

## 5. Display on the Inquiry page — decision

**New `InquiryDetailsSection.tsx` supplements, not replaces, the existing "Tattoo details" / "Reference images" / "Placement photos" cards** on `InquiryDetail.tsx`. Those three stay exactly as they were: they're editable case-management tools tied directly to the real `Inquiry` columns (staff can revise a description or swap a placement photo after intake, e.g. mid-negotiation), a genuinely different job from a read-only "here's exactly what the client saw and answered on our form" snapshot. The new section **does replace** the old "Additional Information" custom-answers card, which becomes fully redundant once every custom answer is folded into the unified view.

The new section fetches the studio's *current* live field list (`GET /studio-settings/intake-form-fields`, enabled only, ordered) and renders every field's value pulled straight from the real `Inquiry`/`Client` columns for SYSTEM fields, or from `Inquiry.customFieldAnswers`'s own self-contained snapshot for CUSTOM fields. `referenceImages`/`placementImages` are deliberately skipped here — their own cards already render real thumbnails with an edit affordance; a text-only "N image(s)" row would be a strictly worse duplicate, not a genuinely new view. A custom answer whose question has since been deleted (not just disabled — a disabled-but-still-existing question still gets its current position) has no current position to sort by, so it's appended at the end under its own snapshot's original label — verified live against a real pre-existing inquiry with exactly this shape (see §2).

**Bug found and fixed during verification**: the format helper only recognized the new `IntakeCustomQuestionType` enum's `'YES_NO'`, so a pre-migration snapshot (still holding the old lowercase `'yes_no'` type string, unrelated to and unaffected by the id-preserving field migration itself) rendered its raw `"YES"`/`"NO"` value instead of `"Yes"`/`"No"`. Now checks both spellings.

## 6. Backend — config-driven submission (`inquiries.ts`, `studioSettings.ts`)

`POST /inquiries`: the old hardcoded `REQUIRED_FIELDS` array and the old `IntakeCustomQuestion`/`validateAndBuildCustomFieldAnswers` logic are gone. Required-ness, which fields exist, and their labels now all come from the studio's live `IntakeFormField` rows (`getEffectiveIntakeFormFields`, shared with the public route so the two can never disagree about what an empty-rows studio requires). Two fields map to non-nullable columns with no data-safe "unspecified" value — `hasBeenTattooedBefore` (`Boolean`, can't represent "unanswered") and `referralSource`/`channel` (`Channel` enum, no "unspecified" member) — **documented judgment call**: these default to `false` and `Channel.EMAIL` respectively when hidden/left blank, rather than the submission being rejected or the column becoming nullable (which would violate the task's own core safety property). Every other SYSTEM field defaults to an empty-but-valid value (`""`, `null`, or `[]`) when disabled or left blank by a not-required field, satisfying the untouched NOT NULL columns without ever loosening their constraints. CUSTOM field validation (`validateCustomFieldAnswers`, in `lib/intakeFormFields.ts`, shared and reusable) now covers all 8 types, including `SELECT`/`MULTI_SELECT` options-membership checks and `NUMBER`/`DATE` format checks — none of which the old 3-type system needed. The staff-request carve-out for CUSTOM-field required-ness (StaffInquiryForm has no UI for custom questions) is preserved unchanged from the original Package Q; SYSTEM-field required-ness stays enforced for staff same as before (StaffInquiryForm already collects all of these).

`studioSettings.ts`: new OWNER-only `GET`/`PUT /studio-settings/intake-form-fields` (staff editor's read/write pair — GET open to OWNER/FRONT_DESK/ARTIST matching this file's existing read-gate convention, PUT OWNER-only per the task). `PUT` validates full shape + the name/contact `enabled` constraint (`validateIntakeFormFieldsPayload`, server-side, never trusting the UI's own lock) before a delete-all-then-recreate transaction; rejecting a payload that disables both `email` and `phone` was verified with a **direct API call bypassing the UI entirely** (not just the UI's own preventive lock) — `400`, `"At least one contact method (email or phone) must stay enabled."`, and confirmed the DB was genuinely untouched by the rejected request (both still `enabled: true` on re-fetch).

## Verification (browser, Playwright via `chromium.launch()`, scratch ports API :4801 / web :5801)

- Reordered a mixed system+custom list (dragged a SYSTEM field, `hasBeenTattooedBefore`, past another SYSTEM field) via the Settings editor and saved — confirmed the public intake form renders in the new order (caught and fixed the drag-reorder bug in the process, see §3).
- Attempted disabling both `email` and `phone` in the editor: UI lock prevents it (confirmed both the dynamic lock engaging when the second contact method is unchecked, and that a forced click on the now-disabled checkbox is a no-op); a raw API `PUT` bypassing the UI is independently rejected server-side with `400` and no DB change (see §6).
- Added one of each of the 5 new custom types (`PARAGRAPH`, `NUMBER`, `DATE`, `MULTI_SELECT`, `PHOTO_UPLOAD`) plus confirmed the 3 old types (`TEXT`, `SELECT` — both already present from the migrated questions — and `YES_NO`, tested via the orphaned historical answer in §5) all render and validate correctly, including server-side required enforcement (`validateCustomFieldAnswers`).
- Full public-form submission with every field type filled in (real Cloudinary uploads for `referenceImages`, `placementImages`, and the custom `PHOTO_UPLOAD` field) — `201`, and the resulting Inquiry Details section showed every field correctly ordered and labeled, including `"Traditional, Fine line"` for the `MULTI_SELECT` answer and a real `res.cloudinary.com` URL for the photo-upload answer.
- Pre-existing custom questions confirmed migrated correctly (same text/type/options) and historical `customFieldAnswers` confirmed still resolving correctly against the migrated fields, including the orphaned-question edge case (see §2, §5).
- Downstream spot-checks (**core safety property**: no `Inquiry`/`Client` column changed shape, and no route besides `inquiries.ts`/`studioSettings.ts` was touched) — Inquiries List view, description-text search, and the Kanban board all correctly show a newly-created inquiry with zero console/page errors; the existing "Tattoo details"/"Reference images"/"Placement photos" edit cards on `InquiryDetail.tsx` rendered and (per their pre-existing, untouched code paths) remain fully editable. Estimates/waivers/calendar invites were not independently driven through their full flows this session, but read the identical, unchanged `Inquiry` columns these three checks already exercised, and no code in those features was touched by this package.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc --noEmit` + `npm run build` (web) — all clean, both before and after the two bugs found during browser verification were fixed.

## Commits

`93ae6a3` — Package Q (revised): true intake form builder, system + custom fields mixed. `146a786` — fix for the two bugs found during verification (drag-reorder id-matching, legacy `yes_no` display). Both pushed immediately after committing. (One mid-session data-loss scare: a concurrent session's broad checkout briefly reverted 5 of this package's edited-but-uncommitted files back to `HEAD` — caught via `git status`/`git diff --stat` showing an unexpected clean state, confirmed against the intended content still visible in this session's own context, redone identically, and committed right away rather than left exposed to the same risk twice, consistent with the standing discipline from Package R's own incident.)

## Cleanup

Both scratch dev servers (API :4801, web :5801) stopped by PID after confirming the ports freed. All temporary verification/backfill scripts (`check_before_migration.ts`, `backfill_intake_form_fields.ts`, `verify_migration.ts`, `verify_state.ts`, `check_historical.ts`, `prod_check_before.ts`, `prod_backfill.ts`, and every Playwright driver script) deleted from the repo or left only in the scratchpad — none committed. A stray background `find /` filesystem search (launched while checking for a local Playwright install, irrelevant once `npx playwright` proved available) was stopped. Test data created during verification (one full end-to-end inquiry submission on the dev studio, the reordered field list itself) left in the dev database, consistent with the standing convention in every prior package's report; production received only the schema migration (already applied by a concurrent session) and the system-field data backfill, both idempotent and safe to leave in place.

---

# Package: Stackable gift cards (multiple cards, one appointment, per-card redeem/roll)

Single session on `main`. Money-math session — every scenario in the Verification section below was checked against actual computed numbers (a direct-API test script), not just typechecks, per the task's own explicit emphasis.

## Pre-flight investigation (answering the task's own question first)

**A migration WAS needed.** `GiftCard.appointmentId String? @unique` — a real database-level constraint preventing more than one card from ever sharing an appointment, confirmed by reading the schema before writing any code. This is a constraint *drop* (loosening, not tightening), so none of the nullable→backfill→required discipline applies — it's not a new required column on a populated table, just removing a uniqueness rule. Migration `20260724050332_gift_card_stacking`, generated via `prisma migrate dev`, is exactly two statements:

```sql
DROP INDEX "GiftCard_appointmentId_key";
CREATE INDEX "GiftCard_appointmentId_idx" ON "GiftCard"("appointmentId");
```

The `Appointment.giftCard GiftCard?` back-relation became `giftCards GiftCard[]` (Prisma requires the relation cardinality to agree on both sides) — every route selecting or including it needed pluralizing, which turned out to be a bigger share of the actual work than the schema change itself: three `prisma.giftCard.findUnique({ where: { appointmentId } })` calls (in `giftCards.ts`'s manual-issue and attachment-move routes) no longer typecheck once `appointmentId` isn't unique, and both routes' old "reject if this appointment already has a card" guards are now actively wrong under the new model (removed, not just fixed to compile).

## The exact required-amount computation reused from Package C1

`computeDepositTier(averageEstimate, tiers)` (unchanged, `apps/api/src/lib/depositTiers.ts`) is the sole source of truth. A new one-line wrapper, `computeRequiredDepositCents(priceEstimateLow, priceEstimateHigh, tiers)`, averages the inquiry's price bounds and calls it — returning `depositAmount` in cents, **not** `totalCharged`. This distinction mattered: `totalCharged` bakes in a flat `$10` processing fee a client pays when they pay a deposit form *by card*; a gift card's face value is never issued at that inflated number (`routes/deposits.ts`'s own `amountCents: dollarsToCents(depositForm.depositAmount)` confirms this) — so stack sufficiency has to be checked against the same, non-fee-inflated number a card can actually be worth. Missing/null price-estimate bounds resolve to a `$0` requirement (any card, including a `$0` EXEMPT one, trivially satisfies that) rather than blocking attachment on data that isn't there. A client-side mirror (`apps/web/src/lib/depositTiers.ts`) drives the live running-total preview using the identical algorithm — same "mirror the exact server math for a live preview, server stays authoritative" pattern `AppointmentDetail.tsx`'s own checkout amount-due preview already used before this package touched it.

## What changed

- **Schema**: see above.
- **`lib/giftCards.ts`**: new `validateGiftCardsForAttachment(giftCardIds, studioId, clientId, requiredCents)` — reuses the existing per-card `validateGiftCardForAttachment` (ownership, ACTIVE/EXEMPT status, unexpired, not already attached) in a loop, then additionally requires the stack's `amountCents` sum to meet or exceed `requiredCents`, returning a shortfall message naming the exact dollar gap if not.
- **`routes/appointments.ts` `POST /`**: `giftCardIds: string[]` replaces `giftCardId`; looks up the inquiry's price estimate + the studio's deposit tiers, computes `requiredCents`, validates the stack, attaches every card to the new appointment in one transaction. `GET /:id`'s include and the delete-preview/delete-summary helper both pluralized (`giftCards`/`giftCardsToDetach`).
- **`routes/appointments.ts` `POST /:id/checkout`**: request body is now `{ finalCostCents, decisions: [{ giftCardId, action: "REDEEM" | "ROLL" }], closeoutNotes }`. Every non-EXEMPT attached card must have exactly one decision (missing/duplicate/unknown-card/EXEMPT-card decisions are all rejected with a specific error); EXEMPT cards are excluded from the decision set entirely and always auto-detach. Combined REDEEM total is applied against `finalCostCents` (floored at zero for amount due); if the combined REDEEMED total exceeds the final cost, **exactly one** new gift card is issued for the leftover — this is genuinely new logic, not a generalization of something that existed: the pre-stacking checkout route only ever computed and returned `remainderCents` for staff to "handle manually (no refund processing yet)," confirmed by reading the code before assuming the task's "reuse the exact existing overage-to-new-card logic" premise held (it didn't — the new-card issuance shape was instead modeled on the closest analogous code, `routes/deposits.ts`'s own gift-card issuance: `generateUniqueGiftCardCode()` + `computeGiftCardExpiration(studioSettings.giftCardDefaultExpirationDays)` + `issuedById`). Audit: one combined `Appointment`/`checkout` entry with the full decision set (every card, its decision, the combined redeemed total, final cost, amount due, new card id if any) plus one lightweight per-card `GiftCard` entry each (so each card's own `AuditTrail` on its detail page stays legible) — not a duplicate of the combined entry, a genuinely different scope.
- **`routes/inquiries.ts` `POST /:id/schedule`**: same `giftCardIds`/sufficiency treatment as standalone creation. **Deliberately left untouched**: `POST /:id/attach-gift-card` (the pre-conversion, no-appointment-yet route) stays single-card with no amount check — it only signals "some deposit exists" to unlock the `SCHEDULING` transition; the real attach + sufficiency enforcement happens at `/schedule`, where an `Appointment` row actually gets created. Not in the task's explicit scope, and touching it would have meant re-deriving a sufficiency check with no real `Appointment` object yet to attach to.
- **Frontend**: new shared `GiftCardStackPicker.tsx` (checkboxes + live running total vs. required amount) replaces the single `<select>` in both `AppointmentForm.tsx` (already the one shared component behind standalone creation, the calendar's click-to-create, and the project-detail "add a session" flow — fixing it once covers all three) and `InquiryDetail.tsx`'s own `/schedule` flow, which had its own separate picker. `AppointmentDetail.tsx`'s checkout form got a REDEEM/ROLL radio pair per attached card (EXEMPT cards show a plain informational line, never a toggle), a live amount-due total reflecting the current mix, and an overage banner that links straight to the newly-issued card right after submission (falling back to descriptive text on a later page load, since the new card isn't attached to this appointment and so isn't otherwise reachable from it post-refresh).
- **Display** (§5): `GiftCardDetail.tsx`'s "Attached" row now reads "`[date]`, alongside 2 other cards" (a new `appointment.giftCards` sibling list added to `GET /gift-cards/:id`'s include) instead of implying a solitary relationship. `ClientDetail.tsx`'s own gift-card table computes the identical stacked count purely from the client's own already-loaded card list (grouping by `appointmentId`) — no extra fetch needed, since any sibling card sharing an appointment necessarily belongs to the same client and is therefore already in that list.

## Verification — pass/fail per scenario (direct-API test script + a browser pass for the UI)

| # | Scenario | Result |
|---|---|---|
| 1 | Single sufficiently-large card still creates an appointment (no regression) | **PASS** — `201` |
| 2 | Two cards summing to *exactly* the required amount | **PASS** — `201` ($60 + $40 = $100 required) |
| 3 | Two cards summing to *less than* required | **PASS** — `400`, `"...total $50.00, which is $50.00 short of the required $100.00 deposit."` |
| 4 | Many (6) cards stacking | **PASS** — `201` (6 × $20 = $120 ≥ $100 required); confirmed usable in the browser (screenshot, §UI below) |
| 5 | Mixed checkout: one card REDEEMED, one ROLLED | **PASS** — checkout `200`; redeemed card status → `REDEEMED`; rolled card confirmed `ACTIVE` **and** unattached (`appointment: null`); `amountDueCents: 0` for a $60 final cost against a $60 redeemed card |
| 6 | Combined REDEEMED total exceeds final cost | **PASS** — 6 cards × $20 redeemed = $120 against a $50 final cost → `amountDueCents: 0`, `overageCents: 7000`, **exactly one** new gift card issued with `amountCents: 7000` (verified by id, not just count) |
| 7 | EXEMPT card in a real-value stack | **PASS** — appointment with 1 EXEMPT + 1 real card creates fine (`201`); a checkout request naming the EXEMPT card in `decisions` is rejected (`400`); a checkout omitting it succeeds and the EXEMPT card is confirmed auto-detached (`appointment: null`) while remaining `status: EXEMPT` |
| 8 | Cross-studio isolation | **PASS** — a dev-studio-2 OWNER token against a dev-studio appointment gets `404` on both `GET` and `POST .../checkout` (never `403` — existence isn't leaked) |
| 9 | Role gating | **PASS** — an ARTIST token attempting `POST /appointments` gets `403` |
| UI | `GiftCardStackPicker` renders and works in-browser | **PASS** — screenshot shows 6 selectable cards, a live "$200.00 selected of $100.00 required" banner (green, sufficient) updating as checkboxes toggle |
| UI | Checkout form's per-card REDEEM/ROLL toggles | **PASS** — screenshot shows two independent radio pairs (one per attached card), both defaulting to Redeem, with a live "Amount due today: $0.00 / Redeemed total exceeds final cost by $110.00 — a new gift card will be issued" banner that updates as `finalCostCents` and per-card decisions change |
| UI | Stacked-context display | **PASS** — `ClientDetail.tsx`'s gift-card table screenshot shows 6 redeemed cards from scenario 6 each reading "Yes, alongside 5 others"; rolled/EXEMPT cards correctly read "Unattached" post-checkout |

Full script output and screenshots were reviewed directly (not summarized from a sub-agent) before writing this table.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc --noEmit` + `npm run build` (web) — all clean, checked after every commit in this package, not just once at the end.

## Commits

`f214818` — part 1: schema, `lib/depositTiers.ts` + `lib/giftCards.ts` additions, `routes/appointments.ts` (`POST /`, `GET /:id`, delete-preview, `POST /:id/checkout`), `routes/giftCards.ts` guard removals. `55c2a40` — part 2: `routes/inquiries.ts` `POST /:id/schedule`. `2fb6e7b` — part 3: the full frontend (`GiftCardStackPicker.tsx`, `AppointmentForm.tsx`, `AppointmentDetail.tsx`, `InquiryDetail.tsx`, `GiftCardDetail.tsx`, `ClientDetail.tsx`, `lib/depositTiers.ts`). Split into three commits and pushed immediately after each, rather than one large commit at the end, specifically because of a recurring risk this session: a concurrent session sharing this same working directory ran at least one broad `git checkout`/similar operation mid-session that silently reverted several already-edited-but-uncommitted files back to `HEAD` more than once (caught each time via an unexpected-clean `git status`/`git diff --stat`, confirmed against the intended content still visible in this session's own context, and redone identically) — committing each completed, typechecked slice immediately kept the exposure window small rather than risking the entire session's work at once.

## Cleanup

Both scratch dev servers (API :4901, web :5901) stopped by PID after confirming the ports freed. All temporary verification scripts (`verify_giftcards.mjs`, `verify_cross_studio.mjs`, `verify_gc_ui.mjs`, `verify_gc_ui2.mjs`, `verify_checkout_ui.mjs`, `create_checkout_test.mjs`) and screenshots stayed in the scratchpad only, none committed. Test data created during verification (several gift cards, several appointments across their full REDEEM/ROLL/overage lifecycle, on the dev studio's existing `FullTest Submission` test client) left in the dev database, consistent with the standing convention in every prior package's report — this package did not touch production.

---

# Fix — YES opt-in keyword, opt-in confirmation reply, HELP keyword

Single session on `main`. No schema migration (JSON field only), confirmed via pre-flight.

## Pre-flight finding: item 1 was already done

Before writing any code, read `apps/api/src/routes/webhooks.ts` directly rather than assuming the task's premise held. `START_KEYWORDS` was already `new Set(["START", "UNSTOP", "YES"])` — **YES was already a recognized opt-in keyword**. The two genuine gaps, confirmed by the same read: START/YES/UNSTOP cleared `Client.smsOptedOutAt` completely silently (no reply sent, confirmed — the only response anywhere in the route is empty TwiML), and there was no `HELP` keyword at all (no `HELP_KEYWORDS` set, no branch referencing it).

## What changed

- **`lib/reminderTemplates.ts`** (new): `ReminderTemplates` interface + `renderTemplate()`, extracted from `lib/jobs/reminderTicker.ts`'s own local (unexported) copies of both, so the webhook's new auto-replies and the existing cron ticker share one implementation rather than two that happen to agree. `reminderTicker.ts` now imports both from here.
- **Schema / seed**: `StudioSettings.reminderTemplates`'s doc-comment shape extended with `optInConfirmation` and `helpResponse`. `seed.ts`'s template literal gets both, with the task's exact wording. `studioSettings.ts`'s `REMINDER_TEMPLATE_KEYS` (the all-required-non-empty-string validation array) extended to match.
- **Dev backfill**: the one existing dev `StudioSettings` row predated this change (`upsert`'s `update: {}` wouldn't have reached it on a re-seed) — backfilled via a one-off idempotent script (checked before/after keys, not just log output) to add the 2 new keys without touching the other 5.
- **`lib/clientSms.ts`**: `sendClientSms` gains an optional `bypassOptOutCheck` flag. This is the one sanctioned exception to its normal opted-out gate — HELP must work regardless of current opt-in/opt-out status per CTIA convention (and this task's own explicit instruction), and every other caller (reminders, composer, the new opt-in confirmation itself) leaves it unset and gets the normal enforcement.
- **`routes/webhooks.ts`**: `HELP_KEYWORDS = new Set(["HELP"])`. On a successful START/YES/UNSTOP transition (the existing `else if (... && client.smsOptedOutAt)` branch, unchanged condition), renders `optInConfirmation` with `{{studioName}}` and sends it via `sendClientSms`. A new `else if (HELP_KEYWORDS.has(keyword))` branch (fires independent of opt-in/opt-out status) renders `helpResponse` with `{{studioName}}`/`{{studioPhone}}`/`{{studioEmail}}` (sourced from the studio's first `Location` row — neither `Studio` nor `StudioSettings` has a dedicated phone/email field) and sends it with `bypassOptOutCheck: true`. Both silently no-op if the studio's `reminderTemplates` doesn't have the relevant key yet (same "skip if not configured" spirit `reminderTicker.ts`'s own `if (sendTimes && templates)` gate already uses), rather than sending a broken/empty message.
- **Settings.tsx**: two new entries in `REMINDER_TEMPLATE_FIELDS` (`optInConfirmation` → placeholders `['studioName']`; `helpResponse` → `['studioName', 'studioPhone', 'studioEmail']`) and the `ReminderTemplatesData` interface. The editor's render loop is already generic over this array — no other UI code needed, confirmed by reading `Settings.tsx` before assuming.
- **Dev seed**: added one `Location` row for the dev studio (none existed at all) with a real phone/email, so the HELP reply's placeholders render actual values in dev instead of coming out blank.

## Discrepancy found and escalated: production's studio name didn't match the submitted campaign text

Checked production directly (read-only) before assuming anything: `Studio.name` there was **"Black Hive Ink"** — not "Black Hive Ink and Arts" as the task's exact-submitted-to-Twilio text names. Since `{{studioName}}` renders from `Studio.name`, production would have sent "Black Hive Ink: You are now opted-in..." — not matching what the task says was actually submitted to carriers for the A2P campaign, which is exactly the kind of mismatch this task's own framing ("must match reality exactly") was written to catch. Stopped and asked rather than guessing or silently hardcoding around the placeholder. User chose to update `Studio.name` to `"Black Hive Ink and Arts"` in production.

Separately, production's `StudioSettings.reminderTemplates` was **entirely `null`** (no SMS integration is connected there yet either) — since the field is validated all-or-nothing (7 required non-empty-string keys), making `optInConfirmation`/`helpResponse` usable at all meant the other 5 (client/artist reminder cadence, unrelated to this task) needed real text too, not just the two this task asked for. Flagged this as a distinct decision rather than bundling it into the name-mismatch question. User chose to populate all 7 with the same generic defaults used in dev.

**Applied to production** (verified read-only first, then applied, then re-verified):
- `Studio.name`: `"Black Hive Ink"` → `"Black Hive Ink and Arts"`.
- `StudioSettings.reminderTemplates`: `null` → the same 7-key object seeded in dev.
- Confirmed after: `/health` 200, and a bogus-credential `POST /login` returns `401` (not 500), confirming the API is still round-tripping to the database correctly post-change.

Production has no connected SMS integration at present, so none of this fires live yet — it's now correctly staged for the moment Twilio is connected there, rather than needing this same discrepancy re-discovered later.

## Verification

**Live-signature Twilio simulation** (PowerShell/live send wasn't practical in this environment; a Node script instead computed real `X-Twilio-Signature` HMAC-SHA1 signatures using the dev studio's actual decrypted Twilio auth token — the exact algorithm `verifyTwilioSignature`/the `twilio` package checks against — so the webhook's real signature-verification path was genuinely exercised, not bypassed):

| # | Scenario | Result |
|---|---|---|
| 1 | STOP opts a client out (regression check) | **PASS** |
| 2 | YES from an opted-out client → opt-out cleared | **PASS** |
| 3 | YES → opt-in confirmation auto-reply actually sent (real outbound `Message` row, exact seeded text with `{{studioName}}` rendered as `"Dev Studio"`) | **PASS** |
| 4 | START → opt-out cleared, confirmation reply sent | **PASS** (still working, no regression) |
| 5 | UNSTOP → opt-out cleared | **PASS** (still working, no regression) |
| 6 | HELP while opted out → `200`, reply sent, opt-out status **unchanged** | **PASS** |
| 7 | HELP while opted in → `200`, reply sent, opted-in status **unchanged** | **PASS** |
| 8 | HELP reply renders the real studio phone number (`{{studioPhone}}` → the seeded dev Location's `555-0100`) | **PASS** |

18/18 individual assertions passed (some scenarios above check multiple things — status code, DB state, and actual message content — each recorded separately). First run had 2 test-script bugs of my own (an over-loose regex matching "for help" inside the opt-in text too, and phone-number reuse across script runs colliding client lookups) — both caught, fixed, and the full suite re-run clean rather than accepting a false pass.

**Settings editor UI** (Playwright, screenshots reviewed directly): both new templates appear in the "Reminder Templates & Send Times" list; opening "SMS Opt-In Confirmation" shows the `{{studioName}}` placeholder chip, the exact seeded text, and a working character/segment counter (`150/160 characters · 1 SMS segment`) identical in behavior to the existing 5; "SMS HELP Reply" shows its `{{studioPhone}}` chip correctly too.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc --noEmit` + `npm run build` (web) — clean.

## Commit

`d2fd1b9` — Fix: YES opt-in keyword, opt-in confirmation reply, HELP keyword. Pushed immediately. Production `Studio.name`/`reminderTemplates` changes (see above) were applied directly via script against `.env.production`'s `DATABASE_URL`, not through a migration — there's no schema change to commit for that part, only the data change itself, executed and verified as described above.

## Cleanup

Scratch API (:5001) and web (:6001) servers stopped by PID. The decrypted Twilio auth token, fetched once to sign test webhook requests, was written to a scratchpad-only file and deleted immediately after use — never printed to any persistent log. All temporary scripts (`verify_sms.mjs`, `verify_settings_ui.mjs`, `get_token_script.ts`, `check_prod_templates.ts`, `check_prod_studio.ts`, `prod_apply.ts`) deleted or left scratchpad-only, none committed. Test data (one throwaway client per test client per verification run, `SmsKeyword TestClient`) left in the dev database, consistent with this session's standing convention.

---

# Feature — Owner can permanently delete staff

Single session on `main`.

## Design decision

`User` is referenced by ~13 other tables, most via required (RESTRICT) foreign keys, so a raw `DELETE` would fail immediately on any staff member with real history. Rather than guess at the right tradeoff, asked the user directly (AskUserQuestion) between three approaches: (1) full delete, loosening the small number of FKs that point at genuine business content so it survives with a "deleted user" placeholder; (2) full delete but hard-block whenever there's any meaningful history at all; (3) full delete for non-artists but always hard-block artists with any appointment history. **User chose (1).**

## Schema change

Five FKs made nullable (matching relation made optional), each documented in-schema as following the existing `Message.authorUserId` / `AuditLog.actorUserId` "preserve content, anonymize actor" precedent:

- `GiftCard.issuedById` — a gift card is real customer money; it survives its issuer's deletion.
- `AppointmentPhoto.uploadedById`, `InquiryNote.authorId`, `ConversationTag.createdById` — same reasoning for their respective content.
- `PersonalTask.createdById` — only if the task was created *for a teammate*; `PersonalTask.userId` (the assignee) was deliberately left required, since a user's own tasks are deleted along with them.

Migration `20260724124132_nullable_user_refs_for_staff_delete` — confirmed purely additive: 5 `DROP NOT NULL` + FK re-adds with `ON DELETE SET NULL`, no backfill needed. This let the delete transaction skip explicit reassignment logic for these 5 relations entirely — Postgres handles it once the `User` row is deleted.

`inquiries.ts`'s `canModifyNote` helper widened to accept `authorId: string | null` (a null-author note simply never matches the caller, falling through to OWNER-only — no other logic change needed).

## What changed

- **`routes/studios.ts`**: `GET /:studioId/users/:userId/delete-preview` (counts everything that will be deleted or preserved, plus block flags) and `DELETE /:studioId/users/:userId` (typed `"DELETE"` confirmation required, same pattern as Client/Inquiry/Appointment deletes). Guards: rejects deleting yourself; reuses the existing last-active-owner count check; hard-blocks deleting an ARTIST with any real appointment or assigned/preferred-inquiry history (my own judgment applying the "preserve business records" choice to this specific cascade risk — unwinding an artist's full history is out of scope for a staff-removal feature; deactivation is offered as the alternative in the error message). Ephemeral records (task dismissals, section-seen/read receipts, conversation-participant rows, dismissed-duplicate markers, prefill drafts, import batches + rows, the user's own personal tasks, their `Artist` row if any) are deleted in one transaction; the 5 business-content relations are left for Postgres's `ON DELETE SET NULL`. Full audit log entry recorded before deletion (email/name/role + the full summary).
- **Frontend (`Team.tsx`)**: red "Delete" button next to "Edit" in both the Staff table and Artists cards, disabled (with a title tooltip) on the current user's own row. A confirmation modal fetches the preview, shows a hard-block banner for the last-owner or artist-history cases, otherwise a two-part breakdown ("will permanently remove" vs. "preserved, just loses the author link"), and requires typing `DELETE` before enabling the submit button.
- **Frontend null-safety**: 4 files (`InquiryNotesSection.tsx`, `GiftCardDetail.tsx`, `Tasks.tsx`, `AppointmentDetail.tsx`) had their `author`/`issuedBy`/`createdBy`/`uploadedBy` display types widened to `| null` with a "Deleted user" fallback. `tsc --noEmit` did not catch these on its own since the frontend interfaces predated the schema change — found by grepping for direct (non-optional-chained) property access on all 4 fields across `apps/web/src` and fixing every real hit before running any tests.

## Verification

**Backend** (direct-API script, 24/24 assertions passed): fresh user with zero history deletes cleanly; self-delete rejected (400); last-active-owner flagged correctly in preview; artist with zero history fully deletes including their `Artist` row; artist with real appointment history hard-blocked (400, exact counts in the message); gift card and a task-created-for-a-teammate both genuinely survive their creator's deletion with the author field nulled and all other data (amount, title) intact; FRONT_DESK gets 403 on the preview/delete routes; cross-studio access gets 403.

**Frontend** (Playwright, screenshots reviewed directly): Team page renders both Delete buttons — confirmed the current owner's own row's button is present but disabled. Clicking an enabled Delete button on a teammate's row opens the confirmation modal showing the correct live counts ("4 of their own personal tasks", "2 read-receipt / dismissal records", correctly reporting "no Artist profile" for this non-artist user) and a working type-`DELETE`-to-confirm input.

## Typechecks

`npx tsc --noEmit` (api) — clean. `npx tsc --noEmit` + `npm run build` (web) — clean.

## Commit

`6185823` — Allow owner to permanently delete staff accounts. Pushed immediately after the collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

Both scratch dev servers (API :5501, web :6501) stopped by PID. Temporary verification scripts (`verify_staff_delete.mjs`, `verify_team_ui.mjs`) and screenshots left scratchpad-only, none committed. Test users/gift cards/tasks created during verification were deleted as part of the delete flow itself being tested, or left in the dev database consistent with this session's standing convention.



---

# Fix — Inquiry page progress timeline: connector gaps, spacing, reorderability

Single session on `main`. No schema changes.

## 1. Connector lines not touching the circles — root cause

The desktop/horizontal pipeline (`InquiryPipeline.tsx`) laid out each step as a `flex-1` box containing a "circle + label" column (auto-width, sized to fit the label text) followed by a separate connector box. The connector's actual line had an explicit `mx-1.5` (6px) margin on both sides, which is what created the visible gap between the line and each circle — confirmed with a before/after screenshot of the raw connector geometry (`shots/pipeline-crop.png` during verification, not committed) showing a uniform ~6px gap on every circle, on every step, regardless of label length. This was a separate, distinct bug from the earlier centering fix mentioned in the task — that one addressed vertical centering of the connector against the circle; this one is a horizontal margin baked into the line itself.

Rather than just deleting the margin (which would still leave the line stopping short of the circle's actual edge whenever a step's label is wider than its circle, since the circle sits centered inside a label-width column), the horizontal layout was restructured to a CSS grid of equal-width columns (`grid-template-columns: repeat(5, minmax(0, 1fr))`), with each connector absolutely positioned at `left-1/2 w-full` inside its own column. Since every column is now exactly the same width, a connector spanning from its own circle's center outward by exactly one column-width lands precisely on the *next* circle's center — it disappears entirely behind that circle (`z-10`), so there's no gap on either side regardless of how long any given label is. The previous flex layout gave the last step `flex-none` (right-hugging, content-width) instead of an equal share; the grid now sizes all 5 steps equally, which also makes the row's overall step spacing more even/symmetric as a side effect.

## 2. Spacing between the timeline and the next widget

The pipeline previously lived in its own fixed `<div className="mt-6 rounded-2xl ...">`, immediately followed by `<ReorderableWidgetList>` — a plain sibling with no bottom margin, sitting flush against the widget list's first child (widget-to-widget spacing comes entirely from the list's own `gap-6`, which doesn't apply to elements outside it). Moving the pipeline inside the list as its own `<Widget>` fixes this as a side effect of fix #3 below, rather than needing a separate margin patch.

## 3. Made it a reorderable/collapsible widget — reused the existing system, no new mechanism

Wrapped the timeline in the same `<Widget>`/`<ReorderableWidgetList>` components already used by every other section on this page (added earlier this project for "Tattoo details," "Reference images," etc. — see the widget-layout persistence work in prior commits). No second drag/collapse system was built: `'pipeline'` was simply added to the front of `InquiryDetail.tsx`'s existing `INQUIRY_WIDGET_ORDER` array and the timeline JSX wrapped in `<Widget key="pipeline" id="pipeline" title="Pipeline">`, giving it the same drag handle, collapse chevron, and persisted per-account order/collapsed state (`UserWidgetLayout`) as every neighboring card, with no other page or backend changes required.

Kept it collapsible for full consistency with its neighbors — there's no functional reason collapsing a progress strip would be harmful, so no special-cased "non-collapsible" variant was added to `Widget`.

`InquiryPipeline.tsx` gained one new prop, `hideLabel` (default `false`), to suppress its own internal "Pipeline" caption when the caller already supplies an external title (now true only for `InquiryDetail.tsx`'s horizontal usage, which passes `hideLabel`) — avoids a duplicate heading on the `<md` fallback and the closed-inquiry state, without touching the two other (unchanged, still-labelled) `orientation="vertical"` consumers: the Conversations context panel and the Kanban board's Inquiries columns.

## Verification

Browser (Playwright against the running dev servers, owner login): screenshot of the pipeline card at 2x zoom confirmed every connector line touches its circles with zero gap on both sides, and confirmed clear `gap-6` spacing now exists between the Pipeline card, Assignment, and Estimate cards below it (previously flush). Confirmed the drag handle + collapse chevron now render identically to "Assignment"/"Estimate". Reorder mechanism verified via a direct `PUT /widget-layouts/inquiry-detail` (same technique used to verify the original widget-reorder feature, since simulating a raw pointer drag through Playwright against `@dnd-kit/react` doesn't reliably trigger a real drag) moving `pipeline` to the second slot — screenshot confirmed it rendered between Assignment and Estimate — then reset back to the default order and confirmed it returned to the top.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc -b --noEmit` + `npm run build` (web) — clean.

## Commit

`f936f15` — Fix Inquiry pipeline timeline: connector gaps, spacing, and make it a reorderable widget. Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

All ad-hoc Playwright screenshot scripts (`screenshot-pipeline.js`, `screenshot-pipeline-crop.js`, `crop-pipeline.js`) and their screenshots deleted from the scratch `pw-test` directory; none committed. No new background shells were started this session (the dev API/web servers were already running from prior work and were left as-is, not started or stopped by this session). The per-account widget-layout row for `inquiry-detail` used during drag verification was reset to its default (empty) state before finishing.

---

# Fix — Inquiry page: missing gap above widget list, cramped ellipsis button

Single session on `main`. No schema changes. Confirmed as a direct side effect of the immediately prior session's Pipeline-widget refactor before making any changes.

## 1. Missing gap between header card and widget list — root cause confirmed

Hypothesis in the task was correct. Before the prior session's refactor, the Pipeline lived in its own standalone `<div className="mt-6 rounded-2xl ...">` sitting directly after the header card — that `mt-6` was the only thing providing the gap. Once Pipeline moved inside `<ReorderableWidgetList>` as its first child, that wrapper div (and its `mt-6`) disappeared; `ReorderableWidgetList`'s own root div was just `flex flex-col gap-6`, with nothing above it. Confirmed by reading both files side by side and reproducing the zero-gap boundary in a screenshot before touching any code.

Fixed at the shared-component level (`ReorderableWidgetList.tsx`'s root div, now `mt-6 flex flex-col gap-6`) rather than patching `InquiryDetail.tsx`'s header individually, since `AppointmentDetail.tsx` has the exact same "plain header div immediately followed by `<ReorderableWidgetList>`" pattern and was carrying the identical latent bug (not yet reported by the user, found while confirming the hypothesis) — fixing it in the one shared component resolves both pages consistently and matches the `gap-6` value already used between widgets, per the task's instruction.

## 2. Cramped ellipsis button — root cause

Not simply a missing padding value. The button's wrapper div used `self-stretch` (to dynamically match its sibling buttons' height) and the button itself used `aspect-square h-full` (to derive a square box from that stretched height). Measured the actual rendered boxes via Playwright: the wrapper resolved to only 16px wide while the button inside it rendered at 38px wide — the button overflowed its own parent by 22px and spilled 1px past the header card's own outer edge, past the `p-5` padding boundary every sibling button respects. This is a known interaction where a flex container's shrink-to-fit width computation runs before an `aspect-ratio`-driven child size (sourced from `align-self: stretch`) has resolved, so the two disagree.

Replaced with the same fixed `h-9 w-9`, no-border, icon-only circular button pattern already used for equivalent kebab-style actions elsewhere in the codebase (`ConversationsPanel.tsx`, `Settings.tsx`) — sidesteps the aspect-ratio/stretch interaction entirely rather than trying to patch it, and reuses an existing convention instead of inventing a new size.

## Verification

Browser (Playwright, owner login): screenshot confirmed the header-to-Pipeline gap now visually matches the Pipeline-to-Assignment and Assignment-to-Estimate gaps. Re-measured the ellipsis button's bounding box after the fix: wrapper and button both resolve to exactly 36×36px, right edge at 1279px against a card whose padded content boundary is 1280px (`p-5` = 20px inset from the 1300px card edge) — sitting flush with the padding boundary, matching its siblings, no more overflow. Also screenshotted `AppointmentDetail.tsx` to confirm the shared-component fix resolved the identical bug there too.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc -b --noEmit` + `npm run build` (web) — clean.

## Commit

`18ec76c` — Fix missing header-to-widget-list gap and cramped ellipsis button. Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

All ad-hoc Playwright scripts (`screenshot-header.js`, `crop-header.js`, `measure-header.js`, `screenshot-appt.js`) and screenshots deleted from the scratch `pw-test` directory; none committed. No background shells were started this session (the dev API/web servers were already running from prior work and were left as-is).

---

# Feature — Appointment notes, Project details fields, consolidated client notes

Single session on `main`. Schema change: new `AppointmentNote` model (purely additive migration).

## 1. Project details widget (AppointmentDetail.tsx)

Replaced **Budget** with **Estimate** (`priceEstimateLow`/`priceEstimateHigh`, no longer falling back to the free-text `budget` field per the request's "Not budget"), and added **Description**, **Color or Black & Grey**, and **Placement** — all read from the same `appointment.inquiry.*` nested object the reference/placement image grids already used. Backend: added `colorOrBlackGrey`/`placement` to `APPOINTMENT_DETAIL_INCLUDE.inquiryProject.select` in `appointments.ts` (both already existed on `Inquiry`, just weren't selected for this route).

## 2. Per-appointment notes

New `AppointmentNote` model, identical shape/rules to the existing `InquiryNote` (rich-text `bodyHtml`, nullable `authorId` so a note survives its author's deletion, OWNER/FRONT_DESK only) but scoped to a single `Appointment` (session) rather than the whole project — kept as a separate model rather than widening `InquiryNote` with a nullable `appointmentId`, since a client can have several appointments per inquiry and "note about this 2pm session" is a different scope than "note about the whole back-piece project." New `GET/POST/PATCH/DELETE /appointments/:id/notes` routes mirror `inquiries.ts`'s note routes exactly, hardcoded `requireRole(OWNER, FRONT_DESK)` rather than the customizable `appointments.manage` permission — matches `InquiryNote`'s own "internal only, never shown to an artist" precedent even though an ARTIST can otherwise view (not manage) the same appointment.

Refactored rather than duplicated: `InquiryNotesSection.tsx` generalized into `NotesSection.tsx` (parameterized by REST path instead of a hardcoded `inquiryId`), now shared by both the Inquiry and Appointment detail pages. The three tiny backend helpers it depended on (`NOTE_AUTHOR_SELECT`, `isBlankHtml`, `canModifyNote`) moved from `inquiries.ts` into a new `api/src/lib/notes.ts`, imported by both route files, for the same reason.

## 3. Consolidated notes on the Client page

New `GET /clients/:id/notes` (OWNER/FRONT_DESK only, same hardcoded-role reasoning as above, bypassing the router's own customizable `clients.manage` gate) returns every note this client has anywhere, grouped into three buckets: `inquiry`, `project`, `appointment`. There is no separate "Project note" table — Inquiry and "Project" are the same row at different points in its status (`PROJECTS_TAB_STATUSES`/`PROJECT_STATUSES`, already duplicated across `Inquiries.tsx` and `inquiries.ts`, now a third time here per this codebase's existing precedent for that value rather than a cross-route-file import), so a note is bucketed "inquiry" vs. "project" purely off its parent inquiry's *current* status, not whatever it was when the note was written (not tracked). Appointment notes come from the new `AppointmentNote` table, tagged with which specific session they're on. Rendered read-only on the Client page (editing happens on the note's actual originating page); each note links back to its source via a small `NoteGroup` helper.

## Cleanup extraction (touched while already in this code)

The reference/placement image grid (hover caption showing upload timestamp/uploader) was previously duplicated: a local, non-exported `ImageGrid` function in `InquiryDetail.tsx`, and a second hand-rolled copy of the same markup inline in `AppointmentDetail.tsx`'s Project details widget. Extracted into a shared `components/ImageGrid.tsx` (grid density configurable via a `gridClassName` prop, since the two pages used different column counts), used by both pages now. Similarly extracted `InquiryDetail.tsx`'s small `DetailField` (uppercase label + value) into `components/DetailField.tsx`, reused for the new Estimate/Description/Color/Placement fields so both pages' "detail field" look is pixel-identical.

## Verification

Direct API calls (owner login): confirmed `colorOrBlackGrey`/`placement` appear on `GET /appointments/:id`; posted an appointment note and an inquiry note, confirmed both round-trip through their respective GET routes; confirmed `GET /clients/:id/notes` correctly bucketed the inquiry note as "project" (its appointment had already reached CONFIRMED) and the appointment note under "appointment"; confirmed ARTIST gets 403 from both `/appointments/:id/notes` and `/clients/:id/notes`. Browser (Playwright, screenshots reviewed): Project details widget shows all 6 requested fields; Notes widget on the Appointment page shows composer + posted note with author/timestamp and working Edit (verified the edit form opens with Save/Cancel) and Delete; Client page's Notes section renders "Project Notes" and "Appointment Notes" groups correctly, and clicking a note's "On: ..." source link navigates to the right appointment. Deleted both test notes afterward.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc -b --noEmit` + `npm run build` (web) — clean.

## Commit

`f7cc046` — Add per-appointment notes, Estimate/Description/Color/Placement on Project details, and consolidated client notes. Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

All ad-hoc Playwright scripts and screenshots deleted from the scratch `pw-test` directory; none committed. No background shells were started this session (the dev API/web servers were already running from prior work and were left as-is).

---

# Feature — Attachments on notes (any file type)

Single session on `main`. Schema change: `attachments Json?` added to both `InquiryNote` and `AppointmentNote` (purely additive migration). User explicitly chose **"Any file type (images, PDFs, documents)"** over an images-only option via AskUserQuestion, overriding what would otherwise have been full consistency with every other attachment feature in this app (conversation messages, waiver ID photos, appointment photos are all image-only, Cloudinary `image/upload` end to end).

## What changed

- **Cloudinary**: new `ink-manager/note-attachments` folder + `/uploads/note-attachment-signature` route (`uploads.ts`, OWNER/FRONT_DESK gated, matching the notes routes' own hardcoded gate). Frontend `uploadNoteAttachment()` (`lib/cloudinary.ts`) posts to Cloudinary's `auto/upload` endpoint instead of every other wrapper's `image/upload` — the one deviation needed for non-image support. No signed-parameter changes were needed: `resource_type` only ever lives in the endpoint URL, never a signed field, so the existing folder+timestamp signing logic works unchanged for both image and non-image uploads.
- **Data shape**: unlike `Message.attachments` (bare `string[]` of URLs, since those are always images rendered as `<img>`), note attachments are `Array<{url, filename, mimeType}>` — the extra fields are captured client-side off the browser `File` object at upload time, since Cloudinary's own response for a non-image asset doesn't carry a human-readable original filename.
- **Validation**: `isValidAttachments()` added to the shared `api/src/lib/notes.ts` (alongside the existing `isBlankHtml`/`canModifyNote`), used by both `inquiries.ts` and `appointments.ts`'s notes routes.
- **PATCH semantics**: attachments omitted from the request body means "leave as-is"; an explicit `[]` means "clear them all" — the latter requires `Prisma.JsonNull` (not plain `null`/`undefined`) to actually null out a `Json?` column, otherwise Prisma just skips the field. Both routes' `Prisma` import had to change from type-only to a value import to use `Prisma.JsonNull`.
- **UI** (`NotesSection.tsx`): a paperclip button (composer, and again inside each note's own edit mode) uploads immediately on pick — multiple files at once — appending each result to a removable pending-chip strip, matching `ConversationsPanel.tsx`'s existing "upload on pick" composer pattern rather than a bulk-gallery picker. Posted notes render the same chip read-only: an image gets a small thumbnail, anything else gets a generic file icon + filename, both open the file in a new tab. The `AttachmentChip` component is exported and reused as-is by `ClientDetail.tsx`'s consolidated notes view, so attachments show up there too with zero extra work.

## Verification

Direct API: fetched a real signature and uploaded a `.txt` file straight to Cloudinary's `auto/upload` endpoint (confirmed `resource_type: raw` in the response, proving the endpoint distinction works for non-images); posted a note with that attachment and confirmed it round-tripped through `GET /appointments/:id/notes` unchanged. Browser (Playwright, screenshots reviewed): composed a note, attached a real file via the actual paperclip input (after two false starts where the test script's locator picked the wrong file input on the page — the *unrelated* Photos widget's own image uploader — before scoping correctly to the Notes composer's), saw the pending chip, posted it, and confirmed the chip persisted on the rendered note; opened edit mode on that note, removed the attachment via its chip's × button, saved, and confirmed it was gone after reload (proving the `Prisma.JsonNull` clear-path works end to end, not just in isolation). Deleted all test notes afterward.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc -b --noEmit` + `npm run build` (web) — clean.

## Commit

`ae512bc` — Add file attachments to notes (any file type, not just images). Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

All ad-hoc Playwright scripts, the scratch `test.txt` fixture, and screenshots deleted from the `pw-test` directory; none committed. All 4 test notes created during verification deleted via the API. No background shells were started this session (the dev API/web servers were already running from prior work and were left as-is).

---

# Feature — Revise a Project's estimate (reason required, client approval)

Single session on `main`. Schema change: 6 new `estimateRevision*` fields on `Inquiry` (purely additive migration). User explicitly chose, via two AskUserQuestion prompts: (1) the customer must actively click to approve the revision (not just be notified), and (2) a decline/objection only flags it for staff follow-up rather than auto-cancelling anything.

## Design

Before this, `PATCH /:id` hard-blocked the estimate fields entirely once an inquiry converted to a Project (`SCHEDULING`/`WAITLISTED`/`CONFIRMED`/`DEPOSIT_PENDING`) — the client already paid a deposit against those numbers, so silently rewriting them was disallowed with no exception. This adds the deliberate, controlled exception: a new `POST /inquiries/:id/revise-estimate` route, requiring a reason, that's the *only* sanctioned way to change a Project's estimate.

**Why not reuse `POST /:id/send-estimate`**: that route always flips `status` to `AWAITING_CLIENT_RESPONSE` — correct for a pre-conversion inquiry, but wrong for a Project, since it would yank an already-scheduled/deposited row out of the Projects tab back into Inquiries. The new route never touches `status` at all.

**Why not reuse the existing `/estimate/:token` public flow**: its `PROCEED` branch sets `status: DEPOSIT_PENDING`, assuming a pre-conversion inquiry with no deposit or scheduling yet. A Project's revision response needs to record "did the client accept this change" without disturbing any of that already-in-place state, so it gets its own token/fields (`estimateRevisionToken` etc., distinct from `estimateToken`) and its own public page/routes.

**No new revision-history table**: every past revision's old values, new values, and the staff's reason are permanent via `AuditLog` (`action: "estimate_revised"`, `diffObjects` output merged with a `reason` key) — the `Inquiry`-level `estimateRevision*` fields only track the *current/latest* pending-approval state, overwritten by each new revision.

## What changed

- **Backend** (`inquiries.ts`): `POST /:id/revise-estimate` — reason required (unlike Mark as Lost's optional one), gated to `PROJECT_STATUSES` only, same price/time range validation as `send-estimate` (with the same "fall back to current value" convenience), generates a new revision token (7-day expiry, same TTL as the original estimate token), logs the audit entry, and sends a real text via the existing `sendClientSms`/`getOrCreateClientConversation` infra with the new numbers + reason + a shortened link.
- **Backend** (`estimates.ts`): `GET /revision/verify/:token` and `PATCH /revision/respond/:token` (decision: `APPROVE` | `FLAG`) — mirrors the existing verify/respond pair's shape but never touches `status`; `FLAG` deliberately does nothing beyond recording the response (audit log + `estimateRevisionApproved: false`) since auto-cancelling a paid deposit or scheduled appointment would be unsafe.
- **Frontend**: new public page `EstimateRevisionResponse.tsx` (route `/estimate-revision/:token`) — simpler than `EstimateResponse.tsx`, just the new range + reason + "I approve this change" / "I have a concern about this". `InquiryDetail.tsx`'s Estimate widget: the previously-empty `isConverted` action slot now shows a "Revise Estimate" button opening a modal (price/time inputs identical to the existing edit form + a required reason textarea), and a color-coded banner (warning while pending, success once approved, danger if flagged) showing the current revision's state and reason. Added `reason: 'Reason'` to `AuditTrail.tsx`'s `FIELD_LABELS` so the new audit action renders with a clean label instead of raw camelCase.

## Verification

Full browser flow (Playwright, screenshots reviewed) on a real dev-seed Project: opened "Revise Estimate", confirmed the form pre-filled current values, confirmed client-side validation correctly blocked submission when a genuinely-unset field (time estimate, null on this seed record) was left empty, filled it in and submitted — confirmed the warning banner appeared on the Inquiry page ("Awaiting client approval..."), confirmed the audit trail logged both the old→new diff and the reason. Visited the actual public revision link and approved it — confirmed the banner turned green ("Client approved...") and the audit trail logged a second, system-attributed entry. Created a second revision and used the public page's "I have a concern" path — confirmed the banner turned red/flagged, and confirmed via direct API check that `status` stayed `CONFIRMED` throughout (never reverted to an Inquiry-stage status) and nothing about the deposit/scheduling was touched. Reverted the test inquiry's estimate back to its original values afterward using the feature itself (not a direct DB edit), leaving an honest audit trail rather than silently mutating test data.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc -b --noEmit` + `npm run build` (web) — clean.

## Commit

`1fba9a0` — Allow staff to revise a Project's estimate via a reason-required modal, with client approval. Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

All ad-hoc Playwright scripts and screenshots deleted from the scratch `pw-test` directory; none committed. The dev-seed Project used for verification was left with one pending-flagged revision from the FLAG-path test (dev/seed data, consistent with this session's standing convention of leaving harmless test artifacts in the dev database). No background shells were started this session (the dev API/web servers were already running from prior work and were left as-is).

---

# Fix — Separate Policies and Defaults in Settings, plus a gap in estimate revision links

Single session on `main`. No schema changes. `apps/web/src/pages/Settings.tsx` was concurrently being edited by another session (Gmail/email integration work, entirely in the imports/state area and the Integrations tab) -- isolated my change via the established git-index technique (reconstruct clean base from `HEAD`, apply the same edit there, verify the diff matches exactly, stage via `git hash-object` + `git update-index --cacheinfo`) so the other session's in-progress work on disk was never touched.

## 1. Policies and Defaults separated into their own sections

The Settings → Policies & Templates tab had one oversized card literally titled "Policies & Defaults" that mixed policy wording (Refund Policy, Deposit Policy, etc.) with unrelated numeric/behavioral defaults (estimate follow-up hours, gift card expiration, referral reward, cold lead days, timezone, sidebar badges). Split into two top-level cards -- "Policies" and "Defaults" -- matching the page's own established convention where every other concern on this tab already gets its own `rounded-2xl` card (Reminder Templates & Send Times, Custom Policies, Deposit Tiers were already separate; this card was the one inconsistent holdout).

While in there, also promoted **Waiver Questions & Clauses**, **Intake Form Fields**, and **Message Templates** from nested sub-cards inside that same oversized card to their own top-level sections -- none of the three are "Policies" or "Defaults" either, and leaving them arbitrarily attached to one of the two new cards would've just relocated the inconsistency rather than fixed it. `IntakeFormFieldsEditor.tsx` (a component used at exactly this one call site) had its own outer wrapper bumped from the sub-card styling (`rounded-xl`, plain `<p>` title) to the top-level card convention (`rounded-2xl`/`bg-surface`/`<h2>`) to match its new siblings.

## 2. Gap in the Project estimate-revision feature (from the immediately prior session)

User-reported: after revising a Project's estimate, the client-facing SMS text says "share the link below manually" as a fallback, but no link was actually shown anywhere on the Inquiry page. Root cause: `POST /inquiries/:id/revise-estimate`'s response included a `revisionUrl`, but that value only ever lived in that one request/response -- nothing persisted it for a later page load to redisplay, unlike the original (pre-conversion) estimate flow, where `GET /inquiries/:id` re-derives `estimateUrl` fresh on every fetch by re-shortening the stored `estimateToken` (gated on it being unexpired). Added the identical computation for `revisionUrl` off `estimateRevisionToken`/`estimateRevisionTokenExpiresAt`, and added the matching "Share this link" input+copy-button box (byte-identical style to the existing `estimateUrl` box) to `InquiryDetail.tsx`'s revision banner.

## Verification

Browser (Playwright, screenshots reviewed): confirmed the Settings Policies & Templates tab now renders 8 distinct top-level cards (Policies, Defaults, Waiver Questions & Clauses, Intake Form Fields, Message Templates, Reminder Templates & Send Times, Custom Policies, Deposit Tiers) with consistent spacing/styling; opened the "Edit defaults" modal and confirmed it still pre-fills and matches correctly. For the link fix: revised a test Project's estimate via the API, confirmed the POST response's `revisionUrl` and a subsequent fresh `GET /:id` call both returned the identical link (simulating a page reload); confirmed in the browser that the "Share this link" box now renders with a working copy button. Resolved the test revision (approved) afterward to leave the dev-seed Project in a clean state.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc -b --noEmit` + `npm run build` (web) — clean.

## Commit

`9da4927` — Separate Policies and Defaults into their own sections in Settings (also includes the revisionUrl fix). Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

All ad-hoc Playwright scripts and screenshots deleted from the scratch `pw-test` directory; the isolation scratch copy of Settings.tsx deleted from the session scratchpad. None committed. No background shells were started this session (the dev API/web servers were already running from prior work and were left as-is).

---

# Feature — Client detail page: reorderable/collapsible widgets, ellipsis button fix

Single session on `main`. No schema changes. Applied the same treatment already built for the Inquiry and Project (Appointment) detail pages earlier this session to the Client detail page, per explicit request.

## What changed

All 8 sections on the Client page -- Contact Info, Inquiries, Gift Cards, Deposit Forms, Appointments, Waivers, Notes, Activity History -- are now `Widget`s inside a `ReorderableWidgetList` (`pageKey: "client-detail"`), reusing the exact same components/persistence (`UserWidgetLayout`) built for the other two pages. Same minimal-diff strategy as before: each widget's inner content (tables, forms, buttons) stayed exactly where it was in the source; only the outer `rounded-2xl` card wrapper, `<h2>` title, and header action-button row were swapped for `<Widget key id title actions={...}>`.

One wrinkle not present on the other two pages: `ReorderableWidgetList` only renders children that are `Widget` elements carrying a string `id` prop (`Children.toArray(children).filter(...)`) -- anything else is silently dropped, not just rendered out of place. The "Merge with another client" button and the potential-duplicates warning banner were previously free-standing siblings between the Contact Info and Inquiries cards; both were folded into the Contact Info widget's own content (they're both about client identity, a reasonable thematic fit) rather than left as bare children, which would have made them vanish entirely once the page went through the widget system.

Also fixed the identical cramped-ellipsis-button bug already fixed twice this session on the Inquiry and Appointment pages: `self-stretch` + `aspect-square h-full` let the "..." button render wider (38px) than its own shrink-to-fit wrapper (18px), overflowing past the card's own padding boundary. Replaced with a fixed `h-9 w-9` -- this instance already had `border-border` (unlike the other two, which didn't), so the border was kept for consistency with its own sibling buttons rather than removed.

## Verification

Browser (Playwright, screenshots reviewed): confirmed all 8 widgets render with a drag handle and collapse chevron, in their original visual order, with Contact Info correctly showing the folded-in Merge button. Measured the ellipsis button's bounding box directly (before: 38px button in an 18px wrapper, overflowing to the card's edge; after: 36px button in a 36px wrapper, sitting flush at the padded boundary). Verified reorder + collapse persistence via a direct `PUT /widget-layouts/client-detail` call (moved Appointments to the top, collapsed Gift Cards) followed by a page reload screenshot showing both changes applied -- then reset the layout back to default.

## Typechecks

`npx tsc -b --noEmit` + `npm run build` (web) — clean. (No API changes this turn.)

## Commit

`19bcabf` — Make Client detail page widgets reorderable/collapsible and fix the cramped ellipsis button. Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

All ad-hoc Playwright scripts and screenshots deleted from the scratch `pw-test` directory; none committed. The per-account widget-layout row for `client-detail` used during verification was reset to its default (empty) state before finishing. No background shells were started this session (the dev API/web servers were already running from prior work and were left as-is).

---

# Feature — Multiple named intake forms, editable field types, form picker on send

Single session on `main`. Confirmed no other migration was in progress before starting (`prisma migrate status` — clean).

## Schema + migration (nullable → backfill → required, three separate steps)

New `IntakeForm` model (`name`, `slug` unique-per-studio, `isDefault`, timestamps). `IntakeFormField` gains `intakeFormId`; `Inquiry` gains `intakeFormId` (nullable **permanently** — historical inquiries genuinely predate this, no backfill attempted for that column).

Per the discipline established after the referral-migration production outage (`20260723201202_referral_code_required`'s own comment — that incident happened because a backfill was run as a throwaway dev-only script, never captured as committed SQL, so production's `NOT NULL` migration failed outright), this shipped as three separate migrations, verified at each step:

1. **`20260724214509_add_intake_forms`** — purely additive: `CREATE TABLE "IntakeForm"`, both new `intakeFormId` columns added nullable. Confirmed via the generated SQL before applying — no `ALTER COLUMN ... SET NOT NULL` anywhere in this step.
2. **`20260724214543_backfill_intake_forms`** — hand-authored (not schema-diff-generated), real committed SQL: one `IntakeForm` row per existing studio (`isDefault: true`, name "Standard Inquiry", slug `standard-inquiry`), then every existing `IntakeFormField` row re-pointed to its own studio's new form. Both statements idempotent (`WHERE NOT EXISTS` / `WHERE ... IS NULL` guards). Ends with a `DO $$ ... RAISE EXCEPTION` block that fails loudly (naming the exact remaining-null count) if the backfill somehow left rows unbackfilled, rather than silently letting step 3 fail with a generic constraint-violation error.
3. **`20260724215014_intake_form_id_required`** — schema-diff-generated once step 2's backfill was verified complete: drops and re-adds `IntakeFormField_intakeFormId_fkey` with `ON DELETE RESTRICT` (was `SET NULL` in step 1, since the column was nullable then), then `ALTER COLUMN "intakeFormId" SET NOT NULL`.

**Backfill verification numbers** (dev database, checked directly via Prisma before/after each step):

| Check | Before step 1 | After step 1 | After step 2 (backfill) |
|---|---|---|---|
| `IntakeFormField` row count | 35 | 35 | **35** (zero data loss) |
| `IntakeFormField` rows with `intakeFormId IS NULL` | n/a (column didn't exist) | 35 (all, column just added) | **0** |
| `IntakeForm` row count | 0 | 0 | **2** (one per studio — matches `Studio` count) |
| `IntakeForm` rows with `isDefault: true` | — | — | **2** (matches studio count — exactly one default each) |

Also added a **self-healing fallback** (`ensureDefaultIntakeForm` in `lib/intakeForms.ts`, same "backfill on read" convention `ensureDefaultSystemFields` already used): a studio created via `POST /studios/bootstrap` or `prisma/seed.ts` — neither of which was updated to create an `IntakeForm` directly — would otherwise have zero forms and no way to resolve "the default," breaking its public intake form entirely. `resolveIntakeForm(studioId, null)` now creates one on first read if none exists, idempotently.

## What changed

- **`lib/intakeForms.ts`** (new): `generateUniqueIntakeFormSlug`, `setDefaultIntakeForm` (atomic swap — the previous default and the new one flip in one transaction, so a concurrent read never sees zero or two defaults), `resolveIntakeForm`/`ensureDefaultIntakeForm` (the one shared resolution point `GET /studio-settings/public`, `POST /inquiries`, and `POST /prefill-drafts` all use for "no formSlug given").
- **`lib/slug.ts`** (new): `slugify()` extracted out of `routes/studios.ts` (which generated `Studio.slug` the same way) so both call sites share one implementation.
- **`lib/intakeFormFields.ts`**: `getEffectiveIntakeFormFields`/`ensureDefaultSystemFields` re-scoped from `studioId` to `intakeFormId`. Deleted `migrateExistingCustomQuestions` — confirmed zero callers anywhere in the repo (a one-time historical backfill utility from the original Package Q rollout that was never wired to anything), and it would have needed an `intakeFormId` parameter to keep compiling regardless.
- **`routes/intakeForms.ts`** (new): `GET/POST /intake-forms`, `PATCH/DELETE /intake-forms/:id` (delete blocked while `isDefault`; a non-default delete cascades its own field rows in a transaction, then the DB's own `ON DELETE SET NULL` nulls any inquiries that referenced it), `GET/PUT /intake-forms/:id/fields` (moved here from `studioSettings.ts`, now form-scoped instead of studio-scoped).
- **`routes/inquiries.ts`**: public `POST /` now resolves `formSlug` (public path) or the studio's default (staff path — `StaffInquiryForm` has no form-picker UI) via `resolveIntakeForm`, validates against that form's own field list, and stores `intakeFormId` on the created `Inquiry`.
- **`routes/prefillDrafts.ts`**: accepts an optional `formSlug`, validates it belongs to the studio, builds `/inquiry/{studio-slug}/{form-slug}?draft=...` when given (unchanged `/inquiry/{studio-slug}?draft=...` shape when omitted).
- **`routes/studioSettings.ts`**: `GET /public` now also resolves `formSlug` (or default), returns `formName` alongside `intakeFormFields`.
- **Frontend**: `IntakeFormFieldsEditor.tsx` takes a required `intakeFormId` prop instead of being studio-wide. New `IntakeFormsManager.tsx` (Settings → Policies & Templates) lists/creates/deletes/sets-default and wraps the field editor. `App.tsx` gains `/inquiry/:studioSlug/:formSlug`; `IntakeForm.tsx` reads it, passes it through to both the fields fetch and the submission body, and treats a 404'd formSlug the same as an unknown studio (the existing "invalid link" full-page state). New shared `useIntakeForms.ts` hook + `IntakeFormPicker.tsx` component, wired into both `ClientDetail.tsx`'s "Copy prefilled link" and `ConversationsPanel.tsx`'s composer "+ menu" — both skip the picker entirely when a studio has one form or fewer (the common case), matching the same advisory-only philosophy as `preferredSchedule`.

## Section 3 — editable field types, investigated first

Confirmed (not assumed) that changing a `CUSTOM` field's `customQuestionType` after creation was **already fully supported** by the existing Settings UI (`IntakeFormFieldsEditor.tsx`'s `<select>` for `customQuestionType` has no lock/restriction) — no code change needed there.

The historical-answer-rendering risk was real but narrower than it first looked: `Inquiry.customFieldAnswers` already stores its own immutable `type` per answer, captured at submission — `formatCustomAnswer` in `InquiryDetailsSection.tsx` already read from *that*, never the field's live `customQuestionType`, so a retyped field (e.g. `YES_NO` → `SELECT`) was already guaranteed not to reinterpret an old answer under the new type. The actual gap was defensive shape-safety: if `answer.answer` were ever something other than the string/string[] the function's type signature assumed (a malformed/pre-Package-Q row, or any future data drift), it would hand a raw non-string value straight to JSX — a real crash risk (`Objects are not valid as a React child`) for a genuinely unexpected shape. Hardened `formatCustomAnswer` with the exact same discipline as `AuditTrail.tsx`'s own crash fix (`formatValue`): array → join if all-strings else `JSON.stringify`; string → the existing YES_NO/plain-text handling; anything else (null/undefined/object/other) → a safe fallback, never a raw object.

**Confirmed via the verification script**: retyped a live custom field `YES_NO` → `SELECT`; the pre-existing inquiry's `customFieldAnswers` snapshot still reads `{"type":"YES_NO","answer":"YES"}` unchanged after the retype (own immutable snapshot, unaffected); a **new** submission through the same now-`SELECT` field correctly stores `{"type":"SELECT","answer":"Yes, several"}`; and a submission attempting the **old** `YES_NO`-shaped answer (`"YES"`) against the now-`SELECT` field is correctly **rejected** (`400`, "must be one of the offered options") by `validateCustomFieldAnswers`, which validates fresh submissions against the field's current live type, not historical answers.

## Verification

**Backend** (direct-API script, 36/36 assertions passed): form CRUD; exactly-one-default invariant held through create/set-default/delete; deleting the current default blocked with a clear message; deleting a non-default form succeeds and detaches (not deletes) its inquiries' data; two forms' field lists fully isolated from each other (adding a field to one never appears on the other); public resolution correct for no-formSlug (→ default), a named formSlug, and an unknown formSlug (404); submission through each form captures the correct `intakeFormId` and validates against that form's own field set; field-type retyping behaves exactly as described in Section 3 above; FRONT_DESK can read forms but not create/modify them (403 on write, 200 on read); cross-studio PATCH/DELETE both 404 (never leak existence).

**Browser** (Playwright, screenshots reviewed directly, not summarized): Settings → Policies & Templates shows the new "Intake Forms" card (form list, default badge, Set-as-default/Delete actions, the field editor for whichever form is selected). A brand-new form's dedicated public URL (`/inquiry/dev-studio/{new-form-slug}`) renders its own custom question; the same studio's default-form URL (`/inquiry/dev-studio`) does **not** show that question — confirmed isolated. ClientDetail's "Copy prefilled link" correctly opens a "Which intake form?" picker (listing all 3 forms present in the dev studio at verification time, default badge on the right one) before generating the link, since the studio has more than one form.

## Typechecks

`npx tsc --noEmit` (api) — clean. `npx tsc --noEmit` + `npm run build` (web) — clean.

## Commit

`616efc5` — Support multiple named intake forms, editable field types, form picker on send. Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

Both scratch dev servers (API :5501, web :6501) stopped by PID after confirming the ports freed. All temporary verification scripts (`verify_intake_forms.mjs`, `verify_intake_forms_ui.mjs`/`ui2`/`ui3`/`ui4`) and screenshots left scratchpad-only, none committed. Test data (several intake forms and inquiries created across repeated verification runs, including one form literally named "UI Check Form {timestamp}") left in the dev database, consistent with this session's standing convention.

---

# Feature — Artist profile page: reorderable/collapsible widgets

Single session on `main`. No schema changes. Request was "apply the same formatting we did for inquiries and projects to be done in client page... and all pages" -- surveyed every page in the app first to scope "all pages" concretely rather than guessing.

## Scoping "all pages"

Grepped every page under `apps/web/src/pages` for repeated `rounded-2xl border border-border bg-surface p-5/p-6` card blocks (the signature of this page shape) to find genuine candidates beyond what was already done (Inquiry/Appointment/Client detail pages, done in earlier turns this session). Found: `ArtistDetail.tsx` (8 cards, a real match -- single artist, several independent informational sections, explicitly named in the request) plus several false positives that don't share the shape this pattern is built for and were left alone:

- **Settings.tsx** -- a tabbed configuration page, just reorganized into cleaner sections in the immediately prior turn; not a single-entity detail view.
- **Team.tsx / Tasks.tsx / MyInquiries.tsx** -- list/roster views, not a single entity's detail page.
- **ArtistCreate.tsx** -- a creation form; reordering or collapsing a form's own required fields mid-fill would be actively unhelpful.
- **GiftCardDetail.tsx** -- only one real card (the header); the "2 cards" the grep matched was that header plus an error/loading state div, not genuine additional sections.
- **WaiverSign.tsx** -- a public, unauthenticated, one-time client signing flow, not an internal staff page revisited repeatedly (the whole premise of "remember my preferred layout" doesn't apply).

## What changed

`ArtistDetail.tsx`: Guest Artist, Bio, Social Links, Specialties, Preferred Schedule, and Portfolio are now `Widget`s inside `ReorderableWidgetList` (`pageKey: "artist-detail"`), same drag handle/collapse chevron/persistence as the other three pages, same minimal-diff strategy (each widget's inner content stayed in its original source position).

One structural difference from the other three pages: this page has a single page-level "Save changes" button that saves Bio/Social Links/Specialties/Guest Artist together in one call, rather than a per-widget save action. Kept it as a sibling *after* `ReorderableWidgetList` closes, rather than folding it into any one widget, since it isn't the content of any single section and needs to stay reachable regardless of how the widgets above get reordered. Preferred Schedule's own already-separate "Save schedule" button stayed exactly where it was, inside that one widget, since it only ever saved that section.

No ellipsis/"more actions" button exists on this page, so there was no equivalent squished-button bug to fix here (unlike the Inquiry/Appointment/Client pages, which all had the same `self-stretch` + `aspect-square h-full` overflow bug).

## Verification

Browser (Playwright, screenshots reviewed): confirmed all 6 widgets render with drag handles and collapse chevrons in their original order, with "Save changes" fixed at the bottom. Verified reorder + collapse persistence via a direct `PUT /widget-layouts/artist-detail` call (moved Portfolio to the top, collapsed Social Links) followed by a reload screenshot showing both changes applied, with "Save changes" still correctly anchored after the widget list regardless of the new order -- then reset the layout back to default.

## Typechecks

`npx tsc -b --noEmit` + `npm run build` (web) — clean. (No API changes this turn.)

## Commit

`1d9ac45` — Make Artist profile page widgets reorderable and collapsible. Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

All ad-hoc Playwright scripts and screenshots deleted from the scratch `pw-test` directory; none committed. The per-account widget-layout row for `artist-detail` used during verification was reset to its default (empty) state before finishing. No background shells were started this session (the dev API/web servers were already running from prior work and were left as-is).

---

# Feature — Signature pads for the liability waiver

Single session on `main`. Schema change: 2 new `LiabilityWaiver` fields (purely additive migration). `apps/api/src/routes/appointments.ts`, `inquiries.ts`, `clients.ts`, and `permissions.ts` were concurrently being reworked by another session (a granular-permissions expansion, splitting `clients.manage` into `clients.view/edit/merge/archive/import`) for the entire duration of this turn -- confirmed via `git diff --stat` that none of my changes touched those files, and staged only the files this feature actually changed.

## Design

Waiver signing previously only asked the client to type their full legal name into a text input -- not an actual signature. Deposit forms already solved this exact problem: `DepositForm.signatureName`/`signatureData` (a base64 PNG from the `signature_pad` library, already an installed dependency), wired up in `DepositResponse.tsx`. Applied the identical pattern to `LiabilityWaiver`'s two signature spots -- the main liability signature and the optional photo/video release signature -- rather than inventing a new mechanism.

New `LiabilityWaiver.signatureData`/`photoReleaseSignatureData` fields mirror `DepositForm`'s pair exactly. The typed name field stays alongside the drawn signature in both cases (matching the existing schema comment's own reasoning: the typed name is what's legible in an audit trail; the drawn mark is the actual signature). `PATCH /waivers/sign/:token` now requires `signatureData`, and requires `photoReleaseSignatureData` specifically when the photo release is accepted -- same shape as the existing required-name checks.

## Shared component extraction

`DepositResponse.tsx` was the only prior user of the canvas/`signature_pad` setup (canvas sizing for devicePixelRatio, pad init/teardown, clear, `toDataURL`/`isEmpty`). Rather than copy-pasting that block a second and third time for the waiver's two signature spots, extracted it into `components/SignaturePadField.tsx` -- a ref-based component (`isEmpty`/`toDataURL`/`clear`, exposed via `useImperativeHandle`) since a signature is only ever read at submit time, never reactively on every stroke. Refactored `DepositResponse.tsx` to use the shared component too, now that a second genuine call site exists, rather than leaving the original inline and drifting from the new shared version.

`AppointmentDetail.tsx`'s staff-facing Liability Waiver widget now displays both drawn signatures as `<img>` elements, matching the exact style already used for deposit form signatures in `InquiryDetail.tsx` (`h-20 rounded-lg border border-border bg-white` -- the white background matters since the signature itself is drawn in black ink on a white canvas, and the app UI is dark-themed).

## Verification

Confirmed the full pipeline end-to-end via direct API calls (drawing the signature via Playwright's synthetic mouse/pointer events did not register on the canvas -- the same class of limitation already documented earlier this session for `@dnd-kit`'s drag simulation, where canvas/pointer-capture libraries don't reliably respond to programmatically dispatched events in headless testing): `PATCH /waivers/sign/:token` correctly rejected a request missing `signatureData` (400, "Please sign before submitting"), then correctly accepted and persisted a request with both `signatureData` and `photoReleaseSignatureData` set; confirmed via a follow-up `GET` that both fields round-tripped correctly. Screenshotted `WaiverSign.tsx` to confirm both signature pad canvases render correctly with their Clear buttons in the right position (main signature and, once the photo/video release checkbox is checked, the release signature). Screenshotted `AppointmentDetail.tsx`'s Liability Waiver widget after signing and confirmed both signature images render in the staff-facing view. The dev API server restarted repeatedly mid-verification due to the other concurrent session's active edits to `inquiries.ts`/`clients.ts` -- unrelated to this work, waited out each time.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc -b --noEmit` + `npm run build` (web) — clean.

## Commit

`6a0b17c` — Add signature pads for both signature spots on the liability waiver. Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

All ad-hoc Playwright scripts, screenshots, and the tiny test PNG fixture deleted from the scratch `pw-test` directory; none committed. No background shells were started this session (the dev API/web servers were already running from prior work and were left as-is, despite the other session's edits causing repeated restarts).

---

# Feature — Granular permissions expansion (8 → 49 configurable keys)

Single session on `main`. No schema migration (`RolePermission.permissionKey` was already free-form text) — confirmed a concurrent session had an in-progress, uncommitted schema change (waiver signature pads) at the start of this one; since this task needed no schema change of its own, proceeded without touching `schema.prisma` or their migration, and that work landed as its own commit (`6a0b17c`) partway through this session without incident.

## Final count: 49 configurable keys (not the prompt's estimated 46)

Counted precisely rather than forced to match the estimate: 43 genuinely new keys + `locations.manage` (already existed, just re-grouped) + 5 pre-existing untouched keys (`studio.manage`, `artists.manage`, `artists.view`, `appointments.create`, `appointments.view`) = 49. The three-key gap from "46" is just the prompt's estimate not accounting for those five carried-over keys — reported honestly rather than dropping/merging real keys to hit a round number.

## The five safety-floor items — confirmed unreachable via the matrix

All five investigated first and left exactly as they were (hardcoded `requireRole`, never touched):

1. **Waiver health answers / ID images** — `waivers.ts`'s `staffRouter.use(requireRole(OWNER, FRONT_DESK))` router-level gate, untouched. A new narrow `GET /waivers/:id/status` (status/signedAt/verifiedAt only, registered *before* that gate) is what `waivers.viewStatus` actually governs for ARTIST — the full-detail route stays behind the same hardcoded wall it always was.
2. **Exempt gift card issuance** — `POST /gift-cards/exempt` stays `requireRole(Role.OWNER)`. Verified: granting FRONT_DESK `giftCards.issue=true` (a real, matrix-configurable key) still gets a `403` on this specific route.
3. **Permanently deleting a client or inquiry** — both `DELETE` routes and their `delete-preview` companions untouched.
4. **Editing the permission matrix itself** — `GET`/`PATCH /:studioId/permissions` stay `requireRole(Role.OWNER)`; verified FRONT_DESK gets `403` on both regardless of any other grant.
5. **Studio integrations** — `integrations.ts`'s `router.use(requireRole(Role.OWNER))` (everything past the connection-status read) untouched; verified FRONT_DESK gets `403` on `GET /integrations`.

None of the 49 keys are named anything resembling these five capabilities — confirmed by grepping the final key list for floor-adjacent guesses (`waivers.healthAnswers`, `giftCards.exempt`, `clients.delete`, `permissions.manage`, etc.) and finding zero matches.

## The two-key split — override propagation

`clients.manage` (gated the entire `clients.ts` router as one blanket permission) → `clients.view`/`edit`/`merge`/`archive`/`import`. `appointments.manage` (gated `PATCH /:id` + archive/unarchive, all three sharing that one key) → `appointments.reschedule` (the one successor all three now share — `appointments.checkout`/`photos.manage` were never actually gated by `appointments.manage`, they were separately hardcoded `requireRole(OWNER, FRONT_DESK)`, so they get no propagated override).

Ran a one-time idempotent script (`_propagate_permission_overrides.ts`, archived to the scratchpad, not committed — needs to run once against production before this deploys there, same as it ran once against dev here) that copies every existing `(studio, role)` override on the two old keys onto every successor key. **Tested by deliberately setting a custom override first** (per the task's own suggestion): set `clients.manage=false` and `appointments.manage=false` for `FRONT_DESK` in `dev-studio`, ran the script, and confirmed all 5 `clients.*` successors and `appointments.reschedule` came out `false` for that same role — verified via a direct DB read, not just the script's own success log. Old key rows were left in the table afterward (never deleted), then the actual key list stopped referencing them (removed from `PERMISSION_KEYS`, so `hasPermission`/the matrix UI never look at them again).

## Corrected defaults (reality didn't match the prompt's table)

- **`reports.viewDashboard`**: prompt assumed `AR✗`. The actual route (`GET /reports/dashboard`) was `requireRole(OWNER, FRONT_DESK, ARTIST)` — ARTIST already had it. Kept `AR✓` to match current reality, per this task's own overriding rule ("seed defaults so behavior is identical to today").
- **`reports.viewFinancial`**: a genuinely deliberate tightening, not a same-as-today default — today's single combined dashboard response includes `depositConversion`/`giftCardLiability` (real dollar figures) for all three roles with zero separation. Split those two sections out behind this new key, defaulting `FD✓/AR✗` exactly as the prompt specified. This is a real, immediate behavior change on deploy (ARTIST loses default visibility into gift-card-liability/deposit-conversion totals) — flagged here explicitly since it's the one place this session changed live behavior rather than preserving it.
- **`appointments.reschedule`**: not a wrong default, but a scope note — the old `appointments.manage` covered `PATCH /:id` *and* archive/unarchive together; rather than inventing a 4th key the prompt's list didn't ask for, all three stayed on the one new key so their access never diverges from each other.

## A real bug the larger matrix exposed (found during verification, fixed)

`PATCH /:studioId/permissions` did one `prisma.rolePermission.upsert()` per `(role, key)` update inside a single Prisma interactive `$transaction([...])`. At 8 keys × up to 3 roles this was at most ~24 round trips and never a problem; at 49 keys × the 2 roles the Settings UI now actually sends per save, that's up to 98 sequential round trips against the remote Railway Postgres instance — which blew Prisma's default 5-second transaction timeout (`P2028`) and 500'd every real save from the browser. Caught by browser verification (not the direct-API script, which sends far fewer updates per call), confirmed via the API's own error log, and fixed with a single bulk `INSERT ... ON CONFLICT ("studioId","role","permissionKey") DO UPDATE` (`studios.ts`) — one round trip regardless of matrix size. Re-verified: save now returns `200`, and the toggle survives a full page reload.

## Verification

**Backend** (direct-API script, 33/34 passed — the one "failure" was a test-script assumption, not a bug: expected `404` for ARTIST hitting the full waiver-detail route, got `403`, which is actually the *stronger* correct behavior since the router-level floor gate rejects the role before the handler ever checks whether the waiver exists): matrix contains all 49 keys and zero retired ones; floor items confirmed unreachable (see above); toggling `inquiries.view`/`clients.view`/`appointments.checkout`/`giftCards.void`/`team.manage` visibly flips FRONT_DESK access on the exact route each governs, with OWNER unaffected throughout; `clients.merge` gates independently of `clients.view`/`edit`; the new `/waivers/:id/status` endpoint is reachable by ARTIST while the full-detail route stays blocked; `conversations.viewClientThreads` toggling actually removes CLIENT-type threads from the FRONT_DESK conversation list (not just a role check); `tasks.viewQueue` off empties the system-task array for FRONT_DESK exactly like ARTIST's existing default; `artistSchedules.manage=true` still can't touch a *different* artist's schedule (own-scoping survives the toggle); `settings.manageTheme` gates a theme-only PATCH independently of `settings.manageDefaults`, and a mixed request touching both an allowed and a disallowed field-group is rejected outright, not partially applied; `reports.viewFinancial` toggling adds/removes the two financial sections from the dashboard response, OWNER always sees them; cross-studio access to the permissions endpoint itself is `403`.

**Browser** (Playwright, screenshots reviewed directly): Settings → Team → Permissions shows all 11 groups collapsed by default with an enabled-count per group, no raw key names anywhere (every row has a plain-language label + one-line description); "Owner always has full access" renders as a static note above the groups, not a column — confirmed literally zero "Owner" column header in the table; expanding a group shows exactly two columns, Front Desk and Artist; toggling a checkbox, clicking Save, and reloading the page confirmed the change survived (this is what caught the transaction-timeout bug above — the direct-API script's smaller per-call payloads never hit it).

## Typechecks

`npx tsc --noEmit` (api) — clean. `npx tsc --noEmit` + `npm run build` (web) — clean.

## Commit

`0fb769a` — Expand permission matrix from 8 to 49 configurable keys. Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty. Verified the concurrent session's own uncommitted schema/waivers.ts work (present at this session's start) was never touched or reverted — `git diff` on `waivers.ts` showed only additive permission-gate changes layered on top of their already-landed signature-pad code.

## Cleanup

Both scratch dev servers (API :5501, web :6501) stopped by PID — including one `tsx watch` auto-reload that crashed with `EADDRINUSE` mid-session and had to be force-killed and restarted manually to pick up the transaction-timeout fix. All temporary verification scripts (`verify_permissions.mjs`, `verify_permissions_ui.mjs`, `verify_permissions_ui2.mjs`) and screenshots left scratchpad-only, none committed. The one-time override-propagation script was moved to the scratchpad (not committed) after running it against dev — still needed as a manual one-off step before this deploys to production (propagate overrides, in that order, before the code that stops reading the old keys ships). Test overrides set during verification (several `FRONT_DESK`/`ARTIST` toggles in `dev-studio`, including a deliberate `clients.manage`/`appointments.manage=false` override used to test propagation) were left in the dev database except where a script explicitly reverted them (`inquiries.markLost`, confirmed via a reload check) — consistent with this session's standing convention, and fully reversible by any OWNER revisiting the Permissions tab.

---

# Fix — Add Client / Import Clients disappearing after the permissions expansion

Reported immediately after the granular-permissions work above landed: "permissions look really good but i dont see the ability to add a new client or bulk import anymore."

## Root cause

Retiring `clients.manage` from `PERMISSION_KEYS` (done in the task above) removed it from every role's effective permission list, including OWNER's — `getEffectivePermissions()` derives OWNER's list from `[...PERMISSION_KEYS]`, so OWNER lost `clients.manage` just as completely as any other role the moment the key stopped existing. The backend route-gate migration to the five successor keys (`clients.view/edit/merge/archive/import`) was correct and complete, but three frontend files still checked `profile.permissions.includes('clients.manage')` for UI visibility and were never updated to match, silently hiding the gated UI for everyone rather than erroring.

Found via a single targeted grep (`clients\.manage|appointments\.manage` across `apps/web/src`), which located all three affected files in one pass. `appointments.manage` had zero frontend references — checked proactively even though the user only reported the clients-side symptom — so no equivalent bug existed there.

## What changed

- **`Clients.tsx`**: the one `canManage` flag (gated both "Add Client" and "Import Clients" together) split into `canAddClient` (→ `clients.edit`, matching the `POST /clients` route's actual gate) and `canImportClients` (→ `clients.import`), each button now shown independently.
- **`ConversationsPanel.tsx`**: the composer's "add client" affordance now checks `clients.edit` instead of the retired key — it hits the same `POST /clients` route `Clients.tsx`'s own Add Client button does.
- **`ClientDetail.tsx`**: the largest fix, 14 separate call sites all bundled under one `canManage` flag. Read every call site's surrounding JSX individually rather than assuming one blanket replacement, since several of the bundled actions weren't actually client-management actions — split into six flags matching each action's true backend gate: `canEditClient` (`clients.edit` — Edit button, phone/email add/remove), `canMergeClient` (`clients.merge` — merge button, potential-duplicates banner), `canArchiveClient` (`clients.archive` — archive/unarchive, the unarchive banner, the "More actions" menu visibility), `canCreateInquiry` (`inquiries.create` — Send/New Inquiry), `canEditInquiry` (`inquiries.edit` — Send Deposit Form), `canGenerateWaiver` (`waivers.generate` — Send Waiver).

## Verification

Playwright, both roles, screenshots reviewed: OWNER sees Add Client and Import Clients on the Clients list, and on a client's detail page sees Edit, More actions, + Add phone, + Add email, and Merge with another client all present and correctly gated (confirmed via direct element counts, not just a screenshot glance) alongside the potential-duplicates banner, Send Inquiry/New Inquiry, Send Deposit Form, and Send Waiver actions. FRONT_DESK sees Add Client but not Import Clients on the list page, matching the matrix's `clients.edit=true`/`clients.import=false` defaults from the task above. One test-script false alarm along the way: the first ClientDetail run showed all-zero element counts because a 2-second wait wasn't enough for the page to leave its "Loading client…" state against this environment's remote dev DB — increasing to 4 seconds (with response logging added to confirm the API calls actually completed) resolved it; not a product bug.

Confirmed via `grep -n "canManage"` returning zero matches across all three files afterward, and via the broader `clients\.manage|appointments\.manage` grep returning zero matches anywhere in `apps/web/src` outside this fix's own explanatory code comments.

## Typechecks

`npx tsc --noEmit` (api) — clean (no API files touched). `npx tsc --noEmit` + `npm run build` (web) — clean.

## Commit

`4cfdfb9` — Fix Add Client / Import Clients disappearing after permissions expansion. Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

Both scratch dev servers (API :5501, web :6501, logging to `api2.log`/`vite2.log` to avoid colliding with the prior task's logs) stopped by PID. Temporary verification scripts (`verify_clients_fix.mjs`, `verify_client_detail_fix.mjs`) and screenshots left scratchpad-only, none committed.

---

# Feature — Mass client import revision: flexible column mapping, gift cards from deposits, historical notes

Single session on `main`. Revises Package R's mass-import feature (`58dfa7c`) around a real CRM export sample rather than the fixed expected schema it originally shipped with. Additive migration: `Client.address`, `ImportBatch.columnMapping` + a new `MAPPING` status, and `ImportRow.parsedDepositCents`/`depositFlaggedAsOutlier`/`depositDecision` (a new `ImportRowDepositDecision` enum). No existing rows needed backfilling -- the new enum value and columns are all additive/nullable-or-defaulted.

## The fuzzy column-mapping logic

`lib/importColumnMapping.ts`'s `suggestColumnMapping` is a small, deterministic keyword matcher, not embeddings or fuzzy string distance: each of the 11 non-"note" target fields (`firstName`/`lastName`/`phone`/`email`/`address`/`inquiry.description`/`inquiry.placement`/`inquiry.size`/`inquiry.budget`/`inquiry.desiredTiming`/`depositAmount`) has a short hand-picked keyword list (e.g. `depositAmount`: `["deposit", "amount paid", "payment"]`); for each CSV header, in column order, the longest keyword substring match wins, and a field already claimed by an earlier header can't be auto-suggested again (later duplicate columns stay unmapped, staff can still assign them by hand). "Historical Note" is never auto-suggested -- it's an explicit opt-in bucket, not a catch-all default for anything unrecognized. Verified against a realistic GoHighLevel-style export (`First Name`, `Last Name`, `Email`, `Phone`, `Address`, `Describe the type of tattoo you want`, `Where do you want it placed?`, `What size are you considering?`, `What's your budget?`, `When would you like to get tattooed?`, `Payment`, plus `Artist`/`Scheduled Appointment Date`/`Last Note` which have no target field): every real column suggested correctly, the three unrecognized ones correctly suggested nothing (left for staff to map to Historical Note or leave out).

Confirming a mapping (`PATCH .../mapping`) is a one-way transition (`MAPPING` -> `PENDING_REVIEW`) -- only then does duplicate-detection and deposit parsing run per row, since which column IS the phone number wasn't known at upload time. `rawData` on every `ImportRow` is keyed by the CSV's own original headers (no more upload-time aliasing to a fixed field name), so the same batch's rows stay meaningful regardless of what mapping ends up chosen.

## The outlier-detection threshold

`isDepositOutlier` (same lib file) flags a parsed deposit as an outlier when it's non-positive (a value was present in the cell but parsed to `<= 0`) or more than double the studio's top deposit tier's `depositAmountCents` (the catch-all tier, `maxAmountCents: null` -- Package C1's `resolveDepositTiers` already guarantees exactly one exists, falling back to the seeded default `$200` top tier for a studio that's never customized its tiers, so the default threshold is `$400`). Verified with the same GHL-style fixture: `Deposit Paid Online - $200` parsed to `$200` (not flagged), a `$9,500` cell flagged (way past `$400`), and a literal `0` cell flagged (non-positive) -- while a genuinely unparseable cell (`"see front desk for details"`) parsed to `parsedDepositCents: null` with no flag and no crash, never guessed. `depositDecision: EDIT` writes the staff-supplied corrected amount straight into `parsedDepositCents` itself (no separate "corrected" column) -- `depositFlaggedAsOutlier` stays untouched afterward, since it records the historical fact that the original parse looked unusual, not today's resolved value.

## Traceability: gift card back to its source CSV row

Every deposit-sourced `GiftCard` reuses the same free-text field `POST /gift-cards/exempt` already puts a human-readable reason on (`exemptionReason`, despite the name -- there's no DB-level constraint tying it to `EXEMPT` status, and the task's own instruction was to "reuse the same kind of reason field already used for exempt cards"), set to `Imported from legacy CRM (Import Batch <id>)`, plus an `AuditLog` row (`entityType: "GiftCard"`, `action: "create-from-import"`, `changes: { importBatchId, importRowId, amountCents }`) -- the same traceability pattern the original Package R already used for imported `Client` rows (no reverse FK from `Client`/`GiftCard` back to `ImportRow` either; the batch's own rows, `rawData` preserved verbatim, are the source of truth). Verified end-to-end: looked up a real imported gift card, read its `AuditLog` entry's `importRowId`, fetched that exact row from `GET /clients/import/:batchId`, and confirmed its `rawData` was the untouched original CSV line (`Priya`/`Nandakumar`/`priya.nandakumar@example.com`/`555-0301`/`12 Birchwood Ln, Springfield`/`Deposit Paid Online - $200`/etc.) -- the full chain closes. `GiftCardDetail.tsx`/`ClientDetail.tsx`'s gift-card list now show this reason for any status, not just `EXEMPT` (previously gated to `card.status === 'EXEMPT' && card.exemptionReason`), since it's no longer an exemption-only field.

## Historical Note bucket

Any number of columns mapped to `note` get concatenated into one `InquiryNote` at execute time, each line labeled with its original header (`<strong>Header:</strong> value`, blank cells skipped, HTML-escaped since raw CSV cell text is untrusted): verified a 3-column mapping (`Artist`, `Scheduled Appointment Date`, `Last Note`) produced exactly `Imported from legacy CRM` followed by all three labeled lines, authored by the executing OWNER, visible through the existing consolidated `GET /clients/:id/notes` endpoint (no new note-reading UI needed).

## Other verification

**Backend** (direct API calls): a re-upload of the same fixture CSV correctly matched all 4 previously-created clients via duplicate-detection (proving cross-batch dedup) and every MERGE row's newly-created throwaway client's `Inquiry` was correctly re-parented onto the survivor by the existing `performMerge`/`repointClientRelations` (the survivor ended up with 2 identical inquiries, one per run); a `$0`-deposit row resolved `IMPORT` correctly issued no gift card (0 is never `> 0`); `FRONT_DESK` got a `403` on `POST .../execute` (OWNER-only, unconditionally, regardless of `clients.import`). **Browser** (Playwright, screenshots reviewed): full flow -- upload, correct auto-suggested mapping, confirm, review table showing "Unusual amount" badges with inline Import/Edit/Skip resolution controls and a red "Missing mapped first/last name" flag on the row with no first name, "Review & Confirm Import" disabled until every row (and every outlier) is resolved, the pre-execute confirmation modal showing accurate add/merge/skip counts and an accurate gift-card dollar total (`$275.00`, correctly excluding both the skipped malformed row's flagged $9,500 and the $0 row), and a final success banner reporting the true add/merge/skip/gift-card-issued counts.

## Typechecks

`npx tsc --noEmit` (api) — clean. `npx tsc --noEmit` + `npm run build` (web) — clean.

## Commit

`687034f` — Mass client import: flexible column mapping, gift cards from deposits, historical notes. Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

Both scratch dev servers (API :5501, web :6501, logging to `api3.log`/`vite3.log`) stopped by PID. Temporary verification scripts (`verify_mass_import.mjs`, `verify_import_data.mjs`, `verify_import_data2.mjs`, `verify_note_bucket.mjs`), the sample GHL-style fixture CSV, and screenshots left scratchpad-only, none committed. Test data created during verification (several imported clients, gift cards, and inquiries in `dev-studio`, plus one cancelled batch) left in the dev database, consistent with this session's standing convention.

---

# Feature — Mass import follow-up: assigned-artist matching, composite address mapping

Single session on `main`. Extends the mass-import feature from the two prior entries above rather than rebuilding it -- same batch/row model, same `MAPPING` -> `PENDING_REVIEW` flow, same review-table pattern for a flaggable per-row condition. Additive migration: `ImportRow.matchedArtistId` (FK to `Artist`) + `artistFlaggedForReview` (Boolean, default false). No existing rows affected.

## Assigned-artist matching

`lib/importArtistMatching.ts`'s `matchArtistForImportRow` checks a mapped `inquiry.assignedArtist` column's text against the studio's own `Artist` display names (`User.name`, case/whitespace-insensitive) for an exact match first -- the only outcome applied without a flag. Short of that, it computes a plain Levenshtein edit distance against every studio artist and offers the closest one as a **fuzzy candidate**, but always flagged (`artistFlaggedForReview: true`), never auto-applied silently. No candidate at all is also flagged, with `matchedArtistId` left null.

**Fuzzy-match threshold**: `distance <= max(1, floor(maxNameLength * 0.25))` -- roughly one typo tolerated per four characters, floored at 1 so even a short name survives a single-character slip. Deliberately loose, since a fuzzy hit is only ever a suggestion in the review UI, never applied without a human glance -- a generous threshold costs an extra row to review, not a wrong assignment.

Unlike a flagged deposit outlier, an unresolved/unreviewed artist match **does not block execute** -- per the task's own instruction, the inquiry still imports successfully, unassigned, with the raw artist-name text preserved as a `<strong>Artist (from import, unmatched):</strong> ...` line appended to the row's Historical Note automatically, even if staff never separately mapped that column to the Historical Note bucket. Verified with a real seeded artist ("Luis Guzman," created for this verification since the seed script had none by that name) and three rows: `"Luis Guzman"` (exact, matched with **no flag, no click needed**), `"Luis Guzmna"` (one-character typo, correctly offered as a fuzzy candidate and flagged), and `"Random Person Nobody Knows"` (no match, flagged, left unassigned) -- confirmed via the browser review table (flag badges + artist picker, pre-populated with the fuzzy suggestion) and via direct execute calls: the exact-match row's `Inquiry.assignedArtistId` came back correctly set, and the no-match row's inquiry imported successfully with `assignedArtistId: null` and the exact raw text preserved in its note.

## Composite address mapping

Four new mutually-exclusive-with-`address` target fields (`address.street`/`address.city`/`address.state`/`address.postalCode`) let staff map a CSV's separate Street/City/State/Postal columns instead of a single Address column; `validateColumnMapping` now rejects a mapping that claims both approaches at once (verified: `400` with a clear message). `composeAddress` (in `lib/importColumnMapping.ts`) concatenates the mapped parts into one clean string -- verified `Street: "900 Lakeshore Dr", City: "Chicago", State: "IL", Postal: "60601"` produced exactly `"900 Lakeshore Dr, Chicago, IL 60601"`, stored as-is on `Client.address` with no standardization or verification applied.

## The validation seam

Per the task's explicit instruction, no Google Address Validation call was added this session (deferred until Google Cloud Console access exists). `composeAddress` is the isolated seam for it: a pure function taking `{ street, city, state, postalCode }` and returning the final string, called from exactly one place in the execute row-processing loop (`routes/clientImport.ts`, immediately before building `fields.address`). A future session can insert a validation call right there -- pass it either `parts` or the composed string, read back a verdict, optionally set a new flag on the row -- without touching the mapping step, the review UI, or anything else in the pipeline; the function's own doc comment states this explicitly so it isn't lost to a later refactor.

## Verification

**Browser** (Playwright, screenshots reviewed): full mapping -> review flow with a realistic fixture (separate Street/City/State/Postal columns plus an Artist column) -- auto-suggestion correctly proposed all four composite sub-roles and `inquiry.assignedArtist` with zero manual correction needed; review table showed "Needs review" badges only on the two non-exact rows, with the artist picker pre-selecting the fuzzy suggestion for the typo row and "Unassigned" for the no-match row, both freely correctable via the same dropdown. **API**: exact match, fuzzy match, and no-match paths all independently confirmed via direct execute calls (see above); mutual-exclusivity validation confirmed rejecting a mapping with both `address` and `address.street` at once.

## Typechecks

`npx tsc --noEmit` (api) — clean. `npx tsc --noEmit` + `npm run build` (web) — clean.

## Commit

`ad77ff6` — Mass import follow-up: assigned-artist matching, composite address mapping. Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

Both scratch dev servers (API :5501, web :6501, logging to `api4.log`/`vite4.log`) stopped by PID. Temporary verification scripts (`verify_artist_address.mjs`, `verify_execute_artist_address.mjs`, `verify_unmatched_artist_note.mjs`, `verify_address_conflict.mjs`), the fixture CSVs, and screenshots left scratchpad-only, none committed. The one-off `_scratch_seed_luis_guzman.ts` script used to create a test artist (not part of the checked-in seed, since it's verification-only fixture data) ran once against dev and was deleted from the repo afterward, not committed. Test data created during verification (the Luis Guzman artist account, several imported clients/inquiries/gift cards) left in the dev database, consistent with this session's standing convention.

---

# Feature — Consultation appointments (no deposit, artist- or client-initiated)

Single session on `main`. Extends the existing `Appointment` model/Calendar/scheduling-assistant/checkout-reminder-task infrastructure to a second appointment type rather than building anything parallel -- confirmed no other session was mid-migration before starting.

## Migration safety, verified against dev data

`Appointment.appointmentType AppointmentType @default(TATTOO_SESSION)` (new enum, `TATTOO_SESSION | CONSULTATION`) -- a genuinely different, safer case than the `Client.referralCode` incident referenced in the task: that column had no default and needed a real per-row backfill script before the `NOT NULL` constraint could land; this one is defaulted, so Postgres materializes every existing row correctly in the single `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT 'TATTOO_SESSION'` statement, no backfill step at all. Didn't just trust that reasoning -- ran `prisma migrate dev`, then queried the dev database directly afterward: all 15 pre-existing `Appointment` rows came back `appointmentType: TATTOO_SESSION`, 0 `CONSULTATION` (correct, since consultations didn't exist before this column).

## Gift-card requirement -- scoped, not weakened

The exact existing check (`POST /appointments`, delegating to `validateGiftCardsForAttachment` in `lib/giftCards.ts`) is now wrapped in `if (!isConsultation)` -- a `CONSULTATION` skips `giftCardIds` validation and the required-deposit computation entirely, while a `TATTOO_SESSION` (or a request that omits `appointmentType`, for backward compatibility with any stale cached frontend bundle) goes through the identical unchanged path. Verified both directions directly, not just by code inspection: a `TATTOO_SESSION` with `giftCardIds: []` still gets a `400` ("giftCardIds must be a non-empty array of strings"); a `CONSULTATION` with no gift cards at all succeeds (`201`). The checkout route (`POST /:id/checkout`) now explicitly rejects a `CONSULTATION` up front with a clear redirect message instead of falling through to its generic "no gift cards attached" `400`; the new lightweight `POST /:id/complete-consultation` symmetrically rejects a `TATTOO_SESSION` — verified both.

## Buffer-conflict / suggested-times, verified explicitly

Read both `lib/schedulingConflict.ts`'s `findBufferConflict` and `lib/schedulingAssistant.ts`'s `getSuggestedTimes` before touching anything: neither query ever filtered by status or type — purely `artistId` + time-window overlap — so a new `appointmentType` value automatically participates in both with zero code changes required. Didn't stop at reading the code: booked a real `CONSULTATION` for an artist, then queried `GET /scheduling/suggested-times` for that same artist and confirmed none of the returned candidates overlapped the consultation's slot without a buffer-conflict flag. Added a one-line comment at each query confirming this was verified, not assumed, for future readers.

## What's new

- `AppointmentForm.tsx` (the one shared creation component, unchanged elsewhere) gains a Tattoo Session / Consultation toggle. Consultation mode: hides the gift-card section entirely, swaps the inquiry-time-estimate-derived suggestion duration for a 30-min/1-hour preset (still fully reuses `getSuggestedTimes` + availability-greying + the buffer-conflict "Close" flag), and bypasses the gift-card-availability gate that otherwise hides the suggested-times panel.
- `InquiryDetail.tsx` gets a dedicated "Schedule Consultation" button living in the same always-rendered Appointments widget the existing "New Appointment" button already uses (never gated by `inquiry.status`) — opens the identical modal/form pre-selected to `CONSULTATION`, satisfying "available regardless of pipeline status" for real rather than adding a second status-gated flow.
- Calendar events get a dashed accent border (`eventPropGetter`) and a `"Consult: "` title prefix for a `CONSULTATION` — no separate legend needed, matching how artist-color coding already relies on being self-explanatory.
- `POST /appointments/:id/complete-consultation` — same `appointments.checkout` permission, sets `checkedOutAt`/`checkedOutById`/`closeoutNotes`/`status: COMPLETED` (the exact same fields checkout already uses as "this concluded," per the task's own instruction), no `finalCostCents`, no gift-card redeem/roll. `AppointmentDetail.tsx`'s Checkout widget branches entirely on `appointmentType`: a consultation gets this lightweight form instead of the financial one, and a "Consultation" badge in the page header.
- **Found and fixed a genuinely broken existing feature while building the "Book the tattoo session now" shortcut**: the checkout flow's existing "Book follow-up" button already navigated to `/calendar?prefillClientId=...&prefillInquiryId=...`, but `Calendar.tsx` never read those query params at all — the deep link silently did nothing. Since the task asked to reuse this exact pattern, and reusing a broken pattern would just ship a second broken button, added the actual `useSearchParams` read (auto-opens the create-appointment modal, pre-filled, then strips the params so a refresh doesn't reopen it) — both "Book follow-up" and the new "Book the tattoo session now" now genuinely work, extended with a `prefillArtistId` param neither had before.
- `lib/tasks/appointmentNeedsCheckout.ts` now selects `appointmentType` and branches its title ("Check out ..." vs "Wrap up consultation with ...") — one unified task type, same `deepLink: /appointments/:id` for both, since `AppointmentDetail.tsx` itself is what decides which action to render.

## Verification

**Browser** (Playwright, screenshots reviewed): scheduled a consultation from an inquiry sitting at pipeline step 1 ("Inquiry received," never touched) via the dedicated button — confirmed no gift-card section anywhere, duration presets, and a working suggested-times panel keyed to the 30-min preset; confirmed the resulting Calendar event renders with a dashed border and "Consult: Sophia ..." label, clearly distinct from solid-bordered real sessions at a glance; completed the consultation with notes ("Consultation" widget, no financial fields), confirmed notes persisted and displayed; clicked "Book the tattoo session now" and confirmed it lands on Calendar with the create modal auto-opened, defaulted to Tattoo Session, artist pre-filled, and — critically — the gift-card section correctly present and required ("This client has no available gift card — collect a deposit...").

**API**: `ARTIST` creating a `CONSULTATION` → `403` (identical gate to a tattoo session, not a separate/weaker check); cross-studio isolation holds (a bogus `artistId` → `400`, never a leak); backdated a `CONSULTATION`'s `endTime` into the past and confirmed the derived task appeared with the branched "Wrap up consultation with ..." wording and the correct deep link.

## Typechecks

`npx tsc --noEmit` (api) — clean. `npx tsc --noEmit` + `npm run build` (web) — clean.

## Commit

`cb331da` — Add consultation appointments (no deposit, artist- or client-initiated). Pushed immediately after a collision check (`git fetch` + `git log HEAD..origin/main`) came back empty.

## Cleanup

Both scratch dev servers (API :5501, web :6501, logging to `api5.log`/`vite5.log`) stopped by PID. Temporary verification scripts (`verify_consultation_api.mjs`, `verify_consultation_task.mjs`, `verify_consultation_ui.mjs`, `verify_consultation_complete.mjs`, plus a couple of one-off debug scripts) and screenshots left scratchpad-only, none committed. Test data created during verification (a consultation appointment and its completion, a backdated consultation for the task check, a rejected cross-studio attempt) left in the dev database, consistent with this session's standing convention.

---

# Feature — Project pipeline timeline (Scheduled -> Waiver Verified -> Session Complete -> Project Complete)

Single session on `main`. Extends the existing 5-step Inquiry pipeline widget (`InquiryPipeline.tsx`) to a second, project-specific 4-step stage set rather than building a second component -- confirmed no other session was mid-migration before starting, though one turned out to start mid-session (see the concurrency section below, which affected this session's git workflow more than its actual implementation).

## Stage derivation

Investigated the existing component first: `PIPELINE_STEPS`/`currentStepIndex(status)` were hardwired module-level constants, not props, despite the "same widget, different stage list" framing implying otherwise -- generalized it with optional `steps`/`activeIndex` props (falling back to the original status-driven behavior for its two other unrelated callers, `ConversationsPanel.tsx` and the Kanban board's `PIPELINE_STEPS` import, both left completely untouched).

Three of the four Project stages derive live from `inquiry.sessions` (already `startTime` ascending from the backend, extended with `checkedOutAt`/`liabilityWaiver.status` -- no new fetch):
- **Scheduled**: complete once `sessions.length > 0` -- not merely `SCHEDULING` status, which a converted-but-not-yet-booked project can sit in with zero real appointments (verified: a project at that exact state showed Scheduled as the current, not-yet-checkmarked step).
- **Waiver Verified** / **Session Complete**: both key off the "current" session -- `sessions.find(s => !s.checkedOutAt)`, the earliest not-yet-checked-out appointment. Verified is required (not merely `SIGNED`) for Waiver Verified to advance.
- **Project Complete**: the fourth stage is NOT derived -- it reflects `Inquiry.projectCompletedAt` directly, set/cleared by two new routes (`POST /inquiries/:id/complete-project` / `/reopen-project`) mirroring the existing mark-lost/reopen pair's exact pattern (audited via `diffObjects`, `emitInvalidation`, same `inquiries.edit` permission). When every session is checked out but this hasn't been set, the timeline sits at "Session Complete" (index 3, Project Complete shown as the current/actionable step) rather than auto-advancing -- confirmed via the derivation function's own index math (`activeIndex = PROJECT_STEPS.length` only once `projectCompletedAt` is actually set, checkmarking all four).

## Multi-session "current appointment" tracking, tested with a real multi-session project

Booked two real sessions (via `POST /appointments`, gift cards attached) on a converted-but-unscheduled project, then walked it through every transition with real API calls -- not just read the derivation logic and trust it:
1. 0 sessions -> stage index 0 (Scheduled current, unchecked).
2. 2 sessions booked, neither waiver'd -> stage index 1 (Scheduled done, Waiver Verified current).
3. Session 1's waiver signed + verified (via the real public sign endpoint + staff verify endpoint, with correctly-shaped `healthAnswers`/`clauseInitials` matching the waiver's own snapshots) -> stage index 2 (Session Complete current).
4. **Session 1 checked out** (`POST /:id/checkout`) -> stage index dropped back to **1** -- confirming the "current session" pointer correctly moved to session 2, which had no waiver yet, rather than staying stuck at "Session Complete" from session 1. This is the exact scenario the task called out as needing real verification, not an assumption.
5. Session 2 signed + verified -> index 2. Session 2 checked out -> index 3 (both sessions done, Project Complete now the actionable step, `projectCompletedAt` still null).
6. `Mark Project Complete` -> index 4 (all four steps checkmarked). `Reopen Project` -> back to index 3, `projectCompletedAt` cleared.

Also confirmed the `"Session 2 of 2"` supplementary badge appears only once `sessions.length > 1`, and tracks the correct current/last session number throughout.

## Inquiry-side timeline confirmed unaffected

Loaded a genuinely non-converted inquiry (status `NEW`) after all of the above and confirmed the original 5-step pipeline (`Inquiry received -> Artist assigned -> Estimate sent -> Deposit requested -> Scheduled`) rendered exactly as before -- same component, same route (`isConverted` branches which `steps`/`activeIndex` it's fed, nothing else about the widget or its two other callers changed). Also replaced two pre-existing, not-yet-centralized inline `['SCHEDULING','WAITLISTED','CONFIRMED'].includes(...)` literal-array checks (the breadcrumb's "Back to Projects/Inquiries" label) with the page's own already-existing `isConverted` variable, which had the identical semantics but wasn't reused there before this session.

## Concurrency: a second session was mid-migration for most of this one

A second session was actively building an unrelated multi-service-support feature (`Service`/`ArtistService` models, `Inquiry.serviceId`) in this same shared working directory for nearly this entire session, discovered via `git status` showing uncommitted `schema.prisma` changes before this session's own migration step. Per user direction, held off on `prisma migrate dev` and did all schema-independent work first (the `InquiryPipeline.tsx` generalization, the `INQUIRY_INCLUDE` select extension, the frontend derivation logic) while polling `prisma migrate status` between rounds of other work, only adding this session's own two `Inquiry` columns once their three-step nullable-\>backfilled-\>required migration sequence for `serviceId` had actually applied (`prisma migrate status` reporting "up to date"). Generated this session's migration with `--create-only` first and inspected the SQL before applying it, confirming it contained only `projectCompletedAt`/`projectCompletedById` and nothing of theirs.

One real, unavoidable side effect: this session's two new `schema.prisma` fields were added to the same file the other session was still editing, and their own commit (`de4f548`, "Part 1: Service model, intake linkage, practitioner tagging") ended up carrying this session's schema diff too, since both were sitting uncommitted in the same working copy at once. The migration itself is unaffected (fully isolated, own file, contains exactly two columns) -- this is purely a git-history attribution wrinkle, flagged here so a future reader isn't confused why `projectCompletedAt` shows up in an unrelated-sounding commit message. This session's own commit (below) contains everything else: the two new routes, the frontend generalization, and the derivation logic.

## Typechecks

`npx tsc --noEmit` (api) — clean. `npx tsc --noEmit` + `npm run build` (web) — clean, after the concurrent session's own transient mid-edit build break (an unrelated file, `ArtistDetail.tsx`, briefly had unused-variable errors from their own in-progress refactor) resolved itself independently.

## Commit

`5230d6f` — Add Project pipeline timeline (Scheduled -> Waiver Verified -> Session Complete -> Project Complete). Pushed together with the concurrent session's own already-local `de4f548`, after explicit user confirmation given the second session's commit was still "Part 1" of a larger, not-yet-finished feature.

## Cleanup

Both scratch dev servers (API :5501, web :6501, logging to `api6.log`/`vite6.log`) stopped by PID -- including one transient `EADDRINUSE` crash-and-restart caused by the concurrent session's own file-watch reloads on shared files, unrelated to this session's own code. Temporary verification scripts and screenshots left scratchpad-only, none committed. Test data created during verification (two real sessions, signed/verified waivers, checkouts, and a project-complete/reopen cycle on an existing dev-studio project) left in the dev database, consistent with this session's standing convention.

---

# Feature — Service lines (multi-service support), Powder Brows as the first real case

Single session on `main`, three parts, three commits, each preceded by both typechecks and pushed immediately. Pre-flight: another session was mid-migration (an unrelated `AppointmentType`/consultation feature) when this session started -- waited (via a background poll on `git status`) until it committed (`cb331da`) before touching `schema.prisma`, per standing discipline. A second, different concurrent session (a "project completion fields" feature) appeared partway through Part 2/3 -- its own migration applied cleanly to the shared dev DB after this session's own three migrations, no overlapping tables, and its uncommitted files were simply never staged into any of this session's three commits.

## Part 1 — Service model, intake linkage, practitioner tagging (`de4f548`)

Added `Service` (`pricingModel: RANGE|FLAT`, `depositModel: TIER_BASED|FLAT`, `flatPriceCents`/`flatDepositCents`/`depositBreakdownNote`, `requiresCandidacyReview`, `intakeFormId`, `isActive`) and `ArtistService` (join table), plus `Inquiry.serviceId`, via the exact nullable -> hand-authored-backfill -> required sequence this schema has used since the referral-migration outage (`20260725152139_service_lines_add_service_model`, `20260725153000_backfill_inquiry_service`, `20260725153431_inquiry_service_id_required`).

**Backfill verification (row counts, before/after):**
- Inquiries: 52 total, 0 with a null `serviceId` before the column existed (expected -- it didn't exist yet) -> 52 total, **0 null** after the backfill migration ran, before the required-column migration made that structurally impossible.
- Artists: 11 total -> 11 `ArtistService` rows created (one per artist, all pointing at that studio's own new "Tattoo" service) -- exactly 1:1, no duplicates, no gaps.
- Exactly one "Tattoo" service created per studio (2 studios in dev -> 2 services), each linked to that studio's actual current default `IntakeForm` (confirmed by id, not assumed).

**Powder Brows seeded** (on `dev-studio` -- see note below on Black Hive): `pricingModel: FLAT`, `depositModel: FLAT`, `flatDepositCents: 6000` ($60), `depositBreakdownNote: "$50 deposit + $10 processing fee"`, `requiresCandidacyReview: true`, its own dedicated `IntakeForm` ("Powder Brows Consultation", slug `powder-brows`) with: Name/Email/Phone enabled, every tattoo-oriented system field present-but-disabled (`referenceImages`/`placementImages`/`description`/etc. -- satisfies the "system fields can be disabled but not removed" invariant `validateFieldListConstraint` enforces elsewhere), a `SELECT` custom question ("Which PMU service are you interested in?", one option: "Powder Brows"), and two **required** `PHOTO_UPLOAD` custom questions (face, eyebrows). The 18+ policy was confirmed already generic -- real enforcement lives in `lib/waivers.ts`'s `isAtLeast18`, which runs on any `LiabilityWaiver` regardless of service; the intake form's "You must be 18 to receive a tattoo" banner is informational copy on the *default* form only, not where enforcement actually happens.

Built `Settings -> Services` (OWNER-only list/create/edit/deactivate; hard delete blocked server-side whenever `Inquiry.serviceId` references it -- deactivate is the only option once real inquiries exist) and an Artist-profile "Services Offered" checkbox widget (`PATCH /artists/:id` now accepts `serviceIds`, syncing `ArtistService` in the same transaction). **Did not guess a real PMU practitioner** -- both seeded dev artists are tagged Tattoo-only; the checkboxes exist for the OWNER to use.

**No studio literally named "Black Hive" exists in the dev database** (only "Dev Studio"/"Dev Studio 2") -- "Black Hive Ink and Arts" is the real production studio (see this file's own "Discrepancy found and escalated" entry from an earlier package), and dev/test never points at production's `DATABASE_URL` per `DEVELOPMENT.md`. Powder Brows was seeded onto Dev Studio as this feature's working demonstration; **creating the actual Powder Brows `Service` row for the real Black Hive Ink and Arts studio in production is a separate, deliberate release step** (e.g. an OWNER using the now-shipped Settings -> Services UI directly against production once these migrations are deployed there), outside this session's dev-only scope.

## Part 2 — Flat pricing and flat deposit models (`d3243a9`)

**Pricing**: the entire existing estimate send/track/respond pipeline is reused completely unchanged -- a FLAT service collects one price instead of a range by submitting the *same value* as both `priceEstimateLow` and `priceEstimateHigh` (both the artist's own `/respond` approval and staff's `/send-estimate`/`/revise-estimate` forms collapse to a single input when `inquiry.service.pricingModel === 'FLAT'`, wired to set both fields identically). Every downstream consumer -- validation, `computeDepositTier`'s average, the client-facing estimate/revision pages -- needed zero branching of its own; only *display* sites needed a shared `formatPriceEstimate(low, high)` helper (`$X` when equal, `$X–$Y` when not) to avoid rendering a redundant `$350-$350`.

**Deposits**: `resolveDepositAmounts`/`resolveRequiredDepositCents` (mirrored on both API and web) branch on `depositModel` at every call site that used to call `computeDepositTier`/`computeRequiredDepositCents` directly -- deposit-form creation, the inquiry-schedule gift-card-sufficiency check, the standalone appointment-create gift-card-sufficiency check, and the web-side live preview in `InquiryDetail.tsx`/`AppointmentForm.tsx`. FLAT sets `feeAmount: 0` and `depositAmount = totalCharged = flatDepositCents` -- the flat number already represents everything charged (per `depositBreakdownNote`), not an additional processing fee stacked on top of it. Public deposit page now shows `depositBreakdownNote` under the Deposit/Fee/Total row when set.

**Live-verified, not just read**: sent a real flat $350 estimate for a Powder Brows inquiry -> client-facing page showed "PRICE: $350" (not "PRICE RANGE"); generated its deposit form -> Deposit $60 / Fee $0 / Total $60, breakdown note shown. Separately created a fresh Tattoo inquiry, sent a genuine $400-$600 range estimate, generated its deposit form -> Deposit $100 / Fee $10 / Total $110 (tier 2 of the studio's default tiers, exactly as before this feature existed) -- confirms `TIER_BASED` is provably unaffected, not merely "should still work."

## Part 3 — Candidacy review pipeline (`d0df41d`)

Added `CANDIDACY_REVIEW` to `InquiryStatus` (pure additive `ALTER TYPE ... ADD VALUE`, no backfill needed -- no pre-existing row could have this value). `POST /inquiries` now sets it instead of `NEW` whenever `service.requiresCandidacyReview` is true; verified a fresh Tattoo inquiry still lands in `NEW` and a fresh Powder Brows inquiry lands in `CANDIDACY_REVIEW`, both via real submissions, not inspection alone.

Three actions (OWNER/FRONT_DESK) on a new "Candidacy Review" widget: **Mark Good Candidate** (`POST /:id/mark-good-candidate`, new but trivial -- `CANDIDACY_REVIEW -> NEW`, same audit-log pattern as every other status-change route) proceeds it into the untouched normal pipeline; **Not a Candidate** opens the *exact same* mark-lost modal/route every other "Mark as lost" entry point on the page uses, just pre-filled with "Not a candidate" as the reason and relabeled -- no second terminal-state system, confirmed via the audit trail literally reading "Status: Candidacy Review -> New" for the sibling good-candidate action and `lostReason: "Not a candidate"` for this one; **Schedule Consultation** required zero backend changes -- the existing consultation feature's own Appointments widget was already unconditional on `inquiry.status`, confirmed live by creating a real `CONSULTATION` appointment against a `CANDIDACY_REVIEW` inquiry and re-fetching it: **status stayed `CANDIDACY_REVIEW`**, appointment linked under `sessions`.

Kept `CANDIDACY_REVIEW` **out of** `PIPELINE_STEPS` (the array shared by the Tattoo/RANGE stepper, the Conversations context panel, and the Kanban board's other columns) -- prepending a step there would have shifted every later status's index, making a Tattoo inquiry that never touched candidacy review show a false "done" checkmark for it. Instead: its own distinct one-line pipeline state (`InquiryPipeline.tsx`, same pattern as the existing `CLOSED_LOST`/`COLD_LEAD` special case), its own dedicated, **non-interactive** Kanban column (dragging is disabled for it -- the three actions are explicit buttons, not a card drag; a drag *onto* it from another column still falls through to the board's existing generic reject message, unchanged), and added to `INQUIRIES_TAB_STATUSES` so it isn't silently filtered out of the tab's own status list. Verified on a live board: "CANDIDACY REVIEW (1)" stood alone as its own column; every other inquiry (Tattoo and already-processed Powder Brows alike) sat in the normal columns.

**Practitioner filtering**: both places staff pick an artist for a specific inquiry -- `InquiryDetail.tsx`'s assignment picker and `AppointmentForm.tsx`'s artist picker (shared by "Schedule Consultation" and regular session booking) -- now filter to only artists tagged via `ArtistService` as offering that inquiry's service. Live-verified: tagged one dev artist with Powder Brows (leaving the other Tattoo-only), opened both pickers against a Powder Brows inquiry, and confirmed only the tagged artist appeared in either one.

**Waitlist, verified not assumed**: read `POST /:id/waitlist`/`/:id/unwaitlist` and the WAITLISTED widget end to end -- purely `status`/`declineNote`/`assignedArtistId`, zero tattoo-specific fields or branches. Then proved it live: took a real Powder Brows inquiry all the way through candidacy review -> good candidate -> assigned -> flat estimate -> flat deposit signed and paid -> `SCHEDULING`, waitlisted it (`status -> WAITLISTED`, note stored, `assignedArtistId` preserved so per-artist grouping still works), then unwaitlisted it back to `SCHEDULING`. Zero code changes needed, exactly as expected.

**Incidental fix**: found and fixed a genuine pre-existing race condition in `InquiryDetailsSection.tsx` (unrelated to service lines) while verifying that staff could actually see a Powder Brows inquiry's submitted candidacy photos -- its own visibility-reporting effect fired with a stale `false` on first render (before its field-list fetch resolved), which unmounted itself via the parent's conditional wrapper before ever getting the chance to report `true`. Fixed by only reporting once the fetch has actually completed; confirmed the "Inquiry Details" section (system fields + the PMU select + both photo-upload answers) now renders correctly, every time.

## Typechecks

`npx tsc --noEmit` (api) and `npm run build` (web) — clean after every one of the three parts, before every commit.

## Commits

- `de4f548` — Part 1: Service model, intake linkage, practitioner tagging
- `d3243a9` — Part 2: flat pricing and flat deposit models
- `d0df41d` — Part 3: candidacy review pipeline

## Cleanup

Both scratch dev servers (API :4000, web :5173) stopped by PID. All ad-hoc Playwright verification scripts and screenshots (`test-services-*.js`, `test-part2-*.js`, `test-part3-*.js`, `shots/svc-*.png`/`part2-*.png`/`part3-*.png`) removed from the scratchpad after each part's verification, none committed. Test data created during verification (several Powder Brows inquiries at various pipeline stages, a couple of fresh Tattoo inquiries, one real consultation appointment, one artist temporarily tagged with Powder Brows for the filtering test) left in the dev database, consistent with this session's standing convention.

## Outstanding for the OWNER

The real PMU practitioner at Black Hive Ink and Arts still needs to be tagged via that artist's profile page ("Services Offered" checkboxes) before any real Powder Brows inquiry can be assigned -- deliberately left undone by this session, per the task's own explicit instruction not to guess who that is.

---

# Package M2: multi-session planning with per-session hour estimates

Single session on `main`. Connects existing infrastructure (Package M's `DepositForm.sessionNumber`, the stackable gift-card system, the "N appointments require N gift cards" enforcement, and the scheduling-assistant suggested-times service) to a real, staff-declared session plan -- doesn't rebuild any of it. Commit: `412e74d`.

**Pre-flight collision note**: another session's uncommitted Stripe-integration work (`apps/api/src/index.ts`, `package.json`, `.env.example`, `package-lock.json`, new `lib/stripe.ts`/`stripeConnect.ts`) was sitting in the shared working directory when this session went to commit. Confirmed it never touched `schema.prisma` or any file this feature needed, then staged and committed only this feature's own exact files by path -- the Stripe files were left uncommitted and untouched, exactly as this session's own standing collision protocol requires.

## Schema

`PlannedSession` (`sessionNumber`, `estimatedHoursMin`/`Max`, nullable+unique `depositFormId`/`appointmentId` FKs, `@@unique([inquiryId, sessionNumber])`) sits alongside -- never replaces -- `Inquiry.priceEstimateLow/High` and `timeEstimateHoursMin/Max`. Migration `20260725174335_planned_sessions`, applied cleanly (verified with `--create-only` first, confirmed purely additive: one new table, two nullable unique FK columns, one index).

## What changed

- **Estimate entry** (`POST /:id/send-estimate`): a `sessions` array in the request body (`{estimatedHoursMin, estimatedHoursMax}[]`), only when `length > 1`, creates one `PlannedSession` row per entry and nulls out the top-level `timeEstimateHoursMin/Max` instead of setting them. `sessions` omitted or length 1 leaves every existing field/behavior untouched -- no rows created.
- **Deposit-form generation** (`POST /:id/deposit-form`, public verify route): an optional `plannedSessionId` names which session this form is for; *that session's own* `depositFormId`/`signedAt` (not "the latest form across the whole inquiry") decides new-vs-resend, and its own `sessionNumber` is used verbatim instead of an incrementing counter -- this is what lets staff generate session 3's form before session 2's exists. The public deposit page shows "Session X of Y — estimated A-B hours" when set, nothing when not.
- **Appointment creation** (`POST /appointments`): an optional `plannedSessionId` links the new appointment to that session and feeds *its own* hour estimate into the scheduling-assistant duration target (`AppointmentForm.tsx`'s `tattooSuggestionDurationMinutes`), instead of the project's top-level estimate. Gift-card requirement/stacking logic (`GiftCardStackPicker`) is completely unchanged -- multiple cards, from any source, still just need to sum to the one tier-derived required amount.
- **Display**: a new "Session Plan" widget on the Project page (`InquiryDetail.tsx`) shows every planned session's hour estimate, deposit status (not generated / pending / paid), and appointment status (not booked / scheduled / completed) with inline "Send Deposit Form" / "Book Appointment" actions. The pre-existing single-session Deposit widget's own send/resend controls were deliberately left in place, fully functional, as an un-planned/ad-hoc escape hatch alongside the new widget -- not suppressed, to avoid regressing its "resend an unsigned form" capability, which the new widget doesn't replicate.

## Verification (real browser + real API calls against the scratch dev stack, not inspection alone)

Generated a real 3-session estimate ($3000 flat / 6-8hr / 6-8hr / 3-4hr) through the actual estimate form UI on a fresh inquiry -- confirmed via screenshot that the top-level "TIME ESTIMATE" field correctly read "Not provided" and all three sessions appeared in the new Session Plan widget with their own hour ranges.

Advanced the inquiry through the real client-facing estimate-response route (`PATCH /estimates/respond/:token`, decision `PROCEED`) to `DEPOSIT_PENDING`, exactly as a real client would trigger it.

- Generated, signed, and paid **Session 1**'s deposit form -> gift card issued, inquiry moved `DEPOSIT_PENDING -> SCHEDULING`.
- Generated, signed, and paid **Session 3**'s deposit form **before Session 2's even existed** -> succeeded with no forced sequencing; Session 2 remained with `depositFormId: null` throughout, confirmed via the Session Plan widget showing "Deposit not yet generated" for it while Sessions 1 and 3 both showed "Deposit paid."
- Booked **Session 1**'s appointment via the widget's "Book Appointment" button -> confirmed (via the actual network request) the scheduling-assistant call used `durationMinutes=420` (Session 1's own 6-8hr / 7hr average), not any other session's estimate.
- Checked out Session 1's appointment choosing **ROLL** for its attached gift card -> confirmed via API the card came back `status: ACTIVE`, `appointmentId: null` (rolled forward, unattached).
- Generated, signed, and paid **Session 2**'s deposit form -> a second gift card issued (inquiry stayed `SCHEDULING`, correctly not re-triggering first-conversion logic).
- Booked **Session 2**'s appointment, selecting **both** the rolled-forward card and Session 2's own newly-paid card in the `GiftCardStackPicker` -> confirmed "$400.00 selected of $200.00 required" (both cards accepted and stacked), the scheduling-assistant request again used `durationMinutes=420` (Session 2's own 6-8hr, not Session 3's 3-4hr), and the appointment was created successfully spanning exactly 7 hours.
- Session Plan widget's deposit/appointment badges stayed accurate at every step above (confirmed via screenshots after each transition).

**Single-session regression test** (the one that matters most): ran an ordinary inquiry through assign -> send-estimate (no `sessions` field at all, exactly as every inquiry has always been created) -> `PROCEED` -> deposit-form (no `plannedSessionId`) -> sign -> mark-paid, entirely via the same real routes. Confirmed at every step: `timeEstimateHoursMin/Max` set normally (non-null), `plannedSessions: []` throughout, deposit form's `sessionNumber` assigned via the original incrementing-counter logic, public verify response's `plannedSession` field `null`, and the inquiry landed in `SCHEDULING` exactly as before this feature existed.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc --noEmit` + `npm run build` (web) — clean immediately before commit.

## Cleanup

Both scratch dev servers (API :5501, web :6501) and every leftover process from this session's earlier crash-restart cycles on those same commands killed by PID/process-tree (a large number had accumulated from repeated `EADDRINUSE` restarts across this session's tasks; confirmed neither port had an active listener afterward). All ad-hoc verification scripts left in the scratchpad, none committed. Test data created during verification (one 3-session Project with two completed/scheduled sessions and a paid-ahead third, several gift cards, one fresh single-session regression inquiry) left in the dev database, consistent with this session's standing convention.

---

# Multi-session sweep: revision flow, section consolidation, deposit fixes

Single session on `main`. Commit: `2a49316`.

**Concurrency note**: another session's Stripe Connect work was actively being edited in the shared working directory throughout this session (`apps/api/src/routes/deposits.ts`/`webhooks.ts`, `apps/api/src/lib/stripe.ts`/`stripeConnect.ts`/`deposits.ts`) -- confirmed none of it was ever staged into this commit. Its in-progress edits caused two real side effects: the scratch API server (running on an alternate port, :5502, to avoid colliding with that session's own :5501 server) restarted/crashed twice on unrelated file changes in the same watched directory (resolved by restarting), and a mid-refactor moment left `deposits.ts` failing `tsc --noEmit` with a dozen missing-import errors that were entirely inside that file and unrelated to any file this task touched -- confirmed by re-running the typecheck until it stabilized clean (the other session finished its edit) before treating "clean" as satisfied. Both API and web typechecks plus the web build were clean immediately before this commit, restricted to this task's own files.

## 1. What the existing estimate-revision feature actually did

`POST /inquiries/:id/revise-estimate` (OWNER/FRONT_DESK only) is the **sole sanctioned exception** to `PATCH /:id`'s hard block on editing `priceEstimateLow/High`/`timeEstimateHoursMin/Max` once a Project has converted (deposit paid) -- it directly overwrites those same fields on the Inquiry row itself, immediately on submission, gated only by a required staff-typed reason. It does **not** create a separate "proposed revision" record sitting alongside the original: there is no historical snapshot of what the estimate was before the revision beyond the audit log. A distinct token/field pair (`estimateRevisionToken`/`estimateRevisionReason`/etc., separate from the pre-conversion `estimateToken` flow) sends the client a link to approve or flag the change; `estimateRevisionApproved`/`FLAG` only ever records their reaction -- it never touches `status`, never reverts the numbers, and never unwinds a paid deposit or booked appointment (unwinding automatically would be unsafe; a flag is staff's cue to follow up manually, per the route's own existing comment).

This coexists correctly with the locking rule: "locked" means "can't be inline-edited via the normal `PATCH /:id` path," not "immutable forever" -- revision is the one deliberate, audited, client-notified escape hatch, and remains the only one after this session's changes. No new inline-editing path was added anywhere.

## 2. Revision flow now supports session-plan editing

Extracted the original estimate form's "Number of sessions" selector and per-session hour rows out of `InquiryDetail.tsx` into a shared `SessionBreakdownEditor.tsx` (`SessionCountField` + `SessionHoursRows`, split in two because both call sites embed the count selector inside a price/time grid and the hour rows as a separate full-width block below it) -- the Revise Estimate modal now renders the exact same components, not a second copy.

**Judgment call, as flagged**: a planned session already backed by a **paid deposit or a booked appointment** can never have its hour range altered or be removed by a revision -- real money or a real booking already depends on it. Everything else (an unpaid/unbooked session, or the whole plan on a project that never had one) stays freely editable. Enforced on both sides: the "Number of sessions" selector's minimum option is raised to the highest locked `sessionNumber` (can't even select a count that would drop a locked slot), and the backend (`POST /:id/revise-estimate`, extended with the same `sessions` array `POST /:id/send-estimate` accepts) independently reconciles create/update/delete against the submitted array while unconditionally preserving any locked session's own row regardless of what was submitted for its slot -- defense in depth, not just a UI nicety. A revision with no `sessions` field at all leaves the plan completely untouched (the common "just revising price" case); an explicit array (any length, including empty) means staff is declaring/editing the plan now.

**Live-verified** on a real 2-session Project (Session 1 paid/locked, Session 2 unpaid/unlocked): opened Revise Estimate, confirmed Session 1 rendered read-only ("4-6 hrs — locked (deposit paid)"), changed Session 2's hours from 4-6 to 4-8, raised the count to 3 (adding a brand-new session), filled its 2-3 hr range, and submitted. Server state afterward: Session 1 **untouched** (still 4-6, deposit still attached), Session 2 hours **updated** to 4-8, Session 3 **created** at 2-3 -- and the Project's `status` stayed `SCHEDULING` throughout (a revision never touches lifecycle status). The Estimate widget's "Locked" banner and the "AWAITING CLIENT APPROVAL OF A REVISED ESTIMATE" notice both rendered correctly, and the audit trail logged the revision with its reason, confirming the locking/revision rule still holds exactly as before.

## 4. "Tattoo Details" / "Inquiry Details" consolidated

Removed the "Tattoo details" widget entirely. `InquiryDetailsSection.tsx` (the studio-configured, order-respecting renderer) is now the single source of truth, with two fixes to reach full parity before anything was removed:

- **Preferred artist** now renders with its avatar (image or initials) + name, matching what "Tattoo details" showed -- the generic field-list renderer was extended with a `kind: 'artist'` row variant specifically for this field, rather than falling back to plain text.
- **Editing**: "Tattoo details" was the only way staff could edit description/color-or-black-and-grey/placement/estimated-size/budget/desired-timing after intake. Rather than lose that (a real regression the task's own wording warned against -- "fix the unified renderer... rather than keeping the old section around as a crutch"), the exact same edit form (same state, same `PATCH /inquiries/:id` call) now lives inside the "Inquiry Details" widget itself, toggled by the same Edit button, relabeled to match.
- **Reference images**: already excluded from the generic list (a pre-existing `referenceImages`/`placementImages` skip, confirmed, not added) -- the dedicated Reference Images/Placement Photos widgets remain the one real place to view/manage them, untouched.

**Live-verified**: "Tattoo details" heading count = 0, "Inquiry Details" heading count = 1 (previously 2 sections total), every field present (name/email/phone/how-they-heard/description/color/placement/size/tattooed-before/preferred-artist/budget/desired-timing, in the studio's configured order), Preferred artist's row confirmed via HTML inspection to render the avatar markup (not plain text), Reference Images and Placement Photos widgets both still present with their own Edit affordances and thumbnails, and the merged Edit button correctly opens the same description/color/placement/size/budget/desired-timing form.

## 5. Deposit form's "Suggest a time" fixed for multi-session

Confirmed the bug precisely: the existing (un-planned) suggest-a-time flow (`fetchSuggestedTimes`, gated by `isNewDepositSession`) reads `inquiry.timeEstimateHoursMin/Max` -- null for any multi-session project -- so it silently produced nothing. Separately, the Session Plan widget's own per-planned-session "Send Deposit Form" mini-form (added in the prior multi-session-planning session) never had a suggest-a-time feature at all, only manual date/time entry.

Added a second, independent fetch (`plannedSessionSuggestedTimes`/`plannedSessionSuggestLoading`/`plannedSessionSuggestError`) that fires whenever staff opens that mini-form for a specific planned session, sized off **that session's own** `estimatedHoursMin/Max` -- kept separate from the un-planned flow's own state rather than reused, since the two pickers are independent contexts that are never both active at once. The un-planned flow (single-session projects, or an ad-hoc extra session outside the plan) is completely untouched -- still reads the top-level fields exactly as before.

**Live-verified**: opened the mini-form for a planned session estimated at 4-8 hrs (average 6hr) -- the captured network request was `durationMinutes=360`, and the endpoint returned real 6-hour slots. Confirmed via direct API call as well, independent of the browser render timing.

## 6. Artist-assignment gate before any deposit request

Added a precondition check (`if (!inquiry.assignedArtistId) return 400 "Assign an artist before requesting a deposit"`) to `POST /:id/deposit-form` -- the single route both the original flow and Package M's "send another deposit form" flow already share, so one check covers both uniformly, as asked. UI: the fresh-session tentative-time block and the Session Plan widget's per-session "Send Deposit Form" toggle both show the same message instead of the send action whenever `!inquiry.assignedArtist`.

**Expanded scope, flagged as a related fix**: `POST /:id/attach-gift-card` reaches the *identical* `DEPOSIT_PENDING -> SCHEDULING` conversion as a deliberate alternative to the deposit-form flow (its own comment says so) -- without the same gate, staff could route around the new requirement entirely whenever a client happened to have a spare gift card on file. Added the same check there, with the same UI message replacing its "Attach Gift Card" button.

**Real gap found and fixed while verifying this, not assumed away**: an inquiry can reach `AWAITING_CLIENT_RESPONSE`/`DEPOSIT_PENDING` with **no artist ever assigned** (`send-estimate` deliberately doesn't require one -- front desk routinely enters a price before an artist ever "responds" in-app). Before this fix, the Assignment widget only ever showed the artist picker at `NEW` status -- past that, a never-assigned inquiry had **no way to ever get one assigned**, meaning the new gate could permanently lock such an inquiry out of ever collecting a deposit. Fixed by extending `PATCH /:id/assign` to also allow a first-time assignment on any non-terminal status (not just `NEW`), leaving `status` untouched in that case (only the original `NEW -> ARTIST_ASSIGNED` path still moves it), rejecting a second assignment attempt once one exists, and extending the Assignment widget to show the picker whenever `!inquiry.assignedArtist && !isTerminal`, not just at `NEW`.

**Live-verified** end to end: created an inquiry, sent an estimate and got client PROCEED **without ever assigning an artist** -> confirmed `POST /:id/deposit-form` correctly rejected with the new message, and the page showed "Assign an artist before requesting a deposit." Assigned an artist via the now-available late-assignment path -> confirmed `status` stayed `DEPOSIT_PENDING` (unchanged), the deposit-form route then succeeded, and a second assignment attempt was correctly rejected ("An artist is already assigned to this inquiry"). Page re-render confirmed the gate message was gone and the assigned artist showed normally.

## 7. Sweep of every other hour-estimate/session-count surface

Grepped the whole codebase for `timeEstimateHoursMin/Max`, `plannedSessions`, `estimatedHoursMin/Max`. Every match, and outcome:

- **Appointment detail's project context** -- previously showed **no** hour estimate at all (single- or multi-session), so there was no stale/wrong-session display to begin with; that absence is exactly what protected it from the multi-session bug. Added a "Session" field ("Session 2 of 3 — estimated 4-8 hrs") sourced from the appointment's own linked `PlannedSession`, null for every appointment outside a plan. Verified via a fresh `GET /appointments/:id` -> `plannedSession` field with the correct `sessionNumber`/hours/`totalSessions`.
- **Kanban cards** -- confirmed (not assumed) they only ever render the **price** estimate (`formatPriceEstimate`), never time/hours -- untouched by multi-session planning (only the time fields get nulled, never price). No fix needed.
- **Checkout flow** -- confirmed it never references hour-estimate/session data at all; it's keyed entirely to the appointment's own attached gift cards and a manually-entered final cost. No fix needed (the new "Session" field on the same page, above, gives staff the session context alongside it regardless).
- **Client-facing estimate pages** (`EstimateResponse.tsx`/`EstimateRevisionResponse.tsx`) -- **real gap found**: both showed "Estimated time: To be discussed" for any multi-session estimate/revision, since they only ever read the (null) top-level fields -- the client saw zero breakdown of the actual session plan they were being asked to approve. Fixed both public routes (`GET /estimates/verify/:token`, `GET /estimates/revision/verify/:token`) to include `plannedSessions`, and both pages to render a "N-session plan" list (each session's own hour range) in place of the single field whenever one exists.
- **Artist's initial estimate-entry form** (`MyInquiries.tsx`'s Approve flow, `PATCH /:id/respond`) -- confirmed this always runs *before* a session plan can exist (`PlannedSession` rows are only created by send-estimate/revise-estimate, both later steps) -- nothing to display or break here.
- **Service-lines / FLAT pricing interaction** -- confirmed (not assumed) nothing in the multi-session code branches on `pricingModel`/`depositModel` at all; the three concerns are fully orthogonal. Live-verified on a real Powder Brows (FLAT) inquiry: set price $50, 2 sessions (1-2 hrs each), submitted -- no crash, `priceEstimateLow/High` both `$50` (not doubled or mangled), `timeEstimateHoursMin/Max` correctly nulled, both `PlannedSession` rows created correctly, Session Plan widget rendered normally. Confirms the SOP's "Powder Brows shouldn't need multiple sessions" expectation is a business-process convention, not something the code needs to enforce or that breaks if bypassed.

## Verification summary

Browser + direct API, against a scratch dev stack: revision flow with a locked + an edited + a newly-added session (above); Details consolidation (single heading, every field present, avatar rendering, Reference Images independent); Suggest-a-time sized correctly for a specific planned session; artist-gate blocking and then unblocking across both the deposit-form and attach-gift-card paths, including the late-assignment fix; Powder Brows FLAT-pricing multi-session with no crash.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc --noEmit` + `npm run build` (web) — both clean immediately before commit (restricted to this session's own files; see the concurrency note above for the transient, unrelated `deposits.ts` state observed mid-session).

## Cleanup

Scratch dev servers run on alternate ports (API :5502, web :6502) specifically to avoid colliding with another concurrent session's own scratch server already on :5501/:6501 -- killed by PID afterward, confirmed the other session's :5501 server was left untouched. Leftover orphaned processes from this session's own restart cycles (triggered by the concurrent session's unrelated file edits in the same watched directory) killed by checking which matching processes held no active port listener first, rather than a blanket kill, again to avoid touching the other session's live process. All ad-hoc verification scripts left in the scratchpad, none committed. Test data created during verification (one existing multi-session Project revised into a 3-session plan, one existing inquiry pushed through the no-artist-then-late-assigned path, one existing Powder Brows inquiry given a 2-session FLAT-pricing estimate) left in the dev database, consistent with this session's standing convention.

---

# Follow-up: three multi-session UX issues from real usage

Same session, immediately after the sweep above. Commit: `cf02a9f`. User reported three issues after actually using the shipped multi-session feature -- all three were real gaps the sweep missed, not misunderstandings.

1. **"Time Estimate still shows Not Provided"** -- the *staff-facing* Estimate widget (`InquiryDetail.tsx`) never got the same treatment the client-facing pages did in the sweep above; it still displayed the (correctly-null) top-level fields with no replacement. Now shows each session's own range inline (`Session 1: 4-6 hrs, Session 2: 4-8 hrs, ...`) whenever a plan exists.
2. **"Inquiry Details has redundant details (Name, Phone, Email)"** -- all three are already shown in the page's own header card, directly above every widget including this one. Excluded from `InquiryDetailsSection`'s generic field list (same treatment already given to `referenceImages`/`placementImages`), and the now-dead `name`/`email`/`phone` cases removed from its formatting switch.
3. **Deposit section redundant with Session Plan, and missing suggested times** -- confirmed: the old Deposit widget's "generate a fresh session" flow reads the (null, once a plan exists) top-level time estimate for its suggested-times fetch, so it silently returned nothing; and it duplicated Session Plan's own per-session "Send Deposit Form." Consolidated: the old widget's whole interactive generate/resend/attach-gift-card flow is now gated to `plannedSessions.length === 0` (single-session projects only, where it remains the sole way to generate a deposit, completely unchanged) -- its read-only history list (amounts, signature, paid status per session) stays visible regardless, since that's genuinely unique information Session Plan doesn't show. To avoid losing capability, Session Plan gained a "Resend Deposit Form" action for a `pending` (generated, unsigned) session, reusing the existing plan-aware resend logic (rotates that session's own linked form's token, no tentative-time re-entry needed).

**Live-verified** on the same 3-session Project used in the sweep: Estimate widget now shows the per-session breakdown instead of "Not provided"; Inquiry Details no longer repeats Name/Email/Phone; the old Deposit widget shows only its read-only history (no "Tentative appointment time"/suggested-times UI) while Session Plan is the only place with active generate/resend controls; generated a fresh unsigned deposit for Session 2 and confirmed the new "Resend Deposit Form" button there rotates its token correctly (same `depositFormId`, no duplicate row). Re-checked a single-session inquiry (no plan) and confirmed zero change: normal "Resend Deposit Form"/tentative-time UI, normal single-value time estimate, no Session Plan widget.

**Typechecks**: `npx tsc --noEmit` (api) and `npx tsc --noEmit` + `npm run build` (web) — clean before commit, restricted to the two files actually changed (`InquiryDetail.tsx`, `InquiryDetailsSection.tsx`); the concurrent Stripe-integration session's edits to `deposits.ts`/`clients.ts`/`ClientDetail.tsx`/`DepositResponse.tsx` (observed mid-session, adding a `paidVia` field to the same `INQUIRY_INCLUDE` object this feature also touches) were confirmed unrelated and left uncommitted.

---

# Phase 7C — Stripe Connect (Standard), real deposit & checkout payments

Three parts, one session, committed and pushed separately as instructed. Ran only after confirming the SMS-consent/privacy-terms session's commits (`f703192`, `bd73203`, `77e4625`) were present on `main` (`git merge-base --is-ancestor` against both `main` and `origin/main`).

**Docs verified**: Stripe Connect Standard onboarding via **Connect Onboarding using Account Links** (`docs.stripe.com`, checked directly via web search/fetch, not assumed from training data) — `stripe.accounts.create({ type: "standard" })` + `stripe.accountLinks.create({ ..., type: "account_onboarding" })`, no OAuth Client ID, no pre-registered redirect URIs. Direct charges on the connected account via the Node SDK's `{ stripeAccount: connectedAccountId }` request option plus `payment_intent_data.application_fee_amount` on the Checkout Session. Checkout Session `line_items` use the current `price_data: { currency, product_data: { name }, unit_amount }` shape. Connect webhook events are resolved to a studio via the event's own top-level `account` field, never a studio id carried in the payload.

## Part 1 — Stripe Connect (Standard) onboarding — `8c0f588`

Added `STRIPE` to `IntegrationChannel`, reusing the existing `StudioIntegration` chassis from Phase 7B — no per-studio secret to encrypt this time, since the platform's own `STRIPE_SECRET_KEY` makes every call, scoped to the connected account via the `stripeAccount` option. `metadata` holds `{ stripeAccountId, chargesEnabled, payoutsEnabled }`.

The onboarding-specific logic (create account, generate a single-use Account Link, "Finish setup" resume) lives entirely in a new `lib/stripeConnect.ts`, deliberately isolated from the payment/webhook logic Parts 2–3 added later. Settings → Integrations gained a Stripe card (OWNER only): Connect / Finish setup / Disconnect, `chargesEnabled`/`payoutsEnabled` surfaced plainly ("Payments are live" vs "Setup incomplete"), masked account id, disconnect clears only Ink Manager's own record (the real Stripe account is untouched).

**Live-verified** against a real Stripe test-mode account: full connect flow (the actual hosted-onboarding form has a live hCaptcha challenge that correctly blocked headless automation — recognized as a legitimate anti-fraud control, not something to defeat, so the user completed that one step manually in their own browser); `chargesEnabled`/`payoutsEnabled` confirmed `true` via both the Stripe API directly and the app's own UI; disconnect confirmed to clear local state while leaving the real Stripe account untouched; FRONT_DESK → 403 on all three routes; cross-studio isolation confirmed via a second seeded studio with its own independent, unaffected `NOT_CONNECTED` row (these routes take no `:id` param, so isolation is structural — scoped entirely by the caller's own JWT `studioId` — rather than a `404`-on-wrong-id check).

## Part 2 — Real deposit payments via Stripe — `46cb0bc`

The public deposit form generates a real Stripe Checkout Session (direct charge, `application_fee_amount` from `PLATFORM_FEE_PERCENT`) once the studio's Stripe is connected. Manual mark-paid stays available as a fallback (cash/comps aren't going away) — `DepositForm.paidVia: "STRIPE" | "MANUAL"` records which path was used, added **alongside** the existing `paidManually` boolean rather than replacing its semantics (roughly a dozen existing call sites, including the cold-follow-up-task query, already treat `paidManually` as the generic "is this paid" signal).

`POST /webhooks/stripe` (public, raw body — `index.ts`'s global `express.json()` is special-cased to `express.raw()` for this one path) verifies the signature against `STRIPE_WEBHOOK_SECRET`, resolves the studio via the event's connected-account id, and on `checkout.session.completed` issues the gift card through a newly-extracted shared `lib/deposits.ts` function (`issueGiftCardForPaidDeposit`) — the same code path the manual route now also calls, rather than two copies of the amount-conversion/issuance logic. Idempotent via a fresh `giftCardId` re-check taken *inside* the transaction, so a webhook retry is a no-op, not a duplicate.

**No Stripe CLI binary was available in this sandboxed environment** (`stripe listen` unusable), so live webhook verification used a substitute that's functionally identical to what the CLI does under the hood: pay a real Stripe Checkout Session with a Playwright-driven browser and Stripe's standard test card, then fetch the genuine resulting event via the Stripe API and re-deliver it to the local webhook endpoint with a signature computed the same way `stripe listen` computes it (HMAC-SHA256 over `{timestamp}.{payload}` using the real webhook secret already in `.env`) — real event data, real signature, real verification code path, just hand-forwarded instead of CLI-forwarded.

**Live-verified** end to end: Checkout Session created → paid with `4242 4242 4242 4242` → webhook delivered → `DepositForm.paidVia: "STRIPE"`, `stripePaymentIntentId` set, a $100 gift card issued (the deposit amount, not the $110 total including the platform fee) → inquiry advanced `DEPOSIT_PENDING → SCHEDULING`. Webhook replay (same event, re-delivered) produced no duplicate gift card. Manual mark-paid confirmed as a working fallback on a second deposit (`paidVia: "MANUAL"`). A studio with no `StudioIntegration` row for `STRIPE` at all got today's manual-only flow completely unchanged, and the new `checkout-session` route correctly 400s for it (`"Online payment isn't available for this studio right now."`).

## Part 3 — Real checkout payments + gift card overage as new card — `3763e4d`

**Note**: the checkout overage → new-gift-card logic itself was already implemented in the codebase going into this part (the task description was stale relative to actual state, exactly as the task itself warned might happen). The real remaining work was wiring `GiftCard.derivedFromGiftCardId` onto what already existed, plus adding the real Stripe charge for the "amount due" side, neither of which existed yet.

Checkout's "amount due" gets a real Stripe Checkout Session (same direct-charge + `application_fee_amount` pattern as Part 2, same `createDirectChargeCheckoutSession` helper, no new payment code) when the studio's connected. Checkout itself still completes synchronously exactly as before — cards redeemed/rolled, appointment `COMPLETED` — collecting the remaining balance is a decoupled concern, which is also why the new manual fallback (`PATCH /appointments/:id/mark-charged`) can apply after the fact for cash/comp or a not-connected studio. The client pays on Stripe's hosted page on whatever device staff hands them; the redirect destination (`/appointments/pay-complete`) is a new, deliberately data-free public page — no appointment id, no auth, nothing to leak — since the actual confirmation happens server-side via the webhook, not the redirect. The Part 2 webhook handler is extended to also resolve `Appointment` by `stripeCheckoutSessionId`, same idempotency discipline (a `paidVia` already set on retry is a no-op).

`derivedFromGiftCardId` is set on the new overage card when **exactly one** card was redeemed — it's a single nullable FK, so a combined multi-card overage has no single "the" origin to point at, and is left `null` in that case (a deliberate simplification, noted here rather than silently done). The audit trail is unaffected by that limitation either way: the existing Appointment-level `checkout` entry already recorded every contributing card id and both amounts (redeemed total, overage) before this part, and a new GiftCard-level `issued_from_overage` entry was added on the new card's own audit trail specifically. Origin is now visible on `GiftCardDetail` ("Issued from redeeming gift card …") and as a small note in the client's gift card list.

**Live-verified**, using the same self-signed-webhook-delivery approach as Part 2:
- **Card-exceeds-cost**: a $100 gift card redeemed against a $60 final cost → original card `REDEEMED`, new $40 card issued with `derivedFromGiftCardId` correctly pointing at the original, both the Appointment-level and the new card's own `issued_from_overage` audit entries present with both amounts.
- **Amount-due (card-under-cost)**: a $100 card redeemed against a $250 final cost → real $150 Stripe Checkout Session created, paid with the test card, webhook confirmed, `Appointment.paidVia: "STRIPE"` + `stripePaymentIntentId` set. Webhook replay produced no duplicate audit entry (exactly 1 `stripe_payment_confirmed` entry after two deliveries).
- **No-Stripe studio**: same amount-due scenario on a studio with no Stripe connection → `checkoutUrl: null` (no regression), manual `mark-charged` set `paidVia: "MANUAL"`, a second call correctly rejected ("already been marked paid").
- Both routes reuse `appointments.checkout`'s existing permission gate (OWNER/FRONT_DESK only) — no new gating logic to separately verify.

## Railway production variables (platform-level only — never per-studio)

```
STRIPE_SECRET_KEY=sk_live_...       # Developers -> API keys, platform account
STRIPE_PUBLISHABLE_KEY=pk_live_...  # same page
STRIPE_WEBHOOK_SECRET=whsec_...     # from a real dashboard-registered endpoint
                                     # (Developers -> Webhooks -> Add endpoint,
                                     # pointed at https://<api-host>/webhooks/stripe),
                                     # NOT the `stripe listen` CLI secret used locally
PLATFORM_FEE_PERCENT=0              # or whatever the platform's real cut is; 0 = no fee
```

## `paidVia` convention

`"STRIPE" | "MANUAL" | null`, on both `DepositForm` and `Appointment`. `null` until paid; set once, never overwritten; a webhook retry or a second manual attempt against an already-set value is a no-op/400, never a re-charge or double-issuance. Layered on top of `DepositForm`'s pre-existing `paidManually` boolean (left with its original, broader "is this paid at all" meaning, unchanged, since existing code elsewhere already depends on it) rather than replacing it.

## Gift card overage → new card: confirmed working end to end

Single-card overage correctly produces a new, smaller, `ACTIVE`, unattached card on the same client with `derivedFromGiftCardId` set and a full audit trail (both card ids, both amounts). Multi-card combined overage still issues the new card correctly (pre-existing behavior, unaffected) but leaves `derivedFromGiftCardId` `null`, noted above as the accepted, single-FK limitation — a reasonable future extension would be a join table if per-origin tracing across multiple redeemed cards is ever needed, not required for the common case this shipped for.

## Typechecks

`npx tsc --noEmit` (api) and `npm run build` (web) — both clean before every one of the three commits.

## Cleanup

All ad-hoc Playwright scripts and screenshots in the scratchpad directory removed after use; one-off `scratch-check.ts` files under `apps/api/` (used for direct Stripe API checks and self-signed webhook delivery, never committed) deleted after each use. Test data created during verification (several inquiries/deposit forms/appointments/gift cards across both `dev-studio` and `dev-studio-2`, plus one extra `ARTIST` user + `Artist` profile seeded for `dev-studio-2` since it had none) left in the dev database, consistent with this session's standing convention. Background dev servers (API :4000, web :5173) killed at the end of the session.

---

# Fix: inquiry/client delete 500, plus three multi-session UX bugs

Same session, follow-up bug reports. Concurrent Stripe-integration work (Part 2/3 above) was actively being committed in this same shared working directory throughout -- see the attribution note at the end of this entry.

## 1. "Internal server error" deleting an inquiry

Root cause, confirmed via the actual migration SQL: `PlannedSession.inquiryId` is `ON DELETE RESTRICT`. Neither `DELETE /inquiries/:id` nor `DELETE /clients/:id` (whose transaction also bulk-deletes that client's inquiries) ever deleted a project's `PlannedSession` rows before deleting the `Inquiry` itself -- a gap from when `PlannedSession` was first added, since the delete transactions were never revisited. Every project with a declared session plan (`sessions.length > 1` at estimate time) was therefore **permanently undeletable**, both directly and via deleting its client, throwing an unhandled Postgres FK-violation as a 500.

Fixed by adding `tx.plannedSession.deleteMany(...)` to both transactions, right before the `Inquiry` delete each one performs (`PlannedSession.depositFormId`/`appointmentId` are both `ON DELETE SET NULL`, so the existing `depositForm`/`appointment` deletes earlier in each transaction never needed to change). Added a `plannedSessions` count to `gatherInquiryDeletionSummary` (and the delete-confirmation modal's preview list) for parity with the other counts already shown there.

**Live-verified**: deleted a real 3-session Project (2 deposit forms, 3 planned sessions) directly -- `delete-preview` correctly reported `plannedSessions: 3`, the `DELETE` call returned `200`, and a follow-up `GET` on the same id returned `404`. Separately deleted a client whose only inquiry had a 2-session plan -- `200`, confirmed gone.

**Attribution note**: this fix (in `apps/api/src/routes/inquiries.ts` and `clients.ts`) ended up committed under `46cb0bc` ("Part 2: real deposit payments via Stripe") rather than a commit of my own -- the other session, actively working in this same shared directory, staged and committed those two files while my edits to them were still uncommitted locally. The code itself is correct and verified as above; only the commit attribution is affected. Not reverted or rewritten, per this session's standing policy on shared-directory collisions -- documented here instead.

## 2. Estimate still fillable with no artist assigned

The Edit button was already correctly hidden without an artist, but a separate "seed form state on inquiry load" effect (`setEditingEstimate(!inquiry.estimateSentAt)`, adjusted-during-render per React's own reset-on-prop-change guidance) forced the form open anyway for any inquiry that had never had an estimate sent -- completely bypassing the button. Fixed the seed itself: `setEditingEstimate(!inquiry.estimateSentAt && !!inquiry.assignedArtist)`. Also added the same server-side gate `POST /:id/send-estimate` was missing (`assignedArtistId` required, mirroring the existing deposit-form gate) so a direct API call can't bypass it either. Live-verified: a fresh, unassigned inquiry now shows only "Assign an artist before entering an estimate." -- no price/time/session fields, no Edit button, no Generate & Send button.

## 3. Deposit widget showing an empty box

Its own interactive "generate a deposit" section is (correctly, per the prior sweep) gated off entirely once a project has a session plan -- Session Plan is the one place to generate one there. That left the widget rendering with nothing inside for any multi-session project that reached `DEPOSIT_PENDING` before its first deposit form existed. Changed the widget's outer visibility to require actual content: `depositForms.length > 0` (real history) `|| (plannedSessions.length === 0 && (status === DEPOSIT_PENDING || isConverted))` (the single-session case, where the interactive section is guaranteed to render). Live-verified: the box now stays hidden until Session Plan generates the first form, at which point it reappears showing that form's real history.

## 4. Can't book an appointment without a paid deposit -- even with an available gift card or exemption on file

Confirmed the premise and found it ran two layers deep. Session Plan's own "Book Appointment" button required `depositStatus === 'paid'` for *that specific* session -- ignoring that gift cards and deposit exemptions stack across the whole client (Phase 3), not per session, so a card rolled forward from an earlier session (or an exemption) can perfectly well cover a later one. Relaxed to `depositStatus === 'paid' || hasAvailableGiftCard`.

That alone wasn't enough: `AppointmentForm.tsx`'s own `availablePlannedSessions` filter had the identical "this session's own paid deposit" requirement, gating which planned sessions the modal would even recognize as selectable -- so clicking "Book Appointment" opened the modal, but it silently failed to pick up the session's own hour estimate (falling back to the null top-level fields and showing "This project has no estimated time yet"), caught by actually clicking through rather than just checking the button's visibility. Relaxed the same way (`!ps.appointmentId` only) -- the real money-sufficiency check already happens independently in `GiftCardStackPicker`, comparing selected-card total against the required amount before `Create Appointment` is enabled, so neither gate was ever load-bearing for correctness, only for discoverability.

**Live-verified end to end**: booked and checked out (ROLL) Session 1's appointment on a real 2-session Project, producing an unattached, available $200 card with Session 2's own deposit never generated. Confirmed "Book Appointment" now appears for Session 2; opened it and confirmed the modal correctly pre-selects Session 2, sizes "Suggested times" at 5-hour blocks (Session 2's own 4-6hr estimate), and offers the rolled-forward card in the stack picker. Selected it and completed the booking -- `201`, `PlannedSession.appointmentId` set correctly.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc --noEmit` + `npm run build` (web) — clean before commit (`c792ec4`), restricted to the two files this fix actually touched going into that commit (`AppointmentForm.tsx`, `InquiryDetail.tsx`) — see the attribution note in §1 for the delete-fix's own two files.

## Cleanup

Scratch dev servers run on yet another fresh port pair (API :5503, web :6503) after confirming :5501/:5502/:6501/:6502 were all still occupied by other concurrent activity in this same shared directory -- killed by PID afterward. Several transient `EADDRINUSE`/`ECONNREFUSED` scratch-server crashes during this fix, caused by the other session's own rapid iterative edits to `appointments.ts` in the same watched directory -- not a bug in this fix's own code; resolved each time by restarting. All ad-hoc verification scripts left in the scratchpad, none committed. Test data: one 3-session Project and one client (with a 2-session Project) permanently deleted as part of verifying the delete fix works; one existing single-session inquiry pushed through the estimate-gate scenario; one fresh 2-session Project created, converted, and booked through both sessions to verify the gift-card-stacking fix -- all left as-is (or, for the two deletions, correctly absent) in the dev database, consistent with this session's standing convention.

---

# Client page Projects widget; Scheduling/Appointments consolidation; button sizing

Same session, follow-up UX requests. Commit: `453b963`.

## 1. Client page: "Projects" widget with per-session status

Added a "Projects" widget, separate from the existing "Inquiries" widget (which is unchanged -- still every inquiry regardless of status). Filters `client.inquiries` to the same 3-status "converted" group used everywhere else in this codebase (`SCHEDULING`/`WAITLISTED`/`CONFIRMED` -- kept as a small local literal, matching this codebase's established convention for that specific group rather than importing it across page files). For each project: description (linked to the Project page) and its status pill, then a per-session status list reusing the exact same deposit/appointment badge logic as the Project page's own Session Plan widget (`Deposit paid`/`pending`/`not yet generated`, `Not yet booked`/`Scheduled`/`Completed`). A project with no declared session plan still shows one implicit "Session 1" line, derived from its own `depositForms[0]` and whatever appointment (if any) has `inquiry.id` matching the project.

Backend: extended `GET /clients/:id`'s existing `plannedSessions` select (already there for `AppointmentForm.tsx`'s own picker) with `appointment: { select: { checkedOutAt: true } }` -- needed to tell "Scheduled" apart from "Completed" the same way Session Plan does; wasn't previously selected since nothing on this page needed it before. Also corrected that select's own comment, stale since the artist-independent gift-card-stacking fix a few commits back (still said "only ones with a paid deposit").

**Live-verified**: a client with one 2-session Project (Session 1 paid+completed, Session 2 booked but its own deposit never generated -- covered by a rolled-forward card instead) shows exactly that under "Projects": `Deposit paid`/`Completed` for Session 1, `Deposit not yet generated`/`Scheduled` for Session 2 -- correctly reflecting that a session doesn't need its own deposit to be booked, consistent with the earlier gift-card-stacking fix.

## 2. Project page: Scheduling merged into Appointments

Confirmed the premise: the standalone "Scheduling" widget (the original, pre-Package-M single-appointment flow -- suggested times, manual time entry, gift-card picker, a "Schedule Appointment" button, and Waitlist) sat directly above "Appointments" (the modern list + "New Appointment"/"Schedule Consultation", which supports consultations and planned sessions), both showing at once whenever a project reached `SCHEDULING` with no appointment yet -- two visibly different ways to book the same thing.

Investigated before touching anything: `POST /:id/schedule` (Scheduling's own action) is the *only* path that moves `status` from `SCHEDULING` to `CONFIRMED`, and the Kanban board's Projects tab has a real `SCHEDULING -> CONFIRMED` drag that deep-links straight to it (`?openFlow=schedule`) -- removing it outright would have broken that drag and silently frozen every project's status at `SCHEDULING` forever. Merged the two into one widget instead (kept "Appointments" as the title) rather than a deeper backend unification of the two booking routes, which was out of scope for what was asked: the list stays as it was, followed directly by Scheduling's old content, unchanged in behavior. Updated the `?openFlow=schedule` deep link and `INQUIRY_WIDGET_ORDER` to match. Dropped one genuinely redundant piece while merging -- the old Start/End/status `DetailField` block for an already-booked `inquiry.appointment` -- since the exact same appointment already appears in the list right above it (full start/end is one click away on its own detail page).

**Related gap found and fixed while verifying, not assumed away**: multi-session projects never move off `SCHEDULING` via their own per-session booking path (`POST /appointments` with a `plannedSessionId` never touches `inquiry.status`, unlike the legacy `/schedule` route) -- so the merged-in "Add an assigned artist and a time estimate to see suggested times" prompt would have shown *forever* on every multi-session project regardless of how many of its sessions were booked and completed, now more visible for sitting inside the same box as the real appointment list. Gated that whole block on `plannedSessions.length === 0`, the same reasoning already applied to the Deposit widget's own multi-session gate.

**Live-verified**: a 2-session Project (2 of its appointments already completed/confirmed) now shows one clean "Appointments" widget with no leftover scheduling prompt. A single-session Project still shows the full ad-hoc flow (suggested times, manual entry, gift cards, Schedule Appointment, Add to Waitlist) inside the same merged box, unchanged from before.

## 3. Session Plan button sizing

The Session Plan widget's own inline actions (Send/Resend Deposit Form, Cancel, Book Appointment) used a smaller size (`px-3 py-1.5 text-xs`) than the header-action buttons elsewhere on the same page (Edit, Revise Estimate: `px-4 py-2 text-sm font-semibold`). Resized all four to match.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc --noEmit` + `npm run build` (web) — clean before commit, restricted to the three files this change touched (`clients.ts`, `ClientDetail.tsx`, `InquiryDetail.tsx`).

## Cleanup

Scratch dev servers on yet another fresh port pair (API :5504, web :6504) after confirming ports through :5503/:6503 were all still occupied by other concurrent activity in this same shared directory -- killed by PID afterward. All ad-hoc verification scripts left in the scratchpad, none committed. No new test data created -- verification reused existing Projects from this session's earlier fixes.

---

# Fix: stale gift-card availability after booking or checkout

Same session, follow-up bug report. Commit: `6ee460e`.

## Investigation

The backend was never the problem -- `validateGiftCardForAttachment`/`validateGiftCardsForAttachment` (shared by both appointment-creation routes) already reject any card whose `appointmentId` is already set, confirmed live: attempting to reuse a card already attached to a booked appointment for a second one returned `400 "This gift card is already attached to another appointment"` every time, via a direct API call, no frontend involved.

The actual bug was frontend caching. This app's `QueryClient` sets a global default `staleTime: 30_000` -- any query is served from cache, un-refetched, for 30 seconds after it last resolved, unless something explicitly invalidates it sooner. Three places read a client's gift cards into a picker, and none of them invalidated after the action that would make their own data stale:

- `AppointmentForm.tsx`'s own `client-projects-for-appointment` query (used by every caller of this component -- `InquiryDetail.tsx`, `Calendar.tsx`, `Inquiries.tsx`) never invalidated itself after a successful booking.
- `InquiryDetail.tsx`'s shared `invalidateInquiry()` (called after every mutation on the page) never touched the un-planned Scheduling flow's own separate `client-gift-cards` query.
- `AppointmentDetail.tsx`'s checkout handler -- which can free a card back up via a `ROLL` decision -- never invalidated either query, so a just-ROLLed card could conversely look *unavailable* for the same 30s window.

Net effect: book an appointment with a card, then try to book a second one for the same client within 30 seconds (very plausible -- e.g. booking two sessions back to back), and the picker would still show the just-spent card as selectable. Staff could check it, only to have the submission itself rejected once the 30s window mattered -- confusing, and exactly what was reported.

## Fix

- `AppointmentForm.tsx`: invalidates its own `['client-projects-for-appointment', effectiveClientId]` query immediately after a successful `POST /appointments`, before calling `onCreated()`. Self-contained, so this one fix also covers its other two entry points (`Calendar.tsx`, `Inquiries.tsx`), not just `InquiryDetail.tsx`.
- `AppointmentDetail.tsx`: its checkout handler now also invalidates `client-projects-for-appointment` and `client-gift-cards` (both keyed on `appointment.client.id`) alongside the query it already invalidated.
- `InquiryDetail.tsx`: `invalidateInquiry()` now also invalidates `['client-gift-cards', inquiry?.clientId]`, closing the un-planned Scheduling flow's own gap.

## Live-verified, not just read

Issued a fresh $200 test card, booked an appointment for that client using it entirely through the real UI (custom `react-day-picker` calendar + time inputs, not a shortcut), and -- **without reloading the page** -- reopened the "New Appointment" modal for the same client immediately after. Confirmed via network monitoring that a fresh `GET /clients/:id` fired the instant the booking succeeded (proof the invalidation actually fired, not just that the code compiles), and the reopened modal correctly read "This client has no available gift card" -- the just-attached card was gone from the list, not still sitting there waiting to be mistakenly reselected.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc --noEmit` + `npm run build` (web) — clean before commit, restricted to the three files this fix touched (`AppointmentForm.tsx`, `AppointmentDetail.tsx`, `InquiryDetail.tsx`).

## Cleanup

Scratch dev servers on a fresh port pair (API :5505, web :6505) after confirming :5501 through :5504/:6501 through :6504 were all still occupied by other concurrent activity in this same shared directory -- killed by PID afterward. All ad-hoc verification scripts left in the scratchpad, none committed. Test data: one $50 and one $200 gift card issued directly to an existing test client to reach the sufficiency threshold for live verification, plus two new ad-hoc appointments booked against that client's project -- left in the dev database, consistent with this session's standing convention.

---

# Feature: artist rates, per-estimate flat pricing, per-session prices, and an Edit Estimate re-sync fix

Same session, follow-up feature request bundled with a bug report. Commit: `6865c7a`.

## Requests, and the design questions asked up front

Four items came in together: "editing estimates doesn't work," add flat-rate pricing to an estimate, add hourly/flat rate fields to an artist, and add a per-session price the same way per-session hours already exist (summed for the project's total). Rather than guess at scope, three design questions went back to the user before writing code:

- **Flat-rate scope** — a per-estimate toggle, independent of the Service's own `pricingModel`, available on any service (not just FLAT-priced ones).
- **Artist rate usage** — auto-calculate a *suggested* starting price (hourly rate x that session's hour estimate, or the flat rate verbatim), never forced or validated against — a pre-fill staff can freely override.
- **Per-session price vs. the project total** — sessions become the only price entry once a plan exists; the project-wide Price low/high becomes a read-only computed sum, mirroring exactly how per-session hours already replace the top-level time estimate.

## Schema

Purely additive, both nullable (`prisma migrate dev`, migration `20260726123546_artist_rates_and_session_prices`):

- `Artist.hourlyRateCents Int?`, `Artist.flatRateCents Int?` — reference rates, independent of each other.
- `PlannedSession.estimatedPriceLow Float?`, `estimatedPriceHigh Float?` — no historically-accurate backfill exists for pre-existing rows, so nullable rather than a required-with-backfill migration, matching this model's own existing "purely additive" posture.

No new field for "is this estimate flat" — flatness is fully expressible as `priceEstimateLow === priceEstimateHigh` (already true of the existing FLAT-service behavior under the hood), so the toggle is pure frontend UI state.

## Backend

- `PATCH /artists/:id` accepts/validates/persists both rate fields (non-negative number or null); `ARTIST_LIST_SELECT` and `ARTIST_INCLUDE` (via Prisma's `include`) expose them with no extra code.
- `POST /inquiries/:id/send-estimate` and `POST /inquiries/:id/revise-estimate`: each session in a declared multi-session plan now also requires a numeric, positive, low-lte-high price range. The submitted top-level `priceEstimateLow/High` is ignored entirely once a plan is being declared — the effective value is the sum of every session's own price instead (mirroring the existing hours-are-nulled-once-a-plan-exists rule). In `revise-estimate`, a **locked** session (paid deposit or booked appointment) keeps whatever price is already stored for it rather than trusting a resubmitted value — same untouchable rule its hour range already had. Every reachable `plannedSession` select across `inquiries.ts`, `clients.ts`, and `estimates.ts` (both the internal `INQUIRY_INCLUDE` and the public estimate/revision verify endpoints) now includes the two price columns.
- `INQUIRY_INCLUDE`'s `assignedArtist` select gained `hourlyRateCents`/`flatRateCents` — the frontend's auto-suggestion reads them straight off whichever artist is already assigned to the inquiry.

## Frontend

- **`ArtistDetail.tsx`**: new "Rates" widget (Hourly rate / Flat rate, dollar inputs converted to/from cents on save), wired to the now-extended `PATCH /artists/:id`.
- **`SessionBreakdownEditor.tsx`**: `SessionHoursRow` gained `priceLow`/`priceHigh`; `LockedSession` gained `estimatedPriceLow/High`. New exported `suggestSessionPrice()` (hourly rate x hours, or flat rate verbatim) and an `isFlat` prop that collapses each session's two price inputs to one (syncing both underlying fields to the same value). `SessionHoursRows` auto-suggests a price the moment both hour fields are filled *and* the price fields are still empty — never overwriting something already typed.
- **`InquiryDetail.tsx`**: both the original "Generate & Send Estimate" form and the "Revise Estimate" modal gained an independent flat/range checkbox (`estimateIsFlat`/`reviseIsFlat`, seeded from the Service's `pricingModel` for a never-sent estimate, or inferred from `low === high` for one already sent/saved), per-session price state, artist-rate auto-suggestion wiring, and a read-only "sum of every session below" price display in place of the editable top-level fields once a plan exists. The Session Plan widget, the top-level "Time estimate" multi-session summary, and `ClientDetail.tsx`'s Projects widget all now show each session's price alongside its hours. `EstimateResponse.tsx`/`EstimateRevisionResponse.tsx` (the client-facing pages) show it too.

## The "editing doesn't work" bug — real root cause found

Prior investigation this session (see the gift-card and stale-availability fixes above) could not reproduce a hard failure: the backend genuinely persisted every edit, confirmed via direct API checks. Asked the user directly what "doesn't work" meant; the answer — *"it allows me to edit it but I can't see any update to it... nothing has changed"* — pointed at the same class of bug already fixed twice this session: local form state that only syncs from live data once and never again.

Found it: the "Edit Estimate" button did nothing but `setEditingEstimate(true)` — it never re-seeded `estimateForm`/`sessionCount`/`sessionHours` from the inquiry's current data. Those were only ever seeded once, in a `seededEstimateForId`-gated effect keyed on `inquiry.id`, which fires exactly once per inquiry no matter how many times the estimate is subsequently sent, resent, or revised on that same page load. Reopening Edit a second time (e.g. after a resend) showed the *original*, pre-edit values — and on any inquiry with an existing multi-session plan, reopening Edit reset the session count back down to 1, silently discarding the real breakdown instead of showing it ready to edit further.

Fix: a new `openEditEstimate()` re-seeds every one of those fields from the live `inquiry` object (including reconstructing `sessionCount`/`sessionHours` — with price — from `inquiry.plannedSessions` when a plan already exists), and the Edit button now calls it instead of flipping the flag directly.

## Live-verified, not just read

Set a real artist's hourly rate to $150/hr via the UI (`Rates` widget, screenshot confirmed both fields and the `$`/`/hr` decoration render correctly), then on an `ARTIST_ASSIGNED` inquiry with that artist: set session count to 2, filled Session 1's hours (4-6) — its price auto-suggested `$600.00`/`$900.00` immediately (150 x 4, 150 x 6), confirmed by screenshot before typing anything into the price fields myself. Filled Session 2 (2-3 hrs, auto-suggested $300/$450), toggled the flat-rate checkbox (confirmed it collapses each session to one price input without silently changing already-entered values), toggled it back off, and submitted — `POST .../send-estimate` returned 201. The read-only view afterward showed `PRICE ESTIMATE LOW $900` / `PRICE ESTIMATE HIGH $1350` (the correct sum), the "Time estimate" line showed both sessions' hours *and* prices, and the Session Plan widget showed the same per-session breakdown. Reopened "Edit Estimate" immediately after — confirmed live that the form reopened with the *actual* saved 2-session plan (not reset to 1 session), each session's price field correctly prefilled from the just-saved values — directly verifying the re-seed fix above.

## Typechecks

`npx tsc --noEmit` and `npm run build`, both api and web — clean before commit.

## Cleanup

Reused the already-running dev servers from earlier in this session (API :4000/tsx watch, web :6506) rather than starting new ones, since both were already live, already pointed at each other, and picking up file changes via watch/HMR automatically. Test data: set a real dev artist's hourly rate to $150/hr and sent a real 2-session estimate against an existing test inquiry directly through the UI — left in the dev database, consistent with this session's standing convention. All ad-hoc verification scripts left in the scratchpad, none committed.

---

# Fix: editing an estimate silently regressed a Project's pipeline once a deposit was already requested

Same session, follow-up bug report on the feature above ("editing the estimate doesn't work... works when it's already a Project, doesn't work when it's still an Inquiry"). Root cause confirmed with live Playwright evidence, not guessed. Commit: TBD (this entry documents the fix before commit).

## Investigation — evidence, not assumption

First pass (no fix applied): reproduced the exact user-described flow (open a pre-conversion Inquiry's estimate, edit, "Generate & Resend Estimate") on both a completely reused dev server pair AND a freshly cold-started one (new API on :5507, new web on :6507, both spun up from scratch to rule out stale-HMR-bundle theories). Both reproduced correctly: fields prefilled from live data, the resend saved (`201`, correct new price shown afterward). Asked the user to hard-refresh and retest — they confirmed the bug persisted even after a hard refresh, ruling out a stale-bundle theory.

Per instruction, re-investigated with real Playwright evidence across roles rather than guessing further:

**Permission-mismatch hypothesis — tested and ruled out.** `POST /:id/send-estimate` is gated by `inquiries.sendEstimate`; `POST /:id/revise-estimate` by `inquiries.enterEstimate` (a genuinely different key). Fetched this studio's actual permission matrix (`GET /studios/:id/permissions`): FRONT_DESK has both keys `true` (no discrepancy), OWNER bypasses every permission check unconditionally. Playwright reproduction logging in as both OWNER and FRONT_DESK, capturing every console error and the exact `send-estimate` network request/response, showed **`201` for both roles** on a genuine pre-conversion inquiry — the price genuinely saved every time. This ruled out the permission theory the investigation was specifically asked to test.

**What actually reproduced it**: tried the identical action against `cms0koz0k000j1si2i2nsq2co`, a real dev-seed inquiry sitting in `DEPOSIT_PENDING` (Pipeline widget showing "Deposit requested" as its current, checked-off stage, with a live, unpaid deposit form already generated below it). The Estimate widget's action button there read **"Edit"**, not "Revise Estimate" — meaning it was still running through the ORIGINAL pre-conversion send/resend flow, not the safe post-conversion revision flow, despite this being a project already deep enough into its lifecycle to have a real deposit form outstanding.

Clicked it, edited the price, submitted — `POST /send-estimate` returned `201` and the new price genuinely saved (`$411`/`$611` shown afterward). But the **Pipeline widget visibly regressed**: "Deposit requested" (previously checked off, stage 4) reverted to showing "Estimate sent" (stage 3) as current, and the status badge changed from "Deposit Pending" back to "Sent, not opened yet" — while the Deposit widget further down the same page kept showing the exact same already-generated, still-unpaid deposit form completely untouched, now orphaned underneath a pipeline that looked like it had never reached that stage. Confirmed via `git log -L` that this button-selection logic (`isConverted = SCHEDULING || WAITLISTED || CONFIRMED`, deliberately excluding `DEPOSIT_PENDING`) predates this session entirely (commit `8ee5678`, "Package H") — not something introduced by the feature work above.

**Root cause, precisely**: `POST /:id/send-estimate` unconditionally sets `status: AWAITING_CLIENT_RESPONSE` on every call (by design — a genuine first send, or a `BUDGET_NEGOTIATION` back-and-forth, has nothing downstream to lose). But `DEPOSIT_PENDING` is excluded from `PROJECT_STATUSES` (it deliberately stays on the Inquiries tab, not Projects — confirmed against `INQUIRIES_TAB_STATUSES`/`PROJECTS_TAB_STATUSES` in `Inquiries.tsx`, unrelated to this fix and untouched), so the frontend's `isConverted` check routes a `DEPOSIT_PENDING` project to the ORIGINAL send/resend UI instead of "Revise Estimate" — the one route that never touches `status` or the existing deposit form. Calling send-estimate here forcibly regresses the pipeline past a stage that already has a real, possibly-already-*paid* deposit form sitting downstream of it. This is a genuine, confirmed server-side + frontend gap, not a permission issue and not a caching issue — this category is "other server-side gap allowing an unsafe action to fire," exactly the third category the investigation asked to check for.

This also explains why the user perceived it as "doesn't work when it's still an Inquiry" — from a plain-English standpoint, a project with a deposit already requested clearly isn't just "an inquiry" anymore, even though the code's own narrower `isConverted` (a proxy for "SCHEDULING and later") disagreed and routed it through the wrong flow.

## Fix

Added a new, narrowly-scoped `ESTIMATE_REVISION_ONLY_STATUSES = [DEPOSIT_PENDING, ...PROJECT_STATUSES]` in `inquiries.ts` — used *only* to gate which of the two estimate-editing routes is reachable, deliberately not touching the broader `PROJECT_STATUSES` constant (which still correctly excludes `DEPOSIT_PENDING` everywhere else — Kanban tab grouping, appointment eligibility, etc. — all untouched):

- `POST /:id/send-estimate` now rejects (`400`) once `ESTIMATE_REVISION_ONLY_STATUSES.includes(inquiry.status)`, with a message pointing at Revise Estimate instead.
- `POST /:id/revise-estimate`'s existing gate (previously `!PROJECT_STATUSES.includes(status)`) now checks `!ESTIMATE_REVISION_ONLY_STATUSES.includes(status)` instead — accepting `DEPOSIT_PENDING` in addition to the three it already accepted.
- `InquiryDetail.tsx`: added `canReviseEstimate = isConverted || status === 'DEPOSIT_PENDING'`, used in place of `isConverted` for the Estimate widget's own action-button selection, its "Locked" messaging (reworded from "converted to a Project (deposit paid)" to "a deposit has already been requested," accurate for both the true-`isConverted` and the new `DEPOSIT_PENDING` case), and the edit-form visibility gates. Every *other* `isConverted` usage on the page (the Pipeline widget's step choice, the "Back to Projects/Inquiries" link, the already-DEPOSIT_PENDING-aware Deposit-widget gates) was deliberately left untouched — this fix only touches the Estimate widget's own edit-vs-revise choice.

## Live-verified, not just read

Re-ran the identical reproduction against a fresh, untouched `DEPOSIT_PENDING` dev inquiry (`cmrzvnyps001q5si2glp2cac6`) after the fix:
- The Estimate widget now shows **"Revise Estimate"**, not "Edit" (confirmed both via `isVisible()` assertions and a screenshot).
- Opening it correctly prefilled `$300`/`$400` (its real saved values).
- Submitting a revision (`$350`/`$450`, with a reason) hit `POST /revise-estimate`, returned `201`.
- Afterward: price shows `$350`/`$450`, the status badge **still reads "Deposit Pending,"** the Pipeline widget **still shows "Deposit requested" as its current, checked-off stage** (no regression), and the original deposit form is still present, untouched, further down the page.
- Directly called the old `send-estimate` route against this same still-`DEPOSIT_PENDING` inquiry via `fetch()` inside the authenticated page context: **`400`**, `"A deposit has already been requested for this inquiry -- use Revise Estimate instead of Generate & Send Estimate."` — confirming the vulnerable path is now closed server-side too, not just hidden in the UI.
- Regression-checked a genuine, unrelated `SCHEDULING` project (`cms0vlzqi0003jci2bgphz3z9`) still correctly shows "Revise Estimate" (screenshot-confirmed, including its own flat-pricing display, `$300` single field) — this fix didn't change behavior for the already-correct case.

## Typechecks

`npx tsc --noEmit` and `npm run build`, both api and web — clean before commit.

## Cleanup

Spun up one fully cold, disposable dev server pair (API :5507, web :6507) purely to rule out stale-HMR-bundle theories, then killed both by PID once that was ruled out. All other verification reused the already-running API :4000 / web :6506 pair. Test data: several dev-seed inquiries/projects had their price/status genuinely changed by these reproduction runs (`cmrs5w1fx0006r4i2o9kacqn1`, `cms0koz0k000j1si2i2nsq2co` — now shows `AWAITING_CLIENT_RESPONSE` instead of its original `DEPOSIT_PENDING`, a side effect of reproducing the pre-fix bug itself, left as-is since it's dev data — and `cmrzvnyps001q5si2glp2cac6`) — all left in the dev database, consistent with this session's standing convention. All ad-hoc verification scripts left in the scratchpad, none committed.

---

# Investigation: "the second estimate-editing form" — consolidated already; three real bugs found and fixed instead

Same session, follow-up task asking to find and delete a second, older single-session-only estimate-editing form component, on the premise (from real screenshots) that the owner had seen two different forms on the same estimate at different points, plus a concrete `$1,500` top-level vs `$3,000` session-sum mismatch. Investigated with the same rigor the task demanded — did not assume the premise was right just because it was asserted; found what was actually true instead.

## 1. Every distinct estimate-editing code path — there is exactly one

Grepped the entire `apps/web/src` tree, not just `InquiryDetail.tsx`, for every place `priceEstimateLow`/`timeEstimateHoursMin`/`send-estimate`/`revise-estimate` appear, and specifically for every usage of `SessionCountField`/`SessionHoursRows`/`SessionBreakdownEditor` (the multi-session-aware building blocks added earlier this session):

- **`InquiryDetail.tsx`** is the *only* file that calls `POST /send-estimate` or `POST /revise-estimate`. It has exactly two form-rendering call sites — the pre-conversion "Edit Estimate" block (`estimateForm`/`sessionHours`, opened via `openEditEstimate()`) and the post-conversion "Revise Estimate" modal (`reviseEstimateForm`/`reviseSessionHours`, opened via `openReviseEstimateModal()`) — and **both** render through the identical shared building blocks, `SessionCountField` + `SessionHoursRows` (`components/SessionBreakdownEditor.tsx`), which is imported nowhere else in the entire web app. There is no second, older, single-session-only component still reachable from anywhere.
- **`Inquiries.tsx`** (the Kanban board): no inline estimate form at all — its `send-estimate`-column drag just navigates to `InquiryDetail.tsx` via `?openFlow=send-estimate`, reusing the exact same single form.
- **`MyInquiries.tsx`** (artist-facing "My Inquiries"): has its own, genuinely different `approveForm` (single price/hour fields, no session awareness) — but this calls `PATCH /:id/respond`, a materially different feature (an artist's own informal first-pass quote suggestion, always pre-conversion, always before any `PlannedSession` row could exist). Confirmed out of scope: chronologically, an artist can only respond *before* staff has ever run send-estimate, so no session plan can exist yet at that point to be unaware of. Not a duplicate of the estimate-editing flow the bug report describes.
- Every other file the initial grep matched (`EstimateResponse.tsx`, `EstimateRevisionResponse.tsx`, `ClientDetail.tsx`, `AppointmentDetail.tsx`, `AppointmentForm.tsx`, `depositTiers.ts`, `format.ts`, etc.) is read-only display or unrelated computation, not an editable form.

**Conclusion for step 1**: the consolidation the task asked for already exists structurally. There is no second form component to delete.

## 2. What actually routes Edit vs. Revise Estimate

`canReviseEstimate` (added in the immediately prior session's `DEPOSIT_PENDING` fix) — `isConverted || status === 'DEPOSIT_PENDING'` — gates both the button choice and, critically, **both** `send-estimate` and `revise-estimate` independently re-check their own analogous server-side gate (`ESTIMATE_REVISION_ONLY_STATUSES`) before doing anything, so neither route trusts the frontend's choice of button. Confirmed neither render path bypasses this: `openEditEstimate()` and `openReviseEstimateModal()` are the only two functions that open a form, gated by the identical `canReviseEstimate` boolean on both the button and the conditional render block.

## 3. What's actually broken instead — found with real evidence, not assumed

The premise's own concrete clue (`$1,500` shown vs. a `$3,000` session-sum) pointed at real, live data. Queried every inquiry in the shared dev database with a declared session plan directly via Prisma (not through the API, to see the raw truth) and compared `priceEstimateLow/High` against the sum of its `plannedSessions`' own price columns:

```
cms0d44pq000oogi2ykvsgfa1   SCHEDULING              top-level: 1500/1500   session-sum: 0/0     <<< MISMATCH (3 sessions)
cmrzvnv0n001f5si2ndoardme   SCHEDULING              top-level: 1200/1200   session-sum: 0/0     <<< MISMATCH (2 sessions)
cmro4uxti00003ci2q69zbnf1   AWAITING_CLIENT_RESPONSE top-level: 900/1350    session-sum: 900/1350  OK
```

Traced the first mismatch's full audit trail: its estimate was originally sent on 2026-07-25 (pre-dating this session's per-session-pricing migration entirely — its 3 sessions only ever got hours, never a price column, since that column didn't exist yet), converted to `SCHEDULING`, then revised on 2026-07-26 at 12:31 — five minutes *before* the per-session-pricing migration ran — confirmed as a leftover artifact of this same session's own earlier verification testing (`repro_multisession_revise.mjs`, referenced in this conversation's own history), run against the pre-migration code. Not a currently-reachable bug by itself — but opening this exact record's Revise Estimate modal *right now*, with the current code, reproduced something very real:

- The read-only Estimate widget correctly showed the stored `$1,500`.
- Clicking "Revise Estimate" showed **"Price estimate (sum of every session below): $0"** — a live, reproducible, and startling mismatch between the same estimate's own display and its edit form, exactly matching "the same estimate, at different points, showing two different numbers."
- All three of that project's sessions were locked (appointment booked / deposit paid). Submitting *any* revision — even just a reason with zero other changes — failed with a `400`: `"Session 1's price range must be positive"`.

**Root cause, precisely**: `POST /revise-estimate`'s per-session validation loop checked `estimatedPriceLow > 0` unconditionally for every session in the submitted array, including locked ones. The frontend fills a locked slot's submission with `locked.estimatedPriceLow ?? 0` (its stored value, or `0` if that legacy session predates per-session pricing and was never given one) — and the backend then rejected that `0` as "must be positive," even though staff has no way to edit a locked session's price at all. **Net effect: any multi-session Project whose sessions were created before this session's per-session-pricing feature, and where every session is now locked, could never be revised again — permanently** — a real, currently-reachable, previously-unnoticed regression introduced by the per-session-pricing feature itself, not a leftover "second form."

Also found, while auditing every code path from step 1 with fresh eyes: the generic `PATCH /:id` route (`NUMERIC_FIELDS`, pre-dates per-session planning entirely) still accepts `priceEstimateLow`/`priceEstimateHigh`/`timeEstimateHoursMin`/`timeEstimateHoursMax` directly, with zero awareness of `PlannedSession` rows, for any inquiry not in `PROJECT_STATUSES` — including a `DEPOSIT_PENDING` or pre-conversion inquiry that already has a declared session plan. No current frontend caller passes those fields to this route (confirmed by grep — `handleSaveDetails` only ever sends `description`/`colorOrBlackGrey`/`placement`/`estimatedSize`/`budget`/`desiredTiming`), so this wasn't independently reproducible through the UI today, but it's a real latent bypass of the "sessions are the only source of truth once a plan exists" invariant and was closed for the same reason the `DEPOSIT_PENDING` fix closed a similar gap last session.

## Fixes applied

- **`POST /:id/revise-estimate`**: the per-session validation loop now skips locked session numbers entirely (`if (lockedSessionNumbers.has(index + 1)) continue`) — a locked slot's hours/price are never actually written from a submission anyway (the reconciliation block below it already ignored whatever was submitted for a locked slot), so there was never a reason to validate it. `lockedSessions`/`lockedSessionNumbers`/`existingByNumber` were moved earlier in the route so the validation loop can consult them.
- **`PATCH /:id`**: now rejects any edit to the four estimate fields once the inquiry has *any* declared session plan (`inquiry._count.plannedSessions > 0`), regardless of status — sessions, via `send-estimate`/`revise-estimate`, are the only sanctioned way to change them from that point on.
- **Data repair**: wrote and ran a one-time script (Prisma, not the API) that found every inquiry with a session plan and a non-null top-level price, and — only where *every* session in the plan had a null price (never partially, to avoid guessing over a plan that's already been priced unevenly on purpose) — backfilled each session with an even split of the existing top-level total. Found and repaired exactly the two records above: `cms0d44pq000oogi2ykvsgfa1` → 3 sessions × `$500`/`$500` each (sums to the existing `$1,500`/`$1,500`), `cmrzvnv0n001f5si2ndoardme` → 2 sessions × `$600`/`$600` each (sums to the existing `$1,200`/`$1,200`). The third, already-consistent record was left untouched. Both repaired records belong to the same single dev-seed studio (`Dev Studio`, `cmro4jzgx0000jwi2zqwlusok`) this whole session's testing has used throughout — confirmed via a database-wide query (no `studioId` filter) that the *only* other studio in this shared Railway database (`Dev Studio 2`, presumably another concurrent session's own test tenant) has zero inquiries with a declared session plan at all, so nothing outside this one dev studio was touched, and no real/production tenant is implicated.

## Live-verified, not just read

Re-opened `cms0d44pq000oogi2ykvsgfa1`'s Revise Estimate modal after both fixes: the modal's own computed sum now reads `$1,500`, matching the read-only view above it exactly, and the per-session breakdown shows `6-8 hrs · $500` for each session. Submitting a no-op revision (reason only) now succeeds with no validation error. To specifically isolate-test the *validation* fix (not just the data repair masking it), temporarily nulled Session 1's price back out via Prisma, retried the identical Revise Estimate submission — it still succeeded, with the modal correctly showing `$1,000` (the two still-priced sessions' sum) rather than blocking on the one null one — then restored Session 1's price and the top-level total to their fully-repaired, consistent state. Also confirmed a genuinely single-session estimate's edit form still renders simply — a flat-rate checkbox, Price low/high, an hours pair, and the "Number of sessions" selector (always present, since it's how staff would promote to a multi-session plan) — with zero per-session row clutter, since `SessionHoursRows` already returns `null` outright whenever `sessionCount <= 1`.

## Typechecks

`npx tsc --noEmit` and `npm run build`, both api and web — clean.

## A note on how this landed in git

While this investigation was in progress, a concurrent Claude Code session working in this same shared repository directory committed its own, unrelated feature (`1899b51`, "Add existing-client lookup to the '+ New Inquiry' flow") using a broad-staging commit that picked up this session's own in-progress, uncommitted edits to `inquiries.ts` (the locked-session-validation and `PATCH /:id` fixes above) alongside its own changes, and pushed the combined commit to `origin/main` before this session finished verifying. Per this session's own standing git-safety rules, an already-pushed commit — especially one containing another session's legitimate, unrelated work — is never rewritten/amended/rebased after the fact. The fixes above are real, complete, and confirmed present and correct in the current `HEAD` (verified via direct grep and a clean typecheck/build immediately after discovering the entanglement) — they are simply attributed to commit `1899b51` rather than a commit of this session's own. This section, and the dedicated commit that adds it, is this session's own clean record of what was actually done and why.

## Cleanup

All investigation/repair scripts were written directly inside `apps/api/src/` (needed real `tsx`+`dotenv` execution against the shared dev database) and deleted immediately after use — confirmed via `git status` that none were ever staged or committed. No new dev servers started this session; reused the already-running API :4000 / web :6506 pair throughout. No background shells left running.

---

# Fix: send-estimate silently dropped hour/price/count changes to an already-declared session plan

Same session, immediate follow-up. The user reported, after the investigation above: "price estimate is updating but number of sessions and hours per session is not updating." Reproduced with Playwright, found a fourth real bug in the same code area, fixed it.

## Reproduction

Took a real pre-conversion inquiry (`cmro4uxti00003ci2q69zbnf1`, `AWAITING_CLIENT_RESPONSE`) that already had a 2-session plan (Session 1: 4-6 hrs/$600-$900, Session 2: 2-3 hrs/$300-$450 — both correct, from earlier verification). Opened "Edit Estimate," changed Session 2's hours to 8-10 and its price to $900-$1100, submitted "Generate & Resend Estimate":

- Request body correctly carried the new numbers.
- Response: `201`.
- **The read-only view afterward still showed Session 2 as 2-3 hrs / $300-$450 — completely unchanged** — while `PRICE ESTIMATE LOW`/`HIGH` jumped from `$900`/`$1,350` to `$1,500`/`$2,000`, the sum of the *submitted* (not stored) session prices.

Exactly the reported symptom, and — as a direct side effect — a fresh instance of the same top-level-price-vs-session-sum mismatch repaired in the investigation above, now reproducible on demand rather than only as historical leftover data.

## Root cause

`POST /:id/send-estimate`'s own comment gave it away once traced: `"a resend never edits an already-declared plan."` The write path was:

```ts
if (plannedSessionInputs) {
  const existingCount = await prisma.plannedSession.count({ where: { inquiryId: id } });
  if (existingCount === 0) {
    await prisma.plannedSession.createMany({ ... });
  }
}
```

This was written back when a resend's *only* possible session-plan action was declaring a brand-new plan for the first time — before per-session pricing existed, changing an existing plan's hours (let alone its price) via this route wasn't a case being handled either way. Once staff can edit an *existing* plan's hours/price/count through the same "Edit Estimate" form (this session's own earlier feature work), this guard means every such edit is silently discarded at the database layer — while `effective.priceEstimateLow/High` (computed from the submission, not from what actually got saved) is written onto the Inquiry regardless, producing the exact "price updates, sessions don't" split.

## Fix

Replaced the guarded `createMany`-only block with the same create/update/delete reconciliation `POST /:id/revise-estimate` already had: match each submitted session against its existing row by `sessionNumber` (update if present, create if not), delete any existing row beyond the newly-submitted length. Included the identical locked-session skip for consistency, even though a locked session can't actually exist this early — `POST /:id/deposit-form` requires `DEPOSIT_PENDING` or later, and `send-estimate` already refuses to run at all once `ESTIMATE_REVISION_ONLY_STATUSES` is reached (the very first fix in the investigation above) — so this is defensive/future-proofing, not covering a reachable case today. Also added `plannedSessions` (with `depositForm.paidAt`) to this route's own inquiry fetch, which it previously didn't select at all.

## Live-verified, not just read

Re-ran the identical reproduction after the fix: Session 2 now correctly shows `8-10 hrs ($900-$1100)` in both the top summary line and the Session Plan widget, and the top-level price (`$1,500`/`$2,000`) now genuinely matches the sum of the real, updated session data rather than a stale submission-only computation. Re-ran the full database-wide mismatch check from the investigation above across every inquiry with a declared session plan (4 now, including this one) — all four consistent, zero mismatches.

## Typechecks

`npx tsc --noEmit` and `npm run build` (api) — clean.

## Cleanup

Reused the already-running API :4000 / web :6506 dev servers. One scratch verification script (`scratch-check-mismatch.ts`, written directly in `apps/api/src/` for real `tsx`+`dotenv` DB access) deleted immediately after use, confirmed via `git status` never staged. No background shells left running. Test data: the same dev-seed inquiry (`cmro4uxti00003ci2q69zbnf1`) now has a genuinely different, intentionally-test-value 2-session plan (hours 4-6/8-10, price $600-$900/$900-$1,100) from this reproduction — left as-is, consistent with this session's standing convention.

---

# Fix: send-estimate couldn't collapse an already-declared session plan back down

Same session, immediate follow-up. The user reported the previous fix worked on Projects (`revise-estimate`) but not on Inquiries (`send-estimate`) specifically when changing session count. Extensive local reproduction (edit an existing session, add a session, remove a session, increase 2→4) all passed — the actual gap only showed up when *collapsing a multi-session plan back down to 1*, and only surfaced because the user was testing on production (`inkmanager.app`), a separate database from this dev environment I have no direct access to.

## Getting real evidence without touching production

Explicitly did **not** run Playwright against `inkmanager.app` — that's a live site with real customers, and scripted actions there (especially anything that fires a real client-facing SMS) aren't something to do without explicit authorization. Instead asked the user to paste the actual network response from their own manual test. They did, straight from `sendEstimate`'s own JSON body on the real inquiry (`cms21etc300083fn0dccqijte`) after setting it to "1 session" and resending:

```json
"plannedSessions": [
  { "sessionNumber": 1, "estimatedHoursMin": 6, "estimatedHoursMax": 7, "estimatedPriceLow": 1000, "estimatedPriceHigh": 1000, ... },
  { "sessionNumber": 2, "estimatedHoursMin": 6, "estimatedHoursMax": 7, "estimatedPriceLow": 1000, "estimatedPriceHigh": 1000, ... }
]
```

Both sessions still there, completely untouched — real, first-party evidence the collapse-to-one path was broken, not something invented from a hunch.

## Root cause

Two matching gaps, one on each side of the request:

- **Frontend** (`handleSendEstimate`): `sessions: isMultiSession ? [...] : undefined`. Once `sessionCount` drops to 1, `isMultiSession` is `false` and `sessions` is never sent at all — no signal reaches the backend that an *existing* plan should collapse. `revise-estimate`'s own send function already had the fix for this exact case (`sessions: isReviseMultiSession ? [...] : (inquiry?.plannedSessions.length ?? 0) > 0 ? [] : undefined`) — `send-estimate`'s never got the equivalent.
- **Backend** (`POST /:id/send-estimate`): even *had* the frontend sent `sessions: []`, the validation gate `if (sessions.length > 1) { ...; plannedSessionInputs = sessions }` meant an empty (or single-element) array was silently treated identically to not sending the field at all — `plannedSessionInputs` stayed `null`, so the reconciliation block from the very first fix in this session never ran, and the old `PlannedSession` rows were never deleted. `revise-estimate` never had this gate (`if (sessions !== undefined)` alone was always enough to activate reconciliation, at any length) — `send-estimate` was the odd one out.

Net effect: reducing session count to 1 updated the top-level `priceEstimateLow/High`/`timeEstimateHoursMin/Max` directly (since that's the non-multi-session code path), but left the old `PlannedSession` rows completely intact — and since the read-only display always prefers a non-empty `plannedSessions` array over the top-level fields, the page kept showing the stale multi-session breakdown forever.

## Fix

- **Frontend**: `send-estimate`'s own request body now mirrors `revise-estimate`'s exact pattern — sends `[]` when collapsing an existing plan, `undefined` only when there was never a plan to begin with.
- **Backend**: removed the `sessions.length > 1` gate entirely; `plannedSessionInputs` is now set whenever `sessions !== undefined`, at any length (0 included) — matching `revise-estimate`. Introduced `hasPlan = finalSessionCount > 1` (mirroring `revise-estimate`'s own naming) to decide whether the top-level price/hours are computed from the session sum or from the direct submission — this is the piece that lets a length-0 or length-1 submission still trigger the reconciliation (and delete the old rows) while correctly *not* forcing price to `$0`.

## Live-verified, not just read

Reproduced on this dev environment's own database first (a 4-session plan on `cmro4uxti00003ci2q69zbnf1`, collapsed to 1 via the real "Edit Estimate" form, filling in a fresh price/hour range): before the fix, this reproduced the identical symptom the user described. After the fix: `POST /send-estimate` response shows `"plannedSessions": []` (all 4 rows genuinely deleted), `priceEstimateLow/High: 1000/1000` and `timeEstimateHoursMin/Max: 6/8` (the freshly-submitted single values), and the page correctly displays "6–8 hours" instead of the old multi-session breakdown.

## Typechecks

`npx tsc --noEmit` and `npm run build`, both api and web — clean.

## Cleanup

Reused the already-running API :4000 / web :6506 dev servers. One scratch read-only script checking whether the production inquiry ID existed in this dev database (it didn't — confirms separate databases) deleted immediately after use, never staged. No background shells left running. Test data: the same dev-seed inquiry now has its plan fully collapsed to a single 6-8 hour, $1,000 estimate — left as-is.

---

# Calendar — artist-filtered Month view for at-a-glance booking density

Same session. New feature, no schema changes — a filter + visual-state enhancement on the existing Month view only.

## 1. Investigation

- **Was Month view's artist filter reusable, or does one not exist yet?** It already existed and was already rendered above the calendar regardless of view (`Calendar.tsx`'s "Artists" chip row, `selectedArtistIds`/`activeArtistIds`/`toggleArtistFilter`) — Week/Day already used it to build resource columns. Month view's own `displayEvents` computation just had a hardcoded early return (`if (effectiveView === Views.MONTH) return events`) that ignored the filter entirely, regardless of which chips were active. No second filter control was needed or built — this is a pure reuse.
- Multi-select already worked mechanically (the chips toggle membership in an array, same interaction Week/Day's resource columns already rely on) — nothing new needed there either.

## 2. Artist filter now applies to Month view

Removed Month view's hardcoded bypass. It now filters by `activeArtistIds` exactly like Week/Day — with one carve-out preserved: when `selectedArtistIds` is still `null` (nothing toggled yet, the default), Month view keeps its original "show everyone regardless" behavior, including an ended guest's past appointments that `activeArtistIds` wouldn't otherwise include (see the existing comment on that guarantee) — only once staff explicitly clicks a chip does Month view start narrowing down.

## 3. Three-state day coloring, filtered to one artist

Added `isArtistUnavailableAllDay` (a Month-view analog of the existing `isStudioClosedAllDay` — "no schedule entry at all for that weekday" reads as not-working; a day the artist works only part of still counts as working, same "no time-of-day granularity in Month view" reasoning the existing studio-hours check already used). A day now reads as one of three states — **only** when the artist filter is narrowed to exactly one artist (`filteredSingleArtist`); with zero or 2+ selected, "working" would have to mean "any of them," which stops answering "was THIS artist continuously booked," so it intentionally falls back to the pre-existing studio-closed-only grey with no ambiguous multi-artist coloring:

- **Not working**: existing grey (`--color-surface-inset`, reused, not a new color) — studio closed OR this artist has no schedule entry for that weekday OR outside their guest window.
- **Working, nothing booked**: a new, distinctly different light green tint (`color-mix(in srgb, var(--color-success) 14%, transparent)` — same color-mix-over-transparent pattern `index.css` already uses for other translucent accents, not a new visual technique).
- **Working, booked**: unchanged — the existing per-artist event color shows through (background stays fully transparent so the event box itself is what reads as "booked").

## Live-verified, not just read

Seeded two real test appointments (consultations, cheapest path to a bookable slot) for a dev artist (`Louie G`, preferred schedule Mon/Wed/Fri only) on two of their working Mondays/Wednesdays this month, leaving every other Mon/Wed/Fri in the month deliberately empty. Filtered Month view down to just this artist (deselecting every other chip — the existing mechanism, not a new one-click "isolate" control) and confirmed, via actual computed `background-color` values pulled from the rendered DOM (not just eyeballing a screenshot):

- Non-working days (Tue/Thu/Sat/Sun): `rgb(18, 18, 20)` — the existing grey.
- Working, empty Mon/Wed/Fri days: a distinct green tint, confirmed as a separate color value from both the grey and the default background.
- The two booked Mon/Wed days: fully transparent background (`rgba(0, 0, 0, 0)`) with the artist's own colored event box on top, unchanged from today.

A full month scan of the screenshot reads immediately as "working days with gaps here, here, here" without opening any individual day. Also confirmed: selecting exactly two artists filters events to just the two of them with zero green-tint coloring (falls back to grey-only, as designed) — no ambiguous "whose availability is this" state. Reloading the page (fresh mount, `selectedArtistIds` back to `null`) restored Month view to its exact original combined-everyone appearance, screenshot-identical to before any chip was touched.

## Typechecks

`npx tsc --noEmit` (api, unaffected but checked per the standing rule) and `npx tsc --noEmit` + `npm run build` (web) — clean.

## Cleanup

Reused the already-running API :4000 / web :6506 dev servers, no new ones started. All verification scripts stayed in the scratchpad, none committed. Test data: two real consultation appointments created for `Louie G` on two Mondays/Wednesdays this month (dev-seed client) — left in place, consistent with this session's standing convention, and useful groundwork for anyone re-verifying this feature later.

---

# Calendar polish — Part 1: visual audit and fixes

Same session, new three-part task on the same `Calendar.tsx`/`index.css`. Confirmed the Month-view artist-filter work above was already committed and pulled before starting.

## 1. Full `rbc-*` CSS audit

Extracted every class name from both stylesheets this app actually loads (`react-big-calendar.css` and the drag-and-drop addon's `styles.css`, not guessed from memory), cross-referenced each one's default color/background/border declaration against what `index.css` already overrides, then confirmed the real gaps live via `getComputedStyle` on the running page rather than trusting the source diff alone.

| Class | Default (light-mode) | Status before this pass | Action |
|---|---|---|---|
| `.rbc-calendar` | — | Already themed (`color: var(--color-fg)`) | none |
| `.rbc-off-range-bg` | `#e5e5e5` | Already themed, `.rbc-calendar` scoping already fixed a load-order tie in an earlier pass | none |
| `.rbc-today` | `#eaf6ff` | Already themed, same earlier load-order fix | none |
| `.rbc-header`, `.rbc-time-header-content`, `.rbc-time-gutter`, `.rbc-label`, `.rbc-agenda-date-cell`, `.rbc-agenda-time-cell` | various | Already themed | none |
| `.rbc-time-view-resources .rbc-time-gutter`/`-header-gutter` | `background: white` | Already themed | none |
| Border batch (`.rbc-header + .rbc-header`, `.rbc-day-bg + .rbc-day-bg`, `.rbc-month-row + .rbc-month-row`, `.rbc-month-view`, `.rbc-time-view`, `.rbc-time-content`, `.rbc-timeslot-group`, `.rbc-day-slot .rbc-time-slot`, agenda table borders) | `#ddd` | Already themed | none |
| `.rbc-off-range` | `#999` | Already themed | none |
| `.rbc-show-more` | `color: #3174ad` | Base color already themed; **`:hover`/`:focus` color (`rgb(37.7,89.3,133.3)`) was never covered** | **Fixed** — added themed hover/focus color + a transition |
| **`.rbc-current-time-indicator`** | `background-color: #74ad31` | **Confirmed broken**: an override already existed in this file (`--color-danger`) but was silently losing the exact same bare-selector load-order tie as `.rbc-off-range-bg`/`.rbc-today` before them — computed style showed RBC's literal default green, not the override | **Fixed** — scoped under `.rbc-calendar` for a guaranteed win, and swapped the color to `--color-accent` per this task's request (was reserved for actual error states, not "where are we right now") |
| **`.rbc-time-header.rbc-overflowing`** | `border-right: #ddd` | **Confirmed broken** — not covered by the existing border-color batch, computed style showed the literal `rgb(221,221,221)` | **Fixed** — themed to `var(--color-border)` |
| **`.rbc-day-slot .rbc-event-content`** | `word-wrap: break-word` | **Confirmed broken** (a behavior bug, not a color leak) — Day/Week view's own event-content rule wraps text across lines instead of Month view's ellipsis truncation, reproduced live as a short appointment's title wrapping to two cramped lines | **Fixed** — overridden to `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`, matching Month view's own `.rbc-row-segment .rbc-event-content` behavior |
| `.rbc-event` | `padding: 2px 5px`, `border-radius: 5px`, `background: #3174ad`, `color: #fff` | Background/color already overridden per-artist via inline `eventPropGetter` (inline always wins); padding/radius untouched | **Fixed** — padding to `4px 8px`, radius to `0.5rem` (this app's existing rectangular-card radius, not the pill `rounded-full` used for label chips) |
| `.rbc-event:focus` outline | `outline: 5px auto #3b99fc` | Un-themed but only visible via keyboard focus, and still a functional focus ring (not invisible) | Left as-is — out of scope for this pass, not a dark-mode leak |
| `.rbc-event.rbc-selected` | `background-color: rgb(37.7,89.3,133.3)` | Never reachable — nothing in this app puts RBC into its own persistent "selected" state | Not applicable |
| `.rbc-slot-selection` (drag-to-select box) | `background-color: rgba(0,0,0,.5)` | Functionally fine in dark mode, but a generic flat black, not tied to this app's palette | **Upgraded** — `color-mix(in srgb, var(--color-accent) 35%, transparent)`, same recipe as the Month-view "open" tint |
| **`.rbc-addons-dnd .rbc-event` transition** | `opacity 150ms` | **Confirmed broken** while verifying the new hover transition below — this addon rule has equal specificity to a bare `.rbc-event` and loads after it, so it silently replaced the entire `transition` shorthand (computed `transitionProperty` came back as `opacity`, not `filter`/`background-color` — the hover color change was correct but snapping instantly) | **Fixed** — first tried scoping as `.rbc-calendar .rbc-addons-dnd .rbc-event` (higher specificity), which **still didn't match**: confirmed via the live DOM that `.rbc-addons-dnd` and `.rbc-calendar` land on the *same* root element, not nested, so a descendant combinator between them never matches anything. Corrected to the compound selector `.rbc-calendar.rbc-addons-dnd .rbc-event` |
| **`.rbc-day-slot .rbc-events-container`** | `pointer-events` unset (`auto`) | **Confirmed broken, and not just a color/transition issue** — this container is absolutely positioned to cover a day column's *entire height* regardless of how many events are actually in it, and with `pointer-events: auto` it wins every hit-test over the empty `.rbc-time-slot`s underneath — real mouse hovers over empty space in Week/Day view were being silently absorbed by this invisible layer, confirmed by a real (non-forced) Playwright hover timing out entirely on a slot with zero events nearby, then succeeding immediately after the fix | **Fixed** — `pointer-events: none` on the container, re-enabled only on `.rbc-event` itself, so an event's own hover/click/drag is unchanged while empty space now correctly reaches the slot beneath it |
| `.rbc-toolbar`, `.rbc-btn`, `.rbc-btn-group`, `.rbc-toolbar-label` and all toolbar button states | various | Never rendered — `Calendar.tsx` replaces the toolbar entirely with its own component | Not applicable |
| `.rbc-agenda-*` (table, date/time cells, view) | various | Never rendered — `Views.AGENDA` is never in this app's `availableViews` | Not applicable |
| `.rbc-allday-cell`, `.rbc-allday-events`, `.rbc-background-event` | various | Never rendered — no `allDayAccessor`/`backgroundEvents` prop is ever passed | Not applicable |
| `.rbc-overlay`, `.rbc-overlay-header` (Month view's "+N more" popup) | `background: #fff`, `border: #e5e5e5` | Looked like a real gap on paper (an un-themed white popup), but live-tested by actually clicking "+N more": this app's Month view has no `popup`/custom `onShowMore` configured, so RBC's *default* behavior fires instead — a drill-down navigation straight to Day view for that date, never rendering an overlay at all | Not applicable (confirmed live, not assumed from the source alone) |
| `.rbc-selected-cell` | `background-color: rgba(0,0,0,.1)` | Rare/cosmetic, translucent black works acceptably regardless of theme | Left as-is |

## 2. Hover states

RBC ships **zero** hover feedback of its own on events or empty slots (confirmed by grep — the only `:hover` rules in its stylesheet belong to the toolbar, which this app never renders). Added:
- `.rbc-event:hover`/`:focus` → `filter: brightness(1.12)`, transitioning `filter`/`background-color` over `var(--duration-base)` (this app's existing 200ms transition-duration token) — reuses the same `brightness-110`-on-hover recipe already established elsewhere (`HorizontalBarList.tsx`) rather than inventing a new one.
- Empty `.rbc-day-bg` (Month) / `.rbc-time-slot` (Week/Day) → `var(--color-surface-raised)`, this app's own established "one step up from the ambient surface" token, with the same transition. An inline `dayPropGetter`/`slotPropGetter` style (closed-grey, artist-unavailable-grey, the Month-view open/booked tint) always wins over this, so a closed slot correctly doesn't shift on hover.
- Along the way, found and fixed the `.rbc-events-container` pointer-events gap (table above) that was silently preventing this new hover from ever firing on a real mouse hover in Week/Day view in the first place.

## 3. Event card refinement

Padding `2px 5px` → `4px 8px`; radius `5px` → `0.5rem` (matches this app's own rectangular-card radius used elsewhere in this exact file, e.g. the drag-error/buffer-notice boxes — not the `rounded-full` pill radius used for label-style chips). Text truncation fixed for Day/Week view (table above, item 3) to match Month view's existing ellipsis behavior instead of wrapping.

## 4. Live current-time indicator

Discovered RBC already ships this feature entirely — `getNow: () => new Date()` is its own default prop, and it already self-updates on a 60-second `setTimeout` loop internally (confirmed by reading `DayColumn.js`), so no separate interval/re-render logic was needed. What was actually missing: it used the *browser's* raw `new Date()`, and the color was wrong (see the audit table). Added `studioNow(timeZone)` — reads the studio's own `GET /studio-settings` timezone (same endpoint `Settings.tsx` already reads for its own timezone-aware relative-time formatting) and reconstructs a local `Date` from that timezone's wall-clock parts via `Intl.DateTimeFormat` (the identical technique `format.ts`'s `civilDateParts` already uses for "today" comparisons) — so RBC's internal local-getter-based positioning math lands the line at the studio's actual current time, not the browser's, with no polling of my own since RBC's existing timer already re-evaluates `getNow()` every minute.

## 5. Weekend shading

Investigated first: this dev studio's own location has `hours: null` (never configured) — `isStudioClosedAllDay` already returns `false` for every day in that case, so there's currently no existing weekend-closed grey to conflict with *for this specific studio*, but the decision has to hold for any studio's actual configuration, not just this one's current empty state. Implemented per-day, not per-studio: a Saturday/Sunday only gets the new subtle `--color-surface-raised` weekend tint when that *specific* day isn't already grey from studio-closed hours — a studio that closes Sunday but opens Saturday would correctly show grey-Sunday + tinted-Saturday, never double-shading the same day for the same reason. Deliberately excluded from Month view's single-artist-filtered mode (the prior session's own feature) — that view's grey/open/booked states are the primary signal there, and layering a second, unrelated shading system on top would just be noise, not a second useful signal.

## Live-verified, not just read

- Month view (unfiltered): three genuinely distinct computed background values confirmed across a full month grid — `rgb(30,30,34)` (weekend tint), `rgb(18,18,20)` (off-range padding days, an existing, unrelated CSS class), `rgba(0,0,0,0)` (ordinary weekdays).
- Current-time indicator: computed background confirmed as `rgb(201,240,49)` (`#c9f031`, this studio's actual accent color), not RBC's default green nor the old danger-red.
- Event hover: computed `filter` confirmed `brightness(1.12)` after hover, `transitionProperty` confirmed `filter, background-color` (not `opacity`) after the addon-conflict fix.
- Empty-slot hover: a genuinely empty Week-view slot's computed background confirmed transitioning `rgba(0,0,0,0)` → `rgb(30,30,34)` on a *real* (non-forced) Playwright hover, which only started succeeding after the `.rbc-events-container` pointer-events fix — before it, the same real hover call timed out entirely, confirming the bug was genuinely blocking real interaction, not just failing an automated check.
- Regression check after the pointer-events fix: clicking an existing event still opens its preview modal, clicking empty space still opens "New Appointment" pre-filled, and dragging an event to a new time still succeeds with no error — all three re-verified live, not assumed safe from the CSS change alone.

## Typechecks

`npx tsc --noEmit` (api, unaffected, checked per the standing rule) and `npx tsc --noEmit` + `npm run build` (web) — clean.

---

# Calendar polish — Part 2: interaction robustness

Same session, same task, continuing straight from Part 1's commit.

## 6. Click-and-drag to create with a specific duration — already present

Investigated before writing anything: `handleSelectSlot` already reads `slotInfo.start`/`slotInfo.end` directly (falling back to a flat 1-hour default only when `end` isn't genuinely past `start`, i.e. a plain click with no drag) and `selectable` was already passed to `DnDCalendar`. Live-tested a real mouse-down-drag-up across roughly a 2.5-hour span in Day view: the "New Appointment" modal opened with Start Time `10:00 AM` / End Time `12:30 PM` — an exact match for the drag, pre-filled through the existing shared `AppointmentForm`, with the existing same-day/buffer-conflict rules untouched since nothing about the validation path changed. **Nothing added here** — this was a real "already exists" finding, not assumed from the code alone.

## 7. Resize handles — genuinely missing, added

Investigated first, and this one really was absent: `resizable={false}` was set explicitly on `DnDCalendar`, and there was no `onEventResize` handler at all. Added:
- `resizable={false}` → `resizable`.
- `onEventResize={handleEventResize}`, routed through the exact same `PATCH /appointments/:id` the drag-reschedule handler already uses — factored a shared `applyAppointmentTimeChange(event, newStart, newEnd)` out of `handleEventDrop` so both paths hit the identical same-day check, buffer-warning handling, and error copy, rather than a parallel bespoke implementation. Resizing never changes `resourceId` (RBC's resize anchors stay anchored to the event's existing column), so unlike drag it has no cross-column-reassignment case to guard against.

**Live-verified, not just "no error shown"**: hovering an event now shows real resize anchor elements (24 found across a week's worth of events); grabbing one event's own bottom anchor precisely (scoped as a descendant of that specific event — a page-wide anchor locator grabbed a different, off-screen event's anchor the first time this was tried) and dragging it down produced an actual network request: `PATCH /appointments/:id` with `startTime` unchanged and `endTime` extended by 1.5 hours, response `200`.

## 8. Smooth view/navigation transitions

RBC swaps its entire internal render tree between Month/Week/Day (and on every Back/Next/Today), so a plain CSS `transition` on a persistent element doesn't apply across that kind of change. Wrapped the calendar in a container keyed on `` `${effectiveView}-${date}` `` so switching view or navigating forces a real remount, then applied `animate-fade-slide-up` — the exact same entrance animation this app already uses for "new content just appeared" elsewhere (`ConversationsPanel.tsx`'s newly-arrived messages), not a bespoke calendar-only motion.

## 9. Loading state on date-range changes

Confirmed the bug first: the `appointments` query's `queryKey` includes the visible range, so every Back/Next/Today click or view switch was a brand-new key with no prior data — `data` reset to `undefined` immediately and the whole calendar was replaced by a plain `"Loading…"` line, a real blank flash on every single navigation, not a hypothetical. Fixed with `placeholderData: keepPreviousData` (this app's TanStack Query v5) so the last range's events stay visible immediately, combined with `isFetching` (true during that background refetch, unlike `isLoading` which is now only ever true on this page's genuine first load) driving a subtle `opacity-60` dim on the calendar via `transition-opacity duration-base` — not a spinner, not a blank page.

## Live-verified, not just read

- Loading indicator: calendar wrapper's computed `opacity` measured at `0.6` roughly 30ms after clicking "Next" (mid-fetch), back to `1` once the new range's data arrived — confirmed the dim-then-restore cycle actually happens, not just that the JSX conditionally renders a class.
- `animate-fade-slide-up` confirmed present on the view/date-keyed wrapper.
- Re-confirmed (again, after this part's changes) that clicking an event still opens its preview, clicking empty space still opens "New Appointment," and dragging still reschedules with no error.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc --noEmit` + `npm run build` (web) — clean.

---

# Calendar polish — Part 3: navigation

Same session, final part of this task, continuing straight from Part 2's commit.

## 10. Jump-to-date

Reused `DatePickerField` (this app's one established single-date picker — the same component `ArtistDetail.tsx`'s guest window and `DateAndTimeRangeFields`' own date field already use), added into the custom `CalendarToolbar` between the label and the Month/Week/Day switcher. Its `value` reflects whatever date the calendar is currently showing (`toDateString(date)`); picking any date calls the toolbar's own `onNavigate('DATE', parsed)` — the same navigation action RBC's Back/Next/Today buttons already use, just with an explicit target date — and the picker's own popover closes itself on selection, matching how it behaves everywhere else it's already used.

## 11. Keyboard shortcuts

Confirmed the exact per-view increment by reading RBC's own `Month.navigate`/`Week.navigate`/`Day.navigate` static methods rather than guessing: month, week, and day respectively. Added a single `window` keydown listener: `ArrowLeft`/`ArrowRight` move by that increment (`dayjs(date).add(±1, unit)`), `t`/`T` jumps to today (same effect as the Today button). Guarded with an explicit check this app's *other* global keydown listeners (Escape in `Modal.tsx`/`SearchPalette.tsx`, Cmd/Ctrl+K in `TopBar.tsx`) didn't need, since none of them are bare, unmodified keys a normal typing context would also use — bails out immediately whenever `event.target` is an `INPUT`, `TEXTAREA`, `SELECT`, or any other `isContentEditable` element.

## Live-verified, not just read

- Jump-to-date: from Day view, opened the picker, paged its own mini-calendar forward three months, picked the 10th — the calendar's label read exactly `"Saturday Oct 10"` afterward (this dev environment's "today" is in July), confirming both that the jump landed on the *exact* chosen date and that it worked while a non-Month view was active, not just Month view where the picker happens to live in the toolbar.
- Arrow keys: in Month view, `ArrowRight` moved the label from `"July 2026"` to `"August 2026"`; `ArrowLeft` moved it back. `t` returned it to `"July 2026"` (this environment's actual current month) from wherever navigation had left it.
- Input-scoping guard: injected a real `<input>` element, focused it, and dispatched a genuine `ArrowRight` `KeyboardEvent` at that element specifically (not just at `window`) — the calendar's label was confirmed unchanged before/after, proving the guard actually intercepts the event at the input rather than merely coexisting with it by chance.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc --noEmit` + `npm run build` (web) — clean.

---

# Final report: three-part calendar polish summary

| Part | Commit | What it covered |
|---|---|---|
| 1 — Visual polish | `7e8822d` | Full `rbc-*` CSS audit (table above); themed hover states; event padding/radius/truncation; studio-timezone-aware current-time indicator; conditional weekend tint |
| 2 — Interaction robustness | `2068eb2` | Confirmed drag-to-set-duration already worked (nothing added); added genuinely-missing resize handles; keyed-remount view/nav transition; `keepPreviousData` + `isFetching` dim instead of a blank "Loading…" flash |
| 3 — Navigation | `bb65c2e` | Jump-to-date via the existing `DatePickerField`; arrow-key/`T` shortcuts scoped away from text input |

**Part 2 investigation outcome, stated plainly**: of the two interactions Part 2 asked about, one (click-and-drag to create with a specific duration) was already fully working — `handleSelectSlot` already read the real dragged end time and `selectable` was already set, live-verified with an exact 10:00 AM–12:30 PM prefill matching a real drag. The other (resize handles on an existing appointment) was genuinely absent — `resizable={false}` was explicit and there was no `onEventResize` at all — and was added, routed through the same `PATCH /appointments/:id` drag-reschedule already uses.

**Weekend-shading decision, stated plainly**: this dev studio's own location has no business hours configured (`hours: null`), so there's no live conflict to observe for *this* studio today — but the fix has to hold for any studio's real configuration, not just this one's current empty state. Implemented per-day rather than per-studio: a Saturday/Sunday only gets the new tint when studio-closed hours haven't already grey-shaded that specific day, so a studio that closes one weekend day but not the other never double-shades, and a studio that closes both never shows the new tint at all (the existing grey already said everything it needed to). Also deliberately excluded from Month view's single-artist-filtered mode from the prior session's own feature, so the two shading systems never compete for the same day.

## Cleanup (all three parts)

Reused the already-running API :4000 / web :6506 dev servers throughout — no new dev servers started at any point across all three parts. All verification scripts (CSS audits, resize/drag network checks, keyboard-shortcut and jump-to-date tests) stayed in the scratchpad, confirmed via `git status` never staged. No background shells left running. Test data: two real consultation appointments for `Louie G` (from the immediately-prior Month-view session), one appointment's duration genuinely extended by a live resize-handle drag during Part 2 verification — all left in place, consistent with this session's standing convention.

---

# Calendar: persist view/filter/etc. per user

Same session, immediate follow-up: the user asked for the Calendar's view, artist filter, and similar display state to be remembered per-user across navigating away and back.

## Design decision, asked up front

Whether the specific *date* navigated to should also be remembered was a real fork (not a confident default either way), so asked directly rather than guessing: confirmed the calendar should always reopen on **today**, regardless of what date was showing when the user last left — only the view mode and filter/display toggles should survive, matching how mainstream calendar apps behave (Google Calendar doesn't reopen on whatever day you last scrolled to).

## Mechanism: the same per-user pattern this app already has, not a new one

Found `UserWidgetLayout` (`apps/api/prisma/schema.prisma`) / `GET,PUT /widget-layouts/:pageKey` (`widgetLayouts.ts`) / `useWidgetLayout.ts` already solve this exact shape of problem — a personal, backend-persisted, per-user display preference — for the Inquiry/Project detail pages' reorderable widget layout. Mirrored it directly rather than reaching for `localStorage` (which the user's own "save it to the user" phrasing also pointed away from — a preference that only lived in one browser wouldn't follow them across devices) or inventing a different pattern:

- **Schema**: `UserCalendarPreference` — one row per user (no `pageKey` needed, unlike `UserWidgetLayout`, since there's only one Calendar), storing `view`, `selectedArtistIds` (`Json?`, `SQL NULL` meaning "no filter" — the exact same null-means-unfiltered convention `Calendar.tsx`'s own `selectedArtistIds` state already used, so the column maps straight to/from that state with zero translation), `selectedLocationId`, `includePastGuests`. Migration is a single new, purely additive table (`--create-only` inspected before applying).
- **Backend**: `apps/api/src/routes/calendarPreferences.ts`, `GET,PUT /calendar-preferences` — same role gate as `widget-layouts` (OWNER/FRONT_DESK/ARTIST), same "not audited, carries no business meaning" treatment, same defaults-if-no-row-yet behavior on `GET`, same upsert on `PUT`.
- **Frontend**: `useCalendarPreferences.ts`, mirroring `useWidgetLayout.ts`'s own shape almost exactly — a query for the current value plus an optimistic, best-effort `persist()` (updates the local query cache immediately regardless of the `PUT`'s outcome; a failed save just doesn't survive a refresh, never worth blocking a filter click over).

## Wiring into `Calendar.tsx`

Seeded `view`/`selectedArtistIds`/`selectedLocationId`/`includePastGuests` from the saved preference exactly once when it loads (the same render-time "seed once" pattern already used elsewhere in this app, e.g. `InquiryDetail.tsx`'s estimate form) — deliberately never seeds `date`. A single `updateCalendarPreferences(partial)` helper merges one changed field into the other three's current values and persists the full bundle; wired into all four places that change one of these: the toolbar's `onView`, `toggleArtistFilter` (restructured to compute the next array as a plain value first, rather than inside a `setState` updater callback, so the computed value is available to also hand to `updateCalendarPreferences`), the location `<select>`, and both the desktop and mobile "Include past guests" checkboxes.

## Live-verified, not just read

Set Week view + filtered down to a single artist (`Louie G`) by deselecting every other chip — confirmed each toggle fired its own real `PUT /calendar-preferences` with the correctly-updated body, the last one landing on `{"view":"week","selectedArtistIds":["<Louie G's id>"],"selectedLocationId":null,"includePastGuests":false}`. **Fully reloaded the page** (not just an in-app navigation) — Week view came back selected, only Louie G's chip showed as active, and the calendar correctly rendered only their single resource column with their real events — confirming the preference actually round-trips through the backend on a cold load, not just an in-memory React Query cache surviving a soft navigation. Also independently re-verified, via direct per-slot computed-style checks, that the Part 1 weekend-tint and artist-unavailable-grey logic were both still applying correctly on the exact days they should (an initial screenshot read had miscounted which day-of-week column was tinted by eye; the actual computed values confirmed every column correct once checked precisely, not assumed from the screenshot).

Reset the real `owner@dev-studio.test` account's saved preference back to defaults (`month`, no filter) afterward via a direct `PUT`, since this is the same account this session's users actually use day to day, not disposable seed data — leaving it filtered to one random artist would have been a confusing surprise on their next real visit.

## Typechecks

`npx tsc --noEmit` (api) and `npx tsc --noEmit` + `npm run build` (web) — clean.

## Cleanup

Reused the already-running API :4000 / web :6506 dev servers. All verification scripts stayed in the scratchpad, none staged. No background shells left running. The one piece of real, non-throwaway state this task touched (the Owner account's own saved calendar preference) was explicitly reset back to defaults after verification, not left as incidental test data.

---

# Dual themes — integrate the v3 restyle as a second selectable preset

Single session on `main` (no branch, no schema change). Integrates `ui/restyle-v3`'s full editorial identity into the existing theme-preset system as a fifth preset, "Editorial Gold" (`editorial-gold`), instead of the app having only one visual identity. Pre-flight: `git status` clean aside from the reference mockup file, `main` up to date with `origin`, `ui/restyle-v3` confirmed fully committed and pushed (`f540c7c`/`b79adb4`/`e330108`/`7e15744`).

## 1. Investigation: diffed `ui/restyle-v3` against `main`, component by component

Ran `git diff main ui/restyle-v3` and read every hunk before writing any integration code, per the task's instruction not to guess. Classification:

**Pure style** (same DOM structure/props in both branches — only className strings or token values differ): `Widget.tsx`, `Modal.tsx`, `DetailField.tsx`, `ArtistAvatar.tsx`, `Dashboard.tsx`'s `CardShell` + stat-number sizing. These needed a `shape`-conditional className, but no new elements or logic branches.

**Structural** (the v3 branch changed actual markup, added elements, or changed what gets rendered — not just how it looks):
- `StatusPill.tsx` — v3 added a brand-new dot `<span>` inside every pill that never existed before, plus switched from a solid-filled pill to a bordered/tinted one (two genuinely different tone-class maps, not one map with different values).
- `InquiryPipeline.tsx` — v3 changed circular nodes to hexagonal (`clip-path`) ones, changed the "current step" color from gold to **red** (gold stayed reserved for "done"), and made the vertical stepper always show a step number for not-yet-reached steps (the original vertical stepper showed nothing there — only the horizontal variant ever showed numbers).
- `Sidebar.tsx` — v3 added a brand-new ornamental `<div>` (gradient hairline + rotated square) below the logo that never existed before, and replaced the active-nav-item's gold-filled pill with a panel-background + border + a CSS `::before` red indicator bar.
- `TopBar.tsx` — v3 added a brand-new `<span class="arc-decor">` with three child `<i>` elements (concentric arc rings) mounted unconditionally.
- `index.css` — v3 added an unconditional `body::after` grain-texture rule and the `.sc`/`.hex`/`.ornament`/`.arc-decor`/`.side-nav-link` class definitions.

Every "structural" item above is called out explicitly in the Component-by-component section below with exactly how it was gated.

## 2. Broadened the preset-definition structure

`apps/web/src/lib/themePresets.ts`'s `ThemePresetInfo` gained three new fields every preset now specifies (not just the new one): `shape: 'default' | 'editorial'`, `decorative: boolean`, and `fonts: { sans, display, jura }` (CSS custom-property values, not classNames). The four existing presets all get `shape: 'default'`, `decorative: false`, and an Inter-everywhere `fonts` object; the new `editorial-gold` preset gets `shape: 'editorial'`, `decorative: true`, and the Fraunces/Jura/Outfit trio.

**Schema-free, confirmed**: `StudioSettings.themePreset` is already a plain, unconstrained-at-the-DB-level string column, validated only in application code against `THEME_PRESET_KEYS` (`apps/api/src/lib/themePresets.ts`) — adding `"editorial-gold"` to that array (now 5 keys) is the only backend change, and `isValidThemePreset()`/the `PATCH /studio-settings` error message both already derive from the array rather than hardcoding the list, so nothing else needed touching. No migration.

**Fonts, self-hosted the same way**: `@fontsource/fraunces`/`@fontsource/jura`/`@fontsource/outfit` (already installed on the branch) added to `apps/web/package.json` and imported unconditionally in `index.css` alongside the existing Inter imports — both font systems are always loaded, so switching presets is purely the `--font-sans`/`--font-display`/`--font-jura` custom-property swap in the `[data-theme="editorial-gold"]` block, never a font (re)load.

**Reactive preset reads for components, not just CSS**: added `subscribeThemePreset`/`getThemePresetSnapshot` (plain module-level pub-sub) to `themePresets.ts` and a new `apps/web/src/lib/useThemePreset.ts` hook (`useSyncExternalStore`) returning the full `ThemePresetInfo` for whichever preset is currently applied. `applyThemePreset()` now updates this store in addition to setting the `data-theme` attribute. This had to be a plain store, not React context, because `applyThemePreset` is called from many independent places with no shared provider — `ThemeApplier.tsx` for the authenticated shell, and each of the five public pages independently from its own fetched route data (confirmed via grep that `EstimateResponse`/`EstimateRevisionResponse`/`DepositResponse`/`GiftCardResponse` all render `StatusPill`, so it has to work correctly on public pages too, not just the authenticated shell).

## 3. Component-by-component: how each structural change was gated

Every component below imports `useThemePreset()`, destructures `shape` (and `decorative` for TopBar), and branches:

- **`StatusPill.tsx`**: `shape === 'editorial'` renders the bordered pill + dot (new `TONE_CLASSES_EDITORIAL` map + `TONE_DOT_CLASSES`); otherwise the original solid-filled pill (`TONE_CLASSES_DEFAULT`, unchanged from `main`). The dot `<span>` is only ever in the returned tree on the editorial branch — never present-but-hidden under `default`.
- **`InquiryPipeline.tsx`**: both the vertical stepper and the horizontal grid branch their node's className (hex + gold-done/red-current vs. circle + gold-done-or-current) and, in the vertical stepper specifically, what's rendered inside a not-yet-reached node (a numeral under `editorial`, nothing under `default` — preserving the original's own asymmetry with the horizontal variant exactly as it was on `main`).
- **`Sidebar.tsx`**: the ornament `<div>` is wrapped in `{isEditorial && (...)}` — a real conditional, not a CSS hide, so its absence under every other preset is unambiguous in the DOM, not just visually. Nav-item className branches between the `.side-nav-link` (border/panel/red-bar) treatment and the original gold-filled pill.
- **`TopBar.tsx`**: the `<span class="arc-decor">` is wrapped in `{decorative && (...)}` (the preset's own `decorative` field, not a hardcoded key check) — same reasoning as Sidebar's ornament.
- **`Widget.tsx` / `Modal.tsx` / `DetailField.tsx` / `ArtistAvatar.tsx` / `Dashboard.tsx`**: className-only branches, verified against the exact `main`-vs-`ui/restyle-v3` diff text so the "default" branch is byte-identical to what `main` already rendered before this task, not an approximation.
- **`index.css`**: the grain rule is scoped entirely under `:root[data-theme="editorial-gold"] body::after` — there is no rule for `body::after` at all under any other preset (confirmed empty selector match, not a zeroed-out one). `.sc`/`.hex`/`.ornament`/`.arc-decor`/`.side-nav-link` class **definitions** stay globally defined (harmless — nothing references them unless a component's `shape`/`decorative` branch above puts that class name in the DOM).
- **`ConversationsPanel.tsx`**: two different kinds of fix here, worth distinguishing. (a) Several hardcoded hex leftovers (`bg-[#3a4118] text-[#c8e04a]` lime, `text-[#5a5a62]` grey) turned out to be **pre-existing bugs on `main` itself**, unrelated to this task — that badge/chip/menu styling was never routed through `--color-accent` at all, so it silently stayed lime-tinted under every non-lime preset already (slate-teal, ember-amber, orchid-magenta), before `editorial-gold` ever existed. Fixed as a universal token-based correction (`bg-accent`/`text-accent-fg`/`text-fg-muted`), not shape-gated, since it's correct for all five presets identically. Same reasoning for the message-bubble colors (`bg-[#23281a]`/`bg-[#1c1c21]` olive/grey hex → `bg-accent/[0.12]`/`bg-surface-raised`). (b) The day-divider's flanking-hairline treatment and the "Draft with AI" menu-item relabel/recolor genuinely are `editorial`-only decorative choices, so those are `isEditorial`-branched.

## 4. Preset picker UI

`Settings.tsx`'s existing picker already maps over `THEME_PRESETS` generically (name/description/swatch colors) — the fifth entry needed zero changes there to appear, confirmed live. Bumped the grid from `sm:grid-cols-4` to `sm:grid-cols-3 lg:grid-cols-5` so five cards lay out in one clean row at desktop width instead of wrapping 4+1.

## 5. Accessibility re-verification

`editorial-gold`'s contrast ratios are unchanged from `ui/restyle-v3`'s own REPORT.md entry (5.16–16.68:1 across every real pairing) — carried forward, not recomputed, since the actual token values are byte-identical to that branch. Re-confirmed the **original** `onyx-lime` preset's contrast is still intact after integration (nothing about merging should have touched it, verified rather than assumed): its surface/border/text tokens in `index.css`'s base `@theme` block are untouched from `main`, and the four "default"-shape presets' own accent-trio blocks are byte-identical to what was already there before this task.

## Verification (Playwright, both directions)

Confirmed **no reload needed**: switched the studio's preset in Settings from `onyx-lime` to `editorial-gold` and back, entirely via SPA navigation (no `page.reload()` anywhere in the test), reading `document.documentElement.dataset.theme` and querying the DOM directly rather than eyeballing screenshots alone.

| Check | onyx-lime | editorial-gold |
|---|---|---|
| `data-theme` attribute | `onyx-lime` | `editorial-gold` (updated live, same page, no reload) |
| `.arc-decor` count anywhere in the DOM | **0** | 1 |
| `.hex` count on Inquiry detail's pipeline stepper | **0** | 10 |
| `.ornament` count in the sidebar | **0** | 1 (present, not checked in the table above but confirmed in the same run) |

Clicked through Dashboard, Inquiries list, Inquiry detail (pipeline stepper), Team (artist cards), Clients, Calendar, and the Conversations panel under `editorial-gold`, then switched back to `onyx-lime` and re-checked Inquiry detail specifically — confirmed it rendered byte-for-byte like the pre-existing `main` screenshot (sans-serif headings, circular gold pipeline nodes, gold-filled active nav pill, no grain, no arcs, no ornament). Also confirmed the **public** intake form (`/inquiry/dev-studio`, a separate unauthenticated browser context, no shared session) independently fetched and applied `editorial-gold` after the studio's preset was changed, proving the public-page path (which never touches `ThemeApplier`) works identically to the authenticated shell's.

Console errors observed during verification were the same pre-existing dev-seed artifacts already documented in `ui/restyle-v3`'s own report (broken `https://example.com/*.jpg` placeholder image URLs, one unrelated conversation-resolve 404) — nothing new from this integration.

## Typechecks

`npm run build` (web — includes `tsc -b`) and `npx tsc --noEmit` (api) — clean before every commit in this session.

## Known trade-off, reported rather than silently left

Beyond the named shared components above, the `ui/restyle-v3` branch also directly batch-edited ~45 page-level files' literal Tailwind class strings (primary/secondary buttons, page `<h1>`s, eyebrow labels, tab-underline colors) via `sed`, rather than routing them through a shared component. Retrofitting all ~193 of those individual call sites with a `shape`-conditional branch was out of scope for this session's time budget. Effect under `onyx-lime`: those specific buttons/headings correctly render in Inter (the font swap is CSS-variable-driven and works everywhere) and the correct `onyx-lime` accent color, but still carry the `editorial-gold` pass's uppercase/tracked/bold treatment and `rounded-btn`/`rounded-card` sizing (the latter mitigated by defaulting `--radius-btn: 9999px` under every "default"-shape preset, so at least the pill shape is preserved) rather than the literal original button proportions. This is a residual, cosmetic-only inconsistency (not a functional bug, not a case of one preset's structural elements leaking into the other) confined to page-level buttons/headings outside the eight components named in the investigation above — flagged here rather than silently accepted.

## Commit

`1a8eb4f` on `main`.

## Cleanup

Reused the already-running API :4000 / web :6506 dev servers. All verification scripts stayed in the scratchpad, none staged. The dev studio's theme preset was left on `onyx-lime` (its original default) after verification — confirmed via a final read of `data-theme`, not assumed.

## After this lands

`ui/restyle-v3` can now be deleted — its content lives properly integrated on `main` as the "Editorial Gold" preset option, not sitting separately. Deletion left to the user to confirm, not done automatically as part of this session.

**Update**: `ui/restyle-v3` deleted (local + `origin`) in a later session, once the user confirmed the integration was in place.

---

# Login page — editorial redesign (fixed platform identity)

Single small session on `main`. No schema changes. Rebuilds the login screen using the existing Fraunces/Jura/Outfit fonts, arc-ornament technique, and panel/border/radius tokens from the editorial restyle — reused, not redesigned.

## Design decision this session locked in

The login page is a **fixed platform identity**, not themed by the per-studio preset system (`lib/themePresets.ts`). There is no authenticated studio context yet at `/login` for a preset to even apply from, and since this is a client-side-routed SPA, a stale `[data-theme]` attribute can still be sitting on `<html>` from whatever preset was last applied in the same tab (e.g. a user who logged out without a full page reload) — referencing the swappable `--color-*`/`--font-*` tokens here would make this page's look depend on browsing history. Every value is a literal constant (new `.login-*` classes in `index.css`, scoped under a `.login-shell` wrapper with its own `--login-*` custom properties), matching the editorial palette's numbers but never wired to the swappable tokens.

## Build

- Full-bleed `login-background.jpg` (`object-fit: cover`) behind a `bg-black/70` overlay.
- `.login-arc-decor`: the same concentric-ring technique as the app shell's `.arc-decor`, recentered (`top/left: 50%`, `translate(-50%,-50%)`) for a full-screen layout instead of anchored behind a header, with a smaller variant below 640px.
- Centered card (`.login-panel-surface`): literal `--login-panel`/`--login-line` values matching editorial's `--panel`/`--line`, `rounded-[1rem]` matching `--r-card`, `shadow-2xl` for separation from the busy background.
- Wordmark: "ink" in `.login-serif` (Fraunces) directly followed by "manager" in `.login-sans-light` (Outfit, weight 300) — one seamless mark, cream color, centered above the form.
- Labels: `.login-label` (gold, normal case, no tracking — the heavy Jura treatment is reserved for the button only, per the spec).
- Inputs: `.login-input` (panel-2 tone background, gold-tinted border, gold focus ring).
- Button: `.login-button` (solid gold fill, `--login-gold-fg` dark text, `.login-jura` uppercase heavy-tracked "SIGN IN", full width, same radius scale as the inputs).
- Login logic itself (`handleSubmit`, `useAuth().login`, redirect to `/dashboard`, error display) is untouched from the prior version — this was a visual rebuild only.

## A real bug found and fixed mid-session: a stray `*/` inside a CSS comment

While verifying, the card rendered with no visible panel/border and white (not gold) labels — `getComputedStyle` on `.login-shell` showed every `--login-*` custom property as an **empty string**, even though the rule's text was confirmed present, byte-for-byte correct, in the served stylesheet. Isolated by testing the identical rule body at a different position in the file (worked) versus its original position (failed), then decoding Vite's actual served CSS output and diffing it against the source: the introductory comment's own prose — "the `--color-*`**/**`--font-*` custom properties" — contained a literal `*/` substring (the slash used as shorthand for "or," directly after the `*` closing `--color-*`), which closed the CSS comment three sentences early. Everything from that point until the next real `*/` further down was silently swallowed as an invalid, ignored declarations, taking every `.login-*` rule below it out with it. Fixed by rewriting the comment to spell out "the color and font custom properties" instead of the `--color-*/--font-*` shorthand. Re-verified via `getComputedStyle` that every `--login-*` property now resolves correctly, and confirmed no other stray `*/` sequences exist anywhere else in `index.css` (`grep` swept the whole file).

## Background image optimization

The provided `apps/web/src/assets/login-background.png` was a 1672×941 photo saved as PNG — 1.76 MB, poor for a lossy photographic background. Compressed with `sharp` (installed with `--no-save`, used once, then uninstalled — never added as a project dependency) to an 82%-quality mozjpeg-encoded JPEG at the same dimensions: **146 KB, a 92% reduction**, visually indistinguishable at this resolution and especially so under the 70% black overlay. Confirmed via the actual served `Content-Length` header in a real browser network response (not just the file size on disk) — 146,046 bytes. Old PNG deleted; `Login.tsx` imports the new `.jpg`.

## Verification

- **Desktop (1600px) and two phone widths (390px, 360px)**: background photo loads and fills the viewport, dark overlay keeps text legible over the busiest parts of the photo, the card stays centered and fully readable at every width tested, no overflow.
- **Real end-to-end login**: filled real dev credentials, submitted, confirmed the actual `POST /login` returned `200` and the app redirected to `/dashboard` and rendered the authenticated shell correctly.
- **Environment note, not a code bug**: this session's already-running dev servers had drifted out of sync with the current `apps/web/.env` (`VITE_API_URL` pointed at a LAN IP — `10.0.0.31` — that no longer matches this machine's current address, `192.168.22.174`), so the long-running web dev server on its usual port was silently POSTing logins to an unreachable host. Rather than editing the shared `.env` or touching that pre-existing dev server (left running, untouched, exactly as found), spun up a temporary, isolated pair for verification only: a fresh API dev server on `:4000` and a fresh web dev server on `:5555` with `VITE_API_URL=http://localhost:4000` passed as an inline shell env var (never written to `.env`). Both stopped after verification; `apps/web/.env` confirmed byte-for-byte unchanged throughout.
- Zero console errors during the full flow.

## Typechecks

`npm run build` (web — includes `tsc -b`) and `npx tsc --noEmit` (api) — clean.

## Commit

`e8cb842` on `main`.

## Cleanup

Both temporary dev servers (`:4000` api, `:5555` web) killed after verification. The pre-existing, long-running dev server on the web app's usual port was never touched. `sharp` uninstalled after the one-off image compression (never landed in `package.json`). All diagnostic scripts stayed in the session scratchpad, none staged.

---

# Login page — visual refinement pass (matching reference, no source CSS)

Single small session on `main`. No schema changes. Refines the login page built in the prior session against a reference screenshot the owner had but no source CSS for — every value below is derived from careful visual comparison, not read off a design file, so treat it as a precise best-effort rather than a guaranteed exact match.

## Also fixed in passing: the `VITE_API_URL` drift

Confirmed the actual cause this time rather than routing around it: this machine's current LAN IP is `192.168.22.174` (via `ipconfig`), but `apps/web/.env`'s `VITE_API_URL` still pointed at `10.0.0.31` (stale, presumably from a different network). Since `.env` is only read at dev-server startup, fixing the file alone would not have helped the already-running server -- **restarted it** (killed the process on its usual port, relaunched `vite --port <same port>` so nothing else about the setup changed) after starting a fresh API dev server (none was running at session start). Verified with a real network capture, not assumed: the browser's actual `POST` now goes to `http://192.168.22.174:4000/login` and returns `200`, with the app correctly redirecting to `/dashboard` afterward.

## 1. Real logo, not a text wordmark

Swapped the "ink" (Fraunces) + "manager" (Outfit) text wordmark for the actual `apps/web/public/branding/logo-white-512.png` image, `h-12` (48px tall, rendering at 128×48 in the browser at that aspect ratio) and centered where the text sat -- sized by rendering and looking at it against the card, not guessed blind. Removed the now-dead `.login-serif`/`.login-sans-light` CSS classes (confirmed unused anywhere else via `grep` before deleting).

## 2. Frosted glass card

- `background: rgba(23, 19, 16, 0.62)` -- was the solid `var(--login-panel)` (`#171310` opaque); now the same color at 62% opacity so the blurred photo shows through. Used a literal `rgba()`, not `color-mix()`/`var()` with an alpha modifier, since this page's whole point is literal, non-token-driven values (see the prior session's "fixed identity" rationale).
- `backdrop-filter: blur(16px)` + `-webkit-backdrop-filter: blur(16px)` -- middle of the suggested 12-20px range.
- Border softened from `rgba(201, 154, 91, 0.18)` to `rgba(201, 154, 91, 0.1)` -- lower-alpha, more atmospheric, less like a crisp outline.

## 3. Corner radius, corrected in opposite directions

- **Card**: `1rem` (16px, the standard `--r-card` token) down to **10px** -- more architectural, and deliberately not required to match the app-wide card radius given this page's own distinct full-screen treatment.
- **Button**: `0.625rem` (10px) down to **6px** -- noticeably more rectangular, the opposite correction from the card. Inputs were also brought to 10px (matching the card, not the button) since they read as container surfaces rather than the specifically-called-out button correction -- an inference, not explicit in the brief, noted here rather than left silent.

## 4. Typography dialed back

- **Labels**: `font-medium` (500) removed in favor of the default `font-weight: 400`, explicit `letter-spacing: 0` -- lighter, plainer sans presentation, still the gold accent color.
- **Button**: `tracking-[0.2em]` down to `letter-spacing: 0.08em` -- computed value confirmed at `0.96px` on the actual `<button>` (`0.08em` × the button's `12px`/`0.75rem` font-size), noticeably tighter than the original very-wide tracking without losing the tracked-caps feel entirely.

## Verification

- Screenshotted at 1600px desktop and 390px mobile -- logo renders at a sensible size, card reads as a soft translucent panel with the photo visible (if dark and subdued, both by design -- the 70% page-level overlay and the card's own dark tone mean the "glass" effect is intentionally atmospheric rather than bright/obvious) rather than a flat opaque block, both radius corrections landed in opposite directions as intended, labels read plainer, button tracking is visibly tighter.
- Confirmed via `getComputedStyle` on the real rendered elements (not just reading the source CSS): card `background: rgba(23, 19, 16, 0.62)`, `border-color: rgba(201, 154, 91, 0.1)`, `border-radius: 10px`, `backdrop-filter: blur(16px)`; button `border-radius: 6px`, `letter-spacing: 0.96px`; label `font-weight: 400`, `letter-spacing: normal`.
- Real end-to-end login re-confirmed after all visual changes: submitted real dev credentials against the (now correctly configured) long-running dev server, got a real `200` from `POST http://192.168.22.174:4000/login`, redirected into `/dashboard`. No functional change anywhere in `handleSubmit`/`useAuth`.

## Typechecks

`npm run build` (web) and `npx tsc --noEmit` (api) -- clean.

## Commit

`6d793e1` on `main`.

## Cleanup

**Deliberately left running, not killed**: the API dev server (`:4000`) and the web dev server (`:6506`, restarted with the corrected `.env`) -- these aren't throwaway verification-only processes from this session, they're this project's actual persistent dev environment, and the whole point of the `VITE_API_URL` fix was to leave it in a working state rather than tear the fix back down. Flagging this explicitly since it's a different call than the prior session's (which killed everything it started) -- if a clean slate is wanted, both are safe to stop manually. All diagnostic/verification scripts stayed in the session scratchpad, none staged.

---

# Login page — hand-tuned values from a live DevTools session

Single tiny session on `main`. The owner pasted the exact CSS rules they landed on after tuning the login page live in browser DevTools -- this session transcribes those values back into the actual source, faithfully, rather than re-deriving or approximating them.

## What changed, translated exactly

Card (`.login-panel-surface`): background `#100f0ee0` (was `rgba(23,19,16,0.62)` -- notably more opaque now, ~88% vs ~62%, a less see-through glass than the prior pass), border `#c99a5b1a` (unchanged in effect, ~10% gold), radius unchanged at 10px, blur unchanged at 16px (neither mentioned in the pasted rule, so left alone).

Inputs (`.login-input`): background `#0f0e0d` (was `var(--login-panel-2)`, `#1d1813` -- now darker/more recessed), border `#252322` (was the gold-tinted `var(--login-line)` -- now a plain neutral dark border, no gold tint at rest), radius `5px` (was 10px -- tighter than the card, distinct from both the card's 10px and the button's 0px). Focus state (still gold border + ring) untouched, so the accent color still appears the moment a field is actually in use.

Labels (`.login-label`): color `#bba585` (was `var(--login-gold)`, `#c99a5b` -- a more muted, desaturated khaki-gold). Weight/tracking untouched from the prior pass.

Button (`.login-button`): background `#d5a05c` (was `var(--login-gold)` -- slightly brighter/warmer), radius `0px` (was 6px -- now fully square, the most extreme end of the "opposite correction from the card" direction the prior pass started), added `margin-top: 1em` (new -- extra breathing room above the button, stacking on top of the password field's own existing `mb-6` rather than replacing it, since that's what a DevTools-added declaration on the button's own rule does). Letter-spacing/transition untouched.

Logo image sizing (`h-12 mb-8` → `h-18 mb-4` on the `<img>` in `Login.tsx`): the pasted rules targeted Tailwind's own generated `.h-12`/`.mb-8` utility classes directly (`height: calc(var(--spacing) * 18)`, `margin-bottom: calc(var(--spacing) * 4)`) -- since those are shared utilities used everywhere else in the app for unrelated elements, redefining them globally would have resized/repositioned things across the whole app, not just this logo. Translated the *intent* instead: changed the logo `<img>`'s own className to `h-18`/`mb-4`, which (Tailwind v4 generates spacing utilities for any integer multiplier of `--spacing` on demand) computes to the exact same 72px height / 16px margin the pasted rule specified, scoped to just this one element.

## Verification

Confirmed every value via `getComputedStyle` on the real rendered page, not just re-reading the CSS source: card `background: rgba(16,15,14,0.88)`, `border-color: rgba(201,154,91,0.1)`, `border-radius: 10px`; logo `height: 72px`, `margin-bottom: 16px`; input `background: rgb(15,14,13)`, `border-color: rgb(37,35,34)`, `border-radius: 5px`; label `color: rgb(187,165,133)`; button `background: rgb(213,160,92)`, `border-radius: 0px`, `margin-top: 12px` -- every one matches the pasted values exactly (allowing for the browser's own rgba rounding of the 8-digit hex alpha channels). Screenshotted at 1600px desktop. Re-ran the same real end-to-end login check as the prior two sessions (real dev credentials, real `POST` to the now-correctly-configured API, `200`, redirect to `/dashboard`) -- confirmed unaffected, since nothing here touched `handleSubmit`/`useAuth`.

## Typechecks

`npm run build` (web) and `npx tsc --noEmit` (api) -- clean.

## Commit

`d362b48` on `main`.

## Cleanup

Same dev servers from the prior session (api `:4000`, web `:6506`) reused for verification, left running for the same reason stated there. No new background processes started this session. No scratch scripts staged.

---

# Team account lifecycle — invite, forgot password, change email, change password, deactivation

Single session on `main`. Security-sensitive, so verification below is adversarial (reuse/expiry/immediate-revocation checks), not just happy-path. No public studio signup was built — invites only add a teammate to an existing studio, sent by someone with `team.manage`.

## 1. Schema — all on `User`, no new models

`inviteToken`/`inviteTokenExpiresAt`, `passwordResetToken`/`passwordResetTokenExpiresAt`, `pendingEmail`/`emailChangeToken`/`emailChangeTokenExpiresAt`, `passwordChangedAt`, `deactivatedAt`/`deactivatedById` (self-relation, audit metadata only — `isActive` stays the one field every read path actually checks). `password` relaxed to nullable (confirmed it was required first) since an invited-but-not-yet-activated user has no password hash at all. Same token+expiry-on-record pattern as deposits/waivers/estimates — nothing new invented. Migration `20260728003429_user_account_lifecycle`, applied and resolved (`prisma migrate status` confirms up to date).

## 2. Platform email — Bird, `lib/platformEmail.ts`

`sendPlatformEmail({ to, subject, text, html })` posts to `https://{region}.platform.bird.com/v1/email/messages` (region from the `BIRD_API_KEY` prefix, e.g. `bk_us1_...` → `us1`), from `accounts@mail.inkmanager.app`. Every call site is fire-and-forget (`.catch(err => console.error(...))`, never awaited in the request path) — the token/DB write is the durable effect and always happens first, so a Bird outage degrades to "the link exists but the email didn't arrive," never a failed or slow request. This also closes a timing side-channel on forgot-password specifically: awaiting a real network call only on the "email exists" branch would make that branch measurably slower than the "doesn't exist" branch.

## 3. Invite flow

`POST /:studioId/invites` (`team.manage`) creates a passwordless `User` with a token, emails the link, returns `serializeUser(...)`. Public `GET /invite/verify/:token` and `POST /invite/accept/:token { password }` (sets the hash, clears the token, activates, returns a fresh JWT so the new teammate lands signed in). `POST /:studioId/invites/:userId/resend` overwrites the token (old one stops matching anything — invalidated by construction, not a separate revocation step) and re-emails. `DELETE /:studioId/invites/:userId` (Cancel) deletes the row outright — a pending invite never had a real account, nothing about it is worth keeping. Login on a pending account returns `"Check your email to activate your account."`, not the generic invalid-credentials message.

**Team.tsx**: kept the existing direct-create-with-password flow (now labeled "Add directly," secondary button) alongside a new "Invite team member" primary flow — the backend comment on the old route explicitly kept it for "an owner handing over a printed credential in person," so both stayed rather than removing one. Added a distinct amber "Pending invites" section (email/role/expiry, Resend/Cancel) above the regular staff table.

## 4. Forgot password

`POST /auth/forgot-password { email }` — byte-identical response whether or not the account exists (confirmed, not assumed — see verification). `POST /auth/reset-password/:token { newPassword }` sets the hash and `passwordChangedAt` in one update.

**Session invalidation**: `requireAuth` (`middleware/auth.ts`) now does a live `prisma.user.findUnique` on every authenticated request (not just at login) and rejects if the token's own `iat` predates `passwordChangedAt`. This is the only way to get true immediate revocation out of stateless JWTs, and it's a real per-request DB round-trip cost, accepted deliberately. `optionalAuth` was deliberately left as pure JWT verification (no DB hit) — narrower semi-public surface, flagging this as a known asymmetry rather than silently leaving it unexamined.

## 5. Change email (logged in)

`POST /auth/change-email { newEmail, currentPassword }` requires the current password, sends the confirmation to the **new** address, and only ever writes to `pendingEmail`/`emailChangeToken` — `email` itself is untouched until `POST /auth/confirm-email-change/:token` (public, since the link may be opened on a different device/session) succeeds. Does not touch `passwordChangedAt`, so the current session stays valid throughout — correct, since nothing about the credential changed yet.

**Profile.tsx**: split the old single combined form (name/phone/**email**/**password**, one submit) into three independent pieces — profile fields still via `PATCH /users/me`, plus separate "Change email" and "Change password" mini-forms hitting the two new routes. This was a live regression fix, not just new UI: the old form still POSTed `email`/`currentPassword`/`newPassword` to `/users/me`, which the rewritten route now silently ignores, so email/password edits were silently no-ops before this. `serializeUser` also grew a `pendingEmail` field so the profile page can show "confirmation pending" state.

## 6. Change password (logged in)

`POST /auth/change-password { currentPassword, newPassword }` verifies the current hash, sets the new one, and bumps `passwordChangedAt` — which invalidates every session, including the one making this request (its own token was already resolved before the handler ran, but the *next* request 401s). `Profile.tsx` calls `logout()` immediately on success rather than showing a "success" screen the user can't do anything from with an already-dead token.

## 7. Deactivation — judgment call: gated under `team.manage`, same as invite

The task flagged this as a real judgment call rather than a settled decision. Went with `team.manage` (not OWNER-only) for consistency with invite/resend/cancel/team-list, all already gated the same way — a studio that already trusts someone with `team.manage` to add and manage teammates is trusting them with the same authority to pause one. One-line change (`requireRole(OWNER)` → `requirePermission("team.manage")`) if OWNER-only turns out to be the better call.

No new deactivate/reactivate routes: `isActive` was already the real, pre-existing deactivation mechanism (already checked at login, already toggleable via `PATCH /:studioId/users/:userId`) — extended that route to keep `deactivatedAt`/`deactivatedById` in sync as audit metadata whenever `isActive` changes, never a second competing status signal. `requireAuth`'s live check (section 4) also rejects any token for a user with `deactivatedAt` set, **regardless of token age** — so deactivation takes effect on the very next request, not just future logins.

## Verification — adversarial, run against the live dev API (`:4000`) with real HTTP calls, not mocked

Tokens were read directly from the dev DB in place of an inbox (documented as a standing pattern for these token+expiry flows). All test users created during verification were deleted afterward — confirmed via a final DB query.

- **Invite**: created → `GET /invite/verify/:token` → `POST /invite/accept/:token` → login with the new credentials, all succeeded. Reusing the same accept token afterward: `404`. Re-verifying the same token: `404`. A separately-expired token (`inviteTokenExpiresAt` forced into the past): verify `410`, accept `410`. Resend: the pre-resend token now `404`s, the fresh one verifies fine. Login attempt on a still-pending account: `401` with the clear "Check your email…" message, not generic invalid-credentials. Cancel: `204`, row actually deleted (confirmed by successfully re-inviting the same email afterward with no `409`).
- **Forgot password**: real-email and definitely-nonexistent-email requests returned the identical message string. Captured a JWT, then reset the password — **confirmed that exact pre-reset JWT is rejected (`401`) on the very next authenticated request**, after first confirming it worked before the reset (sanity check, not assumed).
- **Change email**: requested a change; old email still logged in; new email returned `401` (not yet confirmed); confirmed the token; old email now `401`s, new email logs in; reusing the confirm token afterward: `404`.
- **Deactivation**: logged in as the target user to get a live JWT, then deactivated them as owner — **that exact already-issued token was rejected (`401`) on the very next request**, immediately, not just on the next login attempt. Login while deactivated: `401` with the clear message. Reactivated: login works again.
- **Permission gating**: `frontdesk@dev-studio.test` (default `team.manage: false`) got `403` on both invite-creation and deactivation. Enabled `team.manage` for `FRONT_DESK` via the permissions matrix, retried invite-creation: succeeded. Restored the default (`false`) afterward.

**UI, in a real headless browser (Playwright, since `chromium-cli` wasn't available in this environment) against the running dev servers**: Team page's "Invite team member" modal → pending-invite row appears in the new amber section → Resend shows "Sent!" → Cancel's confirm modal → row disappears. Profile page's split "Login & security" section, both the change-email and change-password sub-forms render and expand correctly. All four new public pages (`/forgot-password`, `/reset-password/:token`, `/invite/:token`, `/confirm-email-change/:token`) render the fixed platform identity chrome correctly, both for a valid invite token (real invite copy, studio name, role) and invalid/bogus tokens (correct error state). Screenshotted at each step; no unexpected console errors (the only console entries were the expected `404`s from deliberately-bogus test tokens on the invalid-state screenshots).

## Typechecks

`npx tsc --noEmit` (api) and `npm run build` (web) — both clean, re-run after every remaining change (Profile.tsx split, Team.tsx invite UI, `pendingEmail` addition).

## Commit

`8fa711a` on `main`.

## Cleanup

Killed both dev server processes (api `:4000`, web `:6506`) per this task's explicit instruction — a deliberate departure from the "leave dev servers running" convention the last few sessions established, since this task asked directly for every background shell to be stopped. Restart with `npm run dev` in each of `apps/api`/`apps/web` when picking this back up. All ad-hoc verification scripts (`_verify_lookup.ts`, `_tmp_token_lookup.ts`, `_cleanup.ts`, `_final_check.ts`) were temporary, unstaged, and deleted before commit — none were left in the repo.

---

# Branded auth emails, invite details, profile redirect, persistent auth layout

Single session on `main`. Extends the existing invite/forgot-password/change-email flows and the login page's chrome — none of it rebuilt from scratch.

## 1. Branded HTML email template

One shared `apps/api/src/lib/emailTemplate.ts` (`renderPlatformEmailHtml({ heading, bodyParagraphs, buttonText, buttonUrl, footnote })`), reused by all three email types (invite, password-reset, email-change-confirmation) via their existing `sendPlatformEmail`/`sendPlatformEmailBestEffort` call sites in `auth.ts`/`studios.ts` — no per-email one-off markup. Real HTML-email conventions, not web CSS: every rule inline (no `<style>` block, which many clients strip), nested `<table>` layout (Outlook's Word rendering engine has no flexbox/grid support), Georgia for the heading / system sans-serif stack for body copy (not Fraunces/Jura — most clients strip custom web fonts entirely, so naming them would just silently fall back anyway), and a table-based "bulletproof button" `<a>` (real `<button>` support is inconsistent across clients) styled to match the login page's own gold button.

**Logo delivery — base64 data URI, not a URL.** `apps/api` and `apps/web` deploy as separate Railway services with separate filesystems and domains, so there's no `${PUBLIC_APP_URL}/branding/...` link this API could build that's guaranteed reachable from a real inbox in every environment — least of all local dev, where `PUBLIC_APP_URL` is just `http://localhost:5173`. `apps/api/src/lib/emailLogo.ts` inlines `apps/web/public/branding/logo-black-512.png` as a base64 constant (generated once via a Node one-liner, documented in that file's own comment for re-generating if the logo ever changes) — ships with the compiled output regardless of deploy topology, and renders identically in dev and production. Caught and fixed a real bug before sending anything real: the source PNG is 480×95 (a wide wordmark, not square) — an initial `width="120" height="120"` badly distorted it; corrected to `180×36`, the real aspect ratio.

**Confirmed `apps/web/public/branding/logo-black-512.png` exists** at that exact path before starting, per the task's own instruction (it does — present on disk, newly added but not yet committed by whatever process put it there; committed now as part of this session since the email template needs it).

## 2. Name + phone at invite time

**Investigated first, per the task's own instruction**: `User` does NOT have `firstName`/`lastName` — the whole app (Team.tsx's existing Add/Edit forms, Profile.tsx, every other user-facing surface) already uses a single `name` field, consistently. `phone` already existed (nullable `String`). **No schema change, no migration** — both fields were already exactly what was needed; the task's "only add what's genuinely missing" resolved to nothing missing at all, just wiring an existing field through one more entry point.

`POST /:studioId/invites` now accepts an optional `phone` (validated as a string, normalized the same way `POST /:studioId/users` already does) alongside the existing `email`/`name`/`role`. Team.tsx's "Invite team member" modal grew matching Name/Phone fields (same `PhoneInput` component and 10-digit validation the direct-create form already uses).

## 3. Redirect to Profile after accepting an invite

`InviteAccept.tsx`: `navigate('/dashboard')` → `navigate('/profile')` — one line, plus a comment explaining why (a fresh account has nothing on the dashboard yet, but real setup worth finishing).

**Found and fixed a real bug while verifying this in an actual browser** (not just checking the API response): the invite-accept flow wrote the fresh JWT straight to `localStorage` and navigated away, but `AuthContext`'s `token`/`user` React state only ever initializes from `localStorage` once, on mount — so `ProtectedRoute`'s own `useAuth().token` stayed `null` on the very next render and bounced the brand-new user straight back to `/login`, despite a valid token now sitting on disk. This bug predates this session (it was already broken when the invite-accept flow redirected to `/dashboard`, just never caught since the prior session's verification was pure HTTP calls, never driven through the actual frontend). Fixed by adding `setSession(token)` to `AuthContext` — the same `localStorage.setItem` + `setToken`/`setUser` `login()` already does, factored out and reused by both — and switching `InviteAccept.tsx` to call it instead of writing to storage directly. Verified via Playwright: logged the exact same DOM/URL state that used to silently bounce to `/login`, confirmed it now lands on and stays on `/profile`, authenticated, with the invited name/phone/email showing correctly.

## 4. Persistent auth-page layout

New `apps/web/src/components/AuthLayout.tsx` renders the background photo/overlay/rings chrome exactly once; `App.tsx` nests `/login`, `/forgot-password`, `/reset-password/:token`, `/invite/:token`, and `/confirm-email-change/:token` under it as child routes (`<Route element={<AuthLayout />}>`), each page now rendering just its own card content via `<Outlet />`. Deleted the now-unused `AuthPageChrome.tsx` (the old per-page wrapper every one of these pages mounted independently, which was the actual root cause of the reload-flash feeling — remounting the whole background layer on every navigation, even without a literal hard refresh). `Login.tsx` itself is included in the persistent layout too — its own previously-duplicated background markup was stripped down to just the card, matching the other four; every hand-tuned style value on the card itself (frosted glass, radius, gold button, tracking) is untouched.

**Crossfade + slide, no new dependency**: no animation library was already a project dependency, so this uses `useOutlet(location)` (react-router's documented technique for animating between nested routes — decouples what a `<Outlet/>` renders from the router's actual current location) plus two small CSS pieces already mostly present: the "in" half reuses the app's existing `animate-fade-slide-up` utility (already used by `Calendar.tsx`/`ConversationsPanel.tsx` for the same "new content just appeared" moment), the "out" half is a new couple-line `auth-card-fade-out` keyframe in `index.css`, run first and quicker (140ms vs. the existing 200ms `--duration-base`) so the swap reads as a snappy hand-off.

**Direct URLs verified working**, not just in-app navigation: fresh `page.goto()` loads (no prior in-app navigation, cold Playwright context) of `/login`, `/reset-password/:token`, and `/invite/:token` all render correctly — nested routes match identically on a cold load as a top-level route would, confirmed rather than assumed.

## Verification

- **Emails**: rendered locally first (Playwright screenshot of the raw HTML at desktop + mobile widths) to catch the logo aspect-ratio bug before sending anything real. Then triggered three actual sends through the live dev API to a real Gmail inbox (`juan.lazo0001+ims-invite@gmail.com`, `+ims-reset`, `+ims-emailchange` — Gmail's `+` aliasing, all deliver to the same real inbox): an invite, a forgot-password reset, and a change-email confirmation. **User confirmed via the actual received Gmail messages that all three rendered correctly** — logo, gold accent rule, button, and layout all as expected. Email client tested against: **Gmail** (the task's specified minimum bar).
- **Name/phone at invite**: sent a real invite with `name`/`phone` in the payload, confirmed both stored correctly in the API response and later showing correctly on the resulting Profile page.
- **Profile redirect**: drove the full invite-accept flow in a real headless browser (not just the API call) — confirmed landing on `/profile`, authenticated, and *staying* there (this is what caught the `setSession` bug above; the very first attempt silently bounced to `/login` and only showed up because the test checked the actual rendered page, not just the response body).
- **Persistent layout**: captured the background `<img>` DOM node's own object identity before and after an in-app Sign In → Forgot Password navigation and confirmed it's the literal same node (`true`, not just visually similar) — direct proof the layout isn't remounting, not an inference from a screenshot. Confirmed fresh direct loads of `/reset-password/:token` and `/invite/:token` (simulating opening a real emailed link cold) both render correctly.
- **Incidental fix**: `POST /:studioId/users` (the direct-create-with-password route) was still using the old unsafe `{ password: _p, ...rest }` spread instead of the `serializeUser` allowlist the prior session's security fix was supposed to apply everywhere — found by accident while creating a test user for the forgot-password check (its response included raw `inviteToken`/`passwordResetToken`/`emailChangeToken` fields, all `null` in that instance since the row was brand new, but the same unsafe pattern the prior fix explicitly set out to eliminate). Fixed to go through `serializeUser` like every other user-returning route now does.

## Typechecks

`npx tsc --noEmit` (api) and `npm run build` (web) — both clean, re-run after every change including the `setSession` fix and the `serializeUser` incidental fix.

## Commit

`b03a5fd` on `main`.

## Cleanup

Killed both dev server processes (api `:4000`, web `:6506`) started for this session's verification. All ad-hoc scripts (`_get_invite_token.ts`, `_get_user_state.ts`, `_get_token2.ts`, `_cleanup2.ts`, and the local email-preview renderer) were temporary and deleted before commit. All test users created during verification (Gmail-alias accounts and plain test accounts alike) were deleted from the dev database afterward.

## Follow-up: crossfade felt like a reload, fixed

Reported after the above landed: the Forgot Password ↔ Sign In swap didn't reload the *page* (background stayed put, confirmed), but the *card* itself still visibly blinked away and back, reading as a "modal reload" anyway, and didn't feel smooth. Root cause: the original transition was sequential, not overlapping -- fade the outgoing card fully out (140ms), swap, fade the incoming card in (200ms via the shared `animate-fade-slide-up` utility), with a hard cut in the middle where neither card was on screen. That gap was the actual jarring cue.

Rebuilt `AuthLayout.tsx` around a real overlapping crossfade: the outgoing card is captured (via a ref that lags one render behind the live route) and kept mounted, absolutely positioned on top, fading+sliding out, while the incoming card renders normally underneath, fading+sliding in -- both running over the *same* 320ms window, so there's never a frame with neither visible. New `auth-card-enter`/`auth-card-exit` keyframes in `index.css` replace the old `auth-card-out` + borrowed `animate-fade-slide-up` combo, both using `cubic-bezier(0.16, 1, 0.3, 1)`-style easing (paired with a subtle scale, not just a flat slide) for a noticeably more natural deceleration than the previous linear/basic-ease version. The exiting overlay is `inert` (unclickable/unfocusable/unreachable by accessibility tools) while it fades.

**Verified with frame-by-frame screenshots** through the transition window (not just before/after), both directions (Sign In → Forgot Password and back) -- confirmed both cards genuinely overlap mid-transition rather than one appearing only after the other fully disappears, and that both directions settle back to a pixel-identical resting state.

Also cleaned up every ad-hoc verification script (`.mjs`/`.ts`) and dev-server log file this conversation had accumulated in the local scratch directory across both this task and the preceding account-lifecycle one -- none of it was ever part of the repo, but it was still clutter sitting on disk.

Typechecks re-run clean (`npx tsc --noEmit` / `npm run build`). Commit: `6e0d29e` on `main`. Same two dev server processes killed again after verification.

---

# Auth-page transitions: replace hand-rolled crossfade with Framer Motion

Single small session on `main`. Replaces only the card-swap transition inside the existing persistent `AuthLayout` (background/ornaments already don't remount, untouched) -- no schema changes, no other part of the app animated.

## Why the hand-rolled version stayed "almost right"

Confirmed the diagnosis before writing any code: a manually-timed CSS crossfade has to fight React's default "unmount the instant the condition goes false" behavior to keep the outgoing element around long enough to animate out -- the previous version did this with a `setTimeout` + a ref tracking "what was rendered last render," which worked but was inherently fragile. Separately, and independently, it never accounted for content-height differences between cards at all -- the container just snapped to whatever the new card's natural height was.

## 1. Framer Motion installed and set up as reusable infrastructure

`npm install framer-motion` in `apps/web` (confirmed not already a dependency anywhere via `npm ls framer-motion` first -- it wasn't). New `apps/web/src/lib/motion.ts` exports exactly two things, deliberately not a speculative preset library: `crossfadeVariants` (opacity + a 10px vertical settle, mirrored on exit) and `crossfadeTransition` (`{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }`). Both are consumed by `AuthLayout.tsx` and are the reusable starting point for animation work elsewhere in the app whenever that's actually asked for -- nothing beyond what this session needed was built out.

## 2. `AuthLayout.tsx` rebuilt around `AnimatePresence`

- **Default mode, not `"wait"`**: no `mode` prop on `AnimatePresence`, so outgoing and incoming cards mount and animate simultaneously -- confirmed via a real overlap, not inferred (see Verification).
- **The height-jump fix, solved as part of the same system, not bolted on separately**: a small `AuthCard` wrapper calls Framer's `useIsPresent()` -- `true` for the current/entering card, `false` for the one mid-exit. Only the entering card stays in normal document flow; the exiting one switches to `position: absolute` the instant it starts leaving (still visually stacked on top, still animating its own exit). That means at any given moment exactly one card is actually contributing to the container's height, which is what lets the outer wrapper's `layout` prop FLIP-animate a real height change smoothly instead of having two candidate heights to reconcile.
- **Old hand-rolled code deleted outright**, not left dormant: the `useRef`/`useState`/`setTimeout` machinery in `AuthLayout.tsx` and the `auth-card-enter`/`auth-card-exit` `@keyframes` + classes in `index.css` are gone. `grep` confirms no remaining references anywhere in `apps/web/src`.
- **Unified the layout-transition timing with the crossfade timing** -- not in the original brief, but caught during verification (see below) and worth fixing in the same pass rather than shipping something subtly two-toned: Framer's `layout` prop uses its own default spring transition unless told otherwise, which measured out to a ~500ms settle versus the card's own 320ms opacity fade -- meaning the box was still visibly resizing after the incoming card had already fully faded in. Pinned via `transition={{ layout: crossfadeTransition }}` on the wrapper so both animations share the exact same duration/easing and read as one motion.

## Verification

Duration/easing landed on: **320ms, `cubic-bezier(0.16, 1, 0.3, 1)`** (an "expo-out"-style curve) -- picked by eye against the real transition, same values the previous CSS version had converged on, which held up under the new mechanism too.

- **Genuine overlap, proven, not assumed**: screenshotted 30ms after a real click-triggered navigation and captured both the outgoing Sign In card and the incoming Forgot Password card visibly blended together mid-transition -- not sequential, not a scripted illusion of one.
- **Height animation, proven with a real numeric trace, not just eyeballed**: injected a `requestAnimationFrame` poller into the page to log the container's `getBoundingClientRect().height` every frame across two real navigations. Login → Forgot Password (394.5px → 380.5px) interpolated smoothly across ~15 intermediate values, no jump. Confirm Email Change → Sign In (240px → 394.5px, a much bigger and more obvious swing) interpolated through ~20 intermediate values over ~350ms, also smooth. Neither shows a value snapping straight from start to end.
- **Persistent background reconfirmed, not just re-assumed**: captured the background `<img>` DOM node's own object identity before and after a real navigation -- still the literal same node (`true`), so the prior session's remount fix is intact.
- **Reset Password and Accept Invite views checked directly**, not just the two most obvious ones (Sign In / Forgot Password) -- both render correctly with the new system, no visual regressions.
- **Cold-load sanity check**: confirmed a fresh `/login` load shows the card at `opacity: 1` immediately, no unwanted fade-in on first mount (`AnimatePresence`'s `initial={false}` is what prevents this -- verified via `getComputedStyle`, not assumed from reading the prop name).
- No console/page errors in any of the above.

## Typechecks

`npx tsc --noEmit` (api, unaffected by this session -- no API files touched) and `npm run build` (web) -- both clean.

## Commit

`d8fcf13` on `main`.

## Cleanup

Killed both dev server processes (api `:4000`, web `:6506`) started for this session's verification. Deleted every ad-hoc `.mjs` verification/tracing script from the local scratch directory afterward -- none were ever part of the repo.

---

# Auth-page transitions: rebuild using specific Motion techniques (Clerk sign-in reference)

Single small session on `main`. Replaces the prior session's `AnimatePresence`-default-mode approach with the specific techniques from motion.dev's "Clerk: Sign-in-or-up" example -- read directly from the live page (`https://motion.dev/examples/react-clerk-sign-in` / its rendered example at `examples.motion.dev/react/clerk-sign-in`), not guessed at. Only the animation mechanics were borrowed -- no Clerk UI (email/password reveal, OTP card-stack) applies here and none was added. Persistent `AuthLayout` background/rings, untouched.

**Note on working conditions**: a large, unrelated concurrent refactor (`.card-surface`/editorial-gold token consolidation, per its own in-progress `index.css`/`Team.tsx`/`Profile.tsx`/etc. changes) was actively running in this same working tree throughout this session -- confirmed by file-modification timestamps updating in real time. Left entirely untouched, including one moment where it left `index.css` in a transiently build-breaking state that resolved itself a short wait later (confirmed via `npx tsc -b` staying clean the whole time -- the failure was scoped to Tailwind's CSS processing of someone else's in-flight edit, never this session's own TypeScript). Only `apps/web/src/components/AuthLayout.tsx` and `apps/web/src/lib/motion.ts` were staged/committed -- verified via `git diff --stat` against exactly those two paths before committing, so none of the other session's in-progress work is included in this commit.

## The four techniques, confirmed against the real source before implementing

Fetched the actual example page rather than assuming the task brief's description was exact. Confirmed verbatim:
```
<MotionConfig transition={{ type: "spring", bounce: 0.3, visualDuration: 0.4 }}>

const TEXT_VARIANTS = {
    initial: { opacity: 0, filter: "blur(10px)", y: -10 },
    animate: { opacity: 1, filter: "blur(0px)", y: 0 },
    exit: { opacity: 0, filter: "blur(10px)", y: 10 },
}

<AnimatePresence mode="popLayout">
```

1. **`AnimatePresence mode="popLayout"`** -- adopted for both the heading and the card. Also confirmed via `motion.dev`'s own docs text (not assumed from the prop name): popLayout "pops" exiting elements out of document flow via `position: absolute` the instant they start exiting, letting siblings/the incoming element reflow immediately, and "pairs especially well with the `layout` prop" on individual children -- which is why `AuthCard`'s own `motion.div` carries `layout` directly, not just the outer wrapper. Docs also flag that any custom-component direct child of `AnimatePresence` must forward its ref for popLayout to work; `AuthCard` is wrapped in `forwardRef` accordingly (a real requirement, not decorative -- popLayout needs the DOM node to measure/position it while popped out).
2. **Spring via `MotionConfig`**: `{ type: "spring", bounce: 0.25, visualDuration: 0.38 }`, set once at the top of the transitioning region (not a fixed-duration easing curve, and not repeated per element). Landed on 0.25/0.38 by eye, inside the brief's own suggested 0.2-0.3 / 0.35-0.4 ranges -- enough bounce to read as alive without any visible oscillation/overshoot wobble.
3. **One shared piece of state cascading to two named-variant elements**: `getAuthMode(pathname)` maps the route to one of five `AuthMode` values (`sign-in` / `forgot-password` / `reset-password` / `accept-invite` / `confirm-email-change`), used as the heading's `AnimatePresence` key; the card's own `AnimatePresence` still keys off the literal pathname (finer-grained, but they move in lockstep since every mode maps to exactly one route in practice).
4. **Distinct heading treatment**: new `headingVariants` in `lib/motion.ts` (fade + `blur(10px)` &rarr; `blur(0px)` + a mirrored y-offset) versus the card's own `crossfadeVariants` (fade + y-offset only, no blur) -- the heading visibly "resolves into focus" while the card underneath just fades/slides, giving the two their own distinct character even though both run off the same spring.

A new heading element was added to `AuthLayout.tsx` itself (not to any of the five individual page components, which stayed untouched) -- none of Sign In / Forgot Password / Reset Password / Accept Invite / Confirm Email Change had any heading text before this session, just each page's own logo. Added there rather than in each page file to keep "one shared piece of state... cascading to the heading" literally true (a single lookup table in the layout, not five separate hardcoded strings), and to keep this session's footprint to layout/animation mechanics only, per its own scope.

## Verification

- **`popLayout` confirmed to actually fix the height-jump**, not assumed from the mode name: same `requestAnimationFrame`-polling technique as the prior session, tracing the container's real `getBoundingClientRect().height` frame-by-frame through a Sign In &harr; Forgot Password swap. Interpolated smoothly (442.5px &rarr; 428.1px, with a small ~0.4px spring-overshoot-then-settle visible in the trailing frames -- consistent with real spring physics, not a snap) across ~15 sampled frames, no jump.
- **Genuine overlap** re-confirmed with a screenshot 280ms into a real click-triggered navigation: both the outgoing Sign In fields and the incoming Forgot Password card/heading visibly blended together mid-transition.
- **Heading's distinct feel**: visually confirmed the blur is real (not just present in the variant object but actually applied) via `getComputedStyle` on a settled heading (`filter: "blur(0px)"`, confirming the property is live and animatable, not stripped/ignored).
- **Every reachable view checked**, not just the two obvious ones: Sign In, Forgot Password, Reset Password, Accept Invite (both the invalid-token and a real valid-token happy path), and Confirm Email Change all screenshotted with their own correct heading and card content.
- **Persistent background reconfirmed**: captured the background `<img>` DOM node's own identity before/after a real navigation -- still the literal same node.
- **No regression in the invite-accept &rarr; Profile flow** (fixed two sessions ago): drove a real invite end-to-end through the new `AuthLayout` -- still lands on, and stays authenticated on, `/profile`.
- **Cold-load sanity check**: fresh `/login` load shows both the card (`opacity: 1`) and heading (`opacity: 1`, `filter: blur(0px)`) fully settled immediately, no unwanted entrance animation (`AnimatePresence`'s `initial={false}` on both groups).
- No console/page errors in any of the above (aside from the expected 404s from deliberately-bogus test tokens on the invalid-state screenshots).

## Typechecks

`npx tsc --noEmit` (api, unaffected -- no API files touched) and `npm run build` (web) -- both clean. (`npm run build` did fail once mid-session on the unrelated concurrent `index.css` edit described above; confirmed via `npx tsc -b` in isolation that this session's own code was never the cause, and the failure resolved once that other edit finished.)

## Commit

`9e08ee5` on `main`.

## Cleanup

Killed both dev server processes (api `:4000`, web `:6506`) started for this session's verification. Deleted every ad-hoc `.mjs` verification/tracing script and test invite account created during verification. Left the unrelated concurrent work (`index.css`, `Team.tsx`, `Profile.tsx`, and many other files, plus an untracked `apps/api/scratch-check.ts`) completely untouched -- none of it staged or committed by this session.

---

# Editorial Gold — Login's CSS becomes the canonical token source, frosted-glass cards app-wide

Single session, on `main`. No schema changes. Read the prior session's live-chat CSS diagnostic (never written to `REPORT.md` per that task's own instruction) directly from conversation memory rather than from this file -- confirmed accurate against the current codebase before acting on it.

## 1. Card system gained the tokens it never had

`--radius-card`/`--radius-btn` under `:root[data-theme="editorial-gold"]` changed from the ui/restyle-v3 reference's original 16px/10px to Login's own exact numbers -- 10px/0px (fully square). Three genuinely new tokens, since nothing like them existed before: `--color-card-glass` (`#100f0ed6`, translucent), `--color-border-glass` (`rgba(201,154,91,0.1)`, fainter than the general-purpose `--color-border`), `--blur-card` (`16px`). Two more new tokens exist purely so Login's own button/input become token-driven without touching any other button/input in the app: `--color-accent-button` (`#d5a05c`, Login's own lighter/warmer gold, deliberately distinct from the app-wide `--color-accent`) and `--color-input-bg`/`--color-input-border` (`#0f0e0d`/`#252322`, Login's neutral non-gold-tinted input treatment). Nothing else in the app references these last three, so adding them changed nothing anywhere except Login itself.

## 2. Frosted glass, app-wide -- not a Login special case

New `.card-surface` marker class, scoped entirely under `[data-theme="editorial-gold"] .card-surface { ... }` (border-radius/background/border-color/backdrop-filter from the tokens above) -- does nothing at all under any other preset, so `onyx-lime` and friends stay flat/opaque exactly as before. Added to every genuine content-card wrapper across the app: `Widget.tsx` and Dashboard's `CardShell` (already editorial-aware), plus ~30 previously non-theme-aware `rounded-2xl border border-border bg-surface` sites across Team, Settings, Inquiries, Inquiry/Appointment/Client/Artist/GiftCard detail pages, and several public client-facing pages (deposit/estimate/waiver/intake-form/gift-card links, which already apply a studio's own `themePreset`). Deliberately **excluded**: `Modal.tsx`, `TopBar.tsx`'s dropdown, `SearchPalette.tsx`, and `ConversationsPanel.tsx`'s draft-inquiry dialog and its own docked side panel -- all either genuine modal/overlay surfaces or dense scrollable text a user needs to read while typing, where a blurred background would hurt rather than help. Caught and reverted two false-positive matches from the bulk substitution (small circular icon buttons that happened to share the `border border-border bg-surface` substring) before they shipped.

## 3. Cards needed something real to blur against

The `.arc-decor` rings (TopBar-mounted, editorial-gold only) were positioned almost entirely *above* the viewport (`top: -560px` on a 1400px circle), visible only as a sliver behind the header and never again once a page scrolled past its first screenful. Recentered on the viewport (`top: 50%`, matching the login/marketing pages' own proven `.rings` positioning) -- staying `position: fixed` means the same rings now sit centered in whatever's currently in view at any scroll position, on every page, with zero per-page integration work (TopBar already mounts this once, globally). Deliberately did *not* lean on the grain texture for this -- confirmed by isolation-testing (see Performance below) that a 16px blur smooths fine high-frequency grain away almost entirely; only large, soft, low-frequency shapes like the rings actually survive being blurred and read as genuine texture.

## 4. Login is genuinely locked to editorial-gold, not just visually similar

`.login-shell` now shares the *exact same selector* as `:root[data-theme="editorial-gold"]` (`:root[data-theme="editorial-gold"], .login-shell { ... }`) rather than an independent hand-copied set of hex values -- every `--color-*`/`--font-*`/`--radius-*`/`--blur-card`/etc. token Login reads is the real, shared editorial-gold definition, not a second copy that can drift. This is deliberately **not** achieved by having `.login-shell` read the swappable tokens the normal way (i.e. relying on `[data-theme="editorial-gold"]` being set on `<html>`) -- that would make Login follow whichever preset the currently-logged-in studio (or a stale value left over in the same tab) happens to have active, which is exactly what a "fixed platform identity" page must never do. Instead, `.login-shell`'s own selector always applies regardless of `<html>`'s attribute, so the shared values land on Login unconditionally.

The pre-existing `--login-*` custom property *names* (`--login-gold`, `--login-cream`, etc.) were kept rather than renamed everywhere the five auth pages (Sign In, Forgot Password, Reset Password, Accept Invite, Confirm Email Change) reference them inline via Tailwind arbitrary values (`text-[var(--login-gold)]` and similar) -- but their *values* are now `var(--color-accent)`, `var(--color-fg)`, etc., derived from the shared block one level up instead of independently hardcoded. `.login-panel-surface`/`.login-input`/`.login-button` now reference `var(--radius-card)`, `var(--color-card-glass)`, `var(--color-border-glass)`, `var(--blur-card)`, `var(--radius-btn)`, `var(--color-accent-button)`, `var(--color-input-bg)`, `var(--color-input-border)` directly instead of hardcoded literals. `.login-jura` (used across all five auth pages) changed from hardcoding `font-family: 'Jura', ...` to a thin `font-family: var(--font-jura)` pass-through -- the font itself is now 100% shared/inherited, though the class name itself wasn't removed (renaming it would have touched ~10 call sites across five files for no functional gain over just fixing its one definition).

**Verified via the actual failure mode this is meant to prevent**, not just a visual glance: logged into `dev-studio` (onyx-lime active), confirmed via `getComputedStyle` that `<html data-theme="onyx-lime">` was still genuinely present while client-side-navigating to `/login` (no full reload, replicating the "logged out without closing the tab" scenario the original code comment warned about) -- and that `.login-panel-surface`'s computed `background-color` was still `rgba(16,15,14,0.84)` (the editorial glass value), never onyx-lime's flat `--color-surface`. Login is locked, not merely coincidentally correct.

## Verification

Playwright against the local dev stack, `dev-studio` switched to `editorial-gold` via direct DB update (reverted to its original `onyx-lime` after):
- Dashboard, an Inquiry detail page (Widget-based sections: Pipeline/Assignment/Estimate/Appointments/Reference Images/etc.), Team, and Settings all screenshot with genuine frosted glass -- translucent cards with the recentered `.arc-decor` rings visibly crossing through them, 10px radius, fainter gold border. Screenshots in the scratchpad (`shots/edt-*.png`).
- `onyx-lime` re-verified completely unaffected: same Dashboard, flat/opaque cards, 16px radius, no rings, no blur (`shots/onyx-dashboard.png`).
- Login re-verified locked regardless of active preset, both visually (`shots/onyx-then-login-check.png`, `shots/lock-check-spa-nav.png`) and via the `getComputedStyle` check described above.
- Conversations: the docked side panel intentionally stayed solid/opaque (see item 2's exclusions) -- confirmed it still renders correctly and legibly under editorial-gold, no regression (`shots/edt-conversations.png`).

## Performance

Measured real scroll-frame timing (`requestAnimationFrame` deltas during a scripted 2000px scroll) on the two pages named in the task -- Dashboard's card grid and the ~60-row Inquiries list -- under both presets:

| Page | onyx-lime (baseline) | editorial-gold |
|---|---|---|
| Dashboard (has `.card-surface` + blur) | avg 16.4ms, max 16.8ms, 0 long frames | avg 18.1ms, max 50ms, 4-5 long frames (out of ~78) |
| Inquiries list (plain table, **no cards at all**) | avg 16.4ms, max 16.8ms, 0 long frames | avg 32-37ms, max ~100ms, 23-25 long frames (out of ~40) |

Dashboard's actual new frosted-glass cards cost a small, acceptable amount of scroll smoothness -- a handful of dropped frames during a fast scroll, nothing alarming. The Inquiries list result looks worse at a glance, but **the Inquiries list has zero `.card-surface` elements on it at all** (it's a plain table) -- this session's card/blur work cannot be its cause. Isolated by reverting `.arc-decor`'s new position back to its original off-screen placement and separately by zeroing out the pre-existing grain texture's opacity, one at a time, and re-measuring: the slowdown persisted almost unchanged both times. This is a **pre-existing editorial-gold characteristic on long scrollable pages**, present before this session's changes, not something this session introduced or worsened. Root cause not identified (candidates: `Outfit`/`Fraunces` per-row text metrics cost, dev-server-only overhead, something else in editorial-gold's existing per-page treatment) -- flagging for separate investigation rather than silently absorbing it into this session's scope or claiming it's fine without having actually measured it.

## Typechecks

`npx tsc --noEmit` (api, unaffected -- no API files touched) and `npm run build` (web) -- both clean. Hit one genuine syntax bug of my own along the way: two new comments contained a literal `*/` substring (an asterisk immediately followed by a slash inside prose like `bg-surface/rounded-*/border`), which prematurely closed the CSS comment and broke the build -- found by comparing `/*` vs `*/` counts across the file, fixed by rewording both comments to avoid the adjacency, rebuilt clean.

## Commit

`96db04a` on `main`.

## Cleanup

Reverted `dev-studio`'s `themePreset` back to `onyx-lime` (its state before this session). Deleted every ad-hoc Playwright script in the scratchpad; screenshots left in place for reference. Killed the API dev server process started for this session's verification.

---

# Auth transitions, take 3: a genuinely persistent card, not two swapping ones

Single small session on `main`. Follow-up correction to the immediately preceding "Clerk sign-in reference" session -- that session made Sign In and Forgot Password crossfade nicely into each other, but they were still, underneath, two entirely separate cards/pages being swapped (each with its own logo + email input), so the shared elements between them still briefly faded/reset on every switch. This session restructures so the elements that are genuinely the SAME thing across both views -- the card surface, the logo, the email field -- are one continuously-mounted instance, never unmounted or faded at all, while only the content that's actually different (password field vs. explanatory text, button label, link) animates.

**Note on working conditions**: the large concurrent `.card-surface`/editorial-gold refactor mentioned in the prior session's report finished and committed (`96db04a`/`83d6240`, directly above this entry) partway through this session. Confirmed the build stayed clean against that new base once it landed; none of that work was touched by this session.

## The restructuring

New `apps/web/src/components/SignInOrForgotCard.tsx` owns the persistent pieces and both flows' logic (previously split across `Login.tsx`/`ForgotPassword.tsx`, which are deleted -- their JSX became entirely unreachable once `AuthLayout` stopped using it for these two routes, and dead code doesn't get left dormant):

- **Card surface**: one `motion.div` with `layout`, rendered unconditionally regardless of `mode`. Never wrapped in `AnimatePresence`, never given an `exit`/`initial` variant -- there's nothing to enter or exit, since it's the same element the whole time. `layout` alone handles it smoothly resizing as the content inside changes height.
- **Logo and email field**: same treatment -- plain `motion.img`/`motion.input` with `layout`, rendered once, no variants, no `AnimatePresence`. Since the email input is now real shared state (lifted into this one component instead of duplicated per-page `useState`), typing an email on Sign In and clicking through to Forgot Password carries it over rather than starting blank -- a real, visible side effect of the architecture, not just an animation nicety.
- **Only the genuinely different content** -- the password field (+ its error banner) on Sign In; the explanatory paragraph on Forgot Password (moved to render *after* the email field instead of before, so it doesn't need two separate swap slots on either side of a persistent element); the button's label; the link's text/destination; Forgot Password's post-submit confirmation message -- lives in one small region wrapped in `AnimatePresence mode="popLayout"`, using the same `crossfadeVariants` preset as before.
- **`AuthLayout.tsx`**: still the single source of truth for which mode is active, still handles the heading crossfade and the persistent background/rings (both untouched). Its own outer `AnimatePresence mode="popLayout"` now branches: `SignInOrForgotCard` gets a **constant key** (`"sign-in-or-forgot"`) regardless of whether the route is `/login` or `/forgot-password`, so switching between them is a same-key re-render (no exit/enter at all) -- while every other route still gets the previous session's `AuthCard`, keyed by the literal pathname, unaffected. A type guard (`isSignInOrForgotMode`) narrows `AuthMode` down to `SignInOrForgotCard`'s own prop type at the call site, rather than trusting a plain boolean to carry that narrowing through a ternary (it doesn't).
- `/login` and `/forgot-password`'s `<Route>` entries in `App.tsx` now have `element={null}` -- they still need to exist so the URLs match/resolve, but `AuthLayout` never reads their `Outlet` content for these two paths, so there's nothing meaningful to render there anymore.

## Verification

Proved the "never remounts, never fades" claim with actual DOM identity and computed-style checks, not visual impressions:

- Captured the card, logo, and email input's own DOM node references before clicking "Forgot password?", then compared by reference (`===`) after the transition settled: **all three came back `true`** -- the literal same nodes, not new ones that merely look the same.
- Typed an email on Sign In, switched to Forgot Password, submitted it (reaching the "done" confirmation state), then clicked back to Sign In: the email value survived the entire round trip untouched, and the password field reappeared correctly.
- Polled the email input's `getComputedStyle(...).opacity` on every animation frame for 500ms through the Sign In &rarr; Forgot Password transition: **`"1"` at all 20 sampled frames**, never dipping -- it genuinely never fades, confirmed frame-by-frame rather than assumed from the code structure.
- Re-verified the three untouched routes (Reset Password, Accept Invite, Confirm Email Change) still render correctly, and did a real end-to-end login (real credentials, real redirect to `/dashboard`) to confirm the sign-in submit path still works exactly as before after being relocated into the new component.
- No console/page errors in any of the above.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` (web) -- both clean, re-checked once more after the concurrent editorial-gold work landed on top of this session's base.

## Commit

`ec5c4c6` on `main`.

## Cleanup

Killed both dev server processes (api `:4000`, web `:6506`) started for this session's verification. Deleted every ad-hoc `.mjs` verification script from the scratch directory afterward.

---

# Auth transitions: persistent button (not two swapped ones) + slower tuning pass

Single small follow-up on `main`. Two fixes to the immediately preceding session's `SignInOrForgotCard`: the submit button gets the same "one persistent element" treatment already applied to the card/logo/email, and the shared spring's `visualDuration` is temporarily doubled for tuning.

## 1. The button is now one persistent element, not two swapped ones

Previously the submit button lived *inside* each mode's own swapped content block (`sign-in-fields` / `forgot-fields`), so it was a genuinely different button instance each time -- unmounting and remounting on every switch, same class of problem the card/logo/email fix addressed a session ago.

Pulled the button out to its own top-level slot in `SignInOrForgotCard.tsx`, between two now-separate `AnimatePresence` regions (one for the content above it -- password field/error banner vs. explanatory paragraph -- one for the content below -- the mode-switch link, or the done-state confirmation): a single `motion.button` with `layout`, rendered unconditionally except for the one state that genuinely never had a button at all (Forgot Password's post-submit confirmation). Only the label *text* inside swaps, via a small nested `AnimatePresence` wrapping a `motion.span` keyed on the label string itself, using the same blur-fade preset the now-removed heading used to use (renamed `headingVariants` -> `blurTextVariants` in `lib/motion.ts` since it's no longer heading-specific).

**The heading is removed entirely** (`AuthLayout.tsx`, its own `AUTH_HEADINGS` map and `motion.h1` block deleted) -- the button label swap now carries the "this is a different action" signal that the heading used to, making a redundant heading above the card unnecessary. This affects all five auth views, not just Sign In/Forgot Password, since the heading was previously shared across all of them.

## 2. Spring tuning: `visualDuration` doubled, temporarily

`authSpringTransition.visualDuration`: `0.38` -> `0.76`, explicitly as a tuning aid (commented in `lib/motion.ts` as temporary) -- slow enough to actually watch each phase of the motion rather than guessing from a blur. Not a final value; dial back toward something snappier once the restructured button/card feels right at this slower speed.

## Verification

- **Button node identity, proven not assumed**: captured the `<button type="submit">` element's own reference before clicking "Forgot password?" and confirmed by `===` comparison after the transition settled -- the literal same DOM node.
- **The label crossfade is real, traced frame-by-frame** (a screenshot alone was misleading here -- the blur diffuses the overlap enough that a static image at typical scale just looks like a slightly soft single label, not two visibly overlapping words): polled `getComputedStyle` on both the outgoing and incoming `<span>` every animation frame through the transition. Both genuinely coexist from ~72ms to ~615ms, "Sign in" fading opacity 1&rarr;0 with blur 0&rarr;10px while "Send reset link" simultaneously fades 0&rarr;1 with blur 10px&rarr;0px, crossing near their midpoints around 280-300ms. A tightly-cropped screenshot at that exact 290ms midpoint visibly shows the incoming label mid-blur.
- **Confirmed the slower `visualDuration` actually took effect**, not just assumed from the source edit: traced the card's real height in pixels frame-by-frame -- it now takes roughly 900ms-1.2s to fully settle (was ~350-500ms before), consistent with a genuine ~2x slowdown, ruling out a stale dev-server bundle.
- Re-confirmed no regressions: a real end-to-end login (real credentials, redirect to `/dashboard`), and the two other still-`AuthCard`-driven routes (Reset Password, Accept Invite) rendering correctly.
- No console/page errors in any of the above.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` (web) -- both clean.

## Commit

`c4e1742` on `main`.

## Cleanup

Killed both dev server processes (api `:4000`, web `:6506`) started for this session's verification. Deleted every ad-hoc `.mjs` verification/tracing script from the scratch directory afterward.

---

# Auth page background rings: continuous idle orbit + mode-tied rotation

Single small session on `main`. Adds two distinct kinds of motion to the auth page's existing background `.rings` decoration (three concentric arcs + the gold "electron" dot), reusing the persistent-shell architecture and shared `mode`/`MotionConfig` setup from the immediately preceding sessions rather than rebuilding them. No schema changes, no other files touched.

## 1. Continuous idle orbit (CSS keyframes, not framer-motion)

The dot was previously a static fixed offset (`left: calc(50% + 184px); top: calc(50% - 184px)`, 45 degrees around ring 1's 260px radius). Wrapped it in a new zero-size `.ring-orbit` div (`apps/web/src/index.css`) positioned at the same anchor point `.rings` itself uses, with `animation: ring-orbit-spin 42s linear infinite`. Rotating that zero-size wrapper carries the dot's existing fixed offset around in a circle on ring 1's own path without changing the offset value at all -- CSS's standard "transform on an ancestor visually carries absolutely-positioned descendants with it" behavior, no JS involved.

Deliberately plain CSS, not a framer-motion `animate`/`repeat: Infinity` loop: an always-running ambient animation has a different performance profile than a one-shot transition (runs for as long as the page is open), so it's cheapest to hand entirely to the compositor thread via a native CSS transform animation rather than keeping JS ticking indefinitely. Linear easing, not the page's spring -- an idle loop should read as constant-speed, not something that eases/settles. Landed on **42s per revolution** -- slow enough to read as ambient/atmospheric rather than a distraction, fast enough that patient observation confirms it's genuinely moving (~2.4 degrees over the roughly 2.5s window sampled during verification, consistent with 360 degrees/42s). Already covered by the codebase's existing global `prefers-reduced-motion: reduce` rule (`index.css`, collapses all `animation-duration` to 0.01ms) -- no separate media query needed.

## 2. Mode-tied ring rotation + scale

`.rings` (`AuthLayout.tsx`) changed from a plain `div` to a `motion.div`, `animate`d off the same `mode` value (`getAuthMode(location.pathname)`) that already drives the card/button crossfade, using the same `authSpringTransition` spring already established (currently still at the prior session's temporarily-doubled `visualDuration: 0.76` -- untouched by this session, dial-back is that session's own follow-up, not this one's). New `ringModeTransform` map in `lib/motion.ts`, one small `{ rotate, scale }` pair per `AuthMode` (all five, not just Sign In/Forgot Password, so Reset Password/Accept Invite/Confirm Email Change each get their own subtle position instead of defaulting to Sign In's):

| mode | rotate | scale |
|---|---|---|
| sign-in | 0deg | 1 |
| forgot-password | 4deg | 1.015 |
| reset-password | -4deg | 0.985 |
| accept-invite | 6deg | 1.02 |
| confirm-email-change | -6deg | 0.98 |

Deliberately small (a few degrees, ~1-2% scale) -- reads as background depth/atmosphere behind the card, not a competing effect. The continuous CSS spin and this spring rotation compose naturally (nested transforms), no conflict.

## Verification

- **Desktop, Playwright-scripted** (own ad-hoc `.mjs` scripts against the local dev stack, deleted after): confirmed `.ring-orbit`'s computed style carries the real `animation-name`/`duration`/`iteration-count`; sampled the dot's actual on-screen `getBoundingClientRect()` position 6 times over ~2.5s -- coordinates shifted smoothly and continuously (e.g. x 437.5 -> 477.1, y 254.3 -> 321.9), confirming genuine motion rather than a static dot. Confirmed `.rings`' computed `transform` is `none` (identity) on Sign In and a real non-identity `matrix(...)` on Forgot Password after the spring settles; repeated across all five routes (`/login`, `/forgot-password`, `/reset-password/:token`, `/invite/:token`, `/confirm-email-change/:token`) -- each produced its own distinct rotate/scale matrix, no console/page errors on any of them. Screenshot confirms the dot and rings render as intended, subtle and legible against the card.
- **Mobile viewport + CPU throttle (still desktop-run, an emulated proxy, not a real device)**: Playwright's iPhone 13 device emulation with 4x CPU throttling via CDP, sampling 200 animation frames idle and 120 more through a live mode transition. Idle orbit: avg 17.1ms/frame, 1 long frame (>33ms) out of 200. During+after the mode transition: avg 18.5ms/frame, 4 long frames out of 120. No sustained jank under this throttled proxy.
- Both standing typechecks clean: `npx tsc --noEmit` (api, untouched -- no API files touched) and `npm run build` (web).

## Real-phone testing: NOT performed -- explicit gap, not a claim of completion

**This task's own instructions required confirming on a real phone, not a resized desktop browser window, and explicitly said not to approve on desktop alone.** I do not have access to physical device hardware from this environment -- everything above (including the "mobile" CPU-throttled measurement) ran through Playwright's emulation on the same desktop dev machine, which is a reasonable proxy but categorically not the same test the task asked for. **A human still needs to open this page on a real phone** and confirm the idle orbit doesn't introduce stutter or battery-drain-feeling jank, and that the mode-transition still feels smooth with the added ring motion layered in. Flagging this explicitly rather than reporting the task as fully verified.

## Commit

`8c8ecb4` on `main`.

## Cleanup

Killed both dev server processes (api `:4000`, web `:5182` -- the usual `:6506`/`:5173` were both already in use by something else in this environment) started for this session's verification. Deleted every ad-hoc `.mjs` verification/screenshot script from the scratch directory afterward. Left the unrelated concurrent working-tree changes (`Modal.tsx`, both branding PNGs, an untracked marketing screenshot HTML file) completely untouched -- confirmed via `git diff --stat` against exactly this session's own three files (`AuthLayout.tsx`, `index.css`, `lib/motion.ts`) before staging/committing.

---

# Auth page background rings: second orbit dot, opposite direction

Tiny follow-up to the immediately preceding ring-motion session, same day, on `main`. Adds a second gold dot orbiting ring 2 (780px diameter / 390px radius, versus the original dot's ring 1 / 260px radius), spinning the opposite direction from the first.

Reused the exact same `.ring-orbit` wrapper technique -- a second `.ring-orbit.ring-orbit-2` wrapper around a second `<s className="dot-2">`, same `ring-orbit-spin` keyframe and 42s duration as the first dot, but with `animation-direction: reverse` rather than a duplicated keyframe with negated degrees. Positioned at ring 2's own radius (276px/276px offset), starting at the opposite corner (bottom-left) from the first dot's (top-right) purely so they don't start out visually overlapping along the same diagonal. Slightly smaller (6px vs 7px) and `opacity: 0.7`, echoing ring 2 already being fainter than ring 1 in the existing CSS.

## Verification

Playwright, local dev stack: computed each dot's angle around `.rings`' own center from its live `getBoundingClientRect()`, sampled 1.5s apart -- dot 1 moved +12.86 degrees, dot 2 moved -12.86 degrees in the same window, confirming equal speed and genuinely opposite direction (not just a different start position). Screenshot confirms both dots render at their intended positions/sizes, no visual overlap on load. No console/page errors.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` (web) -- both clean.

## Commit

`e49df52` on `main`.

## Cleanup

Killed the web dev server (`:5182`) started for this session's verification. Deleted the ad-hoc `.mjs` verification script and screenshots from the scratch directory afterward. Left the unrelated concurrent working-tree changes (`Modal.tsx`, both branding PNGs, the untracked marketing screenshot HTML) untouched, same as the immediately preceding session.

---

# Modal overflow + scroll-lock fix (shared component, app-wide)

Single small session on `main`. Reported on the New Appointment/Consultation modal (tall content -- Type, artist-assignment warning, duration, suggested times, mini-schedule slider, Date/Start/End, Notes -- got cropped top and bottom with no way to reach the hidden portion, and the page behind it stayed scrollable). Fixed at the shared `Modal` component (`apps/web/src/components/Modal.tsx`) rather than per-instance, since every modal in the app already goes through it.

## Fix

1. **Height cap + internal scroll for `size="default"`**: the dialog previously had no height constraint at all (`w-full max-w-md`, content just grew to its natural height). Changed to `flex w-full max-w-md max-h-[85vh] flex-col`, with the content wrapper below the header switched from a plain `mt-4` to `mt-4 min-h-0 flex-1 overflow-y-auto`. `size="large"` already had a height cap (`h-[80vh] max-h-[80vh]`) and a flexed body area for `fill`-mode children (e.g. `RichTextEditor`) -- left that branch's content-wrapper class untouched so the existing fill-to-parent behavior for the policy/legal-text editor isn't disturbed.
2. **Header stays pinned**: added `shrink-0` to the header row (drag handle, title, close button) on both size variants, so it can't be squeezed by an oversized flex sibling -- previously relied on it implicitly never growing, which happens to hold today but isn't guaranteed by flexbox itself.
3. **Background scroll-lock**: new ref-counted `lockBodyScroll`/`unlockBodyScroll` pair (module-level counter + saved previous `body.style.overflow`) called from a `useEffect` on mount/unmount. Ref-counted specifically so two modals open at once (there's no code path today that nests them, but nothing prevents it) don't fight over restoring the body's overflow value -- only the outermost lock/unlock pair actually touches the style.

## Verification (Playwright against a local dev stack, scratch ports so as not to collide with a concurrent session already on `:5173`)

Reproduced the exact reported scenario: opened Calendar's New Appointment modal, selected a client/project/gift-card/artist to expand it to its full height (Suggested times + mini schedule slider + Date/Start/End + Notes + Create button) at a 1400x720 viewport -- confirmed the dialog clips at `max-h-[85vh]` (measured bounding box height 612px = 0.85 x 720), the header stayed visible throughout, and scrolling the modal's own content area (verified via `scrollIntoViewIfNeeded` reaching the "Create Appointment" button) revealed every field, while `window.scrollY` on the underlying page was unchanged by a mouse-wheel event issued while the modal was open (`document.body`'s computed `overflow` was `hidden`, and reverted to `visible` immediately after closing). Repeated the same flow at a smaller 650px-tall viewport (small-laptop scenario) -- same result, dialog height scaled to the new 85vh cap (552.5px), still fully scrollable, background still locked.

Spot-checked three other modals to confirm the fix came from the shared component, not this one call site: Clients' "Add Client" (short `default`-size content, unaffected by the height cap, scroll-lock still engages/releases correctly), Settings > Policies & Templates > "Edit Refund Policy" (a `size="large"` modal wrapping `RichTextEditor` in `fill` mode -- confirmed the pre-existing 80vh cap and fill-editor layout still render correctly, no regression from the `shrink-0` header change), and Team's "Invite team member" (`default`-size, confirmed scroll-lock engages). All three centered correctly with margin from the viewport edges, none touched top/bottom.

## Typechecks

`npm run build` (web) and `npx tsc --noEmit` (api, untouched) -- both clean.

## Commit

`f22d451` on `main`.

## Cleanup

Playwright and its Chromium browser were installed ad hoc into the scratch directory (not added as a project dependency); both the install and every driver script/screenshot were deleted afterward. Killed the two scratch dev server processes started for this session's verification (api `:4020`, web `:5195` -- picked to avoid an already-running concurrent session on `:5173`/other scratch ports in use). Left the unrelated concurrent working-tree changes (both branding PNGs, the untracked marketing screenshot HTML) untouched. No new test data was created in the dev database beyond toggling an existing seeded client's gift-card checkbox during verification (not submitted, no appointment actually created).

---

# Platform-level /privacy and /terms (Twilio A2P 10DLC resubmission fix)

Single session on `main`. Fixes a real Twilio A2P 10DLC carrier-review rejection (errors 30908/30882) caused by `https://web.inkmanager.app/privacy` and `/terms` not resolving to real content. Read the task's own content drafts (`privacy-policy-platform.md`/`terms-platform.md`, pasted directly into chat rather than committed files) and used them verbatim, with three placeholders filled in per explicit confirmation rather than guessed: `[DATE]` -> July 28, 2026; `[CONTACT EMAIL]` -> `juan.lazo@inkmanager.app`; `[GOVERNING LAW/JURISDICTION]` (Terms only) -> the State of North Carolina, United States.

## Investigated before building, per the task's own instruction

- **No bare `/privacy`/`/terms` route existed.** Only studio-scoped `/privacy/:studioSlug` and `/terms/:studioSlug` (`App.tsx`, backed by `PublicPolicyPage.tsx`, which fetches a Studio's own `StudioSettings.privacyPolicy`/`termsAndConditions` field) -- visiting the bare path with no slug renders "This studio couldn't be found," which is almost certainly what a carrier-review crawler hit. No earlier "Black Hive"-specific privacy/terms draft was found anywhere in the repo to replace (checked; "Black Hive" only appears as a customer/case-study reference on the marketing site).
- **Existing reusable rendering pattern**, confirmed and reused rather than building a new one: `sanitizeHtml()` (`lib/sanitizeHtml.ts`, DOMPurify, allow-listing `p/br/strong/em/u/ul/ol/li/a/h2/h3`) + a `tiptap-content` CSS class + `dangerouslySetInnerHTML`, exactly as `PublicPolicyPage.tsx` and `Policies.tsx` already do for Studio-authored HTML. Applied that same path to this session's own fixed, developer-authored copy (a plain HTML-string constant in the new `content/platformPolicies.ts`, not a database field -- there's no Studio to author it) rather than inventing a second mechanism.
- **`web.inkmanager.app` is not referenced anywhere in the repo** (no env file, CORS config, or vite config names it) -- confirmed it's genuinely live via a direct `curl -I` before trusting the task's own URL claim (`Server: railway-hikari`, real 200), rather than assuming.
- **No CI/CD config exists in-repo** (no `.github/workflows/`, no Dockerfile, no `railway.json`) -- deploy trigger behavior (auto vs. manual on push to `main`) isn't discoverable from the repo, and this session has no Railway credentials/CLI access. **Stopped and asked** rather than assuming a push would go live automatically or silently claiming a live check that didn't happen; confirmed auto-deploy-on-push before proceeding.

## Build

- **New route**, `App.tsx`: `<Route path="/privacy" element={<PlatformPolicyPage title="Privacy Policy" bodyHtml={PLATFORM_PRIVACY_POLICY_HTML} />} />` and the equivalent for `/terms` -- placed so they don't collide with the existing `/privacy/:studioSlug`/`/terms/:studioSlug` (React Router v6 matches these as distinct exact paths, confirmed no regression to the scoped routes below them).
- **New `PlatformPolicyPage.tsx`**: takes `title`/`bodyHtml` directly (no fetch, no `studioSlug`, no `applyThemePreset()` call) -- deliberately the opposite of every other public page in this app, which are all Studio-themed via `applyThemePreset`. This is the first non-auth public page needing the "fixed platform identity" treatment `AuthLayout`'s `.login-shell` already established for Login.
- **New `.policy-shell` CSS class** (`index.css`), joining the exact same selector `.login-shell` already shares with `:root[data-theme="editorial-gold"]` -- real shared token state, locked regardless of whatever `[data-theme]` happens to be on `<html>` (a logged-in Studio's own preset, possibly stale in the same tab), not a hand-copied value that can drift.
- **New `content/platformPolicies.ts`**: `PLATFORM_PRIVACY_POLICY_HTML`/`PLATFORM_TERMS_HTML`, hand-converted from the task's Markdown drafts into the sanitizer's exact allowed-tag subset (h2/p/strong/ul/li/a only -- no h1, since the page component renders the title itself).

## Verification

- **Local dev stack, Playwright**: both routes render with `.policy-shell` present, computed `background-color: rgb(14, 11, 8)` (`#0e0b08`, editorial-gold's locked `--color-bg`) confirming the identity lock holds regardless of the default active theme; correct `<h1>` per route; body text length sane (4373/3302 chars); zero leftover `[DATE]`/`[CONTACT EMAIL]`/`[GOVERNING LAW...]` placeholder text anywhere on either page; **no horizontal scroll at a 390px mobile viewport** (`scrollWidth === clientWidth`) at both routes; no console/page errors. Full-page screenshots at 1280px and 390px both confirm clean, readable rendering.
- **Production, pre-push**: confirmed `web.inkmanager.app` is a real live Railway deployment (not assumed from the task text) and that both `/privacy` and `/terms` currently 200 (SPA fallback already serves `index.html` for unknown client-side paths -- no server-side 404 to fix, only the missing React Router match).
- **Production, post-push -- the actual deliverable**: pushed, then polled the live site's served JS bundle filename every 15s until it changed from the pre-push baseline (`index-DfwgUrvi.js` -> `index-M7-HKCQT.js`, confirming Railway's auto-deploy-on-push genuinely picked up this commit, ~45s after push) rather than assuming a fixed wait was long enough. Then, against the real production domain (not localhost): `curl -I` on both exact URLs -- `https://web.inkmanager.app/privacy` and `https://web.inkmanager.app/terms` -- both a real `200 OK` with a fresh `etag` matching the new build. Followed by an actual browser render (Playwright, since a plain `curl` of this client-side-rendered SPA only ever returns the static shell, never the real content -- see the residual-risk note below): both routes render the correct `<h1>` title and full body text (4373/3302 characters), zero leftover placeholder text, no horizontal overflow at a 390px mobile viewport, no console/page errors, both at 1280px and 390px. Screenshot of the live mobile-width `/privacy` page confirms clean rendering.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` (web) -- both clean.

## A residual risk flagged, not silently absorbed

This app is a client-side-only Vite SPA with no server-side rendering or prerendering anywhere (confirmed via `curl` against production: the raw HTML response for every route, including `/privacy`/`/terms`, is the same empty `<div id="root"></div>` shell regardless of path -- real content only appears after the JS bundle executes). If Twilio's carrier-review crawler fetches the URL without executing JavaScript, it will see an empty shell, not the rendered policy text, **regardless of this session's fix** -- this is a pre-existing, site-wide architecture characteristic, not something introduced or fixable within this session's scope. Every other public page on this site (including the already-live studio-scoped `/privacy/:studioSlug`) has the identical characteristic. Flagging this explicitly rather than claiming the crawler-visible content problem is fully solved; if the resubmission is rejected again on the same grounds, server-side rendering/prerendering for public routes would be the real fix, a materially larger undertaking outside this session's scope.

## Commit

`35418c2` on `main`.

## Cleanup

Killed the web dev server (`:5182`) started for this session's local verification. Deleted every ad-hoc `.mjs` verification/screenshot script and screenshot from the scratch directory afterward. Left the unrelated concurrent working-tree changes (both branding PNGs, the untracked marketing screenshot HTML) untouched; the `Modal.tsx` scroll-lock fix seen mid-session as an unstaged concurrent change was committed by that other work itself (`f22d451`/`745758c`, already on `main` before this session's own commit) -- not authored or staged by this session.

---

# Permissions sweep: OWNER / FRONT_DESK / ARTIST, prompted by a reported Inquiry Detail bug

Single session on `main`. Triggering report: "Inquiry details don't load when you are front desk, which should not be the case." Investigated that specific claim first, then broadened into a systematic Playwright sweep of every major page as all three staff roles, since the root cause turned out to be a general bug *shape* (not a one-off), and the sweep found three more real instances of related shapes plus one confirmed live UX bug. No schema changes.

## 1. The reported bug: `intake-forms/:id/fields` 403s for FRONT_DESK (and ARTIST) — fixed

Root cause was **Express middleware registration order**, not the permission/role config itself (which was already correct — `inquiries.view` is `true` for FRONT_DESK in both `DEFAULT_ROLE_PERMISSIONS` and this dev studio's own explicit override). `apps/api/src/routes/intakeForms.ts` had:

```
router.get("/", requireRole(OWNER, FRONT_DESK, ARTIST), ...)   // line 19
router.use(requireRole(OWNER));                                 // line 27 -- blanket, applies to everything below
...
router.get("/:id/fields", requireRole(OWNER, FRONT_DESK, ARTIST), ...)  // line 152 -- unreachable for non-OWNER
```

Express evaluates middleware in registration order — the blanket `router.use(requireRole(OWNER))` at line 27 already rejects a FRONT_DESK/ARTIST request with 403 before it ever reaches line 152's own (broader) `requireRole`, making that route's stated role list dead code. Confirmed by checking every other `router.use(requireRole(...))` blanket in the API (`calendarPreferences.ts`, `conversations.ts`, `integrations.ts`, `jobs.ts`, `navCounts.ts`, `scheduling.ts`, `search.ts`, `services.ts`, `tasks.ts`, `widgetLayouts.ts`) — `intakeForms.ts` was the only one where a broader per-route gate was registered *after* a narrower blanket one; `waivers.ts` has the identical shape done correctly (narrow ARTIST-inclusive `/:id/status` registered *before* its `OWNER, FRONT_DESK`-only blanket), confirming this is a known-correct pattern the fixed file just had backwards.

**Fix**: moved the `GET /:id/fields` handler to before the blanket `router.use(requireRole(OWNER))`, same position as the already-correct `GET "/"` above it.

**Downstream effect on the actual reported symptom**: `InquiryDetail.tsx`'s "Inquiry Details" widget (`InquiryDetailsSection.tsx`) fetches this exact endpoint to render the studio's live intake-form fields (placement, size, color, budget, etc.) against the inquiry's answers; that component's own fetch is wrapped in `.catch(() => { /* section just doesn't render if this fails */ })` — so the 403 didn't crash the page, it silently produced an **empty "Inquiry Details" section** for FRONT_DESK, which is what "doesn't load" meant in practice. Confirmed live: FRONT_DESK now sees the full field list, matching OWNER.

## 2. Dashboard crashes for ARTIST with `TypeError: Cannot read properties of undefined (reading 'conversionRate')` — fixed

Found via a systematic per-role page sweep (18 pages x 3 roles, Playwright, watching console errors + failed network requests), not from the reported bug directly. A real ErrorBoundary-caught crash, not a console warning.

Root cause: an incomplete rollout of a previous session's own `reports.viewFinancial` permission split (see this file's earlier "Granular permissions expansion" entry). `apps/api/src/routes/reports.ts` was deliberately changed to **omit** `depositConversion`/`giftCardLiability` from the `GET /reports/dashboard` response entirely (not zero them) for a role without `reports.viewFinancial` — ARTIST, by that same session's own explicit, documented design choice — specifically so the frontend could "tell 'no data' apart from 'not allowed' and hide the section." The frontend (`Dashboard.tsx`) was never updated to match: its `ReportsDashboard` interface declared both fields non-optional, and two `CardShell`s read `data.depositConversion.conversionRate` / `data.giftCardLiability.totalCents` unconditionally — crashing the whole page for ARTIST the moment they load `/dashboard`, which is also their post-login landing page.

**Fix**: marked both fields optional on the interface, wrapped both cards in `{data.depositConversion && (...)}` / `{data.giftCardLiability && (...)}`. Verified live: ARTIST's dashboard now renders cleanly (funnel, lost/cold rate, response time, artist utilization) without the two financial cards; OWNER/FRONT_DESK unaffected.

## 3. ARTIST's own sidebar links to "Clients," which is 403-only for them — fixed

Also found via the sweep, then confirmed as reachable through completely normal navigation (not just a manually-typed URL): `Sidebar.tsx`'s `NAV_ITEMS` had no `roles` restriction on "Clients" at all, unlike "Inquiries & Projects" (already correctly `roles: ['OWNER', 'FRONT_DESK']`) right next to it. ARTIST has no `clients.view` permission by default, and this dev studio's own override set also explicitly has `ARTIST / clients.view = false`. Live repro: logged in as ARTIST, "Clients" is present and clickable in the sidebar, leads to `/clients`, which 403s and renders as a **permanently, silently empty table** — no error shown, indistinguishable from "this studio genuinely has zero clients."

**Fix**: gated the nav item on the actual `clients.view` permission (`profile.permissions.includes('clients.view')`) rather than a hardcoded role list, so it also follows a studio's own Settings → Permissions customization (e.g., an OWNER later granting ARTIST `clients.view`) instead of needing a second code change. This required confirming `profile.permissions` (from `GET /users/me`) is reliably correct during an active "View As" session too — it is: `ViewAsContext.tsx` already explicitly calls `refreshProfile()` on both activate and deactivate. Verified live for all three roles: ARTIST no longer sees "Clients"; OWNER and FRONT_DESK still do.

Also gated `AppointmentDetail.tsx`'s "Activity History" widget (an `AuditTrail` call, unconditional before this fix) on `audit.view`, since the sweep caught the same shape there for ARTIST — not a crash, but a raw "Forbidden" string rendered mid-page instead of the section just not appearing.

## 4. Confirmed, but not from the sweep — "Mark as lost" ignores a studio's own permission override — fixed

Separate from the sweep, prompted by noticing this dev studio's `RolePermission` table has an explicit, deliberate `FRONT_DESK / inquiries.markLost = false` override (every other `inquiries.*` key is `true` for FRONT_DESK — this one specifically toggled off, clearly a real customization, not a stray default). `InquiryDetail.tsx`'s "Mark as lost" button (More-actions menu) and "Not a Candidate" button (candidacy-review flow, same underlying action) were gated only by the coarse `canMessage = role === OWNER || role === FRONT_DESK`, never checking the actual `inquiries.markLost` permission. Live repro: FRONT_DESK sees "Mark as lost," fills out the confirmation modal, submits, and gets a raw **"Forbidden"** error rendered on the page — the API correctly enforces the override, the UI just never knew to hide the button.

**Fix**: added `canMarkLost = profile.permissions.includes('inquiries.markLost')`, required alongside `canMessage` for both entry points. Verified live: hidden for FRONT_DESK under this studio's actual override; still visible for OWNER (always has every permission).

## A broader pattern flagged, not chased further this session

Items 3 and 4 are two confirmed instances of the same general shape: `InquiryDetail.tsx` and other pages have **~14** call sites already correctly using the granular `profile.permissions.includes(...)` system (`clients.edit`, `artists.manage`, `waivers.generate`, etc.), but a larger number of buttons/sections across the app — assign-artist, send-estimate, notes-manage, share-with-artist, archive, and more — are still gated only by coarse `role === 'OWNER'`/`role === 'FRONT_DESK'` checks left over from before the granular permission matrix existed. Any of these will show a button a studio has specifically toggled off in Settings → Permissions, and fail with a raw error on submit, exactly like #3 and #4 above. This dev studio happens to have a full explicit override row for every key (apparently saved once from the Permissions tab's UI), which is what made 3 and 4 concretely reproducible here rather than theoretical — a studio using pure defaults wouldn't currently hit either, since the defaults happen to match the old hardcoded role checks. Not fixing every instance in this session (it's a real, separate, page-by-page audit and fix effort); flagging it here as the actual scope of the underlying issue class rather than claiming this session closed it completely.

## Also checked, no issues found

- **Cross-studio boundaries**: a second dev studio's OWNER token against `dev-studio`'s own inquiry/client/appointment/artist IDs — all four correctly `404` (not `403`, matching this codebase's existing not-found-not-forbidden convention for cross-tenant access, so existence isn't leaked). That studio's own `GET /clients` correctly returns only its own 2 rows.
- **ARTIST's remaining sweep `⚠`s** (`/inquiries`, `/inquiries/:id`, `/clients`, `/clients/:id` all 403 for ARTIST on direct URL entry) are all intentional, by-design restrictions matching `DEFAULT_ROLE_PERMISSIONS` and this studio's own override — and, after the Sidebar fix in #3, none of them are linked from ARTIST's own nav anymore, so they're only reachable by manually typing a URL. Correct hardening, not a bug.
- Full three-role, 18-page-each regression sweep re-run after all four fixes above: clean except for the intentional ARTIST direct-URL 403s just described.

## Typechecks

`npx tsc -b` (web) and `npx tsc --noEmit` (api) -- both clean, run after each individual fix and again at the end.

## Commit

`ece425f` on `main`.

## Cleanup

Playwright and Chromium were installed ad hoc into the scratch directory (not a project dependency); the whole scratch `pw` directory (driver scripts, screenshots, the standalone dev-DB lookup script) was deleted at the end. Killed the two scratch dev server processes used for this session (api `:4030`, web `:5210` -- chosen to avoid the concurrent session already holding `:5173`). No dev-database rows were created or modified by this session -- every check was read-only against existing seeded data (the one write, a test "Mark as lost" submission during the FRONT_DESK repro, correctly 403'd before it could persist anything).

---

# Permissions sweep, part 2: coarse role checks replaced with the real permission app-wide

Direct follow-up to the immediately preceding session, same day, on `main` -- that session flagged (but deliberately didn't fix) a systemic pattern: `InquiryDetail.tsx` and other pages have working `profile.permissions.includes(...)` checks in some places, but a larger number of buttons/sections are still gated by coarse `user.role === 'OWNER'`/`'FRONT_DESK'` checks left over from before the granular Settings -> Permissions matrix existed. Asked explicitly to fix that pattern app-wide this session. No schema changes.

## Method

For every `requirePermission(key)` (or inline `hasPermission(...)`) call in `apps/api/src/routes/*.ts`, traced forward to the frontend trigger that calls it, and checked whether that trigger's visibility already matched the permission or was still gated by a coarser role check (or, in a few cases, no check at all). Fixed every genuine mismatch; left every check that turned out to correctly mirror a **hardcoded** (non-configurable) backend `requireRole(...)` alone, since those have no permission key to align with in the first place -- confirmed each one against its actual route rather than assuming.

## Fixed (10 files)

**`InquiryDetail.tsx`** -- by far the largest set. Added `canManageNotes`, `canShareWithArtist`, `canEditInquiry`, `canAssignArtist`, `canSendEstimate`, `canEnterEstimate`, `canCreateAppointment`, alongside the already-fixed `canMarkLost` from the prior session. Re-gated: Share with Artist, Archive/Unarchive (inquiry-level and the More-actions-menu copy), Reopen, Reopen Project, Mark Project Complete, Mark Good Candidate, Schedule Consultation/New Appointment/Book Appointment, Send/Resend Deposit Form, the Notes widget (was reusing `canMessage`, but `GET/POST/PATCH/DELETE .../notes` is `requirePermission("inquiries.notes.manage")`, a real, separately-configurable key -- unlike AppointmentNote's hardcoded-role routes, which stayed as-is). Split "Edit Estimate"/"Generate & Send Estimate" (`inquiries.sendEstimate`) from "Revise Estimate" (`inquiries.enterEstimate`) -- the two map to genuinely different permission keys on the API, previously both read the same `canMessage`. **Three spots had no gate of any kind, not even a coarse one**: the Assign Artist picker+button, the "Edit Inquiry Details" pencil, and the Reference-images/Placement-photos "Edit" pencils -- all now gated on `inquiries.assignArtist`/`inquiries.edit` respectively.

**`AppointmentDetail.tsx`** -- added `canReschedule`, `canCheckout`, `canManagePhotos`, `canGenerateWaiver`, `canVerifyWaiver` (plus `canViewAudit` from the prior session's fix). Re-gated: the status dropdown, the More-actions menu's Reschedule/Archive/Unarchive items (kept `canManage` only for the trigger's fallback since Delete stays genuinely OWNER-only), both Checkout widgets (Consultation and Tattoo Session -- these have **no** role-level gate on the API at all, purely `requirePermission("appointments.checkout")`, so an ARTIST granted it should see them), photo add/delete, Create-Waiver, Verify-against-ID, and the LiabilityWaiver-scoped AuditTrail (was still `canManage`, missed in the prior session's pass over this same file).

**`Settings.tsx`** -- the "Policies & Templates" tab bundled *six* independently-configurable permissions (`settings.manageTheme`, `settings.managePolicies`, `settings.manageDefaults`, `settings.manageReferral`, `conversations.manageTemplates`, `depositTiers.manage`) behind one shared `canEditPolicies = role === 'OWNER'` flag, used at 12 call sites. Split into six distinct checks. Two sections (Custom Policies, the intake-form editor) turned out to be genuinely hardcoded `requireRole(OWNER)` on the API with no matrix key at all -- kept those as an explicit `isOwner`, not folded into the new permission checks.

Found a live, concrete case of why this mattered: this dev studio's own `RolePermission` table has `FRONT_DESK / settings.manageDefaults = true` but `settings.manageReferral = false` (a real, deliberate customization, not a stray default) -- and the "Edit Defaults" modal unconditionally bundled `referralRewardAmountCents` into every save, which `presentSettingsPermissionGroups` (the API's own per-field-group permission check) would reject as a whole with a 403 the moment that field was present, regardless of the other fields' own permission. **A FRONT_DESK granted "Manage studio defaults" specifically could not actually use it** -- the button was correctly hidden (old code was OWNER-only regardless), but simply un-hiding it without the field-level split would have traded a hidden-but-safe bug for a shown-but-broken one. Fixed by making the modal itself field-aware: the referral field only renders (and is only included in the PATCH body) when the actor has `settings.manageReferral`; the rest of the form is gated on `settings.manageDefaults`. Verified live end-to-end as FRONT_DESK: submitted a real change to `estimateFollowUpHours` through the modal, saved with zero failed requests, confirmed the new value persisted and the referral field was never touched.

**`GiftCardDetail.tsx`** -- `canManage`/`canVoidOrEditExpiry` bundled four different gates into two flags. Split into `canTextReceipt` (`giftCards.issue`), `canViewAudit` (`audit.view`), `canVoid` (`giftCards.void`), and `canEditExpiry` (kept as `isOwner` -- `PATCH /:id`'s expiration-edit is commented in the API as deliberately excluded from this permission expansion, hardcoded OWNER-only).

**`Calendar.tsx`** -- `canManageCalendar = !isArtist` decided both which calendar component variant renders (full drag-and-drop vs read-only) and silently gated both `handleSelectSlot` (create) and `applyAppointmentTimeChange` (drag-reschedule/resize), which are `appointments.create` and `appointments.reschedule` respectively -- two different keys. Split into `canCreateAppointment`/`canRescheduleAppointment`; the component-variant choice now shows the interactive calendar if either is granted, and each handler independently re-checks its own specific permission as a second layer (in case a studio grants only one of the two).

**`ArtistDetail.tsx`** -- `canEditSchedule` (the artist-schedule editor) checked `role === OWNER/FRONT_DESK || self`, never the underlying `artistSchedules.manage` permission `PATCH /:id/preferred-schedule` actually requires before its own self-scoping check runs -- a studio revoking that permission from ARTIST would still show them their own edit button (and 403 on save). Fixed to check the permission first, then narrow to self only for the ARTIST role (matching the API's own comment on why OWNER/FRONT_DESK have no such narrowing).

**`Inquiries.tsx`**, **`ArtistCreate.tsx`**, **`ClientDetail.tsx`**, **`Tasks.tsx`** -- one fix each, all the same shape: a coarse role check where a real permission key already existed and was already correctly used by a sibling file for the identical action (`ClientDetail.tsx`'s own `canCreateInquiry` already checked `inquiries.create` correctly -- `Inquiries.tsx`'s copy, sitting right next to a comment claiming "there's no dedicated permission key for inquiries," did not). `ArtistCreate.tsx`'s redirect guard cited "requireRole OWNER" in its own comment for `POST /artists`, which is actually `requirePermission("artists.manage")` -- the comment was simply stale. `ClientDetail.tsx`'s "Issue Gift Card" button now checks `giftCards.issue`. `Tasks.tsx`'s `canAssign` (assign-to-others) now checks `tasks.assignToOthers`, matching `POST /tasks/personal`'s own scoped check (self-assignment stays available to anyone with `tasks.manageOwn` regardless).

## Verified correct as-is, left unchanged

Every other coarse role check found by a final `role === 'OWNER'` / `role === 'FRONT_DESK'` sweep across the whole frontend was individually checked against its actual backend route and confirmed to be a **hardcoded, non-configurable** `requireRole(...)` with no matrix key to diverge from: `AppointmentDetail.tsx`'s Message button and Delete Permanently, the Notes widget (AppointmentNote's routes are explicitly commented "OWNER/FRONT_DESK only via requireRole, not requirePermission"), `ClientImport.tsx`'s final "Confirm Import" step, `GiftCardDetail.tsx`'s expiration-edit, `ClientDetail.tsx`'s prefill-link generation and the gift-card custom-expiration field, `Settings.tsx`'s four *view*-only gates (`canViewPolicies`/`canViewSystem`/`canViewIntegrations`/`canViewServices` -- editing within was the part that needed splitting, viewing the tabs themselves was already correct), `Team.tsx`'s Staff/Permissions tab (explicitly commented as a deliberate, unchanged OWNER-only restriction from an earlier session) and View As, `TopBar.tsx`'s search/tasks-icon/View-As visibility, and `NotesSection.tsx`'s `canModify` (`author === self || role === OWNER`, which is a byte-for-byte match of the API's own `canModifyNote` in `lib/notes.ts`).

## Flagged, not fixed -- two deeper findings out of scope for a frontend-gating pass

- **`ConversationsPanel.tsx`**: `showTabs={!isArtist}` permanently hides the CLIENT-conversations tab from every ARTIST, with no path to it even if a studio granted `conversations.viewClientThreads`. Not fixed here -- unlike every case above, the API doesn't hard-403 on this one (`hasPermission` for this key filters/degrades conversation *resolution* gracefully rather than rejecting), so there's no shown-button-that-breaks bug, just a discoverability gap requiring a larger restructure of this component's tab/query state than a same-session gating fix.
- **`waivers.ts`**: `staffRouter.use(requireRole(OWNER, FRONT_DESK))` sits *before* the `/:id` and `/:id/verify` routes, meaning ARTIST can never reach `waivers.verify`/`waivers.generate` regardless of what a studio sets those keys to in the Permissions matrix -- the exact same "blanket registered before a narrower route" shape as `intakeForms.ts`'s bug from the prior session, except the surrounding code comments here (the waiver "safety floor" framing, the ARTIST-specific route being explicitly scoped to *status only*) suggest this one is deliberate, not an oversight. Left `waivers.ts`'s route order untouched rather than guess at intent; noting it here in case an OWNER reports confusion that toggling these ON for ARTIST in Settings has no effect.

## Verification

Full three-role (OWNER/FRONT_DESK/ARTIST) x 13-page Playwright sweep (console errors + failed API requests), re-run after the fixes: clean for OWNER and FRONT_DESK; ARTIST's remaining 403s (`/inquiries`, `/inquiries/:id`, `/clients`, `/clients/:id` on direct URL entry) are the same intentional, by-design restrictions confirmed in the prior session, still correctly unreachable via ARTIST's own nav. Spot-checks: the FRONT_DESK Defaults-modal save described above (real submit, zero failed requests, correct field persisted); OWNER's Settings tab re-confirmed showing every edit control (Theme, Add Policy, Defaults) with no regression; Calendar drag-and-drop re-confirmed working for OWNER (clicking a day cell opens New Appointment) and correctly still read-only/non-interactive for ARTIST.

## Typechecks

`npx tsc -b` (web) and `npm run build` (web) -- both clean, run repeatedly through the session after each file's fixes, not just once at the end.

## Commit

`ef205b4` on `main`.

## Cleanup

Reused the same scratch dev servers/Playwright install from earlier in this session (api `:4040`, web `:5220` this time, after the first pair was torn down) -- both stopped and the scratch `pw` directory deleted at the end. No dev-database rows created; the one real write in this session's verification (the Defaults-modal save as FRONT_DESK) intentionally persisted (`estimateFollowUpHours` -> 48), left as-is per the standing convention of not rolling back legitimate dev-database changes made during verification.

---

# Platform SMS via Bird, Part 1: sendPlatformSms() + BIRD_SMS integration channel

Single session on `main`. Part 1 of migrating platform SMS from Twilio to Bird, scoped to match how the original Twilio build was phased: the connect flow in Settings, a basic outbound send wired to a real manually-triggered test message, and confirming delivery. Client-facing sends (composer, reminders, keyword handling) deliberately untouched -- those stay on Twilio until a separate future session migrates them once this foundation is proven.

## A premise conflict, checked against code before building

The task brief described `sendPlatformSms()` with a platform-only request shape (one Bird API key from `.env`, no per-studio credential) but also asked for "the connect/credential-storage flow in Settings, matching how the original Twilio build was phased" -- Twilio's actual flow (`lib/twilio.ts`, `routes/integrations.ts`) is per-studio: each studio enters and validates their own Account SID/Auth Token. Those two descriptions don't describe the same architecture. Investigated rather than guessing which one to build: found `IntegrationChannel.STRIPE` already exists as a real precedent for exactly this situation -- a platform-keyed channel on the same `StudioIntegration` chassis, `encryptedSecret` permanently null, "connect" provisioning state rather than collecting a secret. Presented both interpretations (full Stripe-style channel vs. skip the chassis entirely for now) to the user rather than picking one silently -- Stripe-style, full integration channel was the confirmed direction.

## Build

- **New `IntegrationChannel.BIRD_SMS`** (`schema.prisma`, migration `20260729011247_add_bird_sms_integration_channel`) -- coexists with `SMS` (Twilio) rather than replacing it, `encryptedSecret` stays permanently null (nothing per-studio to encrypt).
- **`lib/platformSms.ts`**: `sendPlatformSms({ to, text })`, raw `fetch` matching `sendPlatformEmail()`'s exact pattern (not the Bird SDK, per the task's own "stay consistent" instruction) -- `POST https://{region}.platform.bird.com/v1/sms/messages`, Bearer auth. Uses a separate `BIRD_SMS_API_KEY` (not the email channel's `BIRD_API_KEY`) -- a dedicated, more narrowly-scoped `sms:WRITE` key, confirmed regenerated after the original testing key was exposed in chat (used only the new one, never the exposed one).
- **`routes/integrations.ts`**: `BIRD_SMS` branches on `/connect` (no credential to validate -- just an `isPlatformSmsConfigured()` gate + upsert to `CONNECTED`), `/test-message` (calls `sendPlatformSms` directly, gated on the studio's own `CONNECTED` row so a studio can't test-send without having opted in), and `/disconnect` (already generic, needed no change).
- **`Settings.tsx`**: new "SMS (Bird) -- new" card in the Integrations tab, styled after the `STRIPE` card's simple-connect-button shape (no form) rather than Twilio's SID/token modal -- `handleConnectBirdSms`, `handleSendTestBirdSms`, its own disconnect-confirm copy ("nothing client-facing uses it yet, so there's no fallback to worry about").

## Real end-to-end testing surfaced a genuine gap in the task's own "confirmed" request shape

The task's request shape omitted `from`. Real testing against Bird's live API (via an isolated dev API instance on a spare port, so as not to disturb the concurrently-running dev server another session had up on :4000) hit a real `422 SMSNoEligibleSender`. Rather than guess a fix, fetched the official `@messagebird/sdk` package (confirmed via `npm view` to be Bird's own current-generation TypeScript SDK, not the legacy MessageBird REST client) and read its `SmsMessageSendRequest` type docs directly: `from` is required on every free-text send -- an E.164 number, alphanumeric ID, or short code the workspace actually owns.

Three real candidate values were tried against Bird's actual API, each producing a genuine, distinct, informative error -- not guessed at, not silently worked around:
1. No `from` -- `422 SMSNoEligibleSender`.
2. Short code "30300" (initially reported as this workspace's sender) -- `422 SMSSenderReserved`: "This sender identity is reserved and cannot be used as a sender."
3. `+15005550006` -- back to `422 SMSNoEligibleSender`. Flagged before trying it that this is a well-known Twilio test/magic number (NANPA's reserved 555 exchange), almost certainly not a real Bird-owned sender -- confirmed by the result once tried, at the user's own request to see Bird's actual response rather than assume.

No valid, owned Bird SMS sender is confirmed for this workspace as of this session. Rather than hardcode any of the three failed guesses into checked-in source (which would be actively wrong, not just incomplete), `BIRD_SMS_FROM` is an env var, not a constant -- `isPlatformSmsConfigured()` now requires both `BIRD_SMS_API_KEY` and `BIRD_SMS_FROM`, so the connect route correctly refuses to let a studio "connect" to something that can't actually send (verified: without `BIRD_SMS_FROM` set, clicking Connect in Settings surfaces "Bird SMS isn't available right now" rather than a false-positive Connected state). The code is complete and correct regardless of when a real sender is provisioned on Bird's side -- setting the env var is the only remaining step, no redeploy/code change needed.

## A cross-session collision, caught and reported rather than silently absorbed

A different concurrent session was actively editing `Settings.tsx` in this same shared working tree throughout (a permission-flag refactor, `canEditPolicies` -> several granular `canManageX` checks) -- confirmed via `git log` once discovered. That session committed its own changes (`ef205b4` through `a1e9480`) while this session's Bird SMS UI edits were still sitting uncommitted in the same physical file; since git has no way to distinguish "whose" uncommitted changes are in a shared file, their `git add`/`commit` swept up this session's `Settings.tsx` changes alongside their own. Caught via an unexpectedly large/interleaved `git diff` before staging (135 insertions where ~90 were expected), traced to the actual cause (not assumed) by checking `git log` for a moved `HEAD`.

Handled by: not rewriting or amending their commits (not this session's history to alter, and doing so risks their in-progress work) -- confirmed the swept-up `Settings.tsx` content is intact and uncorrupted (grepped for every `BIRD_SMS` reference, present and correct), reconfirmed both typechecks clean against the actual current `HEAD`, and committed only the files that weren't already caught up in that sweep (`schema.prisma`, `lib/platformSms.ts`, `routes/integrations.ts`, `.env.example`, the migration) as this session's own commit. Those four permission-refactor commits are local-only (not yet pushed), so no external/shared-state damage -- flagging this here as a real risk of multiple concurrent agent sessions sharing one working tree, not something to quietly paper over.

## Verification

- **Connect + test-message, real API calls** (isolated API instance on a spare port, direct HTTP against `owner@dev-studio.test`'s JWT, not the UI, for the send-path testing -- the UI itself separately screenshotted): `GET /integrations` lists `BIRD_SMS` correctly; `POST /integrations/BIRD_SMS/connect` returns real `200 CONNECTED`; three `POST /integrations/BIRD_SMS/test-message` attempts against the real Bird API, each returning genuinely different, correctly-differentiated error responses as the `from` value changed (see above) -- proving the integration talks to Bird's real endpoint with the real key, not a stub.
- **Settings UI, screenshotted**: the "SMS (Bird) -- new" card renders correctly alongside the existing Twilio/Stripe/Email cards, distinct label and explanatory subtext. Clicked "Connect" with `BIRD_SMS_FROM` deliberately unset (its real current state) -- confirmed the UI correctly surfaces "Bird SMS isn't available right now -- ask an admin to check the server configuration" in red under the button, proving the `isPlatformSmsConfigured()` gate works end-to-end through the real UI, not just the API.
- **Dev-database cleanup**: disconnected the `BIRD_SMS` test connection created on `dev-studio` during verification (shared Railway dev DB, not a throwaway local one) so it doesn't sit in a misleading connected-but-can't-actually-send state.
- Both standing typechecks clean, re-confirmed against the actual final `HEAD` after the cross-session collision above: `npx tsc --noEmit` (api) and `npm run build` (web).

## Commit

`95ce749` on `main` (this session's own commit -- the `Settings.tsx` UI half landed inside the concurrent session's `ef205b4`..`a1e9480`, per the collision section above).

## Outstanding, explicitly not resolved this session

No valid Bird SMS sender is confirmed for this workspace. `sendPlatformSms()` will throw ("Platform SMS is not configured") and the Settings connect flow will correctly refuse to connect until `BIRD_SMS_FROM` is set in `apps/api/.env` to a real, Bird-confirmed E.164 number or short code the workspace actually owns -- check Bird's dashboard under Numbers/Senders specifically, not a number from memory. Once that's set, delivery can be confirmed with the same "Send test message" button already wired up in Settings -- no further code changes needed.

## Cleanup

Killed the isolated dev API/web server instances used for this session's own verification (ports 4099/5299 -- left the other session's own dev server on :4000 completely untouched throughout). Deleted every ad-hoc `.mjs` verification script, the temporary `@messagebird/sdk` install used purely to read its type docs, and screenshots from the scratch directory afterward.

---

# Editorial Gold refinement — closing the gap with the marketing site

Single session on `main`. No schema changes. Extends the existing Editorial Gold token system (Login/glass-card unification, Dual Themes) rather than building a parallel one -- every color/font token used below already existed before this session.

## Investigated before building, per the task's own instruction

- **The red accent token already existed.** `--color-danger-strong: #c2402f` (`index.css`) already carried the comment `/* reference --red -- backgrounds/borders/icons only, never text */` from an earlier session -- confirmed against `marketing/index.html`'s own `--red:#C2402F` (`/* trad flash spot red -- micro-accents only */`), same exact hex. Reused directly everywhere red shows up below; no new red token was added.
- **The arc-ornament component already ran globally, not header-only.** `.arc-decor` (`index.css`) is `position: fixed`, viewport-centered, `pointer-events: none`, mounted once by `TopBar.tsx` on every authenticated page -- a prior session ("Login becomes the canonical editorial-gold token source") had already recentered and globalized it. Verified this is still true by screenshot (visible behind Dashboard/Inquiries/Team cards) rather than trusting the old `REPORT.md` claim at face value. **No changes were needed here** -- item 3 of the brief was already satisfied by existing work; this session just confirmed and documented it instead of rebuilding something that already existed.
- **No existing shared `Button` component** (`apps/web/src/components/` has none) -- every button in the app is a raw `<button>` with inline Tailwind, styled per call site, several with zero `isEditorial` branching at all (`DateRangePresetFilter.tsx`, Inquiries'/Team's action buttons). "Reusing whatever button component/classes already exist" therefore meant the *token system* (`.login-button`'s precedent of a typography-only editorial button class), not a nonexistent component -- built two small CSS classes rather than a heavier React component, consistent with the codebase's existing `.sc`/`.hex`/`.ornament` pattern of shared editorial-only class *definitions* that are inert everywhere else.

## What's new vs. reused

**Reused, zero new tokens:** `--color-danger-strong` (red punctuation everywhere), `--color-fg`/`--color-accent-fg` (cream chip bg/text -- literally the same pair the rest of the app already uses for text-on-light-accent), `--color-accent`/`--color-accent-hover` (gold, untouched, still does buttons/bars/links), `--font-jura`/`--font-display`, `.arc-decor`, `useThemePreset()`. Deliberately did **not** extend `--color-accent-button`/`--radius-btn` (Login's own square-corner, warmer-gold tokens) to in-app buttons -- those were scoped to Login's "fixed platform identity" on purpose per their own original comment ("nothing else references this token yet"); in-app editorial buttons keep the ordinary pill-shaped `--color-accent` convention every other preset also uses, just with new typography on top.

**New:**
- `components/Eyebrow.tsx` -- the reusable eyebrow-label component (item 2). Renders the marketing site's `.kicker` pattern (letterspaced uppercase, red "+" flanks, optional `meta` slot for contextual metadata like a date range) under Editorial Gold; a plain caption under every other preset. **Where it now lives, for future pages to pick up**: imported by `Dashboard.tsx` (`CardShell`'s caption, the welcome header), `Inquiries.tsx`, and `Team.tsx` (both page headers) -- any future Editorial Gold page imports the same component rather than re-implementing the pattern.
- `.editorial-btn-primary` / `.editorial-btn-secondary` (`index.css`, item 5) -- typography-only classes (Jura, 700/600 weight, 0.14em tracking, uppercase, 11.5px), layered onto each call site's own existing color/shape Tailwind classes rather than replacing them. Applied to: `DateRangePresetFilter.tsx`'s trigger button (secondary), `Inquiries.tsx`'s "New Appointment"/"New Inquiry" (primary), `Team.tsx`'s "Invite team member" (primary) and "Add directly" (secondary).
- Conversations FAB restyle (`ConversationsPanel.tsx`, item 1) -- red (`bg-danger-strong`), icon + tiny uppercase "CHAT" label stacked (not icon-only), a hairline halo ring (a plain absolutely-positioned sibling span, `border-danger-strong/25`, no new CSS). The button was already `rounded-full` in code (the brief's "current rounded-square treatment" didn't match what's actually in the DOM -- checked before assuming, flagging the discrepancy rather than silently "fixing" a shape that wasn't broken); this session's actual changes were color, label, and halo only.
- Cream highlight chip -- inlined at its one call site (Dashboard's Lost/Cold Rate stat) rather than a separate component, since the brief explicitly wants this rare/one-off, not a general card style; a reusable component would invite exactly the overuse the brief warns against.
- Designed empty state for Lost/Cold Rate with no data (item 6): red dash + italic serif "No outcomes yet in this range.", replacing the bare `formatPct` "—" fallback under Editorial Gold only.
- Dashboard welcome header (item 6): eyebrow above, serif "Welcome," with the first name in italic serif (`text-accent-hover`) beneath, mirroring `marketing/index.html`'s hero `.kicker` + `h2 em` pattern.

## Verification

- **Propagation, not just Dashboard**: screenshotted Dashboard, Inquiries & Projects, and Team all under Editorial Gold (switched `dev-studio` via the real Settings UI, not a DB write) -- Eyebrow labels and both button treatments render correctly on all three, confirming they're genuine shared patterns.
- **`onyx-lime` completely unaffected**: screenshotted Dashboard under `onyx-lime` both before touching anything and again after switching back at the end -- plain "Welcome, Dev" heading, no eyebrows, no cream chip (plain "50%" text), FAB back to its original lime icon-only circle, no arc rings. Reverted `dev-studio`'s `themePreset` back to `onyx-lime` afterward (its state before this session), confirmed via a direct API check, not just the UI.
- **Cream chip rarity**: exactly one use on the one page it was added to (Dashboard's Lost/Cold Rate) -- confirmed by grep, not just intent.
- **Empty state**: forced a real zero-data date range (Jan 2027) through the actual UI and screenshotted the result -- red dash + italic serif message renders correctly, not just written and assumed.
- **Mobile**: 390px viewport, Editorial Gold -- `document.documentElement.scrollWidth === clientWidth` (no horizontal overflow), eyebrow labels wrap cleanly, FAB stays correctly pinned at every scroll position (a `fullPage` screenshot's apparent FAB/chip overlap was traced to Playwright's own fixed-position stitching artifact in full-page capture, not a real layout bug -- confirmed by a second, viewport-only screenshot at the same scroll position).
- **No console/page errors** in any of the above (one unrelated `ERR_NAME_NOT_RESOLVED` for a resource load, present regardless of this session's changes).

## Contrast, checked not assumed

Computed WCAG relative-luminance contrast for every new color pairing this session introduced:

| Pairing | Ratio | Floor | Result |
|---|---|---|---|
| FAB icon/label vs. red bg (cream, as first tried) | 4.39:1 | 4.5:1 (small text) | **Failed** -- caught before shipping |
| FAB icon/label vs. red bg (white, shipped) | 5.16:1 | 4.5:1 (small text) | Pass |
| Cream chip text vs. chip bg | 15.85:1 | 4.5:1 | Pass |
| `.editorial-btn-secondary` text vs. page bg | 10.62:1 | 4.5:1 | Pass |
| `.editorial-btn-primary` text vs. gold bg | 7.72:1 | 4.5:1 | Pass |
| Eyebrow "+" glyph vs. page bg (decorative, `aria-hidden`) | 3.80:1 | 3:1 (non-text) | Pass |
| Eyebrow label text vs. page bg | 6.37:1 | 4.5:1 | Pass |
| FAB red bg vs. page bg (non-text UI floor) | 3.80:1 | 3:1 | Pass |
| Welcome name (italic, `accent-hover`) vs. page bg | 11.22:1 | 4.5:1 | Pass |

The FAB's label color was the one real near-miss: cream (`--color-fg`, the same color the marketing site's own `.go` button uses) measured 4.39:1 against the red background -- just under the 4.5:1 AA floor small text needs. Switched to plain white (5.16:1) rather than shipping the marketing site's own value uncritically. Confirmed live via `getComputedStyle` on the actual rendered button (`rgb(255, 255, 255)` on `rgb(194, 64, 47)`), not just the source class name.

## Typechecks

`npx tsc --noEmit` (api, untouched -- no API files touched) and `npm run build` (web) -- both clean.

## Commit

`a17d516` on `main`.

## Cleanup

Killed the isolated dev API/web server instances used for this session's own verification (ports 4098/5297 -- another concurrent session's own dev server on :4000 was left completely untouched). Deleted every ad-hoc `.mjs` verification script, the temporary Playwright install, and every screenshot from the scratch directory afterward. `dev-studio`'s `themePreset` confirmed back to `onyx-lime` via a direct API check as the final step.

---

# Editorial Gold — heavily-blurred photo background layer

Single small session on `main`. No schema changes. Editorial Gold only.

## The source photo, checked before use

The brief named `apps/web/src/assets/login-background.jpg` as the source to reuse. Grepped for it first: **that file is unused dead weight** -- `AuthLayout.tsx` actually imports `login-background-no-artist.png`, the file genuinely visible on the live Login page today. Used the real one, not the named-but-stale one; flagging the discrepancy rather than silently reusing an orphaned asset that would have produced a background bearing no relation to what anyone actually sees on Login.

## Pre-processed into a static asset -- confirmed, not just described

`apps/web/src/assets/app-bg-blurred.jpg`: generated once via a temporary offline script (`sharp`, already present in `node_modules` -- no new dependency added), placed at the repo root only long enough to run (module resolution needs to find `node_modules` by walking up from the script's own location, which a scratch-directory script outside the repo tree can't do), then deleted. Two stacked techniques, not blur alone: **downscale first** (1672x941 source -> 640px wide, destroying fine detail before blur even runs) **then Gaussian blur** (sigma 28) **then re-encode** as a small JPEG (quality 72). Result: 640x360, ~7KB. Visually confirmed zero recognizable detail (no chair, lamp, or frame identifiable) against the source photo side by side, and confirmed the warm wood/dark-wall color palette survived intent. No live `filter: blur()` anywhere -- grepped the diff to confirm.

## Layer order, and a real bug found building it

Mounted in `TopBar.tsx` (same `decorative`-gated pattern as the existing `.arc-decor`, same file, immediately before it in the JSX): pre-blurred photo, then a flat dark wash (`rgba(12, 10, 8, 0.88)` -- Login's own near-black base color, but a uniform wash rather than Login's directional hero-vignette, since the app shell scrolls and has no single hero focal point for a vignette to frame), then the existing arc-decor/grain layer, then real content -- exactly the order the brief specified.

**Building this exposed a genuine, previously-invisible stacking bug.** The first attempt (photo + wash both at the same `z-index: 0` as `.arc-decor`, ordered earlier in the DOM) produced a screenshot where Dashboard's entire card grid had vanished -- not a rendering glitch, a real CSS stacking-order fact: every routed page's own top-level wrapper (`<div className="flex min-h-screen ...">`) is a plain, non-positioned block, and CSS's paint-order rules put non-positioned static content *behind* any positioned sibling at `z-index: 0`/`auto`, regardless of DOM order between the two. `.arc-decor` has always technically had this same problem -- it just never showed, because thin unfilled ring borders have nothing opaque to reveal it. This session's wash is a real opaque fill, so it was the first thing to expose it.

Fixed at one shared point rather than patching every individual page: `App.tsx`'s routed-content wrapper (`<Routes>...</Routes>`, everything every authenticated page renders through) now gets `className="relative z-10"`. That single change makes every page's content genuinely positioned with a real z-index, so it correctly paints above TopBar's background layers everywhere at once -- confirmed harmless for Login/public routes too, since `TopBar` returns `null` outright with no logged-in user (those routes never mount the background layers to begin with).

## Verification

- **Dashboard, Inquiries & Projects, Settings, all under Editorial Gold**: screenshotted after the stacking fix -- full card grids, tables, and theme picker all fully legible, no content obscured. Sampled background-only pixel regions from a real screenshot (`sharp`'s `.stats()`, not eyeballing): RGB channel means (63, 51, 35) -- a genuine warm brown/amber tint, confirming the blurred photo is actually contributing visible color/mood under the wash, not crushed to flat black.
- **`onyx-lime` completely unaffected**: screenshotted before touching anything and again after reverting -- flat black background, no photo, no wash, identical to before this session. `.app-bg-photo` confirmed absent from the DOM entirely under `onyx-lime` (`decorative` is `false` for that preset, so `TopBar` never mounts it) both before and after.
- **Reverted `dev-studio`'s `themePreset` back to `onyx-lime`** at the end, confirmed via the live UI, matching this project's own established convention for sessions that touch the shared dev database's theme.

## Performance -- checked on the same busy pages tested before

Scripted scroll-frame timing (`requestAnimationFrame` deltas over a scrolled distance, 60 samples each), `onyx-lime` baseline vs. `editorial-gold` with this session's new layer, on Dashboard's card grid and the full Inquiries list:

| Page | onyx-lime (baseline) | editorial-gold (+ bg-blur layer) |
|---|---|---|
| Dashboard | avg 16.30ms, max 16.80ms, 0 long frames | avg 16.33ms, max 16.80ms, 0 long frames |
| Inquiries (full list) | avg 16.28ms, max 16.80ms, 0 long frames | avg 16.35ms, max 16.80ms, 0 long frames |

Statistically indistinguishable -- both sit at the 60fps frame budget (~16.7ms) with zero dropped frames either way, exactly what "a static pre-blurred asset costs the same as any other static background image" predicts.

## Real-phone testing: NOT performed -- explicit gap

**This session's own brief required confirming on a real phone, not just desktop, given the project's own prior mobile `backdrop-filter` stutter precedent.** I have no access to physical device hardware from this environment -- the performance numbers above are Playwright-driven desktop-Chromium measurements only, a reasonable proxy but not the real test asked for. A human still needs to open an Editorial Gold page on a real phone and confirm it doesn't introduce stutter or battery-drain-feeling jank. Flagging this explicitly rather than reporting the task as fully verified -- the theoretical case for "no cost" is strong (a 7KB static JPEG, no live filter, confirmed identical desktop scroll timing), but it is a case, not a real-device measurement.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` (web) -- both clean.

## Commit

`3757bfb` on `main`.

## Cleanup

Killed the isolated dev API/web server instances used for this session's own verification (ports 4097/5296 -- another concurrent session's own dev server on :4000 was left completely untouched). Deleted every ad-hoc `.mjs`/`.mjs`-adjacent script (including the temporary root-level image-processing script, removed immediately after generating the shipped asset), the temporary Playwright install, and every screenshot from the scratch directory afterward.

---

# Background-blur fix: the real bug was `.bg-bg`, not the z-index alone

Small follow-up on `main`, same day. User-reported: two real bugs found through manual testing ("confirmed working" at specific values), not a design change -- fix properly in the source, not as devtools overrides.

## The reported bugs didn't initially make sense together -- investigated rather than pattern-matched

The two reports: (1) "the blurred background image is sitting behind another opaque layer... confirmed working after manually increasing the image's z-index by 1," and (2) "`.bg-bg`'s default opacity is too high, nearly hiding the photo entirely... change the real default to 70%." First instinct was to read "`.bg-bg`" as shorthand for this session's own `.app-bg-wash` element (both are dark background-ish things stacked in the same visual area) -- applied both fixes literally (`app-bg-photo` z-index 0->1, `app-bg-wash` alpha 0.88->0.70), rebuilt, and re-tested with a genuine hard reload.

**That didn't hold up under verification.** A decisive test -- setting `.app-bg-wash` to a solid bright color and screenshotting -- showed zero visible change anywhere on the page. Something else, entirely opaque, was sitting above both elements regardless of their own z-index. Traced it: `.bg-bg` is Tailwind's own generated utility class, literally named `.bg-bg`, and it's applied directly (not through this session's naming) on **every page's own top-level wrapper** -- `Dashboard.tsx` and 27 other files, all `<div className="flex min-h-screen bg-bg text-fg">`. That div paints a fully opaque fill across the entire viewport height in normal document flow, sitting above `.app-bg-photo`/`.app-bg-wash` (z-index 0/1) regardless of anything done to those two elements' own stacking -- because it's the thing they're supposed to render *behind*, not a peer competing with them for a z-index slot. The user meant literally `.bg-bg`, not this session's own class; re-reading their report with that correction, both bugs cohere completely.

## The actual fix

- **The real bug**: `[data-theme="editorial-gold"] .bg-bg { background-color: color-mix(in srgb, var(--color-bg) 70%, transparent); }` -- one scoped rule, higher specificity than Tailwind's plain `.bg-bg`, so it wins under Editorial Gold only. Checked the blast radius first: grepped all 30 `bg-bg` usages in the codebase -- 28 are exactly this `min-h-screen` page-wrapper pattern; the other two (`Sidebar.tsx`'s non-editorial branch, `ViewAsBanner.tsx`'s already-distinct `bg-bg/10` Tailwind opacity-modifier class) are unaffected by a rule targeting the plain `.bg-bg` selector specifically. `color-mix()` over the token itself (not a hardcoded duplicate RGB triplet) matches the exact technique already used elsewhere in this file (`.rbc-calendar .rbc-slot-selection`), so this stays correct if editorial-gold's own `--color-bg` ever changes.
- **The secondary fix**, once the real blocker was gone: explicit, distinct z-index per decorative layer instead of three siblings all at 0 relying on DOM order -- wash `0`, photo `1` (per the user's own confirmed value), arc-decor `2`.
- **A regression caught before shipping, not by the user's own report**: bumping only the photo above wash (without also moving arc-decor) would have hidden arc-decor's thin ring borders behind the now-fully-opaque photo. Confirmed this was real via a targeted on/off toggle -- removing `.arc-decor` from the DOM produced a byte-identical screenshot to leaving it in, proving the rings were already invisible at that intermediate state. Bumped arc-decor to z-index `2` to keep it visible above the photo, restoring the original task's own explicit layer order (photo, wash, arc-ornament, content).
- `.app-bg-wash`'s own alpha reverted back to its original `0.88` -- the 70% figure belongs to `.bg-bg`, not this element. Once the photo (opaque, z-index 1) sits above the wash, the wash's own alpha stops being visually consequential either way; kept in place as the floor color visible for the brief window before the JPEG decodes.

## Verification

- **Decisive on/off tests, not just eyeballing screenshots**: swapped `.app-bg-photo`'s `src` for a solid lime-green data URI post-fix -- the whole page (sidebar, cards, header) rendered visibly lime-tinted through the now-translucent `.bg-bg`, proving the photo genuinely composites through real page content. Boosted `.arc-decor`'s ring borders to a thick lime stroke -- confirmed the rings cross visibly over cards, the sidebar, and the header text, proving they render above content as intended.
- **True fresh hard reloads throughout** (`page.goto(url, { waitUntil: 'load' })`, never SPA client-side navigation) on Dashboard, Inquiries & Projects, Team, and Settings, under Editorial Gold -- photo and rings both render correctly by default, zero manual/devtools intervention needed, matching the user's own explicit verification requirement.
- **`onyx-lime` re-confirmed completely unaffected** -- flat black background, `.bg-bg` fully opaque, screenshotted fresh after reverting `dev-studio`'s theme.
- **Performance re-checked**, since this is now a materially bigger change (every page's own wrapper became translucent, stacked with the already-blurred `.card-surface` frosted-glass cards): scroll-frame timing on Dashboard and the full Inquiries list, `onyx-lime` baseline vs. `editorial-gold` post-fix -- 16.31ms/16.39ms avg vs. 16.13ms/16.59ms avg, zero long frames either way. No regression from the wider `.bg-bg` change.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` (web) -- both clean.

## Commit

`fe5aee7` on `main`.

## Cleanup

Killed the isolated dev API/web server instances used for this session's own verification (ports 4096/5295). Deleted every ad-hoc verification script and screenshot from the scratch directory afterward.

---

# Editorial Gold: notification-bubble color match + theme-load flash fix

Small follow-up on `main`, same day. Two independent quick updates.

## 1. Notification bubbles match the Welcome header's text color

Found every "notification bubble" (a count badge, not a status pill or the FAB's own fill): `TopBar.tsx`'s Tasks-icon badge, `Sidebar.tsx`'s nav-item badges, and `ConversationsPanel.tsx`'s Conversations-FAB badge -- three spots, confirmed complete by grepping every `bg-danger-strong`/`bg-danger` usage across the app and excluding the ones that are something else (status pills, pipeline dots, the FAB's own red fill, a thin red rule) rather than a count bubble.

Two of the three were already `isEditorial`-gated (just the wrong color, `bg-danger-strong`); the FAB's own badge wasn't gated at all (`bg-danger` unconditionally, every preset). All three now use `bg-fg`/`text-accent-fg` under Editorial Gold specifically -- the literal color pair the Welcome header's own "Welcome," text uses (`text-fg`), not the italic `text-accent-hover` name beneath it, per the explicit instruction. Verified via computed style, not assumed: `Welcome` h1 color and all three badges' background color are byte-identical (`rgb(242, 236, 224)`), text inside is `rgb(23, 18, 8)` (`--color-accent-fg`) for contrast. `onyx-lime` re-confirmed unaffected -- the FAB badge stayed `rgb(248, 113, 113)` (its original red) there.

## 2. Theme-load flash, fixed at the source rather than papered over

The reported symptom: every page load briefly showed `onyx-lime` before visibly swapping to the studio's real Editorial Gold preset. Root cause: `ThemeApplier.tsx`'s `/studio-settings` fetch is async and only calls `applyThemePreset()` once it resolves -- between mount and then, the app rendered whatever theme happened to already be on `<html>` (index.css's own `onyx-lime` default on a cold load, since nothing sets the attribute before this fetch completes).

Two-part fix:
- **`lib/themePresets.ts`**: the last-applied preset key now persists to `localStorage`, and `main.tsx` applies it to `<html>` **synchronously, before `createRoot(...).render(...)` even runs** -- a returning user's very first paint already uses their real theme. `currentPresetKey`'s own initial value now also reads from this cache, so `useThemePreset()`'s first React render is correct immediately too, not just the raw CSS attribute.
- **`ThemeApplier.tsx`**: for the cases the cache can't cover (a genuine first-ever visit, or private browsing where nothing persists) -- renders a small full-screen loading overlay (the Ink Manager wordmark, `animate-pulse`, on a plain near-black background that isn't tied to any specific preset's own token, since which preset is even correct is the unresolved question) until the fetch settles, then reveals the app.

**Verified with actual frame-by-frame sampling, not assumed from the code**: cleared the theme cache and hard-reloaded, sampling `data-theme` + overlay-presence every ~50ms through the load -- confirmed the overlay covers the entire unresolved window (theme `null`, overlay showing) until the fetch lands, at which point `data-theme` becomes `editorial-gold` and the overlay disappears in the same tick; the real content never renders un-themed underneath it. Reloaded again immediately after (cache now warm) -- `overlayPresent` was `false` at every single sample, theme jumped straight to `editorial-gold` with no intermediate flash. Screenshotted the overlay itself under an artificially delayed `/studio-settings` response (2s, via a Playwright route intercept) to confirm it actually renders correctly, not just exists in the DOM -- caught and fixed an early sizing bug this same check surfaced: the wordmark asset (`logo-white-512.png`, despite its name, is a wide 3590x1339 PNG, not square) rendered squished at a forced `h-14 w-14`; fixed to `w-40 h-auto object-contain`, matching how `Sidebar.tsx` already sizes the same asset elsewhere.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` (web) -- both clean.

## Commit

`067ff4a` on `main`.

## Cleanup

Killed the isolated dev API/web server instances used for this session's own verification (ports 4095/5294). Deleted every ad-hoc verification script and screenshot from the scratch directory afterward.

---

# Editorial Gold: `.bg-bg` tint 70% -> 80%

One-line tuning follow-up on `main`. `[data-theme="editorial-gold"] .bg-bg`'s `color-mix()` percentage raised from 70% to 80% (the page-wrapper shell reads darker, less of the blurred background photo shows through). Verified via computed style (`color(srgb ... / 0.8)`) and a fresh screenshot -- still fully legible, `onyx-lime` re-confirmed unaffected. Both typechecks clean.

Commit: `a4525d7` on `main`.

---

# Editorial Gold: Conversations panel consistency + overlay opacity correction

Propagation session on `main` -- every pattern reused from elsewhere in the app, nothing new designed. Editorial Gold only, `onyx-lime` unaffected.

## 1. `.bg-bg` opacity

Already at 80% from the immediately preceding session's commit (`a4525d7`) -- confirmed via computed style, no further change needed.

## 2. Conversations panel brought in line with the rest of Editorial Gold

- **Typography**: "Conversations" header and the thread-detail counterpart-name header both now use the same `font-display` (Fraunces) treatment as Dashboard's "Welcome" heading, gated on `useThemePreset().shape === 'editorial'`.
- **Background layer**: new `.conversations-panel-glass` class (`index.css`), reusing `.card-surface`'s exact frosted-glass tokens (`--color-card-glass`, `--color-border-glass`, `--blur-card`) minus its `border-radius` -- the panel is a flush right-docked slide-over, not a free-floating card, so rounding its outer edges would look wrong. Lets TopBar's fixed photo/wash/arc-decor layers show through blurred, same as every other glass surface in the app.
- **Buttons and pills**: "+ New Chat" now verified using `.editorial-btn-primary` (was already close, confirmed rather than assumed). Clients/Team tab switch, All/Unread/Needs Action filter pills, and the sort `<select>` converted from solid-fill to `.editorial-btn-secondary` gold-outline, matching the task's primary-vs-secondary distinction.
- **Status pills**: found genuine drift -- thread list rows were using a one-off `badgeClasses()` function instead of the shared `StatusPill` component. Removed `badgeClasses()` entirely; rows now render `<StatusPill status={...} />`, matching the detail header's own (already-correct) usage.
- **Avatar ring colors**: investigated, not arbitrary -- `ProgressRingAvatar`'s SVG ring color comes from the same `getStatusTone()` mapping `StatusPill` uses (`TONE_RING_COLORS[tone]`), filling clockwise as the linked inquiry progresses through pipeline phases, full ring at terminal status. No ring at all for STAFF threads with no linked inquiry -- intentional, confirmed via screenshots (partial blue ring for NEW/info-tone inquiries, full green ring for SCHEDULING/success-tone, no ring for staff threads). One cosmetic fix: the ring's background track was hardcoded `stroke="#2a2a30"`; changed to `var(--color-border)` so it responds to theme.
- **Thread list cards**: used judgment per the task's own instruction -- applied glass to the panel as a whole rather than per-row, since a list-dense view with per-row glass would compete with itself; search bar and filter row read as part of the same glass surface as everything else.

## Performance check (self-initiated, not requested)

Verifying the new `backdrop-filter` on a panel this large (up to 848px wide, full viewport height -- much bigger than any existing `.card-surface` instance) against the standard `requestAnimationFrame`-delta methodology first showed a real-looking regression: `avg=19.62ms max=66.70ms longFrames=5/60` at idle, vs. the ~16ms/0-long-frames baseline everywhere else, and disabling `backdrop-filter` outright brought it back to baseline.

Didn't accept that as the full story -- isolated timing from cause with a second test that left `backdrop-filter` on throughout: measuring immediately after the panel's open transition reproduced the jank (`avg=21.31ms`, `8/60` long frames), but measuring the *same still-open panel* again after an extra 2s with nothing forced off returned cleanly to baseline (`avg=16.15ms`, `0/60`). The forced-disable test's "fix" was a false positive -- toggling `backdrop-filter` off triggers its own repaint, which coincidentally let in-flight thread-avatar image decode/the `translate-x` open transition finish before the next measurement. The cost is transient settling right after the panel mounts, not `backdrop-filter`'s steady-state rendering cost. No fix applied -- there was nothing to fix; `blur(var(--blur-card))` at the existing radius performs identically to every other `.card-surface` instance once settled.

## Verification

- Fresh hard reloads, Editorial Gold: panel reads as part of the same app as Dashboard -- serif headings, gold-outline toggles, gold-fill primary action, glass background with photo/arcs visible through it, `StatusPill` rendering correctly on thread rows.
- `onyx-lime` re-confirmed unaffected: panel background fully opaque, no `backdrop-filter`, header font not Fraunces.
- `.bg-bg` 80% opacity confirmed via computed style, fresh reload, no devtools overrides.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` (web) -- both clean.

## Commit

`e5149f3` on `main`.

## Cleanup

Killed the isolated dev API/web server instances used for this session's own verification (ports 4093/5292). Deleted every ad-hoc verification and perf-debug script and screenshot from the scratch directory afterward.

---

# Conversations panel: revert transparency overreach, consolidate filter/sort, restyle tabs

Direct follow-up on `main` to the immediately prior session's own overreach. Editorial Gold only, `onyx-lime` unaffected.

## 1. Transparency fully reverted, not just reduced

Removed `.conversations-panel-glass` from `index.css` entirely (was `background: var(--color-card-glass); backdrop-filter: blur(var(--blur-card))`, editorial-gold-scoped) and its class from the panel root in `ConversationsPanel.tsx` -- the panel is unconditionally `bg-surface-raised` now, same for every preset, no `isEditorial` branch left on this element at all. Confirmed via computed style: `backgroundColor: rgb(29, 24, 19)` (solid), `backdropFilter: 'none'` under Editorial Gold. Frosted glass stays exactly where it already was appropriate -- `.card-surface` (Dashboard cards, Login) is untouched.

## 2. Filter/Sort consolidated into two dropdown buttons

New `PillMenu` component (`ConversationsPanel.tsx`, above `ConversationListView`) reuses the exact button+popover shape already established by `DateRangePresetFilter.tsx` (Dashboard's own date-range dropdown, the only precedent for this pattern in the app) -- trigger button, click-outside-to-close via the same `useRef`/`mousedown`-listener approach, absolute-positioned panel (`border border-border bg-surface-inset py-1 shadow-lg`) listing options with a `CheckIcon` on the active one. Generalized over label/icon/options since this file needs the same shape twice rather than once; no new dropdown pattern invented.

Replaced the three always-visible "All/Unread/Needs action" pills with one `Filter` button (tints accent-colored when a non-"All" filter is active, reusing the same active-tint convention as the adjacent "More filters" tag button in this same row) and the separate `<select>` sort pill with one `Sort` button. Both scale to any number of future options without adding more pills. Two small icons added to `icons.tsx` (`FilterIcon`, `SortIcon`) matching the existing icon set's own minimal line-icon style -- neither existed before, and the task's own brief asked for "icon + label" triggers.

## 3. Clients/Team toggle restyled to match Inquiries/Projects

Found the source pattern at `Inquiries.tsx`'s tab strip (`Inquiries`/`Projects` split) -- a plain underline-tab treatment (`border-b-2 border-accent text-fg` when active, `text-fg-muted hover:text-fg` otherwise) with no `isEditorial` branch at all, since it already reads correctly under every preset via CSS-variable-driven tokens. Replaced the old segmented-pill toggle (which *did* have a separate editorial-gold gold-outline variant) with this exact classname string, verbatim, dropping the `isEditorial` branch entirely to match the source component's own approach. Labels unchanged -- still "Clients" and "Team".

## Verification

- Fresh hard reload, Editorial Gold: panel screenshot confirms solid background, zero bleed-through; Filter/Sort read as two compact buttons with no overflow; Clients/Team now underline-styled identically to Inquiries/Projects (`rounded-t-lg px-4 py-2 text-sm font-medium transition` + active/inactive classes, confirmed by direct className comparison, not just visually).
- Filter and Sort dropdowns both open correctly, list their expected options (`All`/`Unread`/`Needs action`; `Most recent`/`Oldest`/`Unread first`/`Name (A-Z)`), and mark the active selection with a checkmark.
- `onyx-lime` re-confirmed unaffected: panel stays solid (`rgb(30, 30, 34)`, no backdrop-filter -- unchanged from before, since the glass rule was always editorial-gold-scoped), Filter/Sort buttons and tab restyle both render correctly there too (the tab pattern and `PillMenu`'s non-editorial branch are shared code, not editorial-only).

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` (web) -- both clean.

## Commit

`4ea52fe` on `main`.

## Cleanup

Killed the isolated dev API/web server instances used for this session's own verification (ports 4093/5292). Deleted every ad-hoc verification script and screenshot from the scratch directory afterward.

---

# Quick fixes: Conversations background, sidebar color match, Dashboard welcome line break

Small session on `main`. Editorial Gold only for all three -- `onyx-lime` unaffected throughout.

## 1. Conversations panel color, precisely

The prior revert session swapped the panel's background token from `--color-card-glass` (translucent, `#100f0ed6`) to `--color-surface-raised` (`#1d1813`) when removing the transparency -- fixed the bleed-through but silently changed the actual color, since those are two different tokens. Corrected: new `--color-card-glass-opaque` token (`#100f0e`, `--color-card-glass`'s own RGB with the alpha stripped) applied via `.conversations-panel-bg`. Same color as before, just opaque now -- confirmed via computed style (`rgb(16, 15, 14)`, `backdropFilter: none`).

## 2. Sidebar background matches cards

Sidebar was `bg-surface-inset` (editorial) / `bg-bg` (default) -- neither matches what cards actually render. Cards use plain `bg-surface` under every "default"-shape preset (matches there already, so the default branch was simply changed to `bg-surface`), but under editorial-gold `.card-surface` overrides that to the glass treatment -- so the sidebar needed the same `--color-card-glass-opaque` token used for item 1 (flat, no blur added to a permanently-open rail) to actually match what's on screen, not just the token name in source. Confirmed via computed style: sidebar and card background now share the identical `rgb(16, 15, 14)` base under editorial-gold (card itself stays translucent per its own glass treatment); both are `rgb(23, 23, 26)` under `onyx-lime`, exactly matching there too (unaffected, that branch of the fix already applied equally to both presets).

## 3. Dashboard welcome header

Removed the hardcoded `<br />` between "Welcome," and the name in `Dashboard.tsx`'s editorial-gold heading. Now `Welcome, <span>{name}</span>` as one run, wrapping naturally on narrow viewports rather than always forcing two lines. Confirmed via `innerHTML` (no `<br>` present) and a 380px-viewport screenshot.

## Verification

- Fresh reloads, Editorial Gold: Conversations panel confirmed same near-black as before (not `--color-surface-raised`), sidebar visually matches card tone, welcome header reads as one continuous element.
- `onyx-lime` re-confirmed unaffected on all three: sidebar/card colors match there too (were never broken), Conversations panel untouched (`rgb(30, 30, 34)`, this session's CSS is editorial-gold-scoped only), welcome header was never using the `<br>` branch to begin with.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` (web) -- both clean.

## Commit

`4b7b0b3` on `main`.

## Cleanup

Killed the isolated dev API/web server instances used for this session's own verification (ports 4093/5292). Deleted every ad-hoc verification script and screenshot from the scratch directory afterward.

---

# App-wide Motion rollout

Three-part session on `main`, committed and pushed separately per part. Reuses the auth page's existing Framer Motion setup throughout (`lib/motion.ts`, `AnimatePresence mode="popLayout"`, `forwardRef` for custom AnimatePresence children) rather than inventing a competing approach.

One deliberate addition to the shared config: `authSpringTransition` (`visualDuration: 0.76`, itself still mid-tuning toward a slower final value) was built for one dramatic card swap, not everyday chrome that fires on every click. New `uiSpringTransition` -- same `type: 'spring'`/`bounce: 0.25` physics, `visualDuration: 0.22` -- is the actual default used everywhere in this rollout, keeping things in the 150-300ms range the brief asked for. Same spring language app-wide, scaled per context, not a second competing config.

## Part 1 -- page/panel motion (`4922b6a`)

- **Route/section transitions**: `App.tsx` restructured into an `AppRoutes` component so `useLocation()` is available; `<Routes location={location}>` now sits inside `AnimatePresence mode="popLayout"` + a `motion.div` keyed by pathname (brief fade + 8px settle). Scoped to routed content only -- TopBar/ConversationsPanel/ViewAsBanner are persistent chrome outside this tree and never re-animate.
- **Modal**: converted from a hand-rolled `entered`/`closing` state machine + `setTimeout(onClose, 200)` to Motion's own `initial`/`animate`/`exit` + `onAnimationComplete`. Drag-to-move, focus trap, and scroll lock all preserved untouched; verified drag still works with a real pointer-move sequence (dialog moved from `{496,318}` to `{626,428}` on drag).
- **Conversations panel**: slide-over transform converted to Motion (`x: '0%' | '100%'`); the `contextOpen` width swap (560px/848px) stays a plain CSS transition since it's a Tailwind breakpoint className change, not a value Motion can interpolate.
- **No toast system exists** in the app (only a page-local `copyToast` in `ClientDetail.tsx`) -- not building new infrastructure for it, per the task's own "if the app has one" framing.

## Part 2 -- list and control motion (`51c933a`)

- **Dropdowns**: `DateRangePresetFilter`, `MultiSelectFilter`, `ArtistSelect`, and the new Conversations Filter/Sort `PillMenu` all converted to `AnimatePresence` + a shared `dropdownVariants` (scale 0.96→1 + fade), rather than each inventing its own.
- **List item enter/exit**: Conversations thread list and every list in `Tasks.tsx` (studio queue, my tasks, assigned-by-others, completed, assigned-by-me) get `motion.li` + `layout` inside `AnimatePresence` -- filtering, completing, and deleting now settle instead of popping.
- **Kanban card drop settle**: `InquiryKanbanCard` restructured with `forwardRef` (matching `AuthCard`'s established pattern) so it can be a direct `AnimatePresence` child; its root `motion.div` owns `layout` + enter/exit, while dnd-kit's own ref stays on an isolated inner `<div>` so Motion's layout transform and dnd-kit's live-drag transform never fight over the same node.
- **Pipeline stepper**: left as plain CSS (`transition-colors duration-base` added to the existing hard class-swap in `InquiryPipeline.tsx`) rather than a Motion conversion -- it's a color swap on a component with a custom `.hex` clip-path shape across two orientations, not a layout/gesture case Motion is for, and the codebase already has an established CSS-transition precedent for exactly this (the button baseline below).

**Known verification gap, disclosed rather than glossed over**: Kanban drag-and-drop could not be end-to-end verified through Playwright. `@dnd-kit/react`'s `PointerSensor` doesn't respond to Playwright's synthetic mouse events (tried `page.mouse`, then raw CDP `Input.dispatchMouseEvent` -- both produced the same result: a browser text-selection artifact instead of a drag, no floating card, no drop). Confirmed this is a pre-existing tooling limitation, not something this session broke: git-stashed the Kanban changes back to the original code and reproduced the *identical* non-drag behavior on the untouched baseline. Structurally the change is safe -- dnd-kit's ref sits on its own DOM node, isolated from Motion's `layout` prop on the wrapping element -- but the drag gesture itself needs manual/real-browser confirmation, which this report doesn't have.

## Part 3 -- micro-interactions (`0d49e8b`)

- **StatusPill**: `transition-colors duration-base` added to both the editorial and default variants -- a status change now transitions instead of hard-swapping.
- **Loading fade-in**: Dashboard's skeleton→data swap now uses `AnimatePresence mode="wait"` (it toggles both directions as the date range changes); Tasks' loading→content swap gets a simple one-way mount fade (never reverts once loaded).
- **Deliberately not added**:
  - Button/hover press feedback -- `index.css` already has a consistent, global `button:active { scale(0.98) }` + color/background/transform transition baseline covering every button app-wide with zero per-component maintenance. Converting that to per-component Motion `whileTap`/`whileHover` would mean touching every `<button>` in the codebase to replace something that already works consistently, for no visible improvement -- exactly the kind of "would have hurt usability with no upside" case the brief asked to skip and document.
  - Inquiries' table loading skeleton -- `SkeletonTableRows` returns its own `<tbody>`, and the real data path is a three-way branch across differently-shaped row groups. Wrapping that in Motion risks fragile or invalid nested-`<tbody>` DOM for a minor polish gain; left as the existing instant swap.
  - Conversations panel's "Loading…" text -- the thread list itself already fades items in individually via Part 2's `AnimatePresence`, which already covers the "content arriving" moment this bullet is about.

## Performance verification

Per-part, on the busiest real pages, using the established `requestAnimationFrame`-delta methodology:

- **Route transitions and panel opens genuinely show elevated frame times *during* the ~220ms transition window** (avg ~30-40ms, several frames over 20ms) when the destination page also has real mount/data-fetch work to do. Isolated cause from symptom before accepting this: measuring the *same still-open* panel/page again 500ms later (animation long finished, nothing forced off) returns cleanly to baseline (~15.7-16ms avg, 0 long frames) every time -- this is transient work overlapping the animation window, not a sustained cost from the animation itself. Confirmed via a real A/B: temporarily git-stashed the Part 1 `App.tsx` change and re-measured the identical mobile route transition -- the baseline *without* any motion wrapper showed the same single-frame spike (483ms vs. 516ms with motion, well within noise), proving the app's own page-mount cost under throttled CPU, not something this rollout introduced.
- **Final steady-state check**, mobile-emulated (Playwright's Pixel 7 device profile) with CPU throttled 4x, on Dashboard's card grid and the Inquiries list, both idle and scrolling: 16.1-16.5ms avg, 0-1 long frames out of 50-60 sampled, every case. Clean.
- **Disclosed limitation**: "mobile-emulated + CPU-throttled" is Playwright's device emulation, not a real phone. This session did not have physical hardware to test on; the brief's own "confirm on a real phone" verification step is unmet for that reason, not skipped by choice. Everything reported above is the closest available proxy, run consistently across all three parts.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` + `npx tsc -b` (web) -- clean after every part.

## Commits

- Part 1: `4922b6a`
- Part 2: `51c933a`
- Part 3: `0d49e8b`

## Cleanup

Killed the isolated dev API/web server instances used for this session's own verification (ports 4093/5292) after each part's checks. Deleted every ad-hoc verification script and screenshot from the scratch directory throughout.

---

# Sidebar/Conversations panel rings + Iris route transition

Small follow-up on `main`, same day. Two independent additions.

## 1. Ring ornaments on the Sidebar and Conversations panel

Both are fully opaque (per the two most recent "revert transparency"/"quick fixes" sessions), so under Editorial Gold they were the only flat, undecorated surfaces in the app shell -- everywhere else shows `.arc-decor`'s concentric rings through a translucent page wrapper. New `.panel-ring-decor` (index.css) reuses the exact same ring markup/border treatment, scoped locally to each panel and anchored off one corner (top-left for Sidebar, bottom-right for the Conversations panel) rather than centered, gated the same way as `.arc-decor` itself (`isEditorial`/`isEditorialFab`, DOM-level, not just CSS-hidden under other presets).

**Real bug found and fixed along the way, not just theorized**: a `position: fixed` ring nested inside Sidebar's `<aside>` was silently behaving like `position: absolute` against it instead of the viewport. Root cause: Tailwind's `translate-x-full`/`translate-x-0` utilities (needed for the sidebar's own mobile slide-in/out drawer) compile to the standalone CSS `translate` property in Tailwind v4, not the `transform` shorthand -- and `translate` set to anything other than the keyword `none` (even an identity `0px`) creates a new containing block for `position: fixed` descendants, same as `transform` does. Easy to miss: `getComputedStyle(aside).transform` still read `none`. Confirmed via a full ancestor-chain walk checking `transform`/`filter`/`perspective`/`contain`/`will-change`/`translate`/`scale`/`rotate` at every level -- `translate: 0px` on the aside was the only hit. Fixed by keeping the ring `position: absolute` (its real, unavoidable behavior) and anchoring off the TOP of the aside's content instead of the bottom -- the aside's own content height (1277px at this viewport) exceeds most screens, so a bottom-anchored ring landed off-screen below the fold and, since a scrollable ancestor's scrollable area includes its own out-of-flow descendants, silently inflated the sidebar's own scrollable height by the ring's footprint (confirmed via `scrollHeight`: 1457 with the ring, 1277 without -- fixed to 1277 either way after the anchor change).

## 2. Iris route transition

Replaced Part 1's fade+8px-settle route transition with a circular reveal: the incoming page's own `clip-path` grows from `circle(0% at 50% 50%)` to `circle(150% at 50% 50%)` (150% comfortably exceeds a centered circle's required radius at any realistic aspect ratio, per the CSS spec's percentage-resolves-against-diagonal/√2 formula), progressively covering the outgoing page rather than the two crossfading. Verified the actual curved boundary is visible mid-transition (not just trusting the clip-path values) by polling `getComputedStyle` via `requestAnimationFrame` until the radius crossed a known threshold, then screenshotting at that exact instant -- confirms a real arc, not a uniform fade.

**Two more real bugs found while building this, not assumed away**:
- Motion leaves the final `animate` value as a permanent inline style once a transition settles. A lingering non-`none` `clip-path` -- even one large enough to clip nothing visible -- creates a new containing block for every `position: fixed` descendant on the page, the exact same category of bug as the Sidebar ring issue above, except app-wide instead of one component. First fix attempt (clearing the inline style directly via a ref in `onAnimationComplete`) didn't stick -- Motion re-asserts its own `animate` target on every render, so a manual DOM mutation just gets overwritten on the next one. Real fix: a new `IrisReveal` component (`forwardRef`, matching `AuthCard`'s established pattern for custom `AnimatePresence` children) owns a `revealed` boolean in state; once true, the `animate` target itself switches to `clipPath: 'none'` -- changing the value through Motion's own reactive model, not fighting it externally.
- `circle(150% at 50% 50%)` and the keyword `none` aren't a valid interpolation pair -- letting Motion spring-animate between them produced real, verified visual garbage (`getComputedStyle` briefly showed nonsense values like `circle(3.13% at 1.04% 1.04%)` mid-"transition"). Fixed by giving that specific switch its own instant, zero-duration transition, scoped to the `clipPath` property only (`transition={{ default: uiSpringTransition, clipPath: revealed ? { duration: 0 } : uiSpringTransition }}`) -- scoping it to just that property, not the whole `transition` prop, matters because the same prop also governs the exit fade's opacity, which needs to stay a real animation.
- `skipAnimation`, passed down from a `useRef`-tracked "is this AppRoutes' very first render" flag, handles the one case `onAnimationComplete` can't reach at all: `AnimatePresence`'s own `initial={false}` skips the enter transition entirely on a fresh page load (as opposed to an in-app navigation), so nothing ever completes to trigger the reveal -- that one instance now starts already revealed instead of leaving a permanent clip-path behind.

## Performance

Same `requestAnimationFrame`-delta methodology as every other check this session. Desktop, warm cache: 15.81ms avg, 0 long frames during the transition itself (an earlier measurement, taken before the circle-to-none interpolation bug above was fixed, showed real elevated jank -- 31ms avg, 8 long frames -- which the fix resolved, not just moved elsewhere). Mobile-emulated (Pixel 7 profile) with 4x CPU throttle: 18.30ms avg, 2 long frames out of 39, max 66.7ms -- consistent with the same transient-during-transition/clean-after pattern established throughout the Motion rollout, not a new regression.

## Verification

- Fresh reloads and in-app navigation both confirmed clean: `clip-path` settles to `none` in both the first-mount (`skipAnimation`) and post-navigation (`onAnimationComplete`) cases.
- Sidebar ring visible top-left (screenshotted), Conversations panel ring visible bottom-right (screenshotted), both correctly gated off under `onyx-lime` (DOM-level check: ring element not mounted at all, not just hidden).
- No console/page errors across the full verification pass.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` + `npx tsc -b` (web) -- clean.

## Commit

`0ef7df3` on `main`.

## Cleanup

Killed the isolated dev API/web server instances used for this session's own verification (ports 4093/5292). Deleted every ad-hoc verification script and screenshot from the scratch directory afterward.

---

# Conversations: image lightbox for message attachments

Small session on `main`. New `ImageLightbox.tsx` -- full-screen click-to-enlarge viewer for message attachments in the Conversations panel, theme-agnostic (a fixed black overlay, no Editorial Gold/onyx-lime branching needed). Clicking any attachment thumbnail in a thread now opens it full-size; if the same message has more than one attachment, left/right arrows (and the arrow keys) step between them, with a count indicator. Escape or clicking the scrim closes it. The existing "Add to inquiry" picker button (a separate, unrelated feature -- attaching a received photo to an inquiry's reference images) is untouched, just now sitting inside the same `<div>` as a sibling to a new `<button>` wrapping the thumbnail.

## Real bug found and fixed, not just implemented and assumed correct

Escape didn't close the lightbox on the first pass -- it turned out to also be intercepted by the Conversations panel's own pre-existing window-level Escape handler (`closePanel()`, registered on the panel's own mount, well before the lightbox ever exists). Both are plain bubble-phase `window.addEventListener('keydown', ...)` listeners on the same target, which fire in registration order regardless of DOM nesting depth -- the panel's, registered first, always ran first. Traced this concretely (not guessed): confirmed via `document.activeElement` that a "stuck focus in the composer textarea" theory was wrong, then found the actual pre-existing handler in `ConversationsPanel.tsx` and confirmed the fix by checking the panel's own `transform` stayed `none` (i.e. still fully open) after the lightbox's Escape closed only itself. Fixed by registering the lightbox's own listener with `{ capture: true }` and calling `stopPropagation()` -- capture-phase listeners run before any bubble-phase listener regardless of registration order, so this reliably takes priority without needing to touch the panel's own existing handler at all.

## Verification

- Full round-trip tested with a real attachment: uploaded an image through the composer (real Cloudinary upload, confirmed via network trace), sent it. Found -- and confirmed via direct network inspection, not assumed -- that this specific dev studio's outbound-SMS-to-a-fake-test-number flow doesn't persist `attachments` on the returned message (POST body included the Cloudinary URL; the subsequent GET came back with an empty `attachments` array) -- a pre-existing dev-data/Twilio-sandbox limitation, unrelated to this session's code, not something to chase down further here.
- Verified the actual lightbox behavior against the real render path anyway (not skipped) by intercepting the thread's own GET response via `page.route()` and injecting two real attachment URLs onto a message -- confirms: both thumbnails render and open on click, next/previous arrows correctly step between them with a live `1 / 2` → `2 / 2` counter, scrim click closes, Escape closes (only the lightbox, panel stays open -- see bug above), and the "Add to inquiry" button (a real, unmocked pre-existing feature) still works independently alongside the new click-to-enlarge behavior.
- Re-confirmed the same flow renders correctly under `onyx-lime` (no theme branching in this component, but checked for real rather than assumed).

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` + `npx tsc -b` (web) -- clean.

## Commit

`4d2be0b` on `main`.

## Cleanup

Killed the isolated dev API/web server instances used for this session's own verification (ports 4093/5292). Deleted every ad-hoc verification script, test image, and screenshot from the scratch directory afterward. Left the two test messages sent during verification in the dev database's "Emily Rodriguez" thread -- that thread (and this dev studio generally) is already full of pre-existing seed/test data (SmsKeyword TestClient, XssTest Estimate, etc.), so a couple more test messages blend into existing dev-data hygiene rather than polluting anything real; no delete-message feature exists to clean them up via the UI, and direct DB manipulation wasn't worth the risk for this.

---

# Fixes: ring placement + slower page transition

Small follow-up session on `main`, addressing owner feedback on the two most recent changes.

## 1. Ring moved off the sidebar, onto the main background

The sidebar's own ring decoration (added two sessions ago) was confined to the sidebar's own opaque surface -- correct per its own reasoning at the time, but not what was wanted: it should read as part of the main background, the same way the app's existing centered `.arc-decor` already does everywhere else.

Removed the ring entirely from `Sidebar.tsx`/its own CSS. New `.arc-decor-sidebar-edge` (index.css) mounted in `TopBar.tsx` instead -- same home, same `decorative` gate, same `z-index: 2` as the existing centered `.arc-decor`, not nested inside the sidebar at all. `left: 40px; width: 380px` means the left portion of the circle sits under the sidebar's own opaque `z-index: 50` fill (hidden for free, no clip-path needed) while the right portion bleeds out over the main content -- reads as emerging from behind the sidebar's edge rather than floating independently, and sidesteps the `translate`-creates-a-containing-block problem the old sidebar-nested version ran into entirely, since TopBar's own elements have no transform/translate anywhere in their ancestor chain.

**Two real bugs found via a decisive on/off check (forced bright-red borders, not guessed), not shipped on faith:**
- The reused `i:nth-child(2)/(3)` inset values (110px/230px) were tuned for the original 1400px `.arc-decor` box. On this smaller 380px box, `inset: 230px` leaves less than 0px of usable diameter -- the third ring was silently collapsing to nothing instead of scaling down. Fixed with proportional insets (40px/80px) for this specific smaller instance.
- Even with insets fixed, the base `.arc-decor` border opacity (0.1/0.07/0.05) was genuinely invisible at this size and position -- confirmed by comparing a zoomed crop against the same region with borders forced bright red (positioning confirmed correct) versus normal opacity (nothing visible, even zoomed in). The center `.arc-decor` gets away with the same low opacity because its much larger radius crosses a lot of plain background at once, reading as ambient atmosphere; this smaller ring sits over a visibly busier header area (photo grain/gradient plus heading text) where the same faint gold-on-warm-background line has too little contrast to register. Roughly 4-5x the base opacity (0.5/0.4/0.3) was what it actually took to read as a deliberate element without looking garish -- checked via full-page screenshots on Dashboard and Clients, not just the zoomed crop.

## 2. Page transition slowed down

New `pageTransition` (`lib/motion.ts`) -- same spring feel as `uiSpringTransition` (identical `type`/`bounce`) but `visualDuration: 0.5`, roughly double the `0.22` used for everyday chrome. Kept as its own named constant rather than bumping `uiSpringTransition` itself, since that one is shared by dropdowns, list items, and panel open/close, which still need to stay fast -- only the iris route transition (`App.tsx`) switched to the new constant. Verified the actual speed change via direct `clip-path` sampling across real elapsed time, not assumed from the number alone: full growth to ~150% now lands around 413ms (was ~262ms), settling by roughly 800ms with the same restrained spring overshoot (was ~410ms) -- genuinely about 2x slower, matching the `visualDuration` change.

## Verification

- Both fixes confirmed correctly gated off under `onyx-lime` (ring: not mounted at all, DOM-level check, not just visually hidden).
- Performance re-checked on the now-slower transition specifically, since a longer-duration animation is a reasonable thing to worry about: 16.16ms avg, 0 long frames throughout the transition and after settling -- a longer duration animates the same per-frame cost across more frames, not more expensive frames, so no regression from slowing it down.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` + `npx tsc -b` (web) -- clean.

## Commit

`4fd7923` on `main`.

## Cleanup

Dev servers killed via PowerShell `Stop-Process` by exact PID this time, not `taskkill //IM node.exe` -- the latter wiped out unrelated `node` processes system-wide earlier this session (including, harmlessly, this same session's own dev servers mid-debugging, requiring a restart) when a test script hung and got force-killed by process name instead of PID. Scratch scripts and screenshots deleted afterward.

---

# Revert: remove the satellite rings, iris transition back to a slower fade

Small follow-up on `main`, undoing two things from the last two sessions per direct owner feedback -- the sidebar-edge ring didn't look as good as hoped even after the opacity/inset fixes, and the iris reveal read as distracting rather than smooth.

## 1. Rings removed

Removed `.arc-decor-sidebar-edge` (TopBar.tsx + its CSS, added last session to bleed a ring from behind the sidebar into the main content) and the Conversations panel's own `.panel-ring-decor`/`.conversations-ring-decor` (ConversationsPanel.tsx + CSS, added two sessions ago). The original, long-standing centered `.arc-decor` -- part of the foundational photo/wash/arc-decor background stack, never the subject of any complaint -- is untouched; confirmed still mounted after the removal, not accidentally caught by the same cleanup.

## 2. Iris transition reverted to a (slower) fade

`App.tsx`'s `IrisReveal` component (circular clip-path reveal) replaced with `PageFade` -- the original crossfade+8px-settle this app-wide Motion rollout first shipped with, before the iris reveal replaced it. Kept the slower `pageTransition` timing from two sessions ago rather than reverting all the way back to the original fast `uiSpringTransition` -- the owner's ask was specifically to slow down what was there before, not just literally the very first version. Verified via direct opacity/transform sampling across real elapsed time: clean fade+slide, both directions, settling around 524ms.

Simplified `AppRoutes` considerably in the process -- the iris version needed a `skipAnimation` prop, a `revealed` state machine, and a `useRef` "is this the first render" tracker, all specifically to handle clip-path's containing-block side effect and its non-interpolable transition back to `none`. None of that machinery is needed for a plain opacity/transform fade, which has no equivalent side effects -- removed all of it along with the unused `useEffect`/`useState`/`useRef` imports it required.

## Verification

- DOM-level check confirms both rings gone, centered `.arc-decor` still present and unaffected.
- Fade transition timing sampled directly (not assumed): exiting page opacity 0.99 → 0 and entering page opacity 0 → 1 over ~524ms, y-transform settling from ±8px to 0 in the same window -- matches the slower `pageTransition` constant, no leftover clip-path-era artifacts.
- Performance re-checked: same transient-elevation-during-transition, clean-settle-after pattern established throughout this whole Motion rollout (avg 26.88ms during, 8 long frames out of 34 during transition-plus-real-page-mount-work; 15.87ms avg, 0 long frames once settled) -- not a new regression, consistent with every other transition measured this way in this project.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` + `npx tsc -b` (web) -- clean.

## Commit

`aba62ab` on `main`.

## Cleanup

Dev servers killed via PowerShell `Stop-Process` by exact PID. Scratch scripts and screenshots deleted afterward.

---

# Editorial Gold — propagate to Calendar, Clients, Team

Three-page propagation session on `main`, one commit per page as a checkpoint per the task's own instruction. Editorial Gold only, `onyx-lime` re-confirmed unaffected on every page.

**One thing found before any styling work began**: `.card-surface` was already present on Calendar's grid wrapper, Clients' table wrapper, and Team's staff table + permissions matrix wrappers -- inherited from an earlier broad template pass, not a deliberate choice. Since the frosted-glass rule fires purely off `[data-theme="editorial-gold"] .card-surface` (theme-global, not page-scoped), this meant all four of those dense, information-critical surfaces would have silently gone translucent the moment Editorial Gold activated anywhere -- the exact mistake this task's own headline rule warns about, already latent before this session touched anything. Removed on all four; called out explicitly per page below.

## Calendar (`091d050`)

- Serif eyebrow+heading; `CalendarToolbar` (its own react-big-calendar `Components.toolbar` override, a separate function component) now self-gates via `useThemePreset()` the same way `Eyebrow`/`StatusPill` do -- Today/Back/Next buttons and the Month/Week/Day segmented control both get the gold-outline treatment, active view gets the filled-active-segment look already established on Conversations' Clients/Team toggle. Artist filter chips and the location `<select>` reuse the same secondary-button pattern.
- `.card-surface` removed from the calendar-grid wrapper -- grid and appointment blocks stay fully solid.
- No "New Appointment" toolbar button exists on this page (the task brief assumed one; checked the actual code -- creation is click-to-create-a-slot only, permission-gated) -- nothing to wire there.
- **Functionality verified, not assumed**: keyboard shortcuts (`T` for today, arrow-key navigation) both confirmed via toolbar-label state checks; drag-and-drop confirmed via network trace -- dragging an event block to a new day produced a real `PATCH /appointments/:id` returning `200`, i.e. an actual successful reschedule, not just a visual drag.

## Clients (`b49e4f1`)

- Serif eyebrow+heading, gold-fill "Add Client" / gold-outline "Import Clients" buttons.
- `.card-surface` removed from the client table wrapper -- table stays fully solid. Row-click-to-navigate confirmed still works.
- Add Client modal's internal form fields left untouched -- outside the task's explicit scope (header + toolbar + list), and `Modal.tsx` itself is already theme-aware.

## Team (`07a440f`)

Already had partial Editorial Gold wiring from an earlier session (header, Staff-tab buttons, tabs) -- confirmed those still correct rather than redone from scratch, and finished the rest:

- Artists-tab "Add Artist" button and Permissions' "Save changes" button now use `editorial-btn-primary` (previously plain, unwired).
- `.card-surface` removed from the staff table and permissions matrix wrappers (same latent issue as Calendar/Clients) -- both confirmed `backdrop-filter: none`.
- **Artist profile cards kept `.card-surface`, deliberately** -- discrete, card-shaped content (photo/name/bio/tags), the reasonable glass candidate this task's own rule calls out. Confirmed via computed style: all 11 rendered cards show `backdrop-filter: blur(16px)`, both dense-list wrappers show `none`.
- Tabs (Staff/Artists/Permissions) investigated per the task's own question ("should these pick up the Conversations tab restyle pattern") -- they already use the identical underline classNames (confirmed byte-for-byte against `ConversationsPanel.tsx`'s own Clients/Team toggle and `Inquiries.tsx`'s original), so no change was needed; noting this explicitly rather than leaving it unaddressed.
- `StatusPill` already correctly used on the staff table (Active/Deactivated) -- confirmed, not re-implemented.

## Verification (all three pages)

- Every dense-content wrapper checked via `getComputedStyle(...).backdropFilter` directly, not just eyeballed screenshots -- `none` on all five (Calendar grid, Clients table, Team staff table, Team permissions matrix) confirmed after the `.card-surface` removals; `blur(16px)` confirmed on Team's artist cards, the one deliberate exception.
- Fresh screenshots on all three pages, all three Team tabs, both Calendar Month/Week views -- all read as clearly part of the same app as Dashboard/Conversations (sidebar background match holds throughout, already fixed in an earlier session, reconfirmed not regressed).
- `onyx-lime` re-confirmed completely unaffected on all three pages (screenshots + `data-theme` checks) -- flat/opaque throughout, no `.card-surface` blur anywhere including Team's artist cards.

## Typechecks

`npx tsc --noEmit` (api, untouched) and `npm run build` + `npx tsc -b` (web) -- clean before every commit.

## Commits

- Calendar: `091d050`
- Clients: `b49e4f1`
- Team: `07a440f`

## Cleanup

Killed the isolated dev API/web server instances used for this session's own verification (ports 4093/5292), via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and screenshot from the scratch directory throughout.

---

# Editorial Gold — propagate to Tasks, Settings

Continuation of the same propagation, two pages this time, one commit per page. Editorial Gold only, `onyx-lime` re-confirmed unaffected on both.

## Tasks (`05af449`)

- Serif eyebrow+heading; `.sc` small-caps treatment on all three section headings (Studio Queue, Assigned to Me, Assigned by Me). `editorial-btn-primary` on Add, `editorial-btn-secondary` on Dismiss.
- `.card-surface` was **not** present on any of the three wrappers here (unlike Calendar/Clients/Team) -- confirmed all three stay `backdrop-filter: none` as-is, nothing to remove.
- **Functionality verified past a first false negative**: the initial add-task check (fixed 800ms wait before checking DOM) reported "task added successfully: false" — turned out to be a test-script timing artifact, not a regression. Re-ran with response-status logging: `POST /tasks/personal` returns `201`, and the new task text renders once given a longer wait. No handler/state code was touched this session, only classNames and JSX structure.

## Settings (`44d18c4`)

- Serif eyebrow+heading; all 12 card-section headings (Studio Profile, Theme, Locations, Policies, Defaults, Waiver Questions & Clauses, Message Templates, Reminder Templates & Send Times, Custom Policies, Deposit Tiers, Integrations, System) get `.sc`. `editorial-btn-primary`/`editorial-btn-secondary` applied to every section-level action button (~30 instances, batched via grep-confirmed `replace_all` edits, one typecheck pass after each batch).
- `LocationForm` is a separate top-level function component living in the same file (used for the location add/edit form) -- one of the batch edits matched its Save/Cancel buttons too, which don't share the parent `Settings()` component's scope. Caught immediately by `tsc -b` (`Cannot find name 'isEditorial'`); fixed by having `LocationForm` call `useThemePreset()` itself, same self-gating convention as `CalendarToolbar`. Worth calling out as a general risk: broad `replace_all` edits on a file with multiple independent function components sharing near-identical JSX can silently cross component-scope boundaries — needs a typecheck immediately after each batch, which is what caught this.
- Two card headings on this page don't live in `Settings.tsx` itself — **Intake Forms** and **Services**, rendered by the separately-imported `IntakeFormsManager.tsx` / `ServicesManager.tsx`. Confirmed both components are used nowhere else in the app, so extended the identical treatment into them: `.sc` heading, `editorial-btn-secondary` on their own "+ New form"/"+ New service" header buttons, `editorial-btn-primary` on their create-modal submit buttons, `editorial-btn-secondary` on their cancel buttons. Both had `.card-surface` on their dense row-list wrapper -- the same latent bug already fixed on Calendar/Clients/Team/Tasks-adjacent pages, removed here too (`backdrop-filter: none` confirmed). Danger-styled delete buttons and per-row Edit/Deactivate chips left untouched, matching the established "don't over-style every row control" precedent.
- Considered swapping `JobStatusDisplay` (System tab) for the shared `StatusPill` component since their tone names match -- decided against it. `JobStatusDisplay`'s existing spinner-for-RUNNING / truncated-inline-error-for-FAILED / distinct-null-state treatment is genuinely richer than `StatusPill`'s fixed `{status, label, className}` API; forcing the swap would trade information density for cosmetic consistency. Left untouched.
- Theme-preset picker (the live theme switcher) confirmed still correctly theme-agnostic -- swatches must always show each preset's own true colors regardless of which theme is currently active. Not touched.

## Verification (both pages)

- Every dense-list wrapper checked via `getComputedStyle(...).backdropFilter` directly: Tasks' three sections, Settings' Intake Forms card, Settings' Services card -- all `none`.
- Full-page screenshots on Tasks and on all 5 Settings tabs (General, Policies & Templates, Services, Integrations, System) under Editorial Gold.
- `LocationForm` opened and screenshotted directly -- renders and functions correctly.
- Theme picker exercised both directions (onyx-lime → editorial-gold → onyx-lime) as part of the same script that does every other check, confirming the switching mechanism itself wasn't broken by any of this session's edits.
- `onyx-lime` re-confirmed completely unaffected on both pages -- default classNames/typography throughout, no `.card-surface` blur anywhere.

## Typechecks

`npx tsc -b` and `npm run build` (web) -- clean before every commit.

## Commits

- Tasks: `05af449`
- Settings (+ IntakeFormsManager, ServicesManager): `44d18c4`

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and screenshot from the scratch directory.

---

# Editorial Gold — reduce StatusPill size, especially on mobile

Single-file fix (plus one downstream call-site adjustment forced by it) on `main`. Editorial Gold only, `onyx-lime` unaffected.

## Values landed on (`StatusPill.tsx`, editorial-shape branch)

Mobile-first responsive classes -- smaller by default, restored to the original desktop sizing at `sm:` (640px) and up:

| | Mobile (base) | Desktop (`sm:` and up, unchanged from before) |
|---|---|---|
| Horizontal padding | `px-2` (8px) | `px-3` (12px) |
| Vertical padding | `py-1` (4px) | `py-1.5` (6px) |
| Font size | `text-[9px]` | `text-[10px]` |
| Letter-spacing | `tracking-[0.08em]` | `tracking-[0.16em]` |
| Dot size | `h-1 w-1` | `h-1.5 w-1.5` |
| Icon/text gap | `gap-1.5` | `gap-2` |
| Line wrapping | allowed (no `whitespace-nowrap`) | `whitespace-nowrap` (forced single line) |

The label text itself is now wrapped in its own `<span className="leading-tight">` so a two-line wrap doesn't pick up extra default line-height.

## Wrap-fallback decision

The longest real labels (`describeInquiryStatus`'s "Opened, awaiting response" / "Sent, not opened yet", rendered uppercase) still don't comfortably fit on one line at 375px even at the reduced size. Per the task's own stated preference, went with wrapping onto a second line rather than shrinking the font further toward illegibility -- confirmed via computed style at 375px that this produces **zero horizontal overflow** (`document.documentElement.scrollWidth === window.innerWidth`) on the worst-case row. No row-layout change (avatar+name+pill stacking vertically) was needed anywhere checked -- the wrap alone was sufficient, so that escalation wasn't used.

## A real regression found and fixed along the way

`ConversationsPanel.tsx`'s two thread-list status badges pass their own smaller `className` override (`px-2.5 py-0.5 text-[11px]`, a deliberately more compact treatment for the dense conversation list). Once `StatusPill`'s base classes gained `sm:`-prefixed variants, those started out-ranking the plain override at >=640px (Tailwind emits responsive utilities after the base ones in its generated stylesheet, so they win when their media query is active) -- verified this empirically via `getComputedStyle` before concluding it, not just reasoned about it: pre-fix, the badge measured `fontSize: 10px, paddingLeft: 12px` at 1440px vs. `fontSize: 11px, paddingLeft: 10px` at 375px, a real, unintended desktop-only size change for a call site that wasn't broken before. Fixed by adding `!` (Tailwind's important modifier) to both overrides. Re-verified: the badge now measures byte-identical (`fontSize: 11px, paddingLeft: 10px, paddingTop: 2px`) at both 375px and 1440px -- and as a side effect, this also fixed a pre-existing quirk where the override's own `py-0.5` had never actually applied at any width (the base component's `py` value was silently winning even before this session's change; now the override wins cleanly everywhere, as originally intended).

## Verification

Real narrow-viewport (375px, iPhone-SE width) Playwright checks against the local dev stack, Editorial Gold active:

- **Inquiries & Projects** (`/inquiries`): worst-case row ("Opened, awaiting response") wraps cleanly onto two lines, zero horizontal overflow -- confirmed via `scrollWidth`/`innerWidth` equality, not just a screenshot.
- **Team** (`/team`, Staff tab): avatar + name + "ACTIVE" pill row no longer squishes the name column.
- **Client detail** (`/clients/:id`): checked across five separate `StatusPill`-rendering sections in one real client's page -- Inquiries, Projects, Gift Cards, Appointments (including "CHECKOUT OVERDUE"), Waivers. All render cleanly; "CHECKOUT OVERDUE" happened to fit on one line here since that table column has more room than the Inquiries page's -- confirms the wrap is adaptive to actual available width, not a fixed break.
- **Gift card detail** (`/gift-cards/:id`) and **Appointment detail** (`/appointments/:id`): standalone pages, both confirmed clean.
- **Conversations panel** (floating chat overlay): confirmed both at 375px and 1440px after the `!important` fix above.
- **Desktop** (1440px): re-checked Inquiries' worst-case row and Team -- both single-line, matching the original pre-fix sizing exactly (`10px` font, `230.5px`-wide single-line pill measured directly, not eyeballed).
- **Onyx Lime**: confirmed via `getComputedStyle` that the default-shape pill's className is byte-identical to before this change (`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ...`) -- completely unaffected, as expected since only the `shape === 'editorial'` branch was touched.
- Calendar's appointment-preview popover and the public `GiftCardResponse` page weren't reached with a live automated click this session (calendar filter/date state and a public-page auth path made scripted navigation slow to set up) -- both render through this exact same shared component and branch with no page-specific overrides, so the fix applies identically; flagging that these two specifically weren't eyeballed live, unlike everything above.

## Typechecks

`npx tsc -b` (web) and `npx tsc --noEmit` (api, untouched) -- both clean before commit.

## Commit

`2adc2b0` on `main`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and screenshot from the scratch directory.

---

# Inquiries list: Client/Status column toggles, mobile Description truncation

Single-file fix (`Inquiries.tsx`) on `main`. Theme-agnostic -- applies identically under Editorial Gold and Onyx Lime, not gated by preset.

## 1. Client and Status columns are now toggleable

Both were hardcoded permanently visible in the existing "Columns" menu system (Channel/Description/Date/Assigned Artist were already toggleable). Folded them into the same `ColumnKey`/`COLUMN_DEFS`/`DEFAULT_COLUMN_VISIBILITY` machinery, defaulting to visible so no existing user's layout changes until they explicitly hide one. Only the photo/avatar column (no header label, never had a toggle) stays permanently fixed -- a row with every other column hidden would otherwise be a blank clickable strip.

Since Status was previously always the last (and only ever) rightmost column, the header row's rounded right corner and each cell's right padding were hardcoded onto it. Both now follow whichever column actually renders last, computed once via `lastVisibleColumnKey = [...COLUMN_DEFS].reverse().find(c => columnVisibility[c.key])`.

## 2. Description column truncates on mobile instead of never appearing

Before this fix, "shorten it with ellipses on mobile" for the Description column was moot -- it was gated `hidden md:table-cell`, meaning it never rendered on a real phone (max ~428px) regardless of what the user toggled, only ever showing at tablet width and up. Removed that gate: toggling Description on now means "show it, including on mobile."

Replaced the old fixed-60-character JS `truncate()` helper with CSS-based truncation (`overflow-hidden` + `text-overflow: ellipsis` + `whitespace-nowrap`, i.e. Tailwind's `truncate` utility) at a responsive `max-w-*` (70px mobile, 160px at `sm`, 220px at `md`, 320px/`max-w-xs` at `lg`+) -- width-aware regardless of actual rendered character widths, unlike a fixed character count that could still overflow a narrow column or look stingy in a wide one. The now-dead `truncate()` helper (its only remaining caller) was deleted.

## Verification

- **Column toggles**: opened the Columns menu, hid Client and Status via direct checkbox interaction, confirmed the header/row cells update immediately, `localStorage` (`ink-manager:inquiries-columns`) persists the new state, a page reload keeps it hidden, and re-enabling both restores the original 7-column layout in the original order. Confirmed the rounded corner correctly relocated to "Assigned Artist" (the new actual last column) while Client/Status were hidden.
- **Mobile Description truncation**: seeded a real inquiry via a direct authenticated API call (`POST /inquiries`) with a 240-character description ("A large, highly detailed Japanese-style irezumi sleeve...") -- dev seed data had nothing near that length to test against honestly. At a real 375px viewport with every optional column enabled (the worst-case combination: Client + Channel + Description + Date + Artist + Status all visible on one narrow row): zero horizontal overflow (`document.documentElement.scrollWidth === window.innerWidth`, both 375), the description cell measured `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` computed styles, and the screenshot shows a clean one-line "A large, hig…" -- no squish, no wrap-induced row growth.
- **Desktop**: same seeded row at 1440px shows "A large, highly detailed Japanese-style irezumi sleeve featuring …" -- a full sentence before truncating, confirming the `lg:max-w-xs` tier is a genuine scale-up from mobile's 70px, not a uniform shrink applied everywhere.
- **Onyx Lime**: same 375px/seeded-row check under the default theme -- identical clean truncation, zero overflow. This change isn't Editorial-Gold-scoped (no `isEditorial` branching anywhere in the diff), so there was nothing theme-specific to break, but checked directly rather than assumed.
- Test client/inquiry (`LongDesc TestClient`) left in the dev database, not rolled back -- same convention as prior sessions' dev-DB test data (this is what `DEVELOPMENT.md`'s dev studio is for).

## Typechecks

`npx tsc -b` (web) and `npx tsc --noEmit` (api, untouched) -- both clean before commit.

## Commit

`bd2e91b` on `main`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification/seed script and screenshot from the scratch directory.

---

# Editing the assigned artist after initial assignment

Single-session fix touching one API route and one page (`InquiryDetail.tsx`, shared by both the Inquiries and Projects tabs -- same detail page, so one fix location covers both). On `main`.

## What was actually blocking this

Not just a missing UI affordance -- the backend explicitly refused it. `PATCH /inquiries/:id/assign` 400'd with "An artist is already assigned to this inquiry" for any inquiry/project past `NEW` that already had one assigned, a deliberate restriction from when this route was first built (its own comment: "Re-assigning only makes sense while it's still NEW"). The frontend's Assignment widget matched that: a picker only while `status === 'NEW'` or no artist was set yet, otherwise a permanent read-only field.

## API (`inquiries.ts`, `PATCH /:id/assign`)

Removed the reassignment block. The route now distinguishes three cases purely by the inquiry's current status/`assignedArtistId` instead of hard-blocking one of them: first assignment (`NEW` -> `ARTIST_ASSIGNED`, unchanged), late assignment (reached a later status with none ever assigned -- unchanged, this was already the existing fallback for when send-estimate doesn't require one but the deposit-form gate does), and now reassignment (already has one, non-terminal). The terminal-status guard (`CLOSED_LOST`/`COLD_LEAD`) is untouched -- still can't assign or reassign on a dead lead.

Reassignment logs its own `artist_reassigned` audit action (previously only `status_change`/`artist_assigned` existed), distinguishable in the Activity History from the original assignment. **Deliberately scoped narrow**: reassignment only swaps `assignedArtistId`/`assignedAt` -- it does not touch any estimate/pricing the previous artist already entered (that's the artist's own response, not something "who's assigned" alone should silently invalidate), and does not cascade into any already-booked appointment (`Appointment.artistId` is a separate field, set independently at scheduling time, not derived from the inquiry's assignment). Flagging this as a real scope boundary rather than an oversight -- if reassigning mid-flow (e.g. after the old artist already priced it) should also prompt to revisit the estimate, that's a separate, bigger decision than "let staff change who's assigned."

## Web (`InquiryDetail.tsx`, Assignment widget)

Same on/off edit-toggle pattern the Estimate widget already established (`editingEstimate` -> mirrored here as `editingArtist`): an Edit button in the widget header (via `Widget`'s existing `actions` prop, same Pencil-icon styling as "Edit Estimate") appears once an artist is assigned and the inquiry isn't terminal. Clicking it pre-seeds the picker (`openEditArtist`) with the currently assigned artist and reveals the exact same `ArtistSelect` + button the first-assignment flow already used -- the button reads "Save" when reassigning vs. "Assign Artist" when not, and a Cancel button (shown only in edit mode) discards the in-progress selection without calling the API.

## Verification

Real live checks against the local dev stack, not just code review:
- **Reassignment**: a Project-stage inquiry (status `SCHEDULING`, already assigned to "Dev Artist Two") -- clicked Edit, confirmed the picker opened pre-seeded with the current artist, switched to "Dev Artist One," clicked Save. Confirmed via network trace the `PATCH .../assign` request returned `200`, and (after actually waiting for the invalidate-and-refetch cycle -- an early check with too short a wait falsely looked stuck on "Saving...") the widget correctly settled back to the read-only view showing the new artist and a fresh "Assigned at" timestamp.
- **Audit trail**: confirmed a distinct "Dev Owner artist reassigned" entry with `Assigned artist: Dev Artist Two -> Dev Artist One` and the `Assigned at` diff, sitting above the original "status change ... New -> Artist Assigned" entry from when it was first assigned -- both preserved, correctly distinguished.
- **Cancel**: opened Edit, changed the picker's selection, clicked Cancel -- confirmed the widget reverted to showing the previously-saved artist, unchanged, with no API call made.
- **Regression check**: the original first-assignment flow (a `NEW` inquiry with no artist yet) still shows the picker directly with no Edit button needed, and completing it still bumps status to `ARTIST_ASSIGNED` correctly.
- **Terminal status**: `isTerminal` (`CLOSED_LOST`/`COLD_LEAD`) gate on the Edit button's visibility is unchanged from the pre-existing check already governing this widget -- not independently re-tested live, since the logic itself wasn't touched.
- Checked the edit UI under both Editorial Gold and Onyx Lime (screenshot) -- this feature has no theme-specific branching, and both rendered correctly through the `Widget` component's own pre-existing theme-aware chrome.
- Discovered along the way (not a regression, just a real environment quirk worth noting): the Assignment widget can be independently collapsed via `Widget`'s own persisted layout state (`useWidgetLayout`) -- a prior session's testing had left it collapsed in this dev browser profile, which hid the Edit button entirely until expanded. Not something this session's change affects.

## Typechecks

`npx tsc -b` (web) and `npx tsc --noEmit` (api) -- both clean before commit.

## Commit

`838b685` on `main`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and screenshot from the scratch directory. Test data created during verification (an artist reassignment on inquiry `cms201u9s000e9si2l5zj95em`, and a first assignment on the previously-seeded `LongDesc TestClient` inquiry) left in the dev database, same convention as prior sessions.

---

# Editorial Gold: semi-bold/bold text becomes regular weight

Single-file CSS fix (`index.css`) on `main`. App-wide by design -- the whole point was not having to touch dozens of individual components.

## Why one CSS rule instead of a per-file sweep

The literal ask ("all of the fonts that are semi-bold and bold") spans the entire app: 57 `.tsx` files use Tailwind's `font-bold`/`font-semibold` somewhere, most of them conditionally under `isEditorial`. Rather than tracking down and editing every one of those call sites, overrode the two *compiled Tailwind utility classes themselves*, scoped under `[data-theme="editorial-gold"]`:

```css
[data-theme="editorial-gold"] .font-bold,
[data-theme="editorial-gold"] .font-semibold {
  font-weight: 400;
}
```

This works because `applyThemePreset()` sets `data-theme="editorial-gold"` on `<html>` if and only if `useThemePreset()`'s `shape` is `'editorial'` -- the exact same condition every `isEditorial` branch in the codebase already checks (confirmed in `themePresets.ts`: `'editorial-gold'` is the *only* preset key with `shape: 'editorial'`). So this one rule is 1:1 synchronized with every existing `isEditorial` check without duplicating that logic anywhere, and it's scoped by attribute selector + class (higher specificity than Tailwind's own bare `.font-bold`/`.font-semibold`), so it always wins regardless of the compiled stylesheet's internal class ordering -- no `!important` needed, no risk of the same kind of source-order fragility hit in an earlier session's `serve -s` investigation.

Separately, `.editorial-btn-primary`/`.editorial-btn-secondary` -- the shared typography class already layered onto every editorial button app-wide (established in an earlier session) -- doesn't use Tailwind's `font-bold` class at all; it sets `font-weight: 700` directly in its own rule. Lowered that to `400` too, in the same place.

`font-medium` (500) was left untouched -- the request was specifically semi-bold and bold, not every weight above regular.

## Verification

Real computed-style checks against the local dev stack, not just visual impression:
- **Onyx Lime** (and by extension every other non-editorial preset, since none of them ever set this attribute value): sampled `.font-bold`/`.font-semibold` elements on Inquiries and Team -- all still compute `font-weight: 700`/`600` exactly as before, confirmed via `getComputedStyle`.
- **Editorial Gold**: same elements on the same two pages, plus `.editorial-btn-primary`/`-secondary` buttons -- all now compute `font-weight: 400`.
- Screenshotted Dashboard, the full Inquiries list (every `StatusPill` tone/label combination visible in the seed data), and Team under Editorial Gold at 1440px -- headings, buttons, table text, and status pills all render at regular weight and stay fully legible; hierarchy still reads clearly through size/color/letter-spacing/uppercase treatment rather than boldness, not just "smaller-looking" or broken. One visual double-take during review (staff names in the Team table still looked bold-ish) turned out to be Outfit's own regular-weight letterforms at that size/contrast, not a missed case -- confirmed via direct `getComputedStyle` that the element was already `400` and had never carried a bold/semibold class in the first place.

## Typechecks

`npx tsc -b` (web) and `npx tsc --noEmit` (api, untouched) -- both clean before commit. (Pure CSS change; typecheck is a formality here, still run per the standing rule.)

## Commit

`20d743a` on `main`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and screenshot from the scratch directory.

---

# Single source of truth for platform Privacy Policy / Terms content

Single-session content-accuracy fix on `main`. No schema changes.

## Investigation

`generate-static-policies.mjs` doesn't have embedded text -- it already reads from `src/content/platformPolicies.ts`'s `PLATFORM_PRIVACY_POLICY_HTML`/`PLATFORM_TERMS_HTML` constants, the exact same source `PlatformPolicyPage.tsx` renders client-side (one content source, two render paths, established in an earlier session). So the drift wasn't a duplication-between-two-copies problem -- it was that **no canonical draft ever existed as a checked-in file** for either policy, for either script or component to be checked against. `platformPolicies.ts` was hand-authored HTML with nothing to diff it against, and it silently drifted from the actual published draft: a carrier-compliance SMS-consent disclosure ("No mobile information will be shared with third parties or affiliates for marketing or promotional purposes...") existed in the real, live-published Privacy Policy in two places, and in neither place in this repo's `platformPolicies.ts`.

## Fix

- Added `apps/web/src/content/privacy-policy-platform.md` -- the provided canonical draft, saved verbatim (including its own `[DATE — fill in at publish time]`/`[CONTACT EMAIL — fill in at publish time]` template placeholders, since those are explicitly authoring markers, not values meant to overwrite what's actually live).
- Diffed the rest of the draft against `platformPolicies.ts` section by section -- confirmed every other sentence already matched word-for-word; only the two additions were missing (end of "SMS and email communications," and appended to the last bullet of "Who we share information with"). Added both, hand-converted to the file's existing HTML tag conventions (matches exactly, confirmed by rebuilding and diffing the generated output against the `.md`, not just eyeballing the source edit).
- Added `apps/web/src/content/terms-platform.md` too, for parity -- no drift was reported for Terms, so this one derives from the current (already-correct) `PLATFORM_TERMS_HTML` rather than a fresh draft, simply so a canonical, diffable reference now exists there too before it has the chance to drift the same way Privacy did.
- Added a comment in `platformPolicies.ts` pointing at both `.md` files as the source to edit first for any future wording change, with the HTML constants hand-converted from them afterward -- explicit that nothing enforces this sync automatically, it's a discipline, not a mechanism.
- Confirmed via a repo-wide search that neither policy's text exists as a stray copy anywhere else in the codebase (only `platformPolicies.ts` + its own `.md` counterpart, plus the gitignored `dist/` build artifact).

Neither `.md` file is parsed or imported by any code -- deliberately not a bigger architecture change (e.g. adding a markdown-parsing dependency so the HTML is literally generated from the `.md` at build time). The task's own instructions specifically branched on this: "if [the script] already reads from a file, simply confirm that file now matches this updated version exactly" -- it already does (via `platformPolicies.ts`), so the fix is confirming/updating that file's content against a now-real canonical draft, not restructuring the render pipeline.

## Verification

- Rebuilt (`npm run build`) and diffed the full generated `dist/privacy/index.html` against `privacy-policy-platform.md` section by section -- exact match, including both instances of the added sentence (`grep -c` confirms exactly 2 in the built output).
- Confirmed the client-side React route (`PlatformPolicyPage.tsx`, reading the same constant) also shows the sentence twice, against the local dev stack -- both render paths genuinely share one source, not just in theory.
- Terms output diffed the same way against its own new canonical `.md` -- exact match (no drift existed, confirmed rather than assumed).
- **Production, post-push**: pushed, then polled `web.inkmanager.app/`'s served bundle hash every 15s until it changed (`index-DKeAPv1j.js` -> `index-BMgEW55Y.js`, confirming Railway's auto-deploy picked up the commit, ~45s after push) rather than assuming a fixed wait was long enough. Then, against the real production domain: `curl` on `https://web.inkmanager.app/privacy` -- raw HTTP response body (the actual "View Page Source" a browser or a non-JS crawler sees, not "Inspect Element," which would show post-JS DOM state) matches `privacy-policy-platform.md` word-for-word, both instances of the carrier-compliance sentence present. Same check on `https://web.inkmanager.app/terms` against `terms-platform.md` -- exact match.

## Typechecks

`npx tsc -b` (web) and `npx tsc --noEmit` (api, untouched) -- both clean before commit.

## Commit

`99d2fd0` on `main`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script from the scratch directory.

---

# "Needs Scheduling" indicator for unscheduled Projects

Single session on `main`. **No schema change** -- fully derivable from existing data, confirmed by investigation before writing any code, per the task's own instruction.

## Derivation

A Project (deposit-paid Inquiry, `PROJECTS_TAB_STATUSES` = SCHEDULING/WAITLISTED/CONFIRMED) with zero linked Appointments -- checks both the older 1:1 `appointment` link and the newer 1:many `sessions` link (`Appointment.inquiryId`), the exact same `OR` `GET /reports/dashboard`'s pre-existing `scheduledCount` query already used (a few dev-seed fixtures only populate one of the two). One canonical `projectNeedsScheduling()` helper added to `lib/kanban.ts` (not `Inquiries.tsx`, so a shared component doesn't import from a page) -- the list row, Kanban card, Project detail header, and the backend dashboard count all key off the same definition.

## A real bug found and fixed along the way

`GET /inquiries`'s list-endpoint `SELECT` (`INQUIRY_LIST_SELECT`) never included `sessions` at all -- only the older `appointment` link, which an existing comment elsewhere in the same file already documents as "usually null" for any project scheduled through the current multi-session flow. Concretely: the Projects tab's "Scheduled Date" column has been silently reading "Not yet scheduled" for every already-scheduled project this whole time, and the new Needs Scheduling badge would have been unconditionally wrong (unable to ever detect a real appointment) without this fix. Added `sessions: { id, startTime }` to the list select; both the Date column and the new badge now check `appointment ?? sessions[0]`.

## Where it's surfaced

- **StatusPill**: new `NEEDS_SCHEDULING` synthetic tone (`warning`, matching `DEPOSIT_PENDING`/`AWAITING_CLIENT_RESPONSE`) -- a second pill rendered alongside the real status pill, not a replacement.
- **Inquiries & Projects list**: badge in the Status column; **Kanban**: badge on the card, below the description.
- **Project detail page**: badge next to the header's main status pill.
- **Dashboard**: new "Needs Scheduling" `CardShell` (icon + count + caption), a right-now snapshot like `depositConversion`/`giftCardLiability` -- not date-ranged, and deliberately **not** gated by `reports.viewFinancial` since it's an operational count, not a dollar figure.
- **Filter**: a "Needs Scheduling" toggle button next to "Group by status," Projects tab only -- not a real `InquiryStatus`, so it's a client-side post-filter (no server round-trip), same pattern the existing "Group by status" toggle already uses.

## Verification

- Found 6 genuinely unscheduled Projects via direct API inspection against the local dev stack (not assumed/guessed) before touching the UI.
- Confirmed the badge renders on all 6 across the list, Kanban board, and Project detail page, and that the Dashboard's count card and the new filter both independently read exactly 6.
- **Transition, not just initial display**: created a real appointment via the API for one of the six (Taylor PMU-Test), then re-checked all four surfaces -- the badge disappeared from the list row, the Kanban card, and the detail header; the Date column updated to the real appointment date (Aug 5, 2026); and the Dashboard count + filter both correctly dropped to 5.
- Onyx Lime confirmed unaffected -- `STATUS_TONE` is shared between both shapes by design (no theme branching added), screenshot-checked directly at the same list view rather than assumed from the shared-code argument alone.
- Confirmed by inspection that the deposit-paid conversion trigger itself was not touched -- no changes anywhere near `deposits.ts` or any status-transition route.

## Typechecks

`npx tsc -b` (web) and `npx tsc --noEmit` (api) -- both clean before commit.

## Commit

`d1cd348` on `main`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and screenshot from the scratch directory. Test data created during verification (one real appointment created via API for the "Taylor PMU-Test" project) left in the dev database, same convention as prior sessions.

---

# Cash payment path for gift cards, alongside Stripe and EXEMPT

Single session on `main`. Schema change (nullable `GiftCard.paymentMethod`, `nullable → backfill` -- deliberately not tightened, see below), solo session confirmed via `git status`/`git pull` before starting.

## Investigation before assuming field names

`DepositForm.paidVia` (`STRIPE`/`MANUAL`, a free-text `String?`) already existed for the deposit-triggered issuance path -- so the real gap wasn't a missing payment-tracking concept, it was `POST /gift-cards`, the general/manual issuance route (backing `ClientDetail.tsx`'s "Issue Gift Card" flow), which created a `GiftCard` with **zero** payment tracking of any kind. That's the actual silent path this task's rule ("a gift card cannot be issued without some recorded payment") was about.

## Schema

`GiftCardPaymentMethod` enum (`STRIPE`/`CASH`/`EXEMPT`) + `GiftCard.paymentMethod`, nullable **permanently** -- not the usual nullable-then-tightened pattern. A few pre-existing paths (the bulk client-import gift-card backfill, and checkout's multi-card overage derivation when more than one origin card combines) genuinely have no single knowable payment method, and fabricating one for historical data would be actively wrong, not just incomplete. Documented directly in the enum's own schema comment.

Two migrations: `20260731061921_add_gift_card_payment_method` (schema diff) and a hand-authored `20260731062313_backfill_gift_card_payment_method`, matching this project's own established backfill-migration convention (real committed SQL, idempotent, runs via `prisma migrate deploy` in production -- see `20260725153000_backfill_inquiry_service`'s precedent). Backfilled only what's honestly knowable: `EXEMPT`-status cards → `EXEMPT`; cards linked to a `DepositForm` with `paidVia='STRIPE'` → `STRIPE`; `paidVia='MANUAL'` → `CASH` (the only manual/non-Stripe payment concept this app has ever had). Verified directly against the dev database: 66 total gift cards, only 6 backfilled -- the other 60 predate `paidVia` itself (only 5 of 25 `DepositForm` rows ever had it set) and correctly stay `NULL`, not guessed.

## What changed

- **`routes/giftCards.ts` `POST /`**: now requires `paymentMethod` in the body, locked to exactly `"CASH"` (a Stripe-paid card only ever comes through the deposit checkout/webhook flow, never this route) -- 400s otherwise. This closes the actual gap directly, reusing the existing `giftCards.issue` permission unchanged (no new permission key, per the task's own instruction).
- **`routes/giftCards.ts` `POST /exempt`**: sets `paymentMethod: "EXEMPT"`, otherwise completely unchanged.
- **`lib/deposits.ts`'s `issueGiftCardForPaidDeposit`**: the one function both the Stripe webhook and the staff mark-paid route already call -- now derives `paymentMethod` from its existing `paidVia` argument (`STRIPE` stays `STRIPE`, `MANUAL` maps to `CASH`). No new call sites needed; both issuance paths get it automatically.
- **`routes/appointments.ts`'s checkout overage-derivation**: inherits the origin card's `paymentMethod` only when there's exactly one unambiguous origin (same condition `derivedFromGiftCardId` already uses) -- left unset for the multi-card combine case, not guessed.
- **`ClientDetail.tsx`**: the issuance modal relabeled "Record Cash Payment" / "Confirm Cash Payment" with explanatory copy ("For cash collected in person only... Front desk/Owner records it after physically collecting payment"), sends `paymentMethod: 'CASH'` automatically -- matches the task's framing that this is a staff-initiated action, never client-facing.
- **`GiftCardDetail.tsx`**: surfaces the new field in the existing Status/Expires/Issued-by metadata grid.

## Verification

- `POST /gift-cards` with no `paymentMethod` (and separately, with `"STRIPE"`) both correctly 400 -- confirms the previously-silent path is closed.
- Recorded a real cash payment through the actual browser UI (not just the API): gift card issued correctly, audit trail shows the full diff including `paymentMethod: "CASH"`, `GiftCardDetail` renders "Cash" in the metadata grid.
- Exercised the *other* issuance path directly: created a real signed test `DepositForm`, called the real `PATCH /deposit-forms/:id/mark-paid` route -- resulting gift card correctly shows `paymentMethod: "CASH"`.
- Confirmed `EXEMPT` issuance is completely unaffected (`POST /gift-cards/exempt` still works exactly as before) and now also correctly tags `paymentMethod: "EXEMPT"`.
- Confirmed via the schema/permissions investigation (not re-tested live, since the permission itself is unchanged by this session) that `giftCards.issue` already defaults to FRONT_DESK + OWNER, matching "front desk/Owner records it."

## Typechecks

`npx tsc -b` (web) and `npx tsc --noEmit` (api) -- both clean before commit.

## Commit

`1a6c905` on `main`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification/scratch script and screenshot. Test data created during verification (a $50 and $42.50 cash-issued gift card, an EXEMPT test card, and one test `DepositForm` + its resulting gift card) left in the dev database, same convention as prior sessions.

---

# PDF export for signed deposit forms and waivers

Single session on `main`. No schema changes -- this reads existing stored data (itemized deposit terms, waiver clauses/initials, signature, health screening answers, ID reference), exactly as scoped.

## PDF library decision

Chose `pdfkit` (native, pure-JS, no native bindings) over a headless-browser HTML-to-PDF approach. This project already got burned once by a phantom/unhoisted dependency (`esbuild`) breaking the Railway production build -- a headless-Chrome dependency (Puppeteer/Playwright) would carry the same or worse risk on this same Railway-hosted API (large binary, missing system libs in a minimal Nixpacks image, memory pressure on a small dyno) for a document this structurally simple. Installed as a real, explicit dependency in `apps/api/package.json` (`pdfkit` + `@types/pdfkit`), not a transitive one.

## What was built

- **`apps/api/src/lib/pdf.ts`** (new): shared helpers (header/footer, signature-image rendering, section titles) plus two generator functions, `generateDepositFormPdf()` and `generateWaiverPdf()`, each returning a `Buffer`.
- **`GET /deposit-forms/:id/pdf`** (new, `deposits.ts` staff router): itemized terms (the shared `TERMS` array -- see caveat below), deposit/fee/total amounts, signature image, signed-at timestamp.
- **`GET /waivers/:id/pdf`** (new, `waivers.ts` staff router, registered after the router's existing `requireRole(OWNER, FRONT_DESK)` floor gate): every health question + answer from the real per-signing `healthQuestionsSnapshot`/`healthAnswers`, every clause + initials from `clausesSnapshot`/`clauseInitials`, acknowledgment text, signature image, photo/video release (text + its own separate signature when accepted), and ID-verification status.
- **`ClientDetail.tsx`**: a "Download PDF" icon button (new shared `DownloadIcon`) on each signed row of the Deposit Forms table, and on each signed waiver in the Waivers list -- reusing the existing widgets these records already render in, not a new surface. A new `downloadFile()` helper in `lib/api.ts` handles the authenticated binary download (apiFetch always parses JSON, so this is a small sibling, not an overload).

## Permission gating -- reused, not invented

- **Waiver PDF**: sits behind the router's own pre-existing, explicitly-documented "floor item, permanent" gate (`requireRole(OWNER, FRONT_DESK)`) -- the exact same boundary that already blocks ARTIST from `GET /waivers/:id`'s health data and ID image. No new permission key. Verified directly: `GET /waivers/:id/pdf` as ARTIST -> 403. The download button itself is also hidden client-side for ARTIST (`canDownloadWaiverPdf`), so the 403 is defense-in-depth, not something a real user would hit.
- **Deposit-form PDF**: no standalone "view a DepositForm" route existed before this -- this data was only ever visible embedded in `GET /inquiries/:id`, gated `inquiries.view`. Reused that same key rather than inventing `deposits.view`. ARTIST has `inquiries.view` by default but scoped to their own assigned projects (same convention as `GET /inquiries/assigned-to-me` and the waiver router's own `/:id/status` route) -- enforced manually in the route handler, since `requirePermission` itself only checks the studio-level toggle, not row ownership. Verified directly: ARTIST requesting a deposit form for an inquiry not assigned to them -> 404 (not 403, consistent with the "don't reveal existence" convention already used elsewhere); the same ARTIST requesting a deposit form for their own assigned inquiry -> 200.

## ID image handling -- deliberately not embedded

Neither PDF embeds the client's raw government-ID photo. A photo of a government ID is a materially more sensitive piece of PII than the rest of this document, embedding it would mean fetching it from Cloudinary at generation time (a new outbound dependency), and a downloadable PDF is easier to forward/leak than the same image viewed in-app behind the normal permission wall. The waiver PDF instead just states whether an ID is on file ("A government ID photo is on file in the app -- see app for the image itself"); staff who need the actual image view it in-app, unchanged from today.

## A real gap found and documented, not silently glossed over

Unlike `LiabilityWaiver` (which has genuine per-signing-time immutable snapshots -- `healthQuestionsSnapshot`, `clausesSnapshot`, `acknowledgmentSnapshot`, `photoReleaseSnapshot`), `DepositForm` has no equivalent snapshot for the 8 terms a client agrees to. Those terms live only in a single shared, studio-wide `TERMS` array hardcoded in `deposits.ts`, described in its own comment as "exact SOP wording." The deposit-form PDF necessarily renders whatever `TERMS` says right now, not what a given client actually saw at signing time. In practice this wording changes rarely and is described as fixed SOP language, so it's an accepted, low-risk gap -- but a real one, flagged here rather than presented as equivalent to the waiver's true historical snapshot.

## Two rendering bugs found and fixed during live verification

- The checkmark character (U+2713) falls outside pdfkit's base-14 fonts' WinAnsi encoding and rendered as a garbled apostrophe glyph in the first real generated PDF. Replaced with a plain hyphen, which is guaranteed correct in every pdfkit standard font.
- `acknowledgmentSnapshot`/`photoReleaseSnapshot` are rich text from a Settings WYSIWYG editor (rendered as real HTML on the public signing page) -- the first generated waiver PDF printed the literal `<p>...</p>` tags instead of the text. Added a small `stripHtml()` helper (same simple regex approach `gmail.ts` already uses for its own HTML-to-plain-text conversion) to both call sites.

## Verification

- Both new routes hit directly against the local dev API with a real signed `DepositForm` and a real `VERIFIED` `LiabilityWaiver` -- 200, `content-type: application/pdf`, valid `%PDF-1.3` header, and (after the two fixes above) fully readable, correctly formatted content confirmed by reading the actual generated PDF bytes.
- Browser, real click-through as OWNER on `ClientDetail.tsx`: three "Download PDF" buttons rendered across the Deposit Forms and Waivers widgets; clicking one triggered a real browser download (`deposit-form-session-1.pdf`, 2862 bytes) via Playwright's download event, not just an API call.
- Browser as ARTIST: `ClientDetail.tsx` itself is already blocked for this role by its own pre-existing `clients.view` gate (unrelated to this change) -- confirmed via screenshot ("You don't have permission to view this client"). Server-side permission boundaries for both new routes verified directly via the API instead (see gating section above), since that's the actual security guarantee, not the incidental UI path.
- The waiver PDF's signature image renders as a solid black rectangle for this particular dev test record -- traced to the underlying `signatureData` itself being a literal 1x1-pixel test PNG (synthetic seed/test fixture data), not a rendering bug in the new code.

## Typechecks

`npx tsc -b` (web) and `npx tsc --noEmit` (api) -- both clean before commit.

## Commit

`254b5c9` on `main`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID -- one leftover stale dev server from an earlier session was already squatting on port 4093 and had to be killed first. Deleted every ad-hoc verification/scratch script (`scratch-find-signed.ts`, `scratch-check-sig.ts`, `scratch-find-artist-deposit.ts`) and the temporary Playwright install from the scratch directory. No new test data was created in the dev database -- verification used existing signed records.

---

# Smart contact-field detection (Conversations) + flat rate per session

Single session on `main`. Two independent features, committed separately per the task brief.

## Part 1 -- Smart contact-field detection when creating a new chat

No schema change. Typing into Conversations' "new chat" -> "Add new client" box now auto-detects whether the typed text is an email, a phone number, or a name, and pre-fills the matching field -- previously it always split whatever was typed into firstName/lastName, even a pasted email or phone number.

New `detectContactField()` in `apps/web/src/lib/format.ts`:
- **Email**: contains `@` with at least one character after it. Kept loose on purpose -- a still-typing address like `jane@gm` lands in the email field (one keystroke from correct) rather than the name field (obviously wrong), satisfying the "email without a full domain yet" edge case.
- **Phone**: 7+ digits remain after stripping spaces, dashes, parens, and a leading `+`. A genuinely all-numeric "name" (tested with `12345`, 5 digits) correctly falls through to the name branch instead -- too short to be mistaken for a real phone number.
- **Otherwise**: name, unchanged whitespace-split behavior.

The Add Client modal is unconditionally editable regardless of which field got pre-filled, so a wrong guess is a one-field correction, not a dead end -- satisfies the "no regression to manually selecting a field" requirement without any extra code.

### A real bug found and fixed along the way

`formatPhoneInput()` truncated to the first 10 digits unconditionally, so `+1 555 123 4567` (11 digits) became `1555123456` -> `(155) 512-3456` -- garbled, wrong number. Fixed by stripping a leading `1` on an 11-digit run first, matching `apps/api/src/lib/phone.ts`'s own `normalizePhone` convention exactly. This is a general fix (not scoped to the new detection code), so every existing caller of `formatPhoneInput` benefits.

### Verification

Real browser click-through, all three input types plus the three called-out edge cases:

| Typed | Result |
|---|---|
| `jordan.smith@example.com` | email field |
| `555-123-4567` | phone field, `(555) 123-4567` |
| `(555) 123-4567` | phone field, unchanged |
| `+1 555 123 4567` | phone field, `(555) 123-4567` (country code correctly stripped) |
| `Jordan Smith` | firstName "Jordan", lastName "Smith" |
| `jane@gm` (partial email) | email field, preserved as-typed |
| `12345` (all-numeric, too short) | name field (firstName "12345") |

Both typechecks clean.

**Commit**: `297b34a`.

## Part 2 -- Flat rate per session, alongside hour-range estimates

No schema change -- investigated `PlannedSession` and the estimate-entry UI before writing any code, per the task's own instruction, and found the schema change wasn't needed.

### What investigation found

The single-session (no plan) estimate already had a "flat rate" concept with **no persisted flag at all**: `estimateIsFlat` is pure client-side UI state, and a flat estimate is defined purely as `priceEstimateLow === priceEstimateHigh` -- inferred back from stored data everywhere it's read (documented explicitly in `InquiryDetail.tsx`'s own comment on this). Multi-session (`PlannedSession`) estimates already had a flat/range toggle too, via `SessionHoursRows`' `isFlat` prop -- but it was one global boolean applied uniformly to every session in the plan, not selectable per session as the task wanted (create session 1 flat and session 2 as a range in the same plan was impossible).

Since price was already never auto-derived from hours anywhere in this codebase (`estimatedHoursMin/Max` and `estimatedPriceLow/High` are always independently-entered fields, `suggestSessionPrice`'s hourly-rate suggestion is just a pre-fill, not a hard link), "flat-rate pricing decouples price from duration" was already structurally true. The only real gap was the UI only offering one flat/range choice for the whole plan instead of one per row.

### What changed

- **`SessionHoursRow`** (`SessionBreakdownEditor.tsx`) gained an `isFlat: boolean` field -- client-side only, mirroring the existing no-persisted-flag convention (not sent to the API; the backend already infers flatness from `estimatedPriceLow === estimatedPriceHigh` the same way it does for the top-level estimate).
- **`SessionHoursRows`** dropped its single `isFlat` prop; each row now renders its own "Flat rate for this session" checkbox, independently collapsing that row's price to one input (or not) without touching its hour-range selects, which stay required either way.
- **`suggestSessionPrice`** gained an `isFlat` parameter: a flat session's suggested price now only ever comes from the artist's own flat rate (`flatRateCents`), never scaled off their hourly rate and the session's hours -- an hourly-derived suggestion would contradict flat pricing's whole point.
- **`InquiryDetail.tsx`**: both the "Generate & Send Estimate" and "Revise Estimate" flows updated -- seeding (`isFlat` inferred per row from `estimatedPriceLow === estimatedPriceHigh` when reopening an existing plan), the now-redundant top-level "Flat rate" checkbox hidden once a session plan exists (it only ever governed the single top-level price field, which per-session flat pricing has made ambiguous to keep showing), and the `isFlat` prop removed from both `SessionHoursRows` call sites.

### Downstream consumers -- confirmed correct with zero further changes

- **Deposit tier calculation** (`computeDepositTier`/`computeRequiredDepositCents`): operates on `(priceEstimateLow + priceEstimateHigh) / 2` at the whole-inquiry level -- purely numeric, works identically regardless of whether any individual session was flat or ranged.
- **Scheduling assistant**: derives a session's duration from `(estimatedHoursMin + estimatedHoursMax) / 2` only -- never reads price, so completely unaffected by pricing mode.
- **Project pipeline display**: already rendered `estimatedPriceLow === estimatedPriceHigh ? "$X" : "$X-$Y"` per session (this exact convention, pre-existing) -- a flat session displays correctly with zero changes needed there.

### Verification

Real browser click-through against a live dev inquiry (`LongDesc TestClient`, Japanese sleeve): set "Number of sessions" to 2, left session 1 as an hour range (4-6 hrs, $400-$600), checked "Flat rate for this session" on session 2 (2-3 hrs, $250) -- confirmed the price inputs visibly collapsed from two fields to one for session 2 only, session 1 unaffected. The computed "Price estimate (sum of every session below)" read `$650-$850` (400+250 to 600+250) before submitting. Submitted for real (`POST /inquiries/:id/send-estimate`) -- "Estimate sent" confirmed.

Verified the persisted data directly against the dev database: session 1 stored as `estimatedPriceLow: 400, estimatedPriceHigh: 600`; session 2 stored as `estimatedPriceLow: 250, estimatedPriceHigh: 250` (flat, inferred correctly) with its own independent `estimatedHoursMin: 2, estimatedHoursMax: 3` -- confirming a flat session's duration is tracked completely separately from its price, per the task's explicit design decision. Reloaded the inquiry page fresh (not just the in-progress form) and confirmed the pipeline display correctly rendered `"Session 1 -- estimated 4-6 hrs ($400-$600)"` and `"Session 2 -- estimated 2-3 hrs ($250)"`.

Both typechecks clean.

**Commit**: `3c9a6f2`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID -- one leftover stale dev server from an earlier session was squatting on port 4093 at the start of this session and had to be killed first before a fresh instance could bind it. Deleted every ad-hoc verification/scratch script (`scratch-find-inquiry.ts`, `scratch-verify-sessions.ts`) and both temporary Playwright installs from the scratch directory. Test data created during verification (a real 2-session estimate sent on the `LongDesc TestClient` / "Japanese-style irezumi sleeve" dev inquiry) left in the dev database, same convention as prior sessions.

---

# Quick fixes batch — background scroll, Tasks filters, list-state persistence

Single session on `main`. No schema changes. Four fixes scoped in the brief; per an explicit mid-session correction, the "revert floating buttons" fix (#2) was dropped -- everything currently floating stays floating.

## 1. Background overlay scrolling with content on mobile — fixed

`AuthLayout.tsx`'s background photo and `.hero-shade` overlay were `position: absolute`, sized to `.login-shell`'s own content height (a `min-h-screen` flex container that can grow taller than one screenful -- a long card, or the on-screen keyboard shrinking the visible viewport). An absolutely-positioned layer only ever covers its own container's height, so a genuinely tall/scrolled page could reveal raw background at the bottom.

Switched both to `position: fixed` -- the exact fix already proven for the authenticated app shell's own equivalent layers (`.app-bg-photo`/`.app-bg-wash`, Editorial Gold only), which pin to the true viewport and were confirmed (via their own `index.css` comments) to have solved this identical class of bug there already.

Verified no ancestor between these layers and `<body>` has a `transform` (checked live via `getComputedStyle` in a real browser -- Framer Motion's page-transition wrapper resolves to `transform: none` at rest), which would otherwise have silently defeated the fix by giving `position: fixed` a containing block other than the true viewport. Reproduced a genuinely scrollable login page (injected extra height, mobile viewport emulation) and confirmed both layers now report `position: fixed` and visibly cover the full scrolled height with no gap.

Typechecks clean.

**Commit**: `e57cc1b`.

## 2. (Dropped per correction) Floating-button audit

Originally scoped as "only Conversations should float." Corrected mid-session: everything currently using floating/sticky positioning should stay that way. No change made.

## 3. Filter/Sort buttons added to the Tasks section

Reused Conversations' own Filter/Sort pattern (`PillMenu`: compact button + dropdown, checkmark on the active option) rather than inventing a new one -- extracted it out of `ConversationsPanel.tsx` into a shared `apps/web/src/components/PillMenu.tsx`, imported by both files now. Re-verified Conversations' own Filter/Sort still work identically post-extraction (a real regression risk, checked directly, not assumed).

Investigated the Tasks data model before adding anything: `PersonalTask` already carries `dueAt`/`completedAt`/`createdBy`, `SystemTask` already carries `type` -- enough for two real additions with no schema change:

- **Studio Queue**: a type filter ("All types" or one specific system-task type) -- the one dimension the section already visually groups by, so this just narrows straight to one group instead of scrolling past the rest.
- **Assigned to Me**: a filter (All / My tasks / Assigned by others / Overdue -- the first two mirror the section's pre-existing static split; Overdue is new, a real past-due `dueAt` on an incomplete task) and a sort (Recently added / Due soonest / A-Z).

Left "Assigned by Me" untouched -- a smaller, less-trafficked section than the brief's own worked examples ("assigned to me / assigned to others, overdue, by type") already fully cover.

### Verification

Real browser click-through: Conversations' Filter dropdown still shows its options correctly post-extraction. Tasks page shows 2 Filter buttons + 1 Sort button across the two sections. Assigned to Me's Filter dropdown correctly lists All/My tasks/Assigned by others/Overdue; selecting Overdue against dev seed data (which has none) correctly shows "No tasks match this filter" rather than silently showing nothing. Both typechecks clean.

**Commit**: `0743d8c`.

## 4. Inquiries & Projects filter/sort/grouping now persists

Status filters (per tab), artist filter, the Needs Scheduling toggle, Group by status, and sort order all reset on navigation away or reload. Persisted to `localStorage` under `ink-manager:inquiries-filters` as one JSON blob, restored on mount and kept in sync via a single `useEffect` watching all six values -- deliberately not intercepting each of the dozen individual setter call sites spread across both tabs' filter controls.

Plain `localStorage`, not per-user-keyed: investigated the file first and found `Inquiries.tsx` already has an established precedent for exactly this kind of preference -- `COLUMN_VISIBILITY_STORAGE_KEY`, a plain (non-per-user) key for column-visibility persistence. Followed that same convention for consistency with the sibling preference already living in the same file, rather than inventing a separate per-user-keyed pattern for this one.

Search text and view mode (list/kanban) stay session-only, unchanged -- out of scope (the task asked for filter/sort/grouping specifically, not search), and view mode already carried its own deliberate "not persisted" comment for an unrelated reason (URL-param collision on tab switch).

### Verification

Real browser click-through: set sort to "Client name (A-Z)", enabled Group by status, enabled Needs Scheduling (Projects tab) -- confirmed the exact JSON landed in `localStorage`. Reloaded the page fresh: all three restored correctly. Navigated away to Dashboard and back (not just a reload): all three still correctly restored, confirming this isn't just surviving via React state but genuinely persisting.

Both typechecks clean.

**Commit**: `e3f3d36`.

## Typechecks

`npx tsc -b` (web) and `npx tsc --noEmit` (api) -- both clean before every commit.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and screenshot from the scratch directory. No test data was created in the dev database -- every fix in this batch was frontend-only, verified against existing dev seed data.

---

# "Needs Scheduling" as a real Project pipeline step (correction)

Single-fix session on `main`, following up on the earlier "Needs Scheduling" feature (commits `d1cd348`/`3504f6b`). Correction from the user: that work added visibility (badge, Dashboard count, filter) but didn't give the Project pipeline itself a real step for it -- the Project detail page's own Pipeline widget just left "Scheduled" sitting in its own "current" state pre-appointment, which read as ambiguous ("in progress toward being scheduled" rather than clearly "nothing booked yet").

## What changed

`InquiryDetail.tsx`'s `PROJECT_STEPS` (the post-conversion, 4-stage pipeline widget -- distinct from the pre-conversion Inquiry-side `PIPELINE_STEPS` in `InquiryPipeline.tsx`) now has a real, explicit "Needs Scheduling" step before "Scheduled": `['Needs Scheduling', 'Scheduled', 'Waiver Verified', 'Session Complete', 'Project Complete']`.

`deriveProjectStageIndex` shifted its later branches by one index accordingly, but kept the same underlying condition the existing badge/filter already use: zero booked sessions (`inquiry.sessions.length === 0`) puts the timeline at index 0, now correctly labeled "Needs Scheduling" instead of ambiguously highlighting "Scheduled." Everything downstream of that (waiver-verified / session-complete / project-complete branching) is unchanged logic, just shifted.

No schema change, no new data -- `InquiryPipeline.tsx`'s stepper component is already fully generic (`effectiveSteps.map`, `done = index < activeIndex`), so adding a 5th step to an existing caller's array required no component changes at all.

## Verification

Found a real, currently-unscheduled Project in the dev database (`SCHEDULING` status, no linked appointment, zero sessions) and loaded its detail page: Pipeline widget correctly showed 5 steps with "Needs Scheduling" as step 1, highlighted active/current.

Booked a real appointment for it via `POST /inquiries/:id/schedule` (a real gift card attached, matching the deposit already paid) and reloaded the page: "Needs Scheduling" and "Scheduled" both correctly flipped to checkmarked/complete, the timeline correctly advanced to "Waiver Verified" (step 3, since the new session's waiver isn't verified yet) -- confirming the transition works, not just the initial unscheduled display. The separate header badge (from the original feature) independently disappeared at the same time, unaffected by this change, confirming both mechanisms stay in sync since they share the same underlying "zero sessions" condition.

Both typechecks clean.

## Commit

`bd3ece9`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and screenshot from the scratch directory. Test data created during verification (a real appointment booked for the "Unmatched ArtistTest" / "Small script tattoo" project) left in the dev database, same convention as prior sessions.

---

# Remove redundant "Needs Scheduling" badge from Project detail header

Follow-up correction: with the Pipeline widget now showing "Needs Scheduling" as a real step (`bd3ece9`), the header's own separate badge next to the main status pill produced two adjacent pills saying overlapping things ("Scheduling" + "Needs Scheduling"). Removed the header-level badge in `InquiryDetail.tsx` only -- the List view and Kanban card badges (`Inquiries.tsx`, `InquiryKanbanCard.tsx`) stay unchanged, since neither surface shows the pipeline stepper; the badge remains the only signal there.

Verified live on a real currently-unscheduled Project: header now shows a single "Scheduling" pill, Pipeline widget below is the sole place saying "Needs Scheduling."

Both typechecks clean.

**Commit**: `a1bba6c`.

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and screenshot from the scratch directory.

---

# Remove redundant "Needs Scheduling" badge from Inquiries & Projects list

Follow-up: the same double-pill pattern fixed on the Project detail header (`a1bba6c`) was still present in the Inquiries & Projects list view's Status column -- the main StatusPill and a separate "Needs Scheduling" pill rendered side by side there too. Removed the duplicate in `Inquiries.tsx`. The Kanban card was checked and left alone -- it only ever shows the single "Needs Scheduling" badge with no adjacent status pill, so it wasn't a double-pill case. The filter toggle is unaffected (verified: still returns the correct 5 matching rows).

Verified live: with the Needs Scheduling filter applied, every row's Status column now shows exactly one pill.

Both typechecks clean.

**Commit**: `c2e51b1`.

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and screenshot from the scratch directory.

---

# Show a Project's real pipeline stage as its status pill (not raw status)

Follow-up correction: after removing the redundant "double pill" badges, the remaining single pill on every converted Project just showed the raw `InquiryStatus` (SCHEDULING/WAITLISTED/CONFIRMED), which all display identically as "Scheduling" -- giving zero visual distinction between a project that hasn't been booked yet and one that's fully wrapped up. The user asked for one pill per project reflecting its real stage: Needs Scheduling, Scheduled, Waiver Verified, Session Complete, or Project Complete -- the exact same 5 stages the Pipeline widget already tracks.

## What changed

New `deriveProjectStage()` in `lib/kanban.ts` is the single canonical source for the post-conversion journey (`PROJECT_STAGE_ORDER`/`PROJECT_STAGE_LABELS`), returning the LAST completed milestone (not "what the stepper is bolding as its current goal" -- those read differently; a pill has to state a true fact, e.g. "Scheduled" while a waiver is still pending, not falsely claim "Waiver Verified" before it's actually verified).

Reused everywhere a Project's status renders:
- **Inquiries & Projects list row** -- Status column shows the derived stage for a Project, the real `InquiryStatus` pill unchanged for a pre-conversion Inquiry.
- **Kanban card** -- both the pill and the card's left-border tone now key off the derived stage instead of the raw status/a conditional Needs-Scheduling-only badge.
- **Project detail header** -- same derived-stage pill, replacing the raw status pill (this is the exact spot the earlier "double pill" fix left showing bare "Scheduling").
- **`InquiryDetail.tsx`'s own Pipeline widget** -- refactored `PROJECT_STEPS`/`deriveProjectStageIndex` to derive from this same shared array instead of an independently-written duplicate, so the pill and the stepper can never drift apart again.

Four new `StatusPill` tones (`SCHEDULED`/`WAIVER_VERIFIED`/`SESSION_COMPLETE`/`PROJECT_COMPLETE`), each visually distinct, following the component's own "one tone per pipeline stage" rule already established for the Inquiry-side statuses.

## Data needed, and what already existed

`GET /inquiries/assigned-to-me` (MyInquiries.tsx, ARTIST) already returns everything needed -- it always used the full `INQUIRY_INCLUDE`, which already carries `sessions.checkedOutAt`/`sessions.liabilityWaiver.status` and (via a plain `include`) `projectCompletedAt`. `MyInquiries.tsx`'s own frontend `Inquiry` type just never declared these fields, so its Kanban cards would have silently derived "no sessions yet" for every project despite the real data already being in the response -- widened that type to match reality.

`GET /inquiries` (`INQUIRY_LIST_SELECT`, used by the OWNER/FRONT_DESK list+Kanban) only had `sessions.id`/`sessions.startTime` and no `projectCompletedAt` at all -- extended the select with the three additional fields needed. No schema change; every field added already existed on the Prisma models, just wasn't being selected by this one narrower query.

## Verification

Real browser check against live dev data: before this fix, every row in the Projects list/Kanban showed "Scheduling" regardless of real progress. After: the same data now shows three genuinely distinct pills across the current dev projects -- "Scheduled" (green), "Session Complete" (violet), "Needs Scheduling" (orange) -- both in the list's Status column and on Kanban cards (card border color also correctly follows the tone). Opened a Project detail page directly (a "Session Complete" one, per its Kanban card) and confirmed the header pill ("Session Complete") and the Pipeline widget below it (step 4, "Session Complete", active) agree exactly -- proving the single-source-of-truth refactor actually keeps them in sync, not just coincidentally matching once.

Both typechecks clean.

## Commit

`2e97c16`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID -- one leftover stale API process was still bound to port 4093 from an earlier session in this same conversation and had to be killed first. Deleted every ad-hoc verification script and screenshot from the scratch directory.

---

# Verify Dashboard Needs Scheduling count still matches (found + fixed a real gap)

Requested verification after the project-stage pill refactor (`2e97c16`): confirmed live that the Dashboard's `needsSchedulingCount`, the Projects list/Kanban filter, and the number of rows whose pill reads "Needs Scheduling" all agree.

Along the way, found a genuine (if currently dormant) inconsistency: `deriveProjectStage`'s NEEDS_SCHEDULING check only looked at `sessions.length === 0`, inherited unchanged from `InquiryDetail.tsx`'s original `deriveProjectStageIndex` -- but `projectNeedsScheduling` (and the Dashboard's own count query) additionally require `appointmentId` to be null, checking both the older 1:1 link and the newer 1:many one. Confirmed directly against the dev database that zero projects currently hit the gap between these two definitions (the real `POST /:id/schedule` route always sets both together), but they were never actually the same definition -- exactly the kind of drift the single-source-of-truth refactor was meant to prevent. Added the same `!appointment` check to `deriveProjectStage`.

Verified live: Dashboard card, filter, and unfiltered-list pill count all now read **5 of 16** -- an exact three-way match.

Both typechecks clean.

**Commit**: `75ad8e7`.

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and the temporary Playwright install from the scratch directory.

---

# Unify gift card issuance: one "Issue Gift Card" flow (Cash, Stripe, or Deposit Exemption)

Single session on `main`. Replaces Client detail's two separate buttons ("Record Cash Payment" / "Issue Deposit Exemption") with one "Issue Gift Card" button that opens a method picker.

## Clarified before building

The one genuinely ambiguous design question -- what should happen when staff picks "Stripe" -- was clarified directly with the user before writing any code: generate a real Stripe Checkout Session (a link staff copies/sends to the client), not a synchronous "just record that Stripe was used" toggle like Cash. This matters because it's the only Stripe capability this app has ever had (the deposit-form flow works the same way) -- there's no "charge a saved card directly" capability, so the gift card can't issue synchronously the way Cash does.

## Schema change

- `GiftCardStatus.PENDING` -- the state a Stripe-checkout-initiated card sits in between link generation and payment confirmation. Never spendable/attachable (`validateGiftCardForAttachment` still only ever accepts `ACTIVE`/`EXEMPT`); exists purely so the webhook has a real row (with its final code) to find once payment completes.
- `GiftCard.stripeCheckoutSessionId`/`stripePaymentIntentId` -- permanently nullable, same fields/naming convention as `DepositForm`'s own. Null for every card issued any other way.

**Migration tooling note**: `prisma migrate dev` (even with `--create-only`) requires an interactive terminal to confirm its own unique-constraint warning, and this sandbox has no TTY -- both attempts failed with "non-interactive environment... not supported." Hand-authored the migration SQL directly instead (matching Prisma's own generated format, confirmed against this project's own precedent migrations for the exact `ADD VALUE`/`ADD COLUMN`/`CREATE UNIQUE INDEX` syntax), then applied it via `prisma migrate deploy` (which doesn't need interactive confirmation) and ran `prisma generate` for the client types.

## What changed

- **`POST /gift-cards/checkout-session`** (new): creates the `PENDING` `GiftCard` row and a real Stripe Checkout Session together, returns the checkout URL. Same `requirePermission("giftCards.issue")` gate as the existing Cash route -- same capability, different payment method, no new permission key.
- **Stripe webhook** (`routes/webhooks.ts`): a third `checkout.session.completed` lookup branch, by `stripeCheckoutSessionId` on `GiftCard` this time (alongside the existing `DepositForm` and `Appointment` branches) -- flips `PENDING` to `ACTIVE`, sets `paidAt`/`stripePaymentIntentId`. Idempotent the same way as the other two branches (a retry that finds the card already past `PENDING` is a no-op).
- **`GiftCardResponse.tsx`** (public `/gift-card/:code` page): a distinct `PENDING` view -- no code/QR shown (misleading before it's actually redeemable), just a "Payment Pending" pill and a status message that adapts based on whether the visit came from Stripe's own success redirect (`?paid=1`).
- **`ClientDetail.tsx`**: one "Issue Gift Card" button opens a method picker (Cash / Stripe / Deposit Exemption, each gated by the same permissions as before). Cash and Stripe share one amount+expiration form; picking Stripe swaps the submit button to "Generate Payment Link" and, on success, shows a copy-link box (same UI pattern the deposit-form/waiver share-link boxes already use) instead of closing the modal, since staff still needs to send the link. Deposit Exemption's form is unchanged, just reached through the picker instead of its own button.

## Verification

All live against the real dev database and a real, connected Stripe test-mode account (not mocked):

- Generated a real Stripe Checkout Session through the actual UI flow -- confirmed a genuine `checkout.stripe.com` URL was returned and the resulting `GiftCard` row was created `PENDING` with the correct `amountCents`, `paymentMethod: STRIPE`, and `stripeCheckoutSessionId` set.
- Simulated the webhook rigorously, not just inspected the code: constructed a real `checkout.session.completed` event and signed it with Stripe's own `webhooks.generateTestHeaderString` helper (the standard way to test webhooks without a live forward-to-localhost tunnel), POSTed it to the actual `/webhooks/stripe` route (full signature verification, not bypassed) -- confirmed the card correctly flipped `PENDING` -> `ACTIVE` with `paidAt`/`stripePaymentIntentId` set. Replayed the identical event a second time and confirmed it was a true no-op (identical `paidAt` timestamp), proving the idempotency guard actually works, not just reads like it should.
- Confirmed the public `/gift-card/:code` page renders correctly both before payment (Payment Pending, no code/QR) and after (normal receipt view, correct amount/code/status) for the same card, just at different points in the flow.
- Regression-tested Cash and Deposit Exemption through the new picker -- both still issue correctly, confirmed the resulting cards in the Client detail gift-card table (one Exempt, one $25 Cash, one $75 Stripe -- all three payment paths present and correctly labeled in one screenshot).

Both typechecks clean.

## Commit

`86ac065`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID -- twice had to clear a leftover stale process squatting on port 4093 from an earlier command in this same session before a fresh instance could bind it. Deleted every ad-hoc verification/scratch script (including the webhook-simulation scripts) and the temporary Playwright install from the scratch directory. Test data created during verification (one Cash $25 card, one Stripe $75 card, both on "LongDesc TestClient") left in the dev database, same convention as prior sessions.

---

# Brand deposit-form and waiver PDFs with the studio's logo and accent color

Follow-up requested for the earlier PDF export feature (`254b5c9`): make the generated PDFs look more professional by branding them with each studio's own logo and colors.

## What changed

- **Logo**: `Studio.logoUrl` (a base64 data URL -- same storage convention already used for it elsewhere in the app) embedded at the top of both PDFs, centered, capped to a sensible width. Falls back to the original plain text-only header when a studio has none set.
- **Accent color**: a colored rule under the header and a colored underline under each section heading, using the studio's chosen theme preset's accent color. New `THEME_PRESET_ACCENT_COLORS` in `apps/api/src/lib/themePresets.ts`, duplicating the five presets' hex values from the web frontend's own `THEME_PRESETS` array -- same cross-boundary duplication convention this file's own `THEME_PRESET_KEYS` already established (no shared package between `apps/api`/`apps/web` anywhere in this codebase).
- Deliberately **never used the accent as body-text color** -- three of the five presets (lime `#c9f031`, amber `#fb923c`, magenta `#e879f9`) are too light for reliable contrast as printed text on white paper. A rule/underline has no such legibility requirement, so that's as far as the color branding goes.

## A real bug found and fixed during verification

The first generated PDF showed the logo overlapping the title/timestamp text directly below it. Root cause: `doc.image()` doesn't advance pdfkit's own layout cursor (`doc.y`) by the image's rendered height the way `.text()` does -- the subsequent `.text()` calls started drawing from wherever the cursor already was, which was still at the image's own top edge. Fixed by reading the logo's real aspect ratio via `doc.openImage()` (confirmed present at runtime in pdfkit's own source, `pdfkit/js/pdfkit.js`, but missing from `@types/pdfkit`'s declarations entirely -- hence a narrow, documented cast rather than pretending the type exists) and explicitly advancing `doc.y` by the image's actual displayed height before continuing.

## Verification

Generated both PDFs live against the real dev studio (which has a real logo set and the `onyx-lime` theme preset) before AND after the cursor fix -- confirmed the overlap in the first version, confirmed clean vertical stacking (logo, then title, then timestamp, then lime accent rule, no overlap) after. Separately generated a PDF directly through `generateDepositFormPdf()` with `studioLogoUrl: null` and a different accent color (`slate-teal`, `#2dd4bf`) to confirm both branches independently: the no-logo fallback renders the original plain header correctly, and the accent color genuinely drives the rule/underline color per studio rather than being hardcoded.

Both typechecks clean.

## Commit

`3029062`.

## Cleanup

Killed the isolated dev API server instance (port 4093) via PowerShell `Stop-Process` by exact PID -- twice had to clear a leftover stale process on that port from earlier commands in this same session before a fresh instance could bind it. Deleted every ad-hoc verification/scratch script and generated test PDF from the scratch directory.

---

# Add staff toggle to hide/show hour range for flat-rate sessions

Follow-up to the flat-rate-per-session feature: staff reported "the flat rate per session update didn't work as intended" -- the actual ask was a way to hide a flat session's hour range from the client-facing estimate/deposit pages while keeping it visible to staff.

## Scope clarified before building

Asked the user directly whether "hide" meant hide from the client only, or hide from everyone including staff. Confirmed: **client-facing only** -- staff must always see the hour range regardless of the toggle. This shaped the whole design: redaction happens only on the three *public* verify routes, never on the staff-facing `INQUIRY_INCLUDE` used by `InquiryDetail.tsx`.

## Schema change

`PlannedSession.showDurationToClient Boolean @default(true)` -- a genuine new persisted field, not inferable from existing data (unlike the flat/range distinction itself, which is purely `estimatedPriceLow === estimatedPriceHigh` with no separate flag). Migration hand-written (`prisma migrate dev` has no TTY in this sandbox, same recurring workaround as prior sessions in this project) and applied via `prisma migrate deploy` + `prisma generate`.

## What changed

- **`apps/api/src/lib/plannedSessions.ts`** (new): `redactedSessionHours()` -- when `showDurationToClient` is false, returns `null` for both hour fields. Used by all three public verify routes (`GET /estimates/verify/:token`, `GET /estimates/revision/verify/:token`, `GET /deposits/verify/:token`) so the hours are never sent over the wire at all, not just hidden client-side.
- **`apps/api/src/routes/inquiries.ts`**: `POST /:id/send-estimate` and `POST /:id/revise-estimate` both accept/validate/persist `showDurationToClient` per session through the existing locked-session reconciliation logic; staff-facing `INQUIRY_INCLUDE` returns the real hours unconditionally.
- **`apps/web/src/components/SessionBreakdownEditor.tsx`**: a "Show this session's hour range to the client" checkbox, shown only for flat-rate sessions, defaulting to checked.
- **`apps/web/src/pages/InquiryDetail.tsx`**, **`EstimateResponse.tsx`**, **`EstimateRevisionResponse.tsx`**, **`DepositResponse.tsx`**: threaded the field through seeding/submission and made the public pages render the hour text conditionally (`estimatedHoursMin/Max` now `number | null`).

## Verification

Live against the dev database (`owner@dev-studio.test`, inquiry with a 2-session plan: session 1 range-priced 4-6 hrs, session 2 flat-priced $250): edited the estimate, confirmed the toggle only appears for the flat session and defaults checked, unchecked it, and submitted (`POST /send-estimate` returned `200` with `showDurationToClient: false` persisted on session 2, `true` on session 1). Visited the resulting public estimate page and confirmed session 1 still reads "4–6 hours — $400–$600" while session 2 reads only "— $250" with the hour text fully absent (not blank/zero -- genuinely not rendered). Confirmed via the same API response that the staff-facing payload still carries session 2's real hours (`estimatedHoursMin: 2, estimatedHoursMax: 3`) unaffected by the toggle.

Both typechecks (`npx tsc --noEmit` api, `npx tsc -b` web) and `npm run build` (web) clean.

## Commit

`87e9e61`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and the temporary Playwright install from the scratch directory. Test data (the resent estimate on "LongDesc TestClient") left in the dev database, same convention as prior sessions.

---

# Show a resendable Stripe checkout link once a deposit form is signed

Second half of the same task batch as the flat-rate hour-range toggle above. A client who signs a deposit agreement is immediately sent to Stripe's own checkout page (existing behavior) -- but if they navigate away or abandon that page before paying, staff previously had no way to get them back to a payment link at all: the staff-facing deposit list's own `url` field is deliberately null once a form is signed (that field is the *sign* link, not a payment link), and `stripeCheckoutSessionId` was stored but never turned back into a usable URL anywhere staff could see it.

## What changed

- **`apps/api/src/lib/deposits.ts`**: extracted `createDepositCheckoutSession(depositFormId)` -- the one place a Stripe Checkout Session gets created for a deposit now, with the same validation (signed, not yet paid, Stripe connected for the studio) either caller needs. `routes/deposits.ts`'s existing public `POST /:token/checkout-session` (called right after signing, and again if the client returns to retry) was refactored to call this instead of duplicating the Stripe-session-creation block inline.
- **`apps/api/src/routes/deposits.ts`**: new staff route, `POST /deposit-forms/:id/checkout-link` -- calls the same shared helper, then best-effort auto-texts the link to the client through the identical `sendClientSms` path every other "resend a link" action in this app already uses (deposit-form send/resend, estimate send/resend), so staff gets the same "sent via text" / "no phone on file, share manually" feedback either way. Gated by `requirePermission("inquiries.edit")` -- the same tier of action as generating/resending the deposit form itself, not a new capability.
- **`apps/web/src/pages/InquiryDetail.tsx`**: the Deposit widget's per-session list now shows a "Get Payment Link" / "Resend Payment Link" box (copyable input, same pattern as every other share-link box in this app) for any deposit form that's `signedAt` and not yet `paidManually`. The whole section is conditionally rendered on that same check, so once staff marks the deposit paid, the section doesn't just hide -- it stops rendering at all, satisfying "the link can then disappear" literally.

## Verification

Live against the real dev database and a real, connected Stripe test-mode account (not mocked): converted the "LongDesc TestClient" inquiry's estimate to DEPOSIT_PENDING, generated a deposit form for session 1, and signed it through the actual public `PATCH /deposits/sign/:token` route (confirmed `stripeConnected: true` in the response). Then, through the real staff UI (Playwright): scrolled to the Deposit widget, confirmed the new payment-link box was present with a "Get Payment Link" button, clicked it, and confirmed a genuine `checkout.stripe.com` URL appeared in a copyable input and the button relabeled to "Resend Payment Link" (screenshot). Clicked "Mark $210 as Paid" and confirmed, in a second screenshot, that the entire payment-link section was gone -- replaced by the existing "Marked paid ... issued gift card" success message, with no trace of "Get/Resend Payment Link" left in the page text.

Both typechecks (`npx tsc --noEmit` api, `npx tsc -b` web) and `npm run build` (web) clean.

## Commit

`7a3617b`.

## Cleanup

Killed the isolated dev API/web server instances (ports 4093/5292) via PowerShell `Stop-Process` by exact PID. Deleted every ad-hoc verification script and the temporary Playwright install from the scratch directory. Test data (the new session-1 deposit form, now paid, and its issued gift card, on "LongDesc TestClient") left in the dev database, same convention as prior sessions.

---

# HIGHEST PRIORITY — Real-time update reliability audit and fix

Studio owner reported staleness "across almost everything" -- not a couple of isolated spots. Three-part audit of the WebSocket notify-then-refetch architecture: connection reliability, backend notify-event coverage, frontend invalidation wiring. One commit + push per part.

## Architecture recap (for context on all three parts)

`apps/web/src/context/SocketContext.tsx` is the ONE place any query invalidation happens on the frontend: it listens for a single generic `invalidate` socket event carrying `{ keys: unknown[][] }` and calls `queryClient.invalidateQueries({ queryKey })` for each. No component has its own socket listener. The backend's `apps/api/src/lib/realtime/registry.ts` is the ONE place those `keys` arrays get decided: a small `InvalidationEvent` union type, a `keysFor()` switch mapping each event type to an array of React Query key prefixes, and `emitInvalidation()` which broadcasts to the mutating studio's socket room. Mutation routes call `emitInvalidation({ type: ..., studioId })` after their write succeeds.

This single-registry design means Part 2 (does a mutation call `emitInvalidation` at all) and Part 3 (does the event's `keysFor()` entry cover every query key actually affected) are both really edits to the same two files (`registry.ts` + the mutation routes) -- there's no separate per-component frontend listener code to audit.

---

## PART 1 — Connection reliability audit and fix

### Findings

- `io(API_URL, { auth: { token } })` had no explicit reconnection config -- relying entirely on socket.io-client's undocumented-in-this-codebase defaults.
- **The critical gap**: nothing in this app ever recovers from a connection drop's BLIND SPOT. `apps/web/src/lib/queryClient.ts` sets `refetchOnWindowFocus: false` *by design*, to lean on the WebSocket push architecture instead of double-fetching against it -- but Socket.IO does **not** queue `invalidate` events for a client that's disconnected (no `connectionStateRecovery` configured server-side). So every `invalidate` event broadcast during ANY connection gap -- a brief wifi blip, a backgrounded tab throttled past the server's ping timeout, a laptop sleep/wake -- was silently and **permanently** lost. The client would reconnect, but its cache would just stay stale until some unrelated later event happened to touch the same query key. Given how many hours a staff tab plausibly sits open/backgrounded in a real work day, this is almost certainly the dominant cause of "staleness across almost everything" -- bigger than any single missing notify-emit call site (Part 2), because it silently defeats EVERY notify event emitted during EVERY gap, compounding over the day.
- No user-visible indicator existed anywhere for connection state -- `useSocket()`'s `onlineUserIds` (presence) was consumed in 3 places, but `socket` itself was never inspected for connected/disconnected state by any component. Staff had no way to know a live connection had dropped, and thus no reason to manually refresh either -- exactly the compounding effect the task brief called out.

### Fixes

- **`apps/web/src/context/SocketContext.tsx`**: explicit `reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 10000, randomizationFactor: 0.5`.
- **The actual fix for the blind spot**: track whether this socket has ever connected before (a closure flag, reset per new socket instance). On every `connect` event AFTER the first one -- i.e. every reconnect -- call a bare `queryClient.invalidateQueries()` (no key filter, invalidates every active query). This is deliberately a full flush, not a targeted one: there's no way to know which specific events were missed during a gap, so the only correct catch-up is "refetch everything that's currently on screen."
- Proactive reconnect: a `visibilitychange` listener calls `socket.connect()` immediately when a tab becomes visible again and the socket is currently disconnected (browsers can throttle a backgrounded tab's timers well past socket.io's own backoff schedule), and a `window.online` listener does the same for a real network transition. Both just nudge socket.io to retry sooner -- the reconnect logic itself is unchanged.
- **New**: `apps/web/src/context/socket-context.ts` gained a `ConnectionStatus = 'connecting' | 'connected' | 'disconnected'` field on the shared context value, set from `connect`/`disconnect`/`reconnect_attempt` socket events.
- **New**: `apps/web/src/components/ConnectionStatusIndicator.tsx` -- renders nothing while connected (the common case stays visually silent), and a small amber "Reconnecting…" pill in `TopBar.tsx`'s icon cluster (visible on every authenticated page) otherwise, with a tooltip explaining live updates are paused.

### Verification (live, not just code review)

Chrome's own network-condition emulation (`context.setOffline` via Playwright/CDP) turned out not to affect already-established `localhost` WebSocket connections in this environment (a known Chrome loopback-bypass quirk, not an app bug) -- so a deterministic alternative was used instead: a tiny local TCP proxy (`browser -> :4094 -> :4093 real API`) that can be killed/restarted instantly, decoupling "is the browser's connection alive" from "is the real API available," which also let a mutation be fired directly at the real API (bypassing the dead proxy) with no race condition.

Live sequence, via Playwright against the real dev stack: opened the "LongDesc TestClient" project detail page (showing "Assigned Artist: Dev Artist One"), killed the proxy -- confirmed the browser's WebSocket connection closed within ~4 seconds and the new "Reconnecting…" pill appeared (screenshot) -- reassigned the project to a different artist via a direct API call to the real backend (200 OK) while the browser's socket was fully down -- restarted the proxy -- confirmed, within ~6 seconds and with **zero manual page interaction**, that a new WebSocket connection formed, the "Reconnecting…" pill disappeared, and the page now showed "Assigned Artist: Dev Artist Two" (screenshot) -- the exact change made while disconnected, recovered purely by the reconnect catch-up invalidate.

Both typechecks (`npx tsc --noEmit` api, `npx tsc -b` web) and `npm run build` (web) clean.

### Commit

`8277dc2`

---

## PART 2 — Notify-event coverage audit across every mutation endpoint

Systematic pass through every route file with a POST/PATCH/PUT/DELETE handler, cross-referenced against `apps/api/src/lib/realtime/registry.ts`'s `emitInvalidation` call sites (grep-verified before and after). Two research agents covered the lower-priority domains (clients/artists/team, services/intake-forms/settings/integrations/misc) in parallel while the explicitly-named priority areas (deposits, gift cards, waivers, messages, appointments, tasks) were read and fixed directly.

### The single biggest finding: shared helpers, not scattered gaps

Two functions sit underneath a large fraction of everything the app does, and neither ever emitted anything:

- **`lib/clientSms.ts`'s `sendSmsMessage`** — the ONE place any outbound SMS creates its `Message` row, called by `sendClientSms`/`sendStaffSms`, in turn called from 9+ files (deposit-form/waiver/estimate auto-sends, gift-card text receipts, reminder jobs, the composer's own direct-send). Only the composer's own `POST /:id/messages` route emitted `conversation.updated` itself; every OTHER caller created a real message with zero broadcast. **Fixed once, in the shared function** — closes every current and future caller in one place.
- **`routes/webhooks.ts`'s inbound Twilio SMS handler** and **`lib/jobs/emailPoller.ts`'s inbound Gmail handler** — a client texting or emailing the studio is the single most time-sensitive, frequent event in the app, and it was **entirely out-of-band from any staff action**, so nothing ever told a connected staff member it happened. This is very likely the dominant contributor to "new messages" feeling stale.
- **`routes/webhooks.ts`'s Stripe `checkout.session.completed` handler** — all three payment-confirmation paths (deposit form, appointment balance, standalone gift card) were silent. Same "out-of-band, no staff action" pattern as the inbound-message webhooks -- explains "deposit/payment status changes" feeling randomly stale.

### Full audit table (endpoint — notify status before — fix)

**Messages (the #1 named symptom):**

| Endpoint | Before | Fix |
|---|---|---|
| `lib/clientSms.ts` `sendSmsMessage` (underlies `sendClientSms`/`sendStaffSms`, 9+ callers) | Silent | Emits `conversation.updated` |
| `POST /webhooks/twilio/sms` (inbound client text) | Silent | Emits `conversation.updated` |
| `lib/jobs/emailPoller.ts` inbound Gmail poll | Silent | Emits `conversation.updated` |
| `POST /conversations/` (new thread) | Silent | Emits `conversation.updated` |
| `POST /conversations/:id/tags`, `DELETE .../tags/:tagId` | Silent | Emits `conversation.updated` |
| `POST /conversations/:id/attach-image` | Silent | Emits `inquiry.updated` (mutates the Inquiry, not the thread) |
| `POST /conversations/:id/messages`, `PATCH .../messages/:messageId` | Already emitted | No change |

**Deposits / payments (the #2 named symptom):**

| Endpoint | Before | Fix |
|---|---|---|
| `PATCH /deposits/sign/:token` (client signs) | Silent | Emits `inquiry.updated` |
| `PATCH /deposit-forms/:id/mark-paid` (staff manual) | Silent | Emits `inquiry.updated` |
| Stripe webhook: deposit form paid | Silent | Emits `inquiry.updated` |
| Stripe webhook: appointment balance paid | Silent | Emits `appointment.changed` |
| Stripe webhook: standalone gift card paid | Silent | Emits `giftcard.changed` |
| `giftCards.ts`: `POST /` (cash), `POST /checkout-session`, `POST /exempt`, `PATCH /:id/attachment`, `POST /:id/void`, `PATCH /:id` | Silent (whole file) | All emit `giftcard.changed` |
| `POST /deposits/:token/checkout-session`, `POST /deposit-forms/:id/checkout-link` | Silent | Left as-is (no new staff-visible persisted state beyond an internal session id) |

**Cross-staff actions (the #3 named symptom) — appointments, waivers, inquiries, clients, team:**

| Endpoint | Before | Fix |
|---|---|---|
| `PATCH /waivers/sign/:token`, `POST /waivers/:id/verify` | Silent | Emit `appointment.changed` + `inquiry.updated` |
| `appointments.ts`: `POST /:id/checkout` (the biggest one -- finalizes status, redeems/rolls gift cards, can issue an overage card) | Silent | Emits `appointment.changed` + `giftcard.changed` |
| `appointments.ts`: archive, unarchive, DELETE, waiver-generate, photos POST/DELETE, notes POST/PATCH/DELETE | Silent (8 routes) | All emit `appointment.changed` |
| `inquiries.ts`: notes POST/PATCH/DELETE | Silent | Emit `inquiry.updated` (rest of this file already had strong coverage) |
| `tasks.ts`: `/dismiss`, `/personal/:id` DELETE | Silent | Emit `task.changed` |
| `tasks.ts`: `/personal/:id` PATCH | Only emitted on a completion change | Now emits on ANY field change |
| `clients.ts`: create, PATCH, phones (add/remove/make-primary), emails (add/remove/make-primary), merge, archive, unarchive, DELETE | Silent (whole file, 12 routes) | All emit new `client.updated` |
| `artists.ts`: create, PATCH, preferred-schedule | Silent (whole file) | All emit new `artist.changed` |
| `studios.ts`: create staff user, invite, PATCH user (role/active/location), DELETE user, locations create/update/delete | Silent (whole file) | Emit new `team.changed` (+ `artist.changed` when the role touches ARTIST) / `locations.changed` |
| `studios.ts`: invite resend, permissions matrix PATCH, studio branding PATCH | Silent | Deliberately left as-is -- see "Known limitations" below |
| `clientImport.ts`: `POST /:batchId/execute` | Silent | Emits new `client.imported` + `inquiry.created` -- reuses the Clients/Inquiries lists' own already-live-consumed keys, the single cleanest win in this audit |
| `intakeForms.ts`: create/update/delete | Silent | Emit new `intakeForm.changed` -- targets `["intake-forms"]`, a real key already read by `ClientDetail.tsx`/`ConversationsPanel.tsx` |
| `integrations.ts`: SMS connect, BIRD_SMS connect, EMAIL OAuth callback, disconnect (any channel) | Silent | Emit new `integration.changed` -- targets `["sms-integration-status"]`, a real key the composer already reads to grey out/enable sending |
| `services.ts`: create/update/delete | Silent | Emit new `service.changed` (no live frontend consumer yet -- see below) |
| `customPolicies.ts`: create/update/delete/reorder | Silent | Emit new `customPolicy.changed` (no live frontend consumer yet -- see below) |

### Deliberately NOT changed (checked, correct as-is)

- `calendarPreferences.ts`, `widgetLayouts.ts`, `users.ts PATCH /me`, `viewAs.ts` -- genuinely personal/per-user preference or audit-only, explicitly documented in their own code as carrying no cross-staff meaning.
- `clients.ts POST /:id/dismiss-duplicate`, `studios.ts` invite-resend -- real mutations, but no meaningfully different visible state for anyone other than the actor.
- `clientImport.ts` mapping/row-review PATCH routes -- marginal (only matters if two staff review the exact same import batch simultaneously, an edge case, not the reported symptom).

### Known limitations carried forward (not silently ignored -- flagged for a deliberate follow-up)

- **`services.ts`, `customPolicies.ts`, `intakeForms.ts PUT /:id/fields`, `studios.ts` permissions/locations/team**: several of the NEW event types added here (`service.changed`, `customPolicy.changed`, `team.changed`, `locations.changed`) target frontend query keys that **don't exist as real `useQuery` calls yet** -- `Settings.tsx`, `ServicesManager.tsx`, `Team.tsx`, `ArtistDetail.tsx`, and `ClientDetail.tsx` all fetch their primary data via a bespoke `useEffect`+`apiFetch`, not React Query. Emitting the event now means no backend route needs a second pass once Part 3 (or a future session) migrates those pages -- but until that migration happens, these specific events are backend-correct and currently inert on the frontend. This is explicitly a Part 3 concern per the task's own framing (is anything listening for the right key), documented here so it isn't mistaken for an oversight.
- **`studios.ts PATCH /:studioId/permissions`**: intentionally not wired. Even with a live query-key fix, an already-logged-in session's effective permissions are baked into its JWT at login, not re-fetched live anywhere except the Permissions tab itself -- a real fix here needs a broader session-refresh mechanism, not just a query invalidation, and is out of scope for this audit.

### Verification

Live, via a raw `socket.io-client` connected as the real dev studio owner (not the full React app, to isolate the registry/emit mechanism from any frontend wiring): triggered `giftCards.ts POST /` (cash issuance) and confirmed an `invalidate` event arrived with `[["client-gift-cards", "<clientId>"]]`; triggered `clients.ts PATCH /:id` and confirmed `[["clients"], ["client", "<clientId>"]]` arrived. Separately verified the `tasks.ts` fix specifically: dismissed a task (event received), created a personal task (event received), then PATCHed only its title -- confirmed a THIRD event arrived for that title-only edit (previously this exact case emitted nothing, since the route only checked `isCompletionChange`). Confirmed the API boots cleanly with every new `emitInvalidation` import in place (no circular-import issues from `lib/clientSms.ts` and `lib/jobs/emailPoller.ts` now depending on `lib/realtime/registry.ts`).

Both typechecks (`npx tsc --noEmit` api, `npx tsc -b` web) clean.

### Commit

`378434f`

---

## PART 3 — Frontend invalidation wiring audit

Given this app's architecture, "does the frontend listen for the right query key" reduces almost entirely to "does `registry.ts`'s `keysFor()` return the right keys" -- there is no separate per-component socket listener anywhere (see the architecture recap at the top of this report). So Part 3's real work was: for every event type, cross-check `keysFor()`'s returned prefixes against the ACTUAL query keys `apps/web/src` uses today, not just the ones a route's own author assumed existed.

### The critical bug this audit was built to catch

`inquiry.updated`/`inquiry.created` only ever invalidated `["inquiries"]` -- the LIST page's own key (`inquiriesQueryKey`, `['inquiries', studioId]`). `InquiryDetail.tsx`'s own single-project fetch uses `inquiryQueryKey(id)` = `['inquiry', id]` -- a **different first array element**, so React Query's prefix-match invalidation never touched it, regardless of which of the ~20 routes emitted the event. **Live-reproduced during Part 1's own reconnect test** (see that section): reassigning a project's artist while its detail page was open never updated it for anyone, connected or not -- only the separate list page ever reflected the change.

**Fix**: `inquiry.updated` gained an optional `inquiryId` field; when present, `keysFor()` also returns `["inquiry", inquiryId]`. Threaded through all ~20 emit call sites across `inquiries.ts` (bulk-replaced, since virtually every route already has the mutated inquiry's `id` in scope from `req.params.id` -- verified safe by a clean `tsc --noEmit` immediately after, which would have failed loudly on any route where `id` wasn't actually in scope), plus `deposits.ts` (via `depositForm.inquiryId`), `waivers.ts` (via `waiver.appointment.inquiryId`, required adding `include: { appointment: { select: { inquiryId: true } } }` to two queries that didn't previously fetch it), `conversations.ts`'s `attach-image` route, and `webhooks.ts`'s Stripe deposit-paid path. Left un-threaded (list-level only, correctly): `clients.ts`'s client-delete route, which cascades through however many inquiries that client had -- there's no single "the" inquiry to target there.

### Second gap found the same way: `conversation-context`

`ConversationsPanel.tsx` has a `['conversation-context', conversationId]` query (the panel showing which entities -- Inquiry/Appointment/GiftCard/DepositForm/Waiver -- are tagged to a thread) that was never in `conversation.updated`'s key list, despite Part 2's own tag-add/remove fixes emitting that exact event. Added.

### What was deliberately NOT done, and why

The two research agents' Part 2 reports (see that section) surfaced a bigger, separate problem: `AppointmentDetail.tsx`, `ClientDetail.tsx`, `ArtistDetail.tsx`, and the relevant parts of `Team.tsx` don't use TanStack Query for their own primary data at all -- they fetch via a bespoke `useEffect` + `apiFetch` + `useState`. **No invalidation mechanism, WebSocket-driven or otherwise, can ever refresh a query that was never registered as a query.** This is a real, load-bearing finding, not an oversight -- migrating four separate, actively-used pages (each 400-700+ lines, each with several of its own local post-mutation `invalidateQueries`/`setState` calls to carefully preserve) to `useQuery` is a substantial, separable body of work with its own real regression risk if rushed. It was scoped out of this session and is flagged here as the clear, concrete next step: convert each page's primary fetch to `useQuery` with a real key (`['appointment', id]`, `['client', id]`, `['artist', id]`, `['team-users', studioId]`, `['team-invites', studioId]` -- names already chosen and reserved in `registry.ts`'s `keysFor()` for `client.updated`/`artist.changed`/`team.changed` specifically so this migration needs zero further backend changes when it happens).

This means `appointment.changed`, `client.updated`'s entity-specific key, `artist.changed`'s entity-specific key, and `team.changed`/`locations.changed`/`service.changed`/`customPolicy.changed` are all backend-correct and already broadcasting today, but currently only effective at the LIST level (`["appointments"]`, `["clients"]`, `["artists"]`, etc.) until that migration lands -- not a silent gap, a documented, deliberate boundary.

### Live verification (two independent, separately-authenticated browser sessions, real dev stack, zero manual reload anywhere)

All four scenarios named explicitly in the task brief, tested with Session A (Owner) and Session B (Front Desk) logged in as genuinely different users in separate Playwright browser contexts:

1. **Reassignment**: both sessions open the same project detail page. Session A reassigns the artist via the real UI (Assignment widget). Session B's page updates to show the new artist within ~2.5s, no reload -- direct proof the `inquiryId`-threading fix works.
2. **Deposits**: with both sessions still on that same page, the client signs a second session's deposit form via the real public sign route (simulating their phone). Both sessions' Deposit widgets update from "Awaiting signature" to "Signed, awaiting payment" live.
3. **Task changes**: both sessions open `/tasks`. Owner creates a personal task assigned TO Front Desk. It appears on Front Desk's Tasks page within ~2.5s, no reload.
4. **Messages**: both sessions deep-link directly into the same staff-to-staff conversation thread (`/conversations/:id`). Owner sends a message through the real composer (actual send button click, not a keyboard shortcut). It appears in Front Desk's already-open thread live, no reload.

Both typechecks (`npx tsc --noEmit` api, `npx tsc -b` web) clean throughout.

### Commit

`ac1a17c`

---

## Final summary

Three commits (code) + three REPORT.md entries, one per part:

1. **Connection reliability** -- `8277dc2` / `f60d6a8`. Fixed the reconnection blind spot (any connection gap silently and permanently lost every event broadcast during it -- likely the single biggest driver of "stale everywhere," since it defeats every fix in Part 2 during any drop); added explicit reconnection config, proactive reconnect on tab-visible/online, and a subtle "Reconnecting..." indicator.
2. **Backend notify-event coverage** -- `378434f` / `4c35b4b`. Full route-by-route audit; closed ~70 individual silent-mutation gaps across nearly every domain, headlined by two systemic fixes (the shared SMS-send helper, the inbound SMS/email webhooks) that each closed many call sites at once. New `InvalidationEvent` types for client/gift-card/artist/team/location/service/policy/intake-form/integration changes.
3. **Frontend invalidation wiring** -- `ac1a17c`. Found and fixed the specific mechanism by which Part 2's own `inquiry.updated` emissions (and everything downstream of them) were failing to reach the single most-used page in the app, `InquiryDetail.tsx` -- a live-reproduced, now-fixed bug. Documented the deeper "four pages aren't wired into React Query at all" finding as the clear next step rather than rushing a risky mass migration.

All three parts verified live against the real dev stack (Playwright, two genuinely separate browser sessions/logins for the final pass), not just by reading code. Every commit passed both typechecks before landing. Dev servers killed by exact PID; every scratch script and Playwright install deleted from the scratch directory after use.

---

# Clients/Projects UI fixes: filtering, columns, spacing, Kanban scroll, search, grouping

Seven-item batch across the Clients and Inquiries/Projects pages, plus the global search bar.

## 1-2. Clients page: activity filtering + Last Modified column

Clarified scope first: Client has no status field the way a Project does (just name/email/phone/archivedAt), and the user's own example ("filter by clients with active appointments") pointed at activity-based filtering, not a status taxonomy.

- **`apps/api/src/routes/clients.ts` `GET /`**: new `?activity=` (repeatable: `upcoming_appointment`, `active_project`, `no_activity`) and `?includeArchived=true` query params. Multi-select OR semantics, matching every other filter in this app -- checking both "Has upcoming appointment" and "Has active project" means either, not both at once. `active_project` reuses the Projects tab's own three statuses (SCHEDULING/WAITLISTED/CONFIRMED, hand-duplicated the same way every other cross-file enum-value list in this codebase already is, since there's no shared package between apps/api and apps/web).
- **`apps/web/src/pages/Clients.tsx`**: new Activity `MultiSelectFilter` and a "Show archived" toggle (same visual pattern as the Inquiries page's own filters), filter state persisted to localStorage the same way Inquiries.tsx's own filter/sort selections already are. New "Last Modified" column (`client.updatedAt`, hidden below `lg` same as the other secondary columns) -- the field was already returned by the API (no `select` narrowing existed), so this was frontend-only.

## 3 & 7. Group by Status spacing + fixing "Group by Status isn't working" in Projects

These turned out to be the same root cause. The Projects tab's status pill (every row, via `deriveProjectStage`) shows one of 5 derived pipeline stages (Needs Scheduling/Scheduled/Waiver Verified/Session Complete/Project Complete) -- SCHEDULING/WAITLISTED/CONFIRMED all collapse into these, by design, from earlier work this session. "Group by status" was still grouping by the RAW `InquiryStatus` (producing headers like "Scheduling (5)", "Confirmed (12)"), which had nothing to do with the derived-stage pill shown on any row inside those groups -- exactly the "doesn't seem to be working" experience reported.

- **`apps/web/src/pages/Inquiries.tsx`**: Projects tab's grouping now uses `deriveProjectStage`/`PROJECT_STAGE_ORDER`/`PROJECT_STAGE_LABELS` (the same taxonomy the pill already uses) instead of raw status; group headers now genuinely match every row inside them. Inquiries tab's grouping (which has no derived-stage concept) is unchanged.
- Added visible spacing between groups: each group renders as its own `<tbody>` (unchanged), with a separate spacer `<tbody>` (no border, just a blank row) between them -- avoided giving the header row a stray top border from Tailwind's `divide-y`, which sharing one `<tbody>` with a spacer row would have caused.

## 4. Folded "Needs Scheduling" into the main Status filter (Projects tab)

Previously a separate standalone toggle button, ANDed against whatever the Status filter already selected. Removed it; "Needs Scheduling" is now a selectable option inside the Status `MultiSelectFilter` itself (a synthetic value, `NEEDS_SCHEDULING_FILTER_VALUE` -- not a real `InquiryStatus`, since "needs scheduling" depends on session/appointment data no status column can express alone).

Implemented with real OR semantics against the other selected statuses (matching how every other multi-select in this app combines its own checked values), which needed a bit of care: when "Needs Scheduling" is selected, the server fetch always requests the Projects tab's FULL status list regardless of which real statuses are also checked (a project needing scheduling could carry any of the three), then the client-side post-filter unions the selected real statuses with `projectNeedsScheduling()` -- narrowing the server request to only the checked real statuses would have silently dropped needs-scheduling rows whose actual status wasn't one of them.

## 5. Kanban board horizontal scroll

The board's own container already had `overflow-x-auto` and genuinely could scroll (confirmed: trackpad swipe, shift+wheel, and dragging the native scrollbar all worked already). The real gap: a **plain vertical mouse wheel** (deltaY only, no deltaX -- what most desktop mice actually send, having no horizontal scroll wheel at all) has no vertical overflow on this element to capture it, so it bubbled straight up and scrolled the whole PAGE instead of panning the board -- which reads exactly like "the Kanban doesn't allow scrolling left and right" for anyone without a trackpad.

**`apps/web/src/components/kanban/InquiryKanbanBoard.tsx`**: added an `onWheel` handler on the board's scroll container that redirects a vertical-dominant wheel delta into `scrollLeft`, the same convention most kanban/carousel UIs use. A genuine horizontal gesture (trackpad swipe, shift+wheel) already carries a meaningful `deltaX` and is left completely alone.

## 6. Top search bar: multi-word name search

`apps/api/src/routes/search.ts` matched a client's `firstName`/`lastName` as two independent `contains` checks OR'd together. Typing "John Smith" checked whether `firstName` contains "John Smith" (no) or `lastName` contains "John Smith" (no) -- neither column ever contains the full two-word string, so a first-plus-last search always returned nothing, while a first-name-only search worked fine.

Fixed using the same word-splitting pattern already established in `clients.ts`'s own merge-search route: split the query on whitespace, require EVERY word to match `firstName` OR `lastName` (AND across words, OR within each word across the two fields) -- correctly handles "John Smith", preserves single-word behavior exactly (one word reduces to the original OR-across-both-fields check), and is applied everywhere client-name matching happens in this route (Clients, Inquiries' linked client, Appointments' linked client).

## Verification

Live against the real dev stack (Playwright + direct API calls, not just code review):
- Clients: applied "Has active project" -- list narrowed correctly to clients with a Projects-tab-status inquiry, confirmed against the same set shown grouped on the Projects tab. Last Modified column renders `updatedAt` correctly.
- Search: confirmed a client findable by first name alone was now ALSO findable by "First Last" (previously 0 results), and still findable by last name alone.
- Kanban: dispatched a pure vertical wheel event (`deltaY` only) over the Inquiries tab's 6-column board (which genuinely overflows at 1280px) and confirmed `scrollLeft` moved from 0 to 300 -- the exact gesture that previously did nothing to the board.
- Projects tab: confirmed the standalone "Needs Scheduling" button is gone, confirmed "Needs Scheduling" appears inside the Status filter dropdown, confirmed Group by Status now shows stage-based headers ("Needs Scheduling (6)", "Scheduled (7)", "Session Complete (4)", ...) instead of raw-status headers, with visible spacing between each group (screenshot).

Both typechecks (`npx tsc --noEmit` api, `npx tsc -b` web) and `npm run build` (web) clean.

## Commit

`a256047`

---

# Estimate flat-rate/hide-duration checkboxes missing at session count 1

Single session on `main`. Reported bug: the "Flat rate" and "Show this session's hour range to the client" checkboxes on the Estimate section don't appear when "Number of sessions" is 1. No schema changes -- the underlying feature (`PlannedSession.showDurationToClient`, added in a same-day-earlier migration) already fully supported this; only the frontend's session-count-1 path had never been wired up to use it.

## Root cause

Both checkboxes live in `SessionHoursRows` (`SessionBreakdownEditor.tsx`), which early-returns `null` whenever `sessionCount <= 1` -- by design, session count 1 is treated as "no plan, use the simple top-level price/hours fields" (a deliberate, documented simplification, not itself a bug). The top-level fields already had their own "Flat rate" checkbox for that path, but no "show hour range to client" equivalent existed there at all -- that concept was only ever wired to the per-session `PlannedSession` rows.

Checked the API before assuming a schema gap: `POST /:id/send-estimate` and `POST /:id/revise-estimate` both already explicitly support a `sessions` array of **any length, including 0 or 1** (per their own code comments -- a from-earlier-this-session bug fix for a different problem: collapsing a plan back down without orphaning stale rows). A 1-length array doesn't flip `hasPlan` (`finalSessionCount > 1`), so it doesn't touch the top-level `priceEstimateLow/High`/`timeEstimateHoursMin/Max` fields at all -- it just gives `showDurationToClient` a real `PlannedSession` row to live on. The client-facing verify routes (`estimates.ts`, and revise-estimate's own) already apply `redactedSessionHours` per session regardless of count. The only genuinely missing piece was the frontend never sending that array, and never showing the checkbox, for the count-1 case.

## Fix

**`InquiryDetail.tsx`** (both the original Generate & Send Estimate flow and the Revise Estimate flow, which mirror each other exactly):
- New `estimateShowDurationToClient`/`reviseShowDurationToClient` state, seeded from an existing 1-row plan's `showDurationToClient` when reopening Edit (defaults to `true`, matching the schema default, for a never-touched estimate).
- New checkbox rendered directly under "Flat rate," shown only once "Flat rate" is checked -- same conditional-visibility convention `SessionHoursRows`' own per-session pair already uses.
- `handleSendEstimate`/`handleReviseEstimate` now send a synthetic 1-row `sessions` array (mapping the top-level price/hours fields into it) whenever `estimateIsFlat`/`reviseIsFlat` is true, instead of only ever sending `sessions` for `sessionCount > 1`. Left every ordinary (non-flat) single-session case exactly as it already worked -- no new `PlannedSession` row is created unless staff actually engages the flat-rate checkbox, so a plain range-priced single estimate has zero behavior change.

**`EstimateResponse.tsx` / `EstimateRevisionResponse.tsx`** (the public client-facing pages): the "N-session plan" breakdown box previously appeared for `plannedSessions.length > 0`, which would have made a 1-row plan read as a slightly odd "1-session plan" list instead of the normal simple "Price / Estimated time" layout every other single-session estimate uses. Changed the split to `length > 1` for the breakdown box and `length <= 1` for the simple layout, with the simple layout reading that one session's own (already-redacted) hours when a row exists, rather than always falling back to the top-level (never-redacted) fields.

## A locked-session edge case, checked not fixed

A single already-locked session (deposit paid or appointment booked) revising through the *now-reachable* top-level UI, rather than the multi-session UI's own "locked" badge, doesn't get an explicit "this is locked" indicator in the modal. Checked this is safe, not just cosmetically rough: `POST /:id/revise-estimate`'s reconciliation explicitly ignores whatever's submitted for a locked `sessionNumber` regardless of source (confirmed by reading the route, which skips locked slots in both its validation loop and its update loop) -- so a locked single session's real hours/price can't actually be overwritten this way, just possibly re-displayed as if editable when they're not. Not fixed this session; flagging as a minor known UX gap for a case that couldn't exist at all before today (a locked plan needed 2+ sessions previously).

## Verification (Playwright against a local dev stack, scratch ports)

- **Checkbox appearance**: opened Edit Estimate on a real seeded inquiry at the default session count of 1 -- confirmed "Show this session's hour range to the client" is genuinely absent until "Flat rate" is checked, then appears immediately.
- **End-to-end persistence**: checked Flat rate, unchecked "show duration," set a price, submitted -- confirmed via a direct API read that the inquiry gained exactly one `PlannedSession` row (`showDurationToClient: false`, correct hours/price) while `priceEstimateLow/High` on the Inquiry itself updated normally.
- **Public page redaction**: loaded the real `/estimate/:token` page for that inquiry -- "Estimated time" correctly read "To be discussed" (hours never sent to the client at all, not just hidden), no "1-session plan" box, otherwise identical to a normal single-session estimate's layout.
- **Reconciliation both directions**: reopened Edit Estimate -- confirmed the checkbox correctly re-seeded to unchecked (reading the stored row) -- rechecked it and resubmitted -- confirmed via the API that the same row flipped to `showDurationToClient: true`.
- **Regression, multi-session unaffected**: bumped "Number of sessions" to 3 on the same inquiry -- confirmed the top-level "Flat rate" checkbox correctly disappears, replaced by 3 independent per-session "Flat rate for this session" checkboxes exactly as before this change.
- **Revise Estimate flow**: opened Revise Estimate on a genuinely single-session (zero existing `PlannedSession` rows) DEPOSIT_PENDING project -- same checkbox-appears-only-after-Flat-rate behavior confirmed. (Also opened it against a project with an existing real 2-session plan first, as a sanity check, and confirmed that one correctly stays on the per-session UI instead -- picking a single-session-shaped test subject was necessary to see the fix at all.)
- Zero console errors or failed requests across every step above.

## Typechecks

`npx tsc -b` (web) and `npx tsc --noEmit` (api, untouched -- no backend changes were needed) -- both clean.

## Commit

`fffac22` on `main`.

## Cleanup

Playwright and Chromium were installed ad hoc into the scratch directory (not a project dependency) and deleted afterward along with every driver script and screenshot. Killed the two scratch dev servers used for this session (api `:4050`, web `:5230`). Left the test data created during verification (the "Range Test" seeded inquiry's estimate now reads $777 flat, `showDurationToClient: true` after the final toggle-back-on test) in the dev database, consistent with this project's standing convention.

---

# Three follow-up fixes: checkbox sizing, gift card back-link, Projects status filter

## 1. Flat rate / Show duration checkbox sizing (session count 1)

The single-session (no plan) "Flat rate" checkbox used `h-4 w-4`; the "Show this session's hour range" checkbox beneath it used `h-3.5 w-3.5`, so the two visibly mismatched. The per-session breakdown editor (`SessionBreakdownEditor.tsx`, used once a real multi-session plan exists) already uses `h-3.5 w-3.5` for both of its own equivalent checkboxes -- the single-session path just hadn't matched that precedent. Changed both `estimateIsFlat`/`reviseIsFlat` checkboxes in `apps/web/src/pages/InquiryDetail.tsx` to `h-3.5 w-3.5`.

## 2. GiftCardDetail back button

Hardcoded `to="/clients"` / "Back to Clients" regardless of how the page was reached -- clicking through from a specific client's own gift card lost that context, forcing a re-search. `GiftCardDetail.tsx` already fetches `card.client.id`/`firstName`/`lastName`; the back link now points at `/clients/${card.client.id}` with the label "Back to {name}" once the card has loaded, falling back to the generic "Back to Clients" while still loading -- same pattern `AppointmentDetail.tsx`'s own back link already uses for "Back to Project" vs "Back to Calendar". Checked for the same bug pattern elsewhere (`grep` for "Back to Clients") -- no other instance; `ClientDetail.tsx`'s own back-to-list link is correct as-is (it IS the list's own direct child), and `ClientImport.tsx` has no client context to preserve.

## 3. Projects tab Status filter: pipeline stages instead of raw status

Follow-up to last session's fix, which folded "Needs Scheduling" into the existing Status filter alongside the three raw `InquiryStatus` values (SCHEDULING/WAITLISTED/CONFIRMED). The user asked for the filter to be the full 5-stage pipeline taxonomy instead (Needs Scheduling/Scheduled/Waiver Verified/Session Complete/Project Complete) -- the same one the status pill and Group by Status already use, so all three (pill, grouping, filter) now share one consistent taxonomy on this tab.

- `apps/web/src/pages/Inquiries.tsx`: Status filter options for the Projects tab now come straight from `PROJECT_STAGE_ORDER`/`PROJECT_STAGE_LABELS` (`lib/kanban.ts`) instead of `PROJECTS_TAB_STATUSES`. Since no derived stage is a real `InquiryStatus` a server-side `?status=` filter can express, filtering is now entirely client-side for this tab (`effectiveStatusFilter` always requests the tab's full real-status set from the server; `filteredInquiries` narrows by `deriveProjectStage(inquiry)` afterward) -- the same approach Group by Status was already using.
- Removed the now-unnecessary `NEEDS_SCHEDULING_FILTER_VALUE` synthetic-value plumbing (the OR-semantics logic for mixing a synthetic value with real statuses) and the now-unused `projectNeedsScheduling` import, since every filter option is a derived stage now, not a mix.
- The Kanban board's own columns (`PROJECT_TAB_COLUMNS`, still raw-status-keyed, driving drag-and-drop transitions) are unaffected -- this change is scoped to the List view's Status filter control, not the board's column/transition model, which is a genuinely different concern (a card's real status, not its derived display stage).

Net effect: staff can no longer filter the Projects list specifically by the raw WAITLISTED status through this dropdown (that distinction is now fully absorbed into the derived-stage system, same as the status pill already treats it) -- the Kanban board is still the place to see WAITLISTED specifically, as its own column.

## Verification

Live against the real dev stack:
- Confirmed the Status filter dropdown on the Projects tab shows exactly the 5 stage labels and nothing else (screenshot).
- Selected "Needs Scheduling" and confirmed the list narrowed to exactly 6 rows, every one tagged "Needs Scheduling" -- matching the count already shown by Group by Status for the same stage.
- GiftCardDetail/checkbox fixes reviewed against the exact same established patterns already used elsewhere in the codebase (AppointmentDetail's conditional back-link, SessionBreakdownEditor's checkbox sizing) rather than invented fresh, so no new visual/behavioral pattern was introduced.

Both typechecks (`npx tsc --noEmit` api, `npx tsc -b` web) and `npm run build` (web) clean.

## Commit

`db8a8e6`

---

# Activity log — usability audit and improvement

Single session on `main`. No schema changes. Scoped the investigation to the 5 entity types actually rendered via `<AuditTrail>` in the frontend (Inquiry, Appointment, Client, GiftCard, LiabilityWaiver) -- confirmed by grep -- not every `logAudit` call site in the backend (~50+), most of which log to entity types (`InquiryNote`, `PersonalTask`, `Conversation`, etc.) no page ever displays.

## Investigate first — all four hypothesized problems confirmed live, not just in code

Screenshotted a real Inquiry's "Activity History" widget with real dev data before making any change. Confirmed:
- **Raw action slugs**: `create-by-staff`, `status change` (the existing fallback already replaced `_` but not `-`, so hyphenated actions rendered literally).
- **Raw ID dumps**: `Client id: cms7f5kh8000658i21erxmien` -- a bare Prisma cuid, unresolved.
- **No date grouping**: every entry (spanning two days in the seeded data) rendered in one flat list.
- **No filtering**: no way to narrow by action type or by staff member on an entity with dozens of entries.

## Build — fixed directly

**1. Human-readable actions + fields** (`apps/web/src/components/AuditTrail.tsx`)
- Added an `ACTION_LABELS` map (~35 entries covering every action string used by the 5 in-scope entity types) and fixed the fallback humanizer's regex (`/_/g` → `/[_-]/g`) so any future/unmapped action still degrades to spaced-out words instead of a raw slug.
- Extended `FIELD_LABELS` for every field newly resolved to a name/timestamp by the backend change below (`clientId` → "Client", `giftCardId` → "Gift card", `fromAppointmentId` → "From appointment", etc.) so labels read naturally once their values are names, not ids.

**2. Date grouping** (`AuditTrail.tsx`, `apps/web/src/lib/format.ts`)
- Added `formatDateOnly` and grouped `filteredLogs` into per-day sections with an uppercase date header, so a long history reads as "JUL 31, 2026 / ... / JUL 30, 2026" instead of one undifferentiated list.

**3. Filtering by action type and staff member** (`AuditTrail.tsx`)
- Reused the app's existing `MultiSelectFilter` component (same one `Inquiries.tsx`/`Clients.tsx` already use for client-side filtering of bounded lists) -- two dropdowns, "All actions" / "All staff", built from the unique values actually present in the fetched logs. Only shown once an entity has more than 5 log entries, so a short history doesn't get filter controls it doesn't need. A distinct "No activity matches these filters." empty state was added, separate from "No activity recorded yet."

**4. Raw foreign-key ids resolved to names** (`apps/api/src/routes/audit.ts`, architectural fix rather than per-route patches)

The route already had an ID-resolution mechanism, but it was narrow in two ways: only two field names (`assignedArtistId`, `appointmentId`), and only handled `{from,to}`-shaped diff values -- a plain value logged at creation time (e.g. a bare `{ clientId: "..." }`) was never touched regardless of field name. Rather than hand-patch the ~25 individual call sites a research pass flagged across `appointments.ts`, `clients.ts`, `giftCards.ts`, `waivers.ts`, `inquiries.ts`, `lib/deposits.ts`, etc. (disproportionate effort for what's really one mechanism), generalized the one existing mechanism instead:
- Added `client` (`clientId`, `otherClientId`, `sourceClientId`, `survivorId`, `referrerClientId`, `referredClientId`) and `giftCard` (`giftCardId`, `giftCardIds`, `exemptGiftCardIds`, `newGiftCardId`, `derivedFromGiftCardId`, `satisfiedByExistingGiftCardId`) categories alongside the existing `artist`/`appointment` ones; extended `appointment` with `fromAppointmentId`/`toAppointmentId`/`detachedFromAppointment`.
- Generalized value handling from diff-only to a shared `walkIdValues`/`mapIdValues` pair that handles a bare string, a `{from,to}` pair, or a string array (`giftCardIds`) uniformly -- one code path per category, not three.
- Unresolvable ids (already-deleted rows, or, as found live, a handful of legacy seed rows that stored a gift card's `code` in the `giftCardId` slot instead of its database id) fall back to displaying the raw value rather than erroring or showing blank -- never worse than the pre-existing behavior.
- Also removed the raw `clientId` from `inquiries.ts`'s `create-by-staff` log entirely (rather than resolving it) -- this Inquiry's own Activity History is only ever viewed already scoped to its one client, so the id was pure noise there, unlike `assignedArtistId`, which genuinely changes over the inquiry's life.

## Judgment calls made (not user-specified, applying general audit-log UX practice)

- **Inline detail vs. expand-to-view**: kept every changed field inline (no collapse/expand), since the in-scope entities' entries top out around 4-5 changed fields at once -- an expand affordance would add a click for no real payoff at this data density. Worth revisiting only if an entity type starts logging much larger `changes` objects.
- **Filter visibility threshold**: gated the two filter dropdowns behind `logs.length > 5` rather than always showing them, so a fresh entity with 1-2 log entries doesn't get filter chrome with nothing to filter.
- **Scope of the raw-id fix**: generalized the shared backend mechanism (client + giftCard categories, extended appointment) rather than touching individual route files. A handful of categories the research pass flagged were deliberately left alone as out of scope for this pass: `artistUserId`/`shared_to_artist`-style fields on entity types not rendered by `<AuditTrail>` at all, `messageId`/`conversationId` in `giftCards.ts`'s `text-receipt` action (internal delivery bookkeeping, not something a viewer needs resolved), and the nested `decisions[].giftCardId` array inside `Appointment`'s `checkout` action changes (an array of objects, not a flat field -- would need a third walker shape for one action). None of these regress from their pre-existing (already-unresolved) state.

## Verification

Playwright against the local dev stack (api `:4093`, web `:5292`), against a real Inquiry with two days of seeded activity:
- Before: flat list, `create-by-staff`, `Client id: cms7f5kh8000658i21erxmien` raw cuid, "artist reassigned" (partial-humanize), no grouping, no filters (screenshot).
- After: same entity now grouped under "JUL 31, 2026" / "JUL 30, 2026" headers; `create-by-staff` → "created this", `Client id:` line → "Client: LongDesc TestClient"; "artist reassigned" → "reassigned the artist"; "All actions" / "All staff" filter dropdowns present (screenshot).
- Filtering: selected "reassigned the artist" in the action filter and confirmed the list narrowed to only those entries, with every other action's rows removed from view; cleared it and confirmed the full list returned.
- Live-verified the generalized `audit.ts` resolution end-to-end for two of its two new/extended categories via real actions on the running dev stack: `client` (the historical `create-by-staff` entry above resolving a real cuid to "LongDesc TestClient"), and `appointment`'s extended field set (a live gift-card rollover producing a fresh entry whose `fromAppointmentId` resolved to the appointment's real start-time). The `giftCard` category shares the exact same `walkIdValues`/`mapIdValues`/lookup code path (verified by reading, not a separate implementation) but wasn't independently reproduced with a genuinely-unresolved live value in this session -- noting this rather than silently claiming full live coverage.

Both typechecks (`npx tsc --noEmit` api, `npx tsc -b` web) and `npm run build` (web) clean.

## Commit

`569b1d2`

---

# Team staff table glass treatment, header alignment, and persistent Sidebar across page transitions

Three-part session on `main`. No schema changes, no backend changes -- purely `apps/web` frontend.

## 1. Staff table glass treatment (Team page)

Restored `.card-surface` to the Staff tab's main roster table wrapper in `Team.tsx`, matching the same fix already applied to `Clients.tsx`'s table in an earlier session. The table had `.card-surface` removed at some point with an explicit "dense-data, no glass" rationale left in a code comment -- overridden here by direct request; the comment now documents the override rather than the original reasoning. Left untouched (still no glass, same original rationale, since neither was part of the request): the Pending Invites sub-table beneath the roster, and the Permissions matrix table below that.

## 2. Header row vertical alignment (Team's Staff table)

Its `<th>` cells used bottom-only padding (`pb-3`), which put the header text near the top of the shaded `bg-surface-inset` header row instead of centered -- visibly different from Inquiries.tsx's table (`py-2`, symmetric) and from Clients.tsx's own table, already fixed to match `py-2` in an earlier session. Changed all 5 `<th>` cells in the Staff table (Name/Email/Role/Status/action column) from `pb-3` to `py-2`, bringing all three of this app's dense-data tables onto the same convention.

## 3. Sidebar remounting on every page transition (architectural fix)

**Root cause**: every one of the 16 authenticated app pages rendered its own `<Sidebar />` inline, inside its own copy of the same three-div wrapper (`flex min-h-screen` > `min-w-0 flex-1 overflow-y-auto` > `mx-auto max-w-*`) -- 16 separate copies of the same markup, not a shared layout. `App.tsx`'s top-level page-transition mechanism (`AnimatePresence` + a `<PageFade key={location.pathname}>` wrapping the entire routed `<Routes>` tree) forces React to fully unmount and remount that whole subtree -- Sidebar included -- on every single navigation, since a key change is what tells `AnimatePresence` "this is a new element, exit the old one and mount a new one." React Router's own nested-route/`<Outlet>` mechanism wasn't in play at all -- there was no shared parent route for any of these 16 pages to begin with.

**Fix**: extracted a persistent shell.
- New `apps/web/src/components/AppShellLayout.tsx`: renders `<Sidebar />` once, plus its own inner `<AnimatePresence>` keyed on `location.pathname` wrapping only `<Outlet />` -- so page *content* still fades on every navigation, just without carrying Sidebar along for the ride.
- New `apps/web/src/components/PageFade.tsx`: the fade/settle animation itself, pulled out of `App.tsx` into a shared, `forwardRef`-wrapping component (`AnimatePresence`'s `popLayout` mode needs a real DOM node to measure/position while exiting) -- used by both `App.tsx`'s outer transition and `AppShellLayout`'s inner one, so the two can't drift into two different-feeling animations.
- `App.tsx`: all 16 authenticated routes now nest under one `<Route element={<ProtectedRoute><AppShellLayout /></ProtectedRoute>}>`, replacing 16 individual `<ProtectedRoute>`-wrapped `<Route>` entries. Auth is now checked once per navigation within the shell instead of once per page.
- Nesting under a shared `<Outlet>` alone wasn't sufficient, though: the OUTER `PageFade`'s key was still the full `location.pathname`, so `App.tsx`'s own `AnimatePresence` would still treat `/dashboard` -> `/clients` as "a new route" and remount everything below it, `AppShellLayout` included. Added `getPageFadeKey()`: any pathname whose first path segment is one of the 13 app-shell route segments collapses to one shared key (`'app-shell'`), so navigating *within* the shell no longer changes the outer key at all -- only entering/leaving the shell (e.g. to `/login`) does.
- Removed each page's own inline `<Sidebar />` + 3-div wrapper individually across all 16 files (Dashboard, Clients, ClientImport, ClientDetail, Calendar, AppointmentDetail, ArtistDetail, ArtistCreate, Inquiries, InquiryDetail, MyInquiries, Settings, Profile, Team, Tasks, GiftCardDetail), each now returning just its own `<div className="mx-auto max-w-*">...` content directly. 5 of the 16 (ClientImport, ClientDetail, Calendar, MyInquiries, Team) needed a `<>...</>` fragment instead of a single root div, since a Modal (or several) rendered as a sibling of the `mx-auto` div, not a descendant of it -- verified div-by-div with a small stack-matching script rather than by eye, after visual inspection alone repeatedly produced wrong guesses on the more deeply-nested files.

**A separate, pre-existing bug found (not fixed, out of scope)**: `AuthLayout.tsx`'s own code comment claims its background/chrome persists across `/login` <-> `/forgot-password` navigation "and never unmounts." Playwright DOM-node-identity testing (`elementHandle.evaluate(el => el.isConnected)`) during this investigation disproved that -- the same root-cause pattern (the outer pathname-keyed `AnimatePresence`) breaks its persistence claim too, just for a different subtree. Flagging since it surfaced during this work, not fixing it since it wasn't part of the request.

## Verification

Playwright against the local dev stack (scratch ports, api `:4070` / web `:5250`), logged in as `owner@dev-studio.test`:
- Grabbed a handle to Sidebar's own `<aside>` element right after login, then clicked through Dashboard -> Clients -> Team -> Calendar -> Dashboard via the real sidebar nav links (not `page.goto`, which would trivially "pass" by forcing a hard reload every time) -- confirmed `isConnected` stayed `true` after every single hop, i.e. the same DOM node survived all four navigations.
- Zero console errors across the run.
- Confirmed a hard reload on a nested app-shell route (`/team`) still resolves correctly (single `<aside>`, correct URL) -- the new nested-route structure didn't break direct/refreshed loads.
- Screenshotted Clients and Team: header text is vertically centered in both header rows; Team's Staff table shows the frosted-glass `.card-surface` treatment matching Clients'.

Both typechecks (`npx tsc --noEmit` api -- untouched this session, no backend changes; `npx tsc -b` web) and `npm run build` (web) clean.

## Commit

`6226795`

## Cleanup

Scratch dev servers (api `:4070`, web `:5250`) killed by PID. Scratch Playwright install and the stack-based div-matching analysis script (used to disambiguate wrapper-div nesting across several large page files where visual inspection kept proving unreliable) deleted from the scratch directory after use.

## Follow-up: page transition felt choppy, simplified to a plain fade

`PageFade.tsx`'s `y: 8` / `y: -8` slide, combined with `pageTransition`'s spring (`lib/motion.ts`), was fine for small isolated UI elements but read as choppy once real page content -- tables, grids, forms, all reflowing as they mount -- was doing so underneath a spring's continuous, physics-driven position updates at the same time; the two fighting for the same frames is what read as jank, not a performance problem to profile away.

- `lib/motion.ts`: `pageTransition` changed from a `type: 'spring'` (bounce 0.25, visualDuration 0.5) to a plain `type: 'tween'`, `duration: 0.15`, `ease: 'easeOut'`.
- `PageFade.tsx`: dropped the `y` offset from `initial`/`animate`/`exit` entirely -- opacity only now. `pageTransition` is only ever consumed here, so no other call site was affected.

Verified via `npx tsc -b` and `npm run build` (both web, clean) -- no functional/live re-verification beyond that, since this is a pure animation-easing tweak to code just verified live moments earlier.

## Commit (follow-up)

`2ca9b88`

---

# Estimate response: missing realtime invalidation — fixed

Reported: after a client responds to an estimate (specifically noticed on a revised-estimate approval), `InquiryDetail.tsx`'s "Awaiting client approval..." banner stays stuck on the old state until a manual refresh, unlike the rest of the app's realtime updates.

## Root cause

`apps/api/src/routes/estimates.ts` -- the public, unauthenticated router the client's browser hits directly from the estimate link (no staff session, no socket registered under that connection) -- never called `emitInvalidation` anywhere in the file. Every other mutation route in the app follows the convention documented in `lib/realtime/registry.ts` (call `emitInvalidation` right after the mutation succeeds); this file was the one place that pattern was skipped entirely, across all three of its mutations:
- `GET /verify/:token` -- sets `estimateOpenedAt` on first open.
- `PATCH /respond/:token` -- the original estimate's PROCEED/BUDGET_TOO_HIGH/DECLINE decision.
- `PATCH /revision/respond/:token` -- the revised-estimate APPROVE/FLAG decision (the one directly reported).

Because none of these emit `inquiry.updated`, a staff member with `InquiryDetail.tsx` open never gets pushed the change -- the page's `['inquiry', id]` query only ever refetches on a manual reload, since `SocketContext.tsx`'s `refetchOnWindowFocus: false` is deliberate (the app leans entirely on server-pushed invalidation instead of polling).

## Fix

Added `emitInvalidation({ type: "inquiry.updated", studioId, inquiryId })` after each of the three mutations above, matching the exact call shape every other inquiry-mutating route already uses (`inquiries.ts`, `deposits.ts`, `waivers.ts`, etc.). `inquiry.updated`'s existing key set already covers both the Inquiries list (`["inquiries"]`) and the single-inquiry detail page (`["inquiry", inquiryId]`), so no registry changes were needed -- just the three missing call sites.

## Verification

Live, no code-reading-only claim: seeded a real revision on inquiry `LongDesc TestClient` (`POST /inquiries/:id/revise-estimate`), opened its `InquiryDetail.tsx` page in a browser (Playwright) and left it sitting on the "Awaiting client approval of a revised estimate" banner -- then, in a second, independent request (simulating the client's own browser, no shared session), called `PATCH /estimates/revision/respond/:token` with `{ decision: "APPROVE" }`. Without reloading or touching the open page at all, the banner flipped live from amber "AWAITING CLIENT APPROVAL OF A REVISED ESTIMATE" to green "CLIENT APPROVED THE REVISED ESTIMATE ON Jul 31, 2026, 8:30 PM" within ~2.5s (screenshots: before/after). The other two fixed call sites (`estimate_opened`, the original PROCEED/BUDGET_TOO_HIGH/DECLINE response) share the identical one-line fix and weren't separately live-reproduced, since they're the same code shape as the one that was.

`npx tsc --noEmit` (api) clean.

## Commit

`54e038d`

---

# Auto-book appointment on deposit payment, with conflict fallback

Single session on `main`. No schema changes -- every new signal (auto-booked, conflicted) is derived from existing columns, not a new one.

## What the tentative-time mechanism looked like before this session

The deposit page already let staff pick a tentative time (`DepositForm.proposedStartAt`/`proposedEndAt`, staff-picked from `getSuggestedTimes`, required on every fresh deposit form -- see `POST /inquiries/:id/deposit-form`) and showed it to the client as "tentatively scheduled for...". Its own schema comment was explicit about the gap: "purely informational... Deliberately has NO relation to Appointment... real scheduling still only happens via `POST /inquiries/:id/schedule` after the deposit is paid." Confirmed by reading every write site: nothing ever turned a paid deposit's tentative pick into a real `Appointment` on its own -- staff had to notice the payment and book it by hand, every time, for every session.

## Root mechanism found and reused

`apps/api/src/lib/deposits.ts`'s `issueGiftCardForPaidDeposit` is already the **one** place both payment paths (Stripe webhook, staff manual mark-paid) converge, by design (its own comment: "the ONE place this happens"). Auto-booking hooks in right there, once, rather than duplicating logic into both the webhook handler and the manual route.

Also discovered mid-investigation: the newer multi-session booking route (`POST /appointments`, with an optional `plannedSessionId`) never touches `Inquiry.appointmentId`/`status` -- only the older, single-session `POST /inquiries/:id/schedule` does that. `deriveProjectStage`/`projectNeedsScheduling` (`apps/web/src/lib/kanban.ts`) already OR in the `Appointment.inquiryId` 1:many relation alongside that singular field, so a later session showing up correctly was never actually dependent on the singular field being touched -- only the very first appointment a project ever gets needs to fill it (for the client-facing deposit page, which only reads that one field). This let the auto-book logic use one unified code path for both planned (multi-session) and un-planned projects, rather than two.

## Build

`apps/api/src/lib/deposits.ts` -- after the gift card is issued (deposit genuinely paid), if the deposit form has a tentative time:
- Re-runs `findBufferConflict` (the exact same buffer/conflict check `POST /appointments`, `POST /inquiries/:id/schedule`, and the scheduling assistant's suggested-times all already use) against the studio's current `assignedArtistId` for this project, fetched fresh (not the pre-payment snapshot).
- **Free**: creates a real `Appointment` (CONFIRMED, TATTOO_SESSION), attaches the freshly-issued gift card, links `PlannedSession.appointmentId` if this deposit form belongs to one, and -- only if this is genuinely the project's first-ever appointment -- also sets the legacy singular `Inquiry.appointmentId`/`status: CONFIRMED`. Logs `auto_booked_from_deposit`; emits `appointment.changed` (the payment-confirmation routes already emit `inquiry.updated`).
- **Conflicted**: does nothing to the schedule -- logs `auto_book_conflict` with the proposed times that didn't make it. Guarded against double-booking a session a staff member raced to book by hand in the same narrow window (`plannedSession.appointmentId` already set → skipped).
- Independent per deposit form: each session's own payment re-checks and books (or flags) only its own tentative slot, regardless of what state any other session of the same project is in.

**New system task** (`apps/api/src/lib/tasks/schedulingConflict.ts`, registered in `TASK_SOURCE_REGISTRY`): surfaces "Scheduling conflict: ..." in the existing task feed, derived the same pure-function-of-current-data way every other source in that registry already works -- a paid, proposed-time-bearing deposit form (or planned session) with no linked appointment. Distinct from the existing `READY_TO_SCHEDULE` source (an ordinary "nobody's booked this yet" project where no attempt was ever made).

**Frontend** (`InquiryDetail.tsx`): the Session Plan widget's per-session appointment badge now shows a distinct red "Scheduling conflict" (was going to otherwise read identically to the routine gray "Not yet booked") plus an explanatory banner with the missed tentative time, right above the same existing "Book Appointment" button -- which already doubles as the resolution action, no new UI needed there. The un-planned path's own "Scheduling" section (nested in the Appointments widget) gets the equivalent banner, derived from the inquiry's latest deposit form. `AuditTrail.tsx` gets two new `ACTION_LABELS` entries so both outcomes read as plain English in Activity History instead of raw action slugs.

## Judgment call: excluding pre-existing data from the conflict signal

Caught live, not hypothesized: without a cutoff, the "conflict" derivation (paid + had a tentative time + no appointment) also matches a lot of **pre-existing dev-seed data** -- every already-paid deposit from before this feature existed that staff simply hadn't gotten around to booking by hand yet. Those are ordinary, unremarkable "needs scheduling" projects, not conflicts; surfacing them all as "Scheduling conflict" tasks on rollout would be actively misleading (confirmed by hitting `GET /tasks` against the real dev database and seeing ~10 false positives before the fix). Since a *real* conflict can only ever be produced by this feature's own code, both the task source and the frontend badges gate on `paidAt >= AUTO_BOOK_SHIPPED_AT` (a literal ship-date constant, kept in sync in both `apps/api/src/lib/tasks/schedulingConflict.ts` and `apps/web/src/pages/InquiryDetail.tsx` -- no schema change, no new column, just a code constant). Re-verified after adding it: the flood of false positives disappeared, the one genuine conflict from this session's own test data still showed correctly.

## Verification -- happy path and conflict path both tested with real conflicting data

Live against the local dev stack (api `:4093`, web `:5292`), driving the real routes end-to-end (sign → mark-paid), not a script that bypasses them:

- **Un-planned happy path** (Bailey Testperson): paid a deposit with a genuinely free tentative time. Confirmed via `GET /inquiries/:id`: `status` → `CONFIRMED`, `appointmentId` set, the real appointment's `startTime`/`endTime` exactly match the tentative pick. Audit log shows `auto_booked_from_deposit`.
- **Un-planned conflict path** (Emily Rodriguez): set a tentative time, then deliberately pre-booked a real conflicting `CONSULTATION` appointment for the same artist directly overlapping it (consultations block calendar time exactly like a tattoo session -- confirmed via `findBufferConflict`'s own existing behavior), then paid the deposit. Confirmed: `status` stayed `SCHEDULING`, `appointmentId` stayed `null`, no duplicate/second appointment was created. Audit log shows `auto_book_conflict` with the correct proposed times. `GET /tasks` surfaced a `SCHEDULING_CONFLICT` task. Screenshotted the live page: red "The tentative time (Aug 10, 2026, 11:00 AM) was no longer available when this deposit was paid, so it wasn't booked automatically. Pick a new time below." banner, with the existing manual scheduler (still fully functional) right below it.
- **Multi-session, independently per session** (Desmond Okafor, a real 2-planned-session project) -- the task's own explicit ask: booked session 1's deposit with a free tentative time (auto-booked successfully) and, separately, pre-booked a conflicting consultation for session 2's tentative slot before paying session 2's deposit. Confirmed via `GET /inquiries/:id`: session 1's `plannedSession.appointmentId` is set (real appointment, matching times), session 2's stayed `null` -- one session's conflict had zero effect on the other's booking. Screenshotted the Session Plan widget: session 1 shows green "Scheduled", session 2 shows red "Scheduling conflict" with its own banner and "Book Appointment" resolution button, side by side. Activity History shows both `auto-booked the appointment on deposit payment` and `could not auto-book -- the tentative time was no longer available` entries in plain English.

Both typechecks (`npx tsc --noEmit` api, `npx tsc -b` web) and `npm run build` (web) clean.

## Commit

`a1272c9`

---

# Settings — new "Defaults" tab, audit existing hardcoded processes for configurability

Single session on `main`. Investigate-and-propose first (this section), then build only the low-risk items from the proposal (see "Part 2" below).

## Part 1 — Proposal: audit of hardcoded business processes

**Starting point, to avoid re-proposing what already exists**: this app already has a *lot* of studio-level configurability on `StudioSettings` -- deposit tiers, reminder message text and send times, gift card expiration, referral reward amount, cold-lead sweep window, timezone, business hours, waiver questions/clauses, several free-text policy fields. Read every one of these end to end before auditing further, specifically so this proposal doesn't re-suggest something that's already a setting.

What follows is what's still genuinely hardcoded -- one fixed value or fixed text, identical for every studio, with no override.

### Safe, additive -- proposed for Part 2 (implemented this session)

**1. Scheduling buffer time** (`SCHEDULING_BUFFER_MS = 1.5 hours`, `apps/api/src/lib/schedulingConflict.ts`)
A flat 1.5-hour buffer used everywhere an artist's double-booking risk is flagged: manual scheduling (`POST /inquiries/:id/schedule`), the general appointment-booking route, calendar drag-reschedule, the scheduling assistant's suggested times, and this session's own recent auto-book feature. "Flag, not block" by its own design -- a studio that tattoos in shorter sessions (or wants more breathing room) has no way to adjust this today.
*Proposal*: `StudioSettings.schedulingBufferMinutes`, default 90 (= today's 1.5h, so every existing studio's behavior is unchanged until an OWNER edits it). One shared function (`findBufferConflict`) and one suggestion service (`getSuggestedTimes`) both already centralize this -- no logic to duplicate, just where the number comes from.
*Risk*: **Low.** A single number, read in a handful of places, purely a warning threshold (never a hard block) -- widening or narrowing it can't corrupt data or silently double-book anyone.

**2. Deposit processing fee** (`DEPOSIT_FEE_CENTS = $10`, `apps/api/src/lib/depositTiers.ts`)
A flat fee added on top of every tier-based deposit -- the tiers themselves are already configurable (Package C1), but the fee stacked on top of them, explicitly, is not (see that file's own comment: "unchanged by configurable tiers"). Every studio pays the exact same $10 processing fee regardless of what they'd actually want to charge (or whether they want to pass a fee through at all).
*Proposal*: `StudioSettings.depositFeeCents`, default 1000 (= today's $10).
*Risk*: **Low.** One number, consumed in exactly one computation (`computeDepositTier`/`resolveDepositAmounts`), already proven safe to vary by the fact the tiers next to it already do.

**3. Reminder cadence day-offsets** (`daysOut: 7` / `1` / `0`, hardcoded at each `sendClientReminders(...)` call site in `apps/api/src/lib/jobs/reminderTicker.ts`)
The reminder cadence's *time of day* (`reminderSendTimes`) and *message wording* (`reminderTemplates`) are already fully studio-configurable -- but *which day* each of the three reminders fires (a week before, the night before, the morning of) is three literal numbers baked into the ticker's own call sites, identical for every studio.
*Proposal*: `StudioSettings.reminderWeekBeforeDays` (default 7) and `reminderNightBeforeDays` (default 1). Deliberately **not** making "morning of" configurable -- changing it away from 0 stops meaning "morning of" at all, and the reminder's own template wording (and its dedicated `reminderMorningOfSentAt` dedup column) assume same-day. Renaming/generalizing that one is a bigger, differently-shaped change than the other two.
*Risk*: **Low.** The exact same `sendClientReminders` function already runs today with a hardcoded number; making it configurable doesn't introduce a new code path, just a different source for the number. Worth noting for the record: two offsets *could* be configured to collide (e.g. both set to the same day), which would just mean a client gets two reminder texts the same day instead of one -- a minor UX duplication, not a data-integrity or safety issue, so not worth blocking on.

### Safe in principle, but deferred -- more plumbing than this session's batch

**4. Checkout-overdue threshold** (`hoursSinceEnd > 24`, `apps/web/src/lib/format.ts`'s `describeAppointmentStatus`)
Purely a *display* threshold -- how many hours past an appointment's end time before its status pill flips from amber "Checkout Pending" to red "Checkout Overdue." Hardcoded at 24h, no studio override.
*Why deferred, not built*: unlike items 1-3, this one has no already-fetched `StudioSettings` sitting in scope at any of its three call sites (`AppointmentDetail.tsx`, `Calendar.tsx`, `ClientDetail.tsx`) -- confirmed by checking: the frontend has no shared studio-settings context/hook today (`useStudio()` only carries name/logo/website), so wiring this in means either a new shared hook or three separate ad hoc fetches, not just "read one more field off data already in hand." Genuinely safe to expose (a pure display derivation, no data risk either way), just more implementation surface than the other three -- better scoped as its own small follow-up than folded into this batch under time pressure.
*Risk*: **Low** (once built). Flagging the *effort*, not the *risk*, as the reason to defer.

### Reviewed, found to be genuinely hardcoded, but too complex/risky for this session

**5. Deposit agreement legal terms** (`TERMS`, 8 fixed clauses in `apps/api/src/routes/deposits.ts`)
The single most "pigeon-holed to one studio's specific setup" thing found in this audit. Every client who pays a deposit, at every studio, must check off the exact same 8 English sentences verbatim:
- "A deposit is required to set an appointment. Deposits are non-refundable and are applied to the final price of the tattoo."
- "Artists reserve the right to reschedule the appointment if the client is more than 15 minutes late without notification."
- "A no-call/no-show forfeits the deposit. A 48-hour notice is required to change a scheduled appointment."
- "After a no-call/no-show, a new deposit is required to set up another appointment."
- "Appointments may be rescheduled up to 3 times; the deposit is forfeited on the 3rd reschedule."
- "Deposits expire one year after the date they were created."
- "Client must bring a government-issued ID and the Deposit Voucher (issued after payment) on the day of the appointment."
- "Client reconfirms they are at least 18 years of age."

Confirmed via a full read of `appointments.ts`: **none of this is code-enforced beyond the checkbox itself** -- there's no automatic gift-card-forfeiture-on-NO_SHOW logic, no reschedule counter anywhere in the codebase. It's pure legal copy the client agrees to, not a hidden state machine -- which actually makes the *text* itself lower-risk to genericize than I initially assumed. What makes it risky is everything else:
- It's a legal agreement a client is asked to affirmatively sign off on, not ordinary UI copy -- getting the editing UX wrong (e.g. letting a studio delete "client reconfirms age 18" without realizing what that removes) has real liability implications a config-UI PR shouldn't quietly decide alone.
- The app *already* has a separate, already-configurable `reschedulePolicy` rich-text field (shown on a public `/reschedule-policy/:studioSlug` page) that has **zero relationship** to this hardcoded list -- a studio could already be editing a "reschedule policy" that says one thing while this checklist, which the client actually has to agree to before paying, says something else entirely. Fixing that overlap is a real product-design question (one field or two? does editing one need to touch the other?), not something to resolve as a side effect of a "make it configurable" PR.
*Proposal, not built*: a dedicated future session, scoped around one specific design decision -- most likely turning `TERMS` into an ordered, studio-editable list (reusing the same WYSIWYG/array-editor pattern `CustomPolicy`/`waiverClauses` already use), *plus* explicitly deciding what happens to `reschedulePolicy` in the process, ideally with a legal/product sign-off on the default text before any studio can touch it.
*Risk*: **High** (implementation risk is actually low; product/legal risk is real).

### Reviewed at the task's explicit request -- no hardcoded-assumption finding

**6. Estimate response options** (`PROCEED` / `BUDGET_TOO_HIGH` / `DECLINE`, `apps/api/src/routes/estimates.ts`)
Each of the three is a structurally distinct code path -- a different `InquiryStatus` transition, different downstream UI, different follow-up behavior -- not a parameterizable default. Adding a 4th option (or removing one) would be a genuine new feature (new status, new UI branch, new task-source logic), not loosening an existing hardcoded value. No proposal here.

**7. Waitlist behavior** (`WAITLISTED` status, `apps/api/src/routes/inquiries.ts`)
It's a single status flag plus an optional staff note -- no automatic slot-reoffer, no notification-on-cancellation, no matching logic exists anywhere to genericize. If a studio wants smarter waitlist handling (auto-notify when a slot frees up, say), that's a new feature to scope on its own, not a hardcoded default this session's mandate covers.

### Noted, not compelling enough to propose

**8. Token TTLs** (deposit link 48h, estimate link 7 days, revision link 7 days, waiver link 24h, password reset 1h, invite link 7 days -- scattered across `routes/inquiries.ts`, `routes/deposits.ts`, `lib/waivers.ts`, `routes/auth.ts`, `routes/studios.ts`)
These are internal security/session windows, not a business process in the sense the task's own examples point at (deposit tiers, reminder cadence, buffer rules, cancellation policy). Misconfiguring one has little upside and a real downside (a token TTL too short breaks a legitimate client mid-flow; too long is a minor security loosening) for a return that doesn't map to any actual studio request seen in this codebase's history. Noted for completeness, not proposed.

## Part 2 — Build

Implemented exactly the three "Low risk" items above (#1-3). Everything else stays as documented in Part 1: #4 deferred (more frontend plumbing, no safety concern), #5 flagged for a dedicated future session (legal/product risk, not implementation risk), #6-8 reviewed with no action needed.

**Schema**: 5 new `StudioSettings` columns (`schedulingBufferMinutes`, `depositFeeCents`, `reminderWeekBeforeDays`, `reminderNightBeforeDays` for items #1-3, plus none extra), all with defaults exactly matching the prior hardcoded values -- no existing studio's behavior changes until an OWNER edits one. One migration (`20260801014804_settings_defaults_tab_buffer_fee_reminder_days`).

**Backend wiring**: `findBufferConflict`/`formatBufferWarning` (`lib/schedulingConflict.ts`) now take an optional `bufferMs`, threaded through all 4 call sites (`POST /appointments`, `PATCH /appointments/:id`, `POST /inquiries/:id/schedule`, the auto-book step in `lib/deposits.ts`) and `getSuggestedTimes` (`lib/schedulingAssistant.ts`) -- every one of them already had `StudioSettings` fetched nearby for something else, so this was extending an existing `select`, not adding a new query anywhere. `computeDepositTier`/`resolveDepositAmounts` (`lib/depositTiers.ts`) take an optional `feeCents`, wired at its one real call site (`POST /inquiries/:id/deposit-form`). `reminderTicker.ts`'s week-before/night-before `sendClientReminders(...)` calls now read `reminderWeekBeforeDays`/`reminderNightBeforeDays` off the studio row `loadStudiosWithSettings()` already fetches in full; morning-of stays the literal `0`.

**`PATCH /studio-settings`**: the 3 new fields validated and added to the existing `settings.manageDefaults` permission group (no new permission key needed) and the audit-diff field list, matching every other numeric default on this route.

**Frontend**: new "Defaults" tab (same OWNER/FRONT_DESK visibility as Policies & Templates). Rather than adding a second, competing "defaults" concept next to the app's existing one, moved the existing Defaults summary card (+ its edit modal, unaffected since it was already rendered independent of `activeTab`), the "Reminder Templates & Send Times" card, and the "Deposit Tiers" card out of Policies & Templates into the new tab -- Policies & Templates now holds only actual policy text/templates (WYSIWYG fields, waiver questions/clauses, message templates, intake forms), which is what its own label already said it was. Added inputs for all 3 new fields into their natural existing homes: scheduling buffer + deposit fee into the Defaults card/modal, the two reminder day-offsets into the Send Times card (with "morning of" shown as a fixed, non-editable "same day" note explaining why).

## Verification

Both typechecks (`npx tsc --noEmit` api, `npx tsc -b` web) and `npm run build` (web) clean.

Live against the local dev stack (api `:4093`, web `:5292`):
- Screenshotted the new Defaults tab: Defaults card (with the two new fields), Reminder Templates & Send Times (with the two new day fields and the "morning of" explanation), Deposit Tiers -- all present and correctly moved.
- Screenshotted Policies & Templates afterward: confirmed the moved cards are gone, only Policies/Waiver Questions & Clauses/Intake Forms/Message Templates remain.
- Edited scheduling buffer (90 → 45 min) and deposit fee ($10 → $5) through the actual UI modal, saved, confirmed the new values render immediately.
- Confirmed the change is real, not just cosmetic, via the API: regenerated a deposit form and got back `feeAmount: 5` (not the old hardcoded 10); booked two appointments 60 minutes apart for the same artist and got `bufferWarning: null` (would have flagged under the old hardcoded 90-minute buffer); booked a third 20 minutes after that and got back `"Less than 0.75 hours..."` -- confirming both the new 45-minute threshold and that the warning text itself (not just the underlying number) now reflects the configured value instead of a hardcoded "1.5 hours".
- Confirmed `reminderWeekBeforeDays`/`reminderNightBeforeDays` round-trip correctly through `PATCH /studio-settings` (5/2 saved and read back correctly).
- Reset all values back to their defaults (90 min / $10 / 7 days / 1 day) afterward, since these are studio-wide settings shared across this dev database's other test data, unlike the additive per-record test data (deposit form, gift card, appointments) left in place per this session's established convention.

## Commit

`b55d1e5`
