# Artist parity audit — web vs mobile

**Investigation only. No product code was changed.** Output is this file plus
`apps/mobile/parity-audit/*.jpg`.

Goal: a ground-truth map of what an ARTIST-role user can do on web versus what mobile
currently offers, so the build sequence can be decided from evidence rather than memory.

---

## How this was captured

Local stack, not the deployed app: `apps/api` on `:4310` against the **dev** Railway database
(`apps/api/.env`), `apps/web` on `:5310` pointed at it. Driven with Playwright at 1440×900.
Mobile screens are preview renders at 414pt (the technique used since session 3 — the mobile
app cannot be logged in under `react-native-web` because `expo-secure-store` has no web
implementation, so its screens cannot be reached with a real session).

**Account: `artist1@dev-studio.test`** (seeded, `password123`). Two things about it matter for
reading this report.

**1. Its permissions are near-default but not identical.** Compared against
`DEFAULT_ROLE_PERMISSIONS.ARTIST` imported from `apps/api/src/lib/permissions.ts`:

| | |
| --- | --- |
| granted beyond default | *(none)* |
| revoked from default | **`inquiries.artistSendEstimate`** |

So the "send estimate directly" affordance is absent for this account by studio
configuration, not by product design. Nothing below records it as a gap.

**2. Every one of its 15 assigned inquiries lives at a GUEST studio**, and that studio
revokes `inquiries.view` for artists — see *Findings* below, which is where the inquiry
**detail** screenshot should have been.

`artist2@dev-studio.test` was checked as an alternative and is worse for this purpose: it sits
at that same studio and so cannot open the inquiries list at all.

---

## Findings that are not parity gaps

Three things surfaced during the walk that are worth separating out, because they are bugs or
defects rather than mobile-vs-web differences.

### A. `InquiryStatus` is incomplete in shipped mobile code — my error, session 5

The enum has **15** values. Session 5's `packages/shared-types` and
`apps/mobile/src/lib/inquiryDisplay.ts` carry **11**. The reading that produced that list
stopped short of the end of the enum block.

Missing: **`TRANSFERRED`**, **`FLASH_PENDING_APPROVAL`**, **`FLASH_PAYMENT_PENDING`**,
**`ON_HOLD`**.

Consequences in code already merged onto `mobile/session5`:

- `FLASH_PAYMENT_PENDING` is **live in the dev data** — it appears on artist1's list right now
  (`web-02-my-inquiries.jpg`, first card). Web tones it `warning` (amber); mobile has no entry,
  so `statusTone()` falls through to `neutral` and it renders grey.
- `ON_HOLD` likewise: web `hold` (blue-grey), mobile grey.
- **`TRANSFERRED` is the material one.** Web groups it with `CLOSED_LOST` and `COLD_LEAD` as
  *Inactive*; mobile's `isClosedStatus()` does not, so a transferred inquiry would sit in
  mobile's **OPEN** segment while web treats it as closed.

Labels degrade gracefully (the de-snake fallback produces "Flash payment pending"), so nothing
crashes — but the tone and the open/closed split are both wrong. Cheap to fix; it belongs at
the front of whichever session touches Inquiries.

### B. List and detail disagree about which studio's permissions apply *(API — flag, do not solve)*

