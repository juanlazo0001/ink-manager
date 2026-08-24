# Owner parity audit — web vs mobile

**Investigation only. No product code was changed** (`git diff` over tracked files is empty for
this session). Output is this file plus `apps/mobile/parity-audit/owner-*.png`.

Goal: a ground-truth map of what an **OWNER** can do on web versus what mobile currently offers,
so the build sequence is decided from evidence. Sessions A–H built and audited against the ARTIST
experience (`PARITY-AUDIT.md`); this is the owner equivalent, and it adds a dimension that audit
did not have — **motion and loading feel**.

**STOP-GATE: nothing here should be built until the owner and architect review it.**

---

## How this was captured

Local stack, not the deployed app: `apps/api` on `:4310` against the **dev** Railway database,
`apps/web` on `:5310` pointed at it, driven with Playwright at 1440×900. Mobile is a 414pt preview
render against that same live API, using a temporary harness that injected an owner session and
rendered the **real** `home.tsx` — deleted before this file was committed. (The app still cannot be
logged in under `react-native-web`: `expo-secure-store` has no web implementation.)

Mobile audited at `mobile/session-h3` — the latest mobile state, which is **unmerged**. Auditing
`main` would have measured an app three sessions stale.

**Account: `owner@dev-studio.test`** at Dev Studio.

### Correction: there is no `DEFAULT_ROLE_PERMISSIONS.OWNER` to check against

The brief asked for the owner's overrides to be diffed against `DEFAULT_ROLE_PERMISSIONS.OWNER`, as
the artist audit did for `ARTIST`. That comparison cannot exist:

- `CONFIGURABLE_ROLES` is `[FRONT_DESK, ARTIST, CUSTOMER]` — **OWNER is deliberately not in it**,
  with the comment *"OWNER always has every permission and is never a row here"*.
- `hasPermission()` returns `true` for OWNER at its first line, **before** consulting
  `RolePermission` or any defaults.
- The dev database holds **zero** `RolePermission` rows for OWNER; had there been any, they would
  be inert.
- Web states the same rule to the user's face, on the permissions matrix:
  *"Owner always has full access, in every category below."*

So nothing below can be dismissed as "this studio revoked it" — every capability seen on web is
available to every owner, everywhere. That makes this audit's gaps unambiguous, which the artist
audit's could not be.

### No fixtures were seeded — the data was already real

The brief allowed seeding if owner surfaces were empty. They were not, so **no dev writes were made
this session at all**:

| | inquiries | appts | clients | convos | tasks | gift cards | waivers | deposit forms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dev Studio | **112** | 60 (19 checked out) | 130 | 84 | 21 | 95 | 24 | 42 |

The inquiry funnel spans 9 statuses (NEW 38, SCHEDULING 21, DEPOSIT_PENDING 20, CONFIRMED 14,
AWAITING_CLIENT_RESPONSE 11, ARTIST_ASSIGNED 3, CLOSED_LOST 3, CANDIDACY_REVIEW 1,
FLASH_PAYMENT_PENDING 1). Every state below is a real state.

---

## The headline finding

**The owner dashboard is already at parity, and nobody knew.** `GET /reports/dashboard` returns
`scope: "studio"` for an owner, and `home.tsx` already branches on it —
`data.scope === 'own' ? 'Your Inquiry Funnel' : 'Inquiry Funnel'` and
`'My Appointments' : 'Artist Utilization'`. Rendered against the live dev API as the owner
(`owner-11`, `owner-12`), mobile shows **all seven** of web's cards, studio-scoped:

Needs Scheduling · Inquiry Funnel · Lost / Cold Rate · Response Time · Artist Utilization ·
Deposit Conversion · Outstanding Gift Card Liability

The most expensive-looking owner surface is the one that needs the least work. Two small
divergences are noted in the gap map rather than treated as a rebuild.

---

## Surface-by-surface gap map

Legend: **MATCHES** · **DIVERGES** (present, differs) · **MISSING** (absent on mobile) ·
**BY DESIGN** (deliberately portal-only) · **BLOCKED** (needs API or permission work).

### 1. Dashboard — `owner-01` vs `owner-11`, `owner-12` — **MATCHES**

All seven cards, correct studio scope, same date-range control (mobile: LAST 7/30/90 pills; web: a
dropdown), and mobile additionally prints the studio timezone under the range. Two divergences:

- **Artist Utilization renders as a plain list on mobile, as bars on web.** Mobile shows a studio
  total (32) plus per-artist counts; web draws a bar per artist. Cheap to close.
- **Response Time rounds differently.** Web showed `2m`; mobile showed `0h` for the same metric.
  `dashboardDisplay.ts` owns this; sub-hour averages need a minute unit.

### 2. Inquiries list — `owner-02` — **DIVERGES**

Web owner gets: Inquiries/Projects tabs, status filter, search, **artist filter**, sort,
**Group by status**, **List/Kanban toggle**, **Columns picker**, **+ NEW INQUIRY**, and an
**Assigned Artist** column.

Mobile has the Inquiries/Projects toggle and status filtering (session G) but **no artist filter, no
Kanban, no column control, no create**. Note the repo's standing rule — *List and Kanban are VIEWS
of the same entities; every capability available from one must be available from the other* — which
argues the Kanban is not optional if the list ships owner actions.

### 3. Inquiry detail — `owner-03` — **BY DESIGN, and that design is now the question**

Web's owner detail is eleven collapsible, **drag-reorderable** sections: Pipeline (5-stage stepper),
Assignment, Estimate, Deposit, Appointments, Reference Images, Placement Photos, Inquiry Details,
Notes (rich text, "share with assigned artist"), Activity History — plus header actions
**View Client · Message · Share with Artist**, and an overflow with **Auto-order sections ·
Mark as lost · Archive · Delete Permanently**.

Mobile's inquiry screen says so itself, on screen: *"Scheduling, deposits and the full estimate
builder live in the portal — this screen shows them, it [does not do them]."*

**That is a deliberate prior decision, not an oversight** — and it is the single biggest question
for the review. It was made for an artist, who has a desk. An owner answering a deposit request from
the shop floor is the phone-first case the brief describes. Owner-only actions absent on mobile:
assign/reassign, share with artist, revise/send estimate, send deposit form (with tentative time and
deposit-vs-prepayment), schedule consultation, new appointment, edit details/images, notes, mark
lost, archive, delete.

### 4. Calendar — `owner-04` — **DIVERGES (structurally)**

Web owner: **whole-studio** calendar with a **19-artist multi-select filter**, month/week/day views,
"include past availability windows", colour-coded per artist.

Mobile's Schedule is a single agenda list. The API already serves the studio scope
(`GET /appointments` → 60 for this owner), so this is UI-only.

### 5. Clients — `owner-05`, `owner-08` — **MISSING entirely**

There is no clients screen on mobile at all. Web owner gets a list (Export, Add Client, activity
filter, show archived, bulk **Import**) and a detail that is the studio's real hub: contact info
with multiple phones/emails, inquiries, projects, **gift cards**, **deposit forms**, appointments,
**waivers**, notes, activity history — with **Merge with another client**, **Merge into this
client**, **Not a duplicate**, **Issue Gift Card**, **Send Deposit Form**, **Send Waiver**.

**Structural note:** gift cards, deposits and waivers have **no standalone pages**. They are reached
only from client detail, appointment detail, and `/scan`. Any plan to "add gift cards to mobile"
is really a plan to add client detail.

### 6. Team + Permissions — `owner-06`, `owner-07` — **MISSING entirely**

Web: Staff / Artists / **Permissions** tabs; invite, add directly, edit, delete, and **View as**
(impersonation). The permissions matrix is nine-plus categories of per-role toggles with a save.

Nothing on mobile. The permissions matrix in particular is a poor phone target and a good
candidate for an explicit "portal-only" decision rather than a build.

### 7. Tasks — `owner-09` — **DIVERGES, with one free win**

Web owner: **studio queue** (shared/unassigned, dismissible), **assigned to me**, **assigned by me**
— the delegation view — plus filter, sort, add, show completed.

`GET /tasks` already returns `{ system[112], personal[10], assignedByMe[5] }`. Mobile renders only
`personal` and `system`. **`assignedByMe` is already in the payload and simply has no UI** — the
cheapest owner win in this document.

### 8. Conversations — `owner-10` — **DIVERGES (mildly)**

Web owner scope is Clients/Team tabs over all 84 studio threads, with search, filter, sort, tags and
New Chat. Mobile (sessions G/H/H2/H3) has the list, search, filters, frequent strip, attachments and
the message action sheet. Closest surface to parity after the dashboard. Web still carries the
`direction === 'OUTBOUND' ? 'You: '` bug that mobile fixed in H3 — visible in `owner-10`.

