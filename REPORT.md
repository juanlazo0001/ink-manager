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