`GET /inquiries/assigned-to-me` is scoped with a **home-studio** `requirePermission`, and its
own comment says so deliberately ("this is a multi-studio LIST … with no single record to
check a matrix against"). `GET /inquiries/assigned-to-me/:id` uses
`hasPermissionAt(inquiry.studio.id, 'inquiries.view')` — the **record's** studio.

For artist1 that produces a list of 15 rows where **all 15 detail requests return 403**.
Verified by probing each id directly. This is not a mobile issue; it would reproduce
identically on any client.

### C. Web hangs forever on that 403

`MyProjectDetail` renders "Loading project…" indefinitely rather than surfacing the error
(`web-03-inquiry-detail-403.jpg`). Whatever is decided about B, this is its own defect. Mobile's
`screenErrorMessage` would show "Your role does not have access to…" in the same situation.

---

## Surface-by-surface gap map

### 1. Dashboard — `web-01-dashboard.jpg`

**MISSING entirely on mobile.** There is no mobile equivalent of any kind.

Web gives an artist: an eyebrow + Fraunces "Welcome, {first name}" with the name in gold
italic; a **date-range control** (`LAST 30 DAYS`); and five widgets — **Your Inquiry Funnel**
(Received → Estimate Sent → Responded → Deposit Pending → Scheduled → Completed, each with a
count and conversion %), **Lost / Cold Rate**, **Response Time** (two averages), **My
Appointments** (count in range), and **Needs Scheduling** (a "right now, not affected by the
date range" counter).

Backed by `GET /reports/dashboard`, which an artist holds (`reports.viewDashboard`, default
true). Note `reports.viewFinancial` is default **false** for artists, and the widgets above are
the non-financial subset.

### 2. My Inquiries — `web-02-my-inquiries.jpg` vs `mob-05-tasks-inquiries.jpg`

| | |
| --- | --- |
| **MATCHES** | Uses the artist route family; status pill per row; client name; description; channel. |
| **DIVERGES** | Web renders a **full card** per inquiry — a four-column `PLACEMENT / SIZE / COLOR / BUDGET` grid, plus **reference-image and placement-photo thumbnails**. Mobile renders a compact list row with description, status, channel, estimate and artist. Web's segmentation is **Inquiries / Projects**; mobile's is **Open / Closed**. |
| **MISSING** | **Approve / Decline** per-card actions (gold + outline) on `ARTIST_ASSIGNED` rows — the artist's single most important action. **List / Board toggle** (Kanban). **Projects** tab. Reference/placement imagery. Per-inquiry detail screen. |
| **BLOCKED** | Inquiry detail cannot be reached at all for this account — Finding B. |

### 3. Calendar / Schedule — `web-07-calendar.jpg` vs `mob-02-schedule.jpg`

| | |
| --- | --- |
| **MATCHES** | Same data source and role scoping; per-artist colour uses the identical hash and palette (proved in session 3 over 5,006 ids). |
| **DIVERGES** | Web offers **MONTH / WEEK / DAY**, defaulting to a month grid, with `TODAY / BACK / NEXT` and a date readout. Mobile offers **DAY / UPCOMING** with a horizontal date strip. Neither of web's month or week views exists on mobile; neither does mobile's Upcoming exist on web. |
| **MOBILE-ONLY** | The Upcoming list (next 30 days grouped by day); the date strip with work markers; the studio-timezone label in the header. **Mobile is the more correct of the two here** — web's calendar builds its fetch range on the *browser's* midnight (session 3), mobile uses the studio's. |
| **MISSING** | Month and week views. Drag-to-reschedule (web has it; needs `appointments.reschedule`, which artists lack by default). |

### 4. Appointment detail — `mob-03-appointment-detail.jpg`

Not captured on web for this artist (no appointments assigned). Mobile's version was built in
session 4 against `GET /appointments/:id` and mirrors web's own visibility rules. Treated as
**MATCHES** on data and gating; unverified visually against web's layout.

### 5. Conversations — `web-11-conversations-panel.jpg` vs `mob-04-conversations.jpg`

| | |
| --- | --- |
| **MATCHES** | Thread list, per-thread channel indication, unread state, message thread with day separators, composer. Artists see team threads only on both, inherited from the API. |
| **DIVERGES** | Web is a **right-hand slide-over panel** launched by a floating **CHAT** button, over whatever page you were on. Mobile is a **tab**. This one is expected — it follows from the native tab-bar skeleton and is not worth "fixing". |
| **MISSING** | **Search** ("Search team or messages…"), **FILTER** and **SORT** controls in the thread list. |
| **MOBILE-ONLY** | The composer's live-send strip ("Sends for real over SMS" vs "Logged to the thread as Phone"), and the failed-send retry affordance. Both are genuinely mobile-specific safety work and should be **kept**. |

### 6. Tasks — `web-09-tasks.jpg` vs `mob-05-tasks-inquiries.jpg`

| | |
| --- | --- |
| **MATCHES** | An artist sees exactly **one** section, "Assigned to me" — no studio queue, no delegated. Mobile's segment rule produces the same single view. Confirmed against the real permission defaults. |
| **MISSING** | **Inline task creation.** Web puts it first inside the card: a title field, a **Due date** control, and a gold **+ ADD** button. Mobile has no creation path at all (`createPersonalTask` is wired and unused). Web also offers sort (name / due-soonest / newest) and an Overdue filter. |
| **MOBILE-ONLY** | Nothing meaningful. |

### 7. Flash Gallery — `web-08-flash-gallery.jpg`

**MISSING entirely on mobile.** A whole artist-visible nav destination with no counterpart.

Web: eyebrow "+ THE SHOWCASE +", Fraunces heading, subtitle "Pre-drawn, self-bookable art.
Your own pieces."; primary gold **+ NEW FLASH**; an **All statuses** filter; **Copy public
gallery link**; then a card grid — image, a "ONE OF ONE" overlay badge, title, status pill
(AVAILABLE / BOOKED / RETIRED), `price · duration`, and **Edit** / **Retire** per card.

Gated on `flashGallery.manage`, **default true for artists**. Worth noting this is the most
naturally mobile surface in the whole product — it is photographs, and the phone is the camera.

### 8. Profile — `web-04-profile.jpg`

**MISSING almost entirely.** Mobile's account screen shows role, email, the API host, and Log
out. Web's "My profile" has eight blocks:

| block | controls |
| --- | --- |
| Identity card | avatar, name, email, phone, role + **Edit** |
| **Client self-scheduling** | toggle "Let clients pick their own appointment time". Studio-controlled — shown disabled with "ask an owner to enable it for you in Team → Artists" |
| **Studio profile access** | toggle "Let studio staff edit my profile" |
| **Artist profile** | **Manage** → the editor below |
| **Public artist page** | slug field (`/artist/…`) + **Publish** |
| **Go solo** | **Go solo** — creates a new studio with the artist as owner |
| **Login & security** | Email **Change**, Password **Change** |
| **Danger zone** | **Delete account** (red-bordered card, red button) |

### 9. Artist profile editor — `web-05-artist-profile.jpg`

**MISSING entirely.** 57 controls across **nine collapsible, drag-reorderable sections**:

**Bio** (textarea) · **Rates** (hourly, flat) · **Scheduling Buffer** (minutes, "Studio
default" placeholder) · **Flash Booking Review** (three radios) · **Social Links** (Instagram,
Facebook, email) · **Public presence** (Copy / Open) · **Specialties** (removable chips +
"Search or add a specialty…") · **Services Offered** (checkboxes) · **Preferred Schedule**
(per-day checkboxes, time pickers, **Save schedule**) · **Portfolio** (file upload). Plus a
global **Save changes**.

Gated on `artistSchedules.manage`, default true for artists.

### 10. Settings — `web-06-settings.jpg`

**MISSING on mobile**, but it is the smallest gap here. For an artist it is a single
**General** tab, entirely read-only: studio profile (logo, name — "You don't have permission to
edit this") and locations ("No locations yet"). Nothing an artist can change.

### 11. Notifications / Mentions — `web-10-mentions.jpg`

**MISSING on mobile.** A bell in the top bar opening a popover; empty state reads "No mentions
yet — internal mentions are coming to Conversations." A thin surface today, but it is the only
notification affordance in the product and mobile has no equivalent (and no push).

### 12. Login — `web-00-login.jpg` vs `mob-01-login.jpg`

**MATCHES.** Rebuilt for parity in session 4B against this same page.

---

## Visual language

The studio's `themePreset` is `editorial-gold`, and every token mobile hardcoded is confirmed
identical against the live web app: accent `#c99a5b`, bg `#0e0b08`, surface `#171310`, fg
`#f2ece0`, danger `#e08272` / `#c2402f`, Fraunces + Outfit + Jura, 0px buttons, 10px cards.

Two things to flag:

- **`themePreset` is per-studio and mobile hardcodes one.** A studio on any other preset would
  see a mobile app that does not match its own web app. Not a bug today (this studio is
  editorial-gold) but a real constraint on the parity goal. `GET /theme` exists; adopting it is
  a structural change, not a cheap one.
- **Web uses `--color-danger-strong` (`#c2402f`) as a brand fill** — measured, not eyeballed:
  the CHAT FAB's computed background is `rgb(194, 64, 47)`, and the Danger Zone card and active
  nav indicator read the same family. Mobile followed the repo's stated "red is punctuation,
  never a fill" rule strictly. **The two are genuinely inconsistent and someone should decide
  which is right** — this audit does not assume the rule or the web is the winner.

---

## Proposed build sequence

Four sessions, ordered by artist-facing value. "Cheap" means it fits existing patterns;
"structural" means new patterns, new navigation, or new dependencies.

### Session A — Inquiries: detail + the approve/decline flow *(highest value)*
The artist's core job is reviewing work assigned to them, and mobile currently cannot do it at
all. Fix the enum defect (Finding A) first — it is twenty minutes and it is wrong in shipped
code. Then the inquiry detail screen, the full card content (placement/size/colour/budget,
reference and placement imagery), and **Approve / Decline**.
**Mixed.** Detail and card content are cheap. Approve/Decline are the first real mutations in
the app beyond messaging and task completion, so they need the confirm/optimistic/rollback
treatment. **Finding B is a hard blocker for testing this on the dev fixture** and needs an
answer before the session starts.

### Session B — Profile + artist profile editor
The largest single block of missing surface, and entirely self-contained. Identity, the two
toggles, login & security, public page publish, and the nine-section editor.
**Structural.** Needs form patterns the app has never had — multi-field editing, image upload,
chip inputs, time pickers, save/dirty state. Realistically this is where a form layer gets
designed. Settings (§10) is a footnote to fold in here; Go Solo and Delete Account deserve an
explicit decision about whether a phone should offer them at all.

### Session C — Flash Gallery
A whole nav destination, and the one best suited to a phone.
**Mixed.** The grid, filter and status pills are cheap. **+ NEW FLASH** and portfolio upload
need camera/library access (`expo-image-picker`) and the Cloudinary flow — new territory,
though it shares the upload work with Session B and the two could be sequenced adjacently.

### Session D — Dashboard, task creation, and conversation list controls
The remaining smaller gaps, grouped because none justifies a session alone: the five dashboard
widgets with the date-range control; inline task creation; and search/filter/sort on the
conversation list.
**Cheap.** All read-only or single-field, against endpoints already reachable. A good session
to slot in whenever a shorter one is wanted.

**Deliberately not sequenced:** calendar month/week views (mobile's day + upcoming is arguably
the better phone idiom — worth a decision, not an assumption); the conversations panel-vs-tab
difference (correct as-is); push notifications (no API support — genuinely **BLOCKED**); and
per-studio theming (structural, and only matters once a non-editorial-gold studio uses mobile).

---

## Open questions for the review

1. **Finding B** — is the list/detail permission mismatch intended? It blocks Session A's
   testing on the dev fixture, and it is an API decision, not a mobile one.
2. **Red as a brand fill** — web's chat FAB and danger zone versus the repo's stated rule.
   Which governs mobile?
3. **Go Solo and Delete Account** — belong on a phone, or web-only?
4. **Calendar** — match web's month/week, or keep mobile's day + upcoming?