### 9. Scan — **MISSING, and it is the most phone-native surface in the product**

`/scan` reads a client's gift-card QR. On desktop web it renders *"Camera unavailable — this device
or browser doesn't support camera scanning."* **The web app is apologising for not being a phone.**
Mobile has `expo-image-picker` and camera permission plumbing already (session H2). Small,
high-signal, and genuinely better on the device it is missing from.

### 10. Settings — **DIVERGES sharply**

Web owner has six tabs: **General** (studio profile, setup guide, theme, locations), **Policies &
Templates** (policies, waiver questions & clauses, intake forms, intake form fields, message
templates, custom policies), **Defaults** (reminder templates & send times, deposit tiers, artist
field visibility), **Services**, **Integrations** (Gmail/Stripe connect, test message),
**System** (job run-now).

Mobile's `settings.tsx` is 154 lines: Studio Profile and Locations. Everything else is absent.

### 11. Flash Gallery — **DIVERGES (small)**

Web owner adds an **All artists** filter and per-piece Edit/Retire over mobile's session-C gallery.

### 12. Appointment detail / checkout — **MISSING (checkout)**

Web's appointment detail carries checkout, tips, gift-card redemption and waiver status. Mobile has
an appointment detail screen (session B) with `appointmentVisibility.ts` already modelling who may
see money — but no checkout. 19 checked-out appointments exist on dev to test against.

---

## Motion + feel inventory

### What web actually defines

Design-system tokens, confirmed both in `index.css` and by computed style at runtime:

| Token | Value |
| --- | --- |
| `--duration-fast` | **120ms** |
| `--duration-base` | **200ms** |
| `--duration-slow` | **300ms** |
| `--animate-scale-fade-in` | `opacity 0→1, scale .95→1`, 200ms ease-out — popovers, dropdowns |
| `--animate-fade-slide-up` | `opacity 0→1, translateY 6px→0`, 200ms ease-out — newly-arrived list items |
| `.message-jump-highlight` | 1.2s ease-out box-shadow flash on the jumped-to message |

Measured on the live dashboard:

- **Funnel bars animate `width, filter` over `0.2s cubic-bezier(0.4, 0, 0.2, 1)`.** That is the
  chart timing to match.
