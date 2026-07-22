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

`<FILLED IN AFTER COMMIT>` on `main`.

## Cleanup

Both dev servers (API on a scratch port 4099, web on 5199 — chosen to avoid the several other sessions' dev servers already running on the usual 4000/5173 range) killed. Backfill/verification scratch scripts lived only in the session scratchpad, never in the repo. The worktree at `../ink-manager-sms-consent` will be removed after this report is committed and pushed.
