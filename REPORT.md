# Phase UI-3+4+5 — Plain-language settings, phone masking, single-day appointments, robust calendar

Three-part session. Each part was built, verified (browser + PowerShell/curl), and committed locally before the next began.

- **Part 1 (UI-3)** commit: `50d5ee8` — "Phase UI-3: plain-language system panel, icon action buttons, rich-text policy editor"
- **Part 2 (UI-4)** commit: `5a13493` — "Phase UI-4: phone masking, single-day appointment form"
- **Part 3 (UI-5)** commit: `62b7b01` — "Phase UI-5: robust calendar view with resource columns and drag-and-drop"

**No commit in this session was pushed.** The task text said "commit now" / "record the hash" at the end of each part but never said "push" — unlike other tasks earlier in this session that explicitly asked for it. I deliberately left all three commits local pending your explicit instruction to push.

---

## Part 1 — Plain-language settings, icon buttons, rich-text policy editor

### JOB_DISPLAY dictionary (Settings.tsx)
```
giftCardExpirationSweep → "Gift Card Expiration"
  "Automatically marks gift cards as expired once their expiration date has passed."
coldLeadSweep → "Cold Lead Detection"
  "Automatically flags inquiries as cold leads after a period of no activity."
```
Cron string, internal `description`, and raw job JSON moved behind a `<details>` "Advanced" disclosure. Status renders as icon+plain text (Succeeded/Failed with reason/Running…/Not run yet — never color alone), with a relative timestamp ("Today at 2:14 PM", "3 days ago") computed in the studio's configured timezone and the exact timestamp available via a native title-attribute tooltip.

### Icon action buttons
InquiryDetail's Message / Share with Artist / More-actions buttons: icon+label pill at ≥768px, 44px circular icon-only touch target below that, `aria-label` and native `title` tooltip at both breakpoints. No other header button on that page had the same crowding issue, so no further buttons needed the pattern.

### Rich-text policy editor (8 fields, Tiptap + DOMPurify)
`refundPolicy`, `depositPolicy`, `reschedulePolicy`, `communicationPolicy`, `estimateTerms`, `waiverAcknowledgment`, `waiverPhotoRelease`, `calendarInviteTemplate` — each gets its own edit-icon + compact plain-text preview (HTML stripped, truncated, "No content yet" when empty) and its own single-field modal with a small Tiptap toolbar (bold/italic/underline/bullet/numbered list/link/basic headings). The 5 "Defaults" fields (`coldLeadDays`, `estimateFollowUpHours`, `giftCardDefaultExpirationDays`, `timezone`, `showSidebarBadges`) share one "Edit Defaults" modal and one PATCH. Waiver health-questions/clauses list editor and Message Templates were left untouched (out of scope / pre-existing dedicated editors).

**HTML render sites sanitized** (audited via a full grep of every `dangerouslySetInnerHTML` and snapshot-copy path before touching anything):
- `EstimateResponse.tsx` — public estimate page's `estimateTermsSnapshot`
- `WaiverSign.tsx` — public waiver page's `acknowledgment` and `photoRelease` (two sites)

**5 of the 8 fields — `refundPolicy`, `depositPolicy`, `reschedulePolicy`, `communicationPolicy`, `calendarInviteTemplate` — have zero consumers outside Settings.tsx's own preview/edit UI today.** Reported transparently rather than sanitizing render sites that don't exist. All sanitization uses a restrictive DOMPurify allow-list (`p, br, strong, em, u, ul, ol, li, a, h2, h3` / `href, target, rel`), proven against a real `<script>` + `onerror=` payload saved through the editor and through a direct API call — neutralized at every render site, not just client-side stripped.

Backward compatibility: old plain-text values render fine as a single run-on paragraph until re-saved (not auto-migrated). Existing immutable snapshots (`estimateTermsSnapshot`, waiver `healthQuestionsSnapshot`/`clausesSnapshot`, etc.) are unaffected.

---

## Part 2 — Phone masking, single-day appointment form