- Buttons transition colour over `0.15s cubic-bezier(0.4, 0, 0.2, 1)` (Tailwind's default).
- Cards transition `filter, transform, box-shadow` at `--duration-fast` on hover — hover has no
  native analog, but the *press* state does.

### Loading treatments — web is not consistent, so "match web" needs a decision

| Treatment | Surfaces |
| --- | --- |
| **Skeleton** (`animate-pulse rounded-md bg-surface`) | Dashboard, Clients, Inquiries, Team, Sidebar |
| **"Loading…" text** | Calendar, Tasks, Settings, Flash Gallery |
| **Spinner** | Settings (2 spots) |
| **Nothing at all** | Client detail, Inquiry detail, Appointment detail, Scan, Conversations panel |

### What mobile has

- **Zero skeletons.** Every screen that loads uses `ScreenLoading`, which is a bare centred
  `ActivityIndicator`. Three screens (`account`, `notifications`, `login`) have no loading state.
- **Zero animation primitives.** No `Animated`, no `LayoutAnimation`, no Reanimated call anywhere in
  `apps/mobile/src`. The only motion in the app is `Pressable`'s `opacity: 0.6` on press and
  `expo-image`'s `transition` prop.
- **No duration tokens** in `src/theme` — nothing corresponding to 120/200/300ms.

So every list appears, every card appears, and every bar reaches full width **as a hard cut**.

### The enabler nobody has used

**`react-native-reanimated@4.1.7` and `react-native-gesture-handler@2.28.0` are already direct
dependencies of `apps/mobile`** (`package.json` lines 38–39), installed, SDK-54-aligned, and
completely unused. Motion parity needs **no new dependency and no SDK risk** — which materially
changes its cost.

---

## Proposed build sequence

Value-ordered. **Cheap** = a screen or two, no new API. **Structural** = new surfaces or API work.

### Session J — the free wins *(cheap, highest value per hour)*

- Tasks: render **`assignedByMe`** — already in the payload, no API work.
- Dashboard: **Artist Utilization bars**, and fix the sub-hour **Response Time** unit.
- Inquiries list: **artist filter** (the API already accepts it).

Small, and it closes three real owner complaints without touching architecture.

### Session K — motion + loading system *(structural, but self-contained; do it early)*

Do this **before** the big new surfaces, so they are built on it instead of retrofitted.

- Add duration tokens to `src/theme` mirroring **120 / 200 / 300ms**.
- **One** `Skeleton` primitive and one `<SkeletonList>`, matching web's `animate-pulse` treatment,
  applied to the four surfaces web itself skeletons (dashboard, lists) — not everywhere.
- **One** shared enter transition equal to `fade-slide-up` (opacity + 6pt rise, 200ms ease-out),
  driven by Reanimated, applied at the list-item level.
- Bar/chart fills animate width over 200ms with `cubic-bezier(0.4, 0, 0.2, 1)`.
- Press feedback standardised on the existing `opacity: 0.6`.

**One system, not per-screen tweaks** — that is the explicit recommendation. Note CLAUDE.md's rule:
never combine `backdrop-filter` with animation without testing on a real phone first.

### Session L — Clients *(structural, biggest single unlock)*

The client list and client detail, because detail is where gift cards, deposit forms, waivers and
merge live. This one screen converts four "missing features" into one build. Checkout on appointment
detail is the natural follow-on.

### Session M — owner actions on inquiry detail *(structural — gated on the decision below)*

Assign/reassign, send deposit form, mark lost/archive, notes. Only if the owner overturns the
portal-only decision.

**Deliberately not sequenced:** Team, the permissions matrix, and most of Settings. They are
administrative, rare, and a poor fit for a phone. Recommend an explicit "portal-only" ruling rather
than a build slot.

---

## Open questions for the review

1. **Does the portal-only rule survive contact with the owner role?** Mobile's inquiry screen tells
   the user that scheduling, deposits and estimates live in the portal. For an artist that was
   right. For an owner on the shop floor it may be exactly backwards. **This is the decision that
   determines whether the next two sessions are small or large.**
2. **Should mobile match web's loading inconsistency, or be better than it?** Web skeletons four
   surfaces and shows nothing on five. Recommendation: pick the better standard (skeleton for lists
   and dashboards, spinner for single-record fetches) and let web catch up later.
3. **Is `/scan` worth doing early?** It is small, it is the one surface where the phone beats the
   desktop outright, and web literally apologises for the camera it lacks.
4. **Team and the permissions matrix — portal-only, permanently?** Recommend yes; asking for the
   ruling rather than assuming it.
5. **Is Kanban required on mobile** given the standing List/Kanban parity rule, or does that rule
   scope to a single client?

---

## FRONT_DESK — does it need its own pass?

**A short one, not a full audit.** FRONT_DESK is a *configurable* role, which OWNER is not: its
capabilities come from `DEFAULT_ROLE_PERMISSIONS.FRONT_DESK` and can be revoked per studio. By
default it holds most of what this audit covers — inquiries, clients, appointments, gift cards,
waivers, conversations, tasks — but **not** `team.manage`, `giftCards.void`, `depositTiers.manage`,
`conversations.manageTemplates`, `clients.import`, or any `settings.*`.

So front desk is close to a subset of owner, and the surfaces above cover it. What it needs that
this audit cannot give is **permission-gated rendering**: every owner surface built from this
document must hide or disable controls the caller lacks, and that gating is only testable as
FRONT_DESK. Recommend folding a FRONT_DESK gating check into the end of each build session rather
than spending a session auditing surfaces already mapped here.

---

## Screenshots

| File | What |
| --- | --- |
| `owner-01-dashboard.png` | Owner dashboard, all 7 cards |
| `owner-02-inquiries.png` | Inquiries list, owner controls |
| `owner-03-inquiry-detail.png` | Full owner inquiry detail, 11 sections |
| `owner-04-calendar.png` | Studio calendar, 19-artist filter |
| `owner-05-clients.png` | Clients list |
| `owner-06-team.png` | Team → Staff, with View as |
| `owner-07-permissions.png` | Permissions matrix |
| `owner-08-client-detail.png` | Client detail — gift cards, deposits, waivers, merge |
| `owner-09-tasks.png` | Tasks — studio queue |
| `owner-10-conversations.png` | Conversations panel, owner scope |
| `owner-11-mobile-home.png` | **Mobile** home as owner — studio scope, funnel |
| `owner-12-mobile-home-utilization.png` | **Mobile** artist utilization + deposit conversion |