### Phone masking
Canonical storage format is a **bare 10-digit US string** (not E.164, despite the task's guess) — this matched the pre-existing `normalizePhone` function in `clients.ts`, adopted as-is per "don't invent a second scheme." One shared `PhoneInput` component (hand-written masking via the existing `formatPhoneInput` helper, no new library) live-formats as `(XXX) XXX-XXXX` while storing/submitting bare digits, with inline "Enter a complete 10-digit phone number" validation.

Applied to: client create/edit (Clients.tsx, ClientDetail.tsx), team member create/edit (Team.tsx), own-profile phone (Profile.tsx), public intake form (IntakeForm.tsx), waiver emergency-contact phone (WaiverSign.tsx), studio location phone (Settings.tsx). Server-side, `normalizePhone` was added as defense-in-depth on every relevant create/update route (clients, users/me, studio users, studio locations, public intake, waiver emergency contact).

**Found but deliberately left untouched:** `components/ConversationsPanel.tsx:1113`'s "New Chat" quick-add-client phone field — flagged per the explicit "do NOT touch ConversationsPanel.tsx" instruction for this session. Follow-up work for whoever owns that file.

Duplicate-detection (`/clients/:id/potential-duplicates`) still matches correctly post-change — verified live by creating two clients with the same number in different raw formats (`9195551212` vs `+1 (919) 555-1212`); both normalized to `9195551212` and matched.

### Single-day appointment form
`react-day-picker` (v10) adopted as this app's calendar-picker standard — no existing date-picker component was found to reuse (waiver DOB and gift-card expiration are both native `<input type="date">`). One new shared component, `DateAndTimeRangeFields`, replaces the old two-datetime-input pattern everywhere: one calendar-grid date field (click-only, never typed) + two native `<input type="time">` fields.

**Appointment forms were consolidated into one shared component**, `AppointmentForm.tsx` — previously near-duplicated between Calendar.tsx's standalone form and InquiryDetail.tsx's nested "add a session" form. `fixedClientId`/`fixedInquiryId` hide+lock those selects for the nested case; `initial*` props (used by Part 3's calendar) prefill without locking. The checkout "Book follow-up" deep-link is not a separate implementation — it's a URL-param deep-link into Calendar's own form, confirmed by reading the code rather than assumed. One deliberate behavior change along the way: the deep-link's client/project prefill went from editable-default to **locked-and-hidden** (a reasonable tightening, since a follow-up is always for the same client/project).

The separate `/inquiries/:id/schedule` flow (first-time scheduling) kept its own smaller `DateAndTimeRangeFields`-only form — different endpoint/semantics, not a duplicate of `AppointmentForm`.

Server-side single-day guard added to **both** the CREATE and UPDATE (`PATCH /:id`) routes, using a new `isSameCalendarDay` helper that compares civil dates via `Intl.DateTimeFormat` in the *studio's* configured timezone — not a naive UTC-date comparison, which would false-positive reject legitimate same-local-day appointments in western US timezones (verified with a concrete counter-example before writing the code). The PATCH route previously only handled `status` and had **no audit logging at all**; it now also accepts `startTime`/`endTime` with the same validation and logs every update — a real pre-existing gap, not something this session introduced, and required groundwork for Part 3's drag-reschedule.

Verified via curl: a crafted end-before-start request and a crafted genuinely-cross-midnight-local request are both rejected 400 on CREATE and UPDATE, independent of any UI.

---

## Part 3 — Robust calendar (resource columns, drag-and-drop)

### Library
`react-big-calendar` v1.20.0, confirmed **MIT-licensed** at time of use (checked via `npm view`), with the drag-and-drop addon (`react-big-calendar/lib/addons/dragAndDrop`) bundled in the same MIT package — no FullCalendar Scheduler paid tier involved. One real interop bug surfaced and fixed along the way: Vite's CJS dependency pre-bundling double-wraps this addon's nested default export, so a plain `import withDragAndDrop from '...'` resolves to the wrapper module object instead of the function; `Calendar.tsx` unwraps it defensively. Also: `resourceGroupingLayout` is required to get per-day, per-artist sub-columns in Week view — without it, RBC's Week/Day time grid only renders one resource header spanning every day.

### Data
`GET /appointments` extended (not a parallel route) with optional `?start=&end=` ISO range params, doing an interval-overlap query and dropping the previous 100-row cap for ranged requests (500-row cap instead — a visible calendar range is naturally bounded, this is just a safety ceiling). Existing `clientId` filter and ARTIST-sees-only-own role scoping preserved exactly; verified live that artist2 (no appointments) gets an empty, correctly-scoped result even with a wide range. Response now also includes `artist.name` (display name) and a short `inquiry.label` (truncated project description) per appointment.

### Views
Week (default) and Day show one resource column per active artist (toggle chips above the calendar, default all). Month shows everyone combined, color-coded by a deterministic per-artist hash (`lib/artistColors.ts`, 8-color fixed palette, pure frontend, no schema change — manual color assignment noted as a reasonable future enhancement, not built here). Plain-language Today/Back/Next + Week/Day/Month switcher replaces RBC's default toolbar entirely.

### Interactions (OWNER/FRONT_DESK only)
- **Click empty slot** opens Part 2's shared `AppointmentForm`, prefilled with date/start-time/end-time and (in a resource column) that column's artist.
- **Drag** submits through the *existing* `PATCH /appointments/:id` route (never a bespoke calendar endpoint) — audit logging and validation fire exactly as they would for a manual edit. Verified via the network log during a real browser drag that it's the same route, and confirmed the resulting `AuditLog` row (`action: "update"`, `{field: {from, to}}` diff shape) is structurally identical to one produced by a manual status change.
- **Buffer conflict** (< 1.5 hours from another same-artist same-day appointment) is a non-blocking amber notice — the drag still saves. Verified live: dragging into a conflict returned 200 with a `bufferWarning`, no block.
- **Same-day violation**: any drag whose resulting end crosses local midnight is rejected client-side (event visually reverts since it's never optimistically mutated) with a message, and confirmed independently rejected server-side by direct curl against the same route.
- **Cross-column drop** (reassigning to a different artist) is rejected entirely — client-side by comparing the drop target's resource against the event's own artist and refusing to call the API at all (the update route also structurally never accepts an artistId, so this is enforced twice). The revert is total: neither the time nor the day portion of the move is kept, only a message.
- **Click an existing appointment** opens a small modal preview (client, time range, artist, status pill, "View details →" link) — never immediate navigation. Works identically for ARTIST.
- The buffer-conflict logic itself was extracted from `inquiries.ts`'s `/schedule` route into a shared `lib/schedulingConflict.ts`, and that route was refactored to use it — so there's exactly one implementation, reused by the original scheduling flow, the calendar's click-create, and drag-reschedule.

### ARTIST (effective, via `useEffectiveUser()` — View As included)
Renders the plain, non-drag-and-drop `Calendar` component — not the same component with drag props omitted, a genuinely different component that never attaches drag listeners. Verified: zero `.rbc-addons-dnd-resize-*` handles in the DOM, zero resource-grouping headers, empty-slot clicks never open a create modal, but click-to-preview still works. No artist-column filter and no `/artists` fetch for this role — an ARTIST's calendar is a single agenda of only their own appointments (server-scoped, confirmed via artist1 vs artist2 tests).

### Mobile (< 768px)
Falls back to a single-column Day view with a dropdown artist switcher (OWNER/FRONT_DESK) instead of shrunk-down resource columns — verified this actually triggers at a 375px viewport, and that the Week/Month switcher itself disappears when only one view is available.

### A regression caught and fixed during this part
Rewriting Calendar.tsx removed the only manual appointment-status-change control that existed anywhere in the app (the old table view's per-row status dropdown). Restored it on `AppointmentDetail.tsx` (a status `<select>` next to the header, OWNER/FRONT_DESK only) rather than leaving that capability gone.

---

## Known non-blocking issue

`react-big-calendar`'s own `TimeGridHeaderResources` internals emit a React "duplicate key" console warning when `resourceGroupingLayout` is combined with more than one day in view (Week view specifically). This is inside the library's bundled code, not something introduced here, and does not affect rendering correctness, drag/click behavior, or data integrity — confirmed via extensive live testing. Dev-console noise only.

## Verification summary
- Browser (Playwright): both breakpoints, OWNER and ARTIST roles, all three parts' UI flows including a real drag-and-drop reschedule, a real cross-column revert, a real cross-midnight revert, a real buffer-conflict warning, and a real XSS payload neutralized at every render site.
- API (curl): role/studio scoping on the ranged appointments endpoint, same-day guard on CREATE and UPDATE with a genuinely-cross-midnight-local payload (not just a naive UTC-crossing one), audit log shape parity between a drag-triggered PATCH and a manual edit, duplicate-detection with mixed phone formats.
- Both `apps/api` and `apps/web` type-check cleanly (`tsc --noEmit`) as of the final commit.

All background dev-server shells and scratch verification scripts from this session were left running only as long as needed for testing and are being shut down now that verification is complete.
