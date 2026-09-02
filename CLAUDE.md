# Standing rules for this repo

Concise operating rules, not a project history — see REPORT.md for history.

## Database / Prisma

- **NEVER run `prisma migrate dev`.** It hangs on an interactive reset prompt (known checksum
  mismatch in this repo's migration history) and will block waiting for input that never comes.
  Use `prisma migrate diff` to generate the SQL, then `prisma migrate deploy` to apply it.
- **Never accept a database reset, ever.** If any tool or prompt offers to reset the dev database,
  decline. There is no scenario in this repo where that's the right call.
- **Always read `migrate diff`'s SQL before applying it — it will try to DROP a table you did not
  touch.** This repo's databases contain a `migrations` table in `public` that belongs to a
  third-party library (rows named `add-db-functions-*`), not to Prisma. It is not in
  `schema.prisma`, so `prisma migrate diff --from-config-datasource` — which diffs the LIVE
  database — faithfully reports it as "extra" and emits `DROP TABLE "migrations";` at the top of
  every generated migration. Delete that statement by hand before `migrate deploy`; keeping it
  would drop another library's migration tracker. Confirmed in Package BJ, and it will recur for
  every future schema change generated this way.
- The alternative generation path that would not see it, `--from-migrations`, needs
  `datasource.shadowDatabaseUrl` in `prisma.config.ts`, which this repo does not set. So the
  live-datasource diff plus a manual read of the SQL is the working procedure, not a shortcut.
- Prisma 7 renamed the flags: `--from-config-datasource` / `--to-schema` (the older
  `--from-schema-datasource` / `--to-schema-datamodel` fail with a usage dump).
- **Do not run `prisma format`.** It reflows column alignment across models you never touched and
  rewrites the file's CRLF line endings to LF — in Package BJ it turned a 103-line additive diff
  into 165 insertions / 62 deletions of unrelated whitespace. Use `prisma validate`, which checks
  the schema without rewriting it, and align new blocks by hand to match their neighbours.

## REPORT.md

- REPORT.md is **append-only**. Every session adds a new `# Title` section at the end; nothing
  already in the file is ever edited or removed.
- **Before committing a REPORT.md change, verify its line count did not decrease** versus the
  previous commit (`git show HEAD:REPORT.md | wc -l` vs. the working copy). If it decreased, stop —
  do not commit — recover the full prior content first (from git history) and re-append.

## Artist studio scoping

- **Never trust an ARTIST token's studio claims.** A JWT's `studioId` reflects the studio at
  login/token-mint time and can go stale (home-studio transfers, ended guest memberships) for the
  full life of the token.
- Resolve real membership from the database via `apps/api/src/lib/artistAccess.ts`'s primitives
  (`callerBelongsToStudio`, `studioHasActiveMembership`, `activeStudioIdsForCaller`) — never a bare
  equality check against the token's own `studioId`.
- Always check membership against the **record's** studio (the inquiry/appointment/project's own
  `studioId`), never the caller's home studio. This includes permission checks, audit log
  `studioId`, and realtime `emitInvalidation` calls — all three have been wrong in exactly this way
  before.

## Prisma predicates on nullable columns

- Prisma `not:`/`notIn:` on a **nullable** column silently excludes NULL rows. It compiles to a
  bare `"col" <> $1`, which under SQL's three-valued logic is UNKNOWN — not TRUE — for a NULL,
  so those rows never match. Webhook- and system-written rows have null author/actor FKs, so
  "not mine" must be written NULL-safe:

      OR: [{ col: null }, { col: { not: id } }]

- Found the hard way in unread counts, 2026-08-26: `Message.authorUserId` is nullable, the Twilio
  webhook writes an inbound SMS with it null, and both unread functions used
  `authorUserId: { not: userId }` — so **an arriving client text was never counted unread** by
  either the per-thread dot or the nav badge.
- The same intent expressed in **JavaScript** is correct and was correct here
  (`lib/tasks/newConversation.ts` does `if (lastMessage.authorUserId === userId) continue`, and
  `null === userId` is plainly `false`). That asymmetry is exactly why this hides: the JS version
  reads identically and behaves differently.
- The existing tests could not have caught it, because every fixture authored its messages as a
  logged-in user. When a column is nullable, a test that never inserts a NULL is not testing the
  predicate — pair every "not mine" assertion with a null-valued row.

## Timezones

- **This bug class has recurred at least four times independently** (scheduling-assistant hours
  reading a server-local clock instead of the studio's, task date pills, a gift-card/waiver
  calendar-date display sweep, and an API dashboard date-range parser) — treat any new
  date/time-touching code as a candidate sighting, not a one-off.
- Two different, non-interchangeable conventions are both legitimate in this codebase — know which
  one a given field uses before touching it:
  - **A pure calendar date with no real time.** There are **two** writers in this repo and they
    are **NOT equivalent** — an earlier version of this note called them equivalent, which was
    wrong and is exactly the bug `fix/web-task-due-date` had to undo. What matters is that the
    READ matches the WRITE; either convention is fine on its own, mixing them is the bug.
    - **UTC midnight** — produced by single-arg `new Date("YYYY-MM-DD")` on a bare date-only
      string, wherever it runs. This is what gift card `expiresAt`
      (`ClientDetail.tsx` → `new Date(form.expiresAt).toISOString()`), waiver `dateOfBirth`
      (`WaiverSign.tsx`, same shape) and guest residency start/end
      (`routes/residencies.ts`'s `parseDateOrNull`) all use. **Read these back with
      `timeZone: 'UTC'` forced** — `formatCalendarDateOnly` in `apps/web/src/lib/format.ts`, or
      `.slice(0, 10)` on the raw ISO string — never a bare
      `toLocaleDateString()`/`toLocaleString()` and never local `Date` getters, which
      re-interpret that UTC midnight in the viewer's own zone and show the wrong day west of UTC.
    - **LOCAL midnight** — produced by `parseDateString`
      (`apps/web/src/components/DateAndTimeRangeFields.tsx`), which is `new Date(y, m - 1, d)`.
      `.toISOString()` on that is the local midnight EXPRESSED in UTC (`2026-08-25T04:00:00Z` in
      EDT), **not** UTC midnight. `PersonalTask.dueAt` is written this way. **Read these back
      with the matching local-zone helper** — `toDateString` from that same file, which is
      `getFullYear`/`getMonth`/`getDate` and so round-trips `parseDateString` exactly. Forcing
      `timeZone: 'UTC'` on one of these shows the wrong day EAST of UTC.
    - Zero-padded `YYYY-MM-DD` strings compare correctly with `<`/`>`, so a calendar-day
      comparison is `toDateString(a) < toDateString(b)` — never `new Date(dueAt) < new Date()`,
      which compares instants and fires at 00:00 on the day something is due
      (`Tasks.tsx`'s `isOverdue`, fixed on `fix/web-task-due-date`).
  - **A real instant that needs to be judged against a studio's business hours, "today," or wall
    clock** (scheduling, reminders, dashboard date ranges) must resolve `StudioSettings.timezone`
    explicitly and go through `apps/api/src/lib/studioTime.ts`'s `civilDateKey`/
    `localMinutesSinceMidnight`/`zonedTimeToUtc` — never the API server process's own OS timezone
    (`new Date().getFullYear()`-style local getters on the backend), and never a client browser's
    guess when the question is "what day is it for this studio."
- Never parse a bare `"YYYY-MM-DD"` string with `new Date(value)` (single-arg form — UTC) and then
  read it back with local `Date` getters, or vice versa — picking either convention consistently is
  fine; mixing the two within one round trip is the bug, every time.
- Before calling a date/timezone fix or feature verified, prove it with a **two-timezone test**:
  pin `now`, set the relevant studio's `timezone` to something deliberately different from the
  machine running the check, and confirm the result tracks the studio's zone (or the intended
  local zone), not the server/dev-box's own OS timezone.

## Backfills

- A data backfill and its schema migration are two separate steps — `migrate deploy` running
  automatically on every Railway deploy only applies the schema change (e.g. a new column default);
  it never touches existing rows. Running a backfill against dev does not make it "done" — it is
  done only when it has also run against production, deliberately, as its own step.
- Every backfill report in REPORT.md **must state explicitly which database(s) it ran against**
  (dev, production, or both) — never leave this implied or ambiguous. A backfill count alone (e.g.
  "39 studios backfilled") is meaningless without saying which database those 39 rows live in; dev
  and production have different studio counts and this has already caused a real gap (a themePreset
  backfill landed only on dev — 122 studios there vs. 10 in production — while 8 of the 10 real
  production studios stayed on the stale default for a full day, silently, because the report never
  named the database).
- If a fix needs to reach production and this session doesn't run it there, say so explicitly as an
  open, unfinished item — don't let "verified on dev" read as "done."

## Branch discipline

- **ONE unmerged mobile line at a time.** Every session merges to `main` at its gate before the
  next session branches. The primary checkout lives on `main` between sessions. Parallel sessions
  require explicit owner approval and immediate reconciliation.
- The rule exists because the alternative already happened: sessions AF-AI built the Clients line
  on one branch while the chat-UX line built on another, both cut from the same base, and neither
  was merged. The owner ran the app and reported the Clients work "missing" - it was not missing,
  it was on a branch he was not on. Session AJ existed only to reconcile the two, and session AK
  only to merge everything and delete 26 branches.
- A branch that is gate-passed and not yet merged is a liability, not a checkpoint. `main` is the
  checkpoint.

## Concurrent sessions

- Each concurrent session works in its own isolated git worktree (`git worktree add`). Never share
  a working tree between sessions — uncommitted edits from one session must not be visible to, or
  clobbered by, another.
- **A worktree is removed when its branch merges; a worktree holding `main` blocks the primary
  checkout and must never outlive its session** (incident: three off-site merges from a detached
  primary). A finished worktree left parked on `main` is not harmless housekeeping — git allows a
  branch in only one worktree at a time, so the primary cannot take `main` back, and every
  subsequent merge has to be run from someone else's directory. The exception is a worktree whose
  branch is unmerged **and** whose tree is dirty: that holds real work, and it is removed by the
  session that owns it, never by a passer-by.
- **Concurrent sessions MUST be launched via `scripts/new-session.ps1`.** It creates the worktree
  (fresh branch off latest `main`), runs `npm ci` in it, and prints a free dev-port pair — the
  single entry point that ends shared-tree collisions at session-launch time, not after the fact.
- **A git worktree isolates the repo, not the Playwright MCP browser.** By default the Playwright
  MCP server persists its browser profile at one fixed, machine-wide path
  (`%LOCALAPPDATA%\ms-playwright-mcp\...`), identical across every worktree/session — a second
  concurrent session's browser tool calls fail with "Browser is already in use" the moment a first
  session's browser is open, worktree isolation notwithstanding. Fixed at the root: `.mcp.json`'s
  `playwright` server is launched with `--isolated` (in-memory profile per server process, never
  written to that shared disk path, so two sessions' browsers never collide). If a browser tool
  still reports "already in use" after this, don't wait on it and don't silently skip the
  browser-dependent work — that error means the CURRENT session's own MCP connection was spawned
  before this fix landed (MCP servers don't hot-reload `.mcp.json` mid-session); ask the user to
  reconnect (`/mcp` in their terminal, or a session restart) rather than treating the lock as
  permanent.

## Trusting a build

- Trust a build/deploy as safe only when **both**: `git status` is fully clean (no uncommitted
  edits to tracked files that matter, no stray untracked files that anything imports) **and** a
  fresh `npm ci` + build passes from that clean state.
- An uncommitted-but-imported file has broken production twice in this repo's history. A diff
  review is not sufficient on its own — confirm with an actual clean-checkout build.
- **A wrong field name inside a Prisma `where`/`include` is NOT caught by `tsc`.** Measured in
  Package BJ: `prisma.appointment.findMany({ where: { sends: { none: ... } } })` — where the real
  relation is `reminderSends` — compiled with **zero** TypeScript errors and threw
  `PrismaClientValidationError: Unknown argument 'sends'` at runtime, on every tick. A full green
  build is therefore not evidence that a query is correct; the only thing that proves a Prisma query
  is running it. Any new query needs at least one execution against a real database before its
  session claims it works.
- "Typecheck passed" means the **full production build** (`tsc -b && vite build` for `apps/web`,
  `tsc` for `apps/api`) — not `tsc --noEmit -p .` alone. `--noEmit` on its own has already missed a
  real error (`ConversationsPanel.tsx`'s separate `Record<Tone, string>` maps needing a new `hold`
  key) that only the real `vite build` caught, after passing silently all session.

## Motion verification protocol

- Any session shipping gesture or animation work must end its report with a named ≤15s recording
  request ("record: slow swipe right, release; fast flick left; tap outside") and, when the operator
  provides it under `tools/motion-probe/recordings/`, run motion-probe and include the verdict
  before recommending merge. The web harness freezes animation travel in app subtrees — geometry
  proves in preview, feel proves on frames or on device, never by assertion.
- The harness freeze is animation-specific, not universal — when feasible run the same probe on the
  before state; a flat after-line is evidence only if the probe moved when it should have (Session 12
  precedent).
- **iOS modal presentation sequencing does not exist in react-native-web — dismiss→present races are
  device-only by construction.** Evidence for modal choreography is a static sequence map plus the
  logged on-device sequence, never a passing preview (incident: attach-flow freeze surviving three
  preview-verified fixes). Two RN `<Modal>`s alive at once is the shape to look for: `Sheet` keeps
  its modal mounted ~300ms after `visible` goes false, so `setThisOpen(false)` and
  `setThatOpen(true)` in one tick overlap by construction. The stable pattern is the long-press
  overlay's — ONE modal whose *contents* swap; a native picker is the only thing that needs a real
  dismissal first, and it launches from the completed-dismiss callback, never from the tap.

## Merge verification

- Before treating a branch as merged, verify its tip with `git merge-base --is-ancestor <tip> main`
  — never merely that a merge commit references the branch; branches grow after partial merges
  (incident: 7f1e834 took one file of eight commits).

## Falsifiable tests

- Every test must be able to fail under the plausible-wrong implementation; suppression/zero-count
  assertions always pair with a strict `+1` positive sibling (incidents: vacuous mute test;
  non-discriminating outsider test; unread NULL-author gap).
- Instrumentation identity must not be keyed on values the system under test mutates — a mount
  ledger keyed on `message.id` reported phantom unmounts at ack; key instruments on stable
  identity (`rowKey`-class).

## Parity with the portal (`tools/parity`)

- **Any session that changes a screen's visual design runs `tools/parity` for that screen and
  attaches the composite and the value table to its report.** Not a suggestion: "it matches web"
  has been asserted many times in this repo's history and measured almost never, and the icon
  audit in session BB found 34 concepts that already matched and 6 that did not — a distinction
  nobody could have made by eye.

      python tools/parity/parity.py --screens team

- **A new deliberate divergence is added to `tools/parity/expected-divergences.md` IN THE SAME
  COMMIT that creates it.** A difference that is not in that manifest is reported as DRIFT, and
  the next session spends an afternoon "fixing" a decision somebody made on purpose. This is the
  same stale-documentation failure that produced most of this file's other rules.
- **What the harness is valid for: layout, type, colour and spacing.** Nothing else.
- **What it is NOT valid for, and must never be presented as covering: MOTION, GESTURES, and true
  native rendering.** Reanimated does not advance inside app subtrees there and gesture-handler is
  inert to synthetic input — see the section immediately below, which is where those limits were
  established. Both sides also render in the same Chromium, so nothing that differs because iOS
  renders differently is visible at all. **A clean parity report is not a device gate and does not
  substitute for one.**
- The pixel-difference percentage in the report is context, not a pass/fail. Two renderers are
  never pixel-identical. The value tables decide.

## Verifying mobile UI on the web harness

- **P3-class animation travel is device-gate-only under the web harness** — a reanimated animation
  that runs fine elsewhere does not advance inside the conversation screen's subtree there (proven
  with a control component that animates in a sibling route and stays flat at 0 inside the screen;
  `useKeyboardHandler` ruled out). Verify geometry with printed numbers instead, and never let
  "it rendered" stand in for "it moved". Gesture-handler is likewise inert to synthetic input, so
  Pan/Pinch behaviour is device-gate too — its silence there proves nothing in either direction.

## Design

- Frosted glass (`backdrop-filter: blur(...)`) only on discrete cards/panels — never on lists or
  tables, where it hurts readability and scroll performance.
- Never combine `backdrop-filter` with animation without testing on a real phone first — this
  combination has caused real jank/frame drops on-device that didn't show up in desktop dev tools.
- Red is punctuation (errors, destructive actions, urgent flags) — never a fill color or a large
  surface area. Gold is the primary brand color.
- **The one exception: the CHAT control.** Red (`--color-danger-strong`) is a legitimate BRAND
  FILL on the chat entry point — web's floating chat FAB and mobile's raised centre tab button.
  That is a deliberate owner decision, not drift, and it predates this note on web
  (`ConversationsPanel.tsx` has shipped a `bg-danger-strong` FAB for some time). **Do not "fix"
  either control back to gold or to an outline.** Everywhere else the punctuation rule stands
  unchanged.
  - On that fill, label text is **white, not cream**: cream on `--color-danger-strong` measures
    4.39:1, under the 4.5:1 AA floor for small text; white clears it at 5.16:1. Web checked this
    and recorded it, and the chat label is the smallest type in either client.
  - Its unread badge is **cream fill with dark text** (`--color-fg` on `--color-accent-fg`), the
    same bubble treatment every other count in the app uses — the badge is not red.
  - **Owner REVERSAL (Juan, 2026-08-26 night, spec rev G):** outgoing chat bubbles are **gold**
    (`colors.accent` fill, `colors.accentFg` ink text) — back to what session AE shipped. An
    earlier ruling the same day made them `colors.dangerStrong`; it shipped, was used on a real
    phone, and proved too distracting. A thread is mostly your own messages, so a brand fill on
    every one of them turns the whole screen into the brand. **The red exception is the CHAT
    control ONLY**, as it was before — plus the composer's 30pt send button, which is
    punctuation-scale and reads as the same entry-point brand.
  - The compensating rule from that ruling is **retained on its original rationale**, not
    retired with it: failure affordances in chat (failed-send badge, NOT DELIVERED line) are
    always **surface-anchored** — rendered on the screen surface adjacent to or below the bubble,
    never as a recolor of the bubble fill. The argument was always "alert-red must pop against
    the fill"; that was true against red and is true against gold. Any future "just tint the
    failed bubble" is still the thing this prevents.
- `backdrop-filter` establishes a containing block for `position: fixed` descendants, same as
  `transform`/`filter` — a fixed-position layer nested inside a `backdrop-filter` ancestor gets
  sized/clipped to that ancestor's box, not the viewport. Portal full-viewport fixed layers
  (background photo/wash, etc.) to `document.body` when they might end up nested inside one.
- **A floating layer positioned relative to an anchor must be clamped against every sibling that
  can move under it — an offset from the anchor is not a position.** The long-press tapback row
  was `translateY: -52` from the bubble and nothing else, while the action sheet, for a bubble low
  on screen, re-anchors to `bottom: 0` and grows upward by its own content height. Both rules were
  individually correct and they collided: the sheet re-anchors precisely for low bubbles, which is
  precisely when the row occupies the band the sheet moved into, and the sheet paints later
  (measured 393x852, `rect.y` 712: row `[660, 710]`, sheet top 674 — 36 of 50pt buried). Derive the
  position, clamp it into the band between the safe area and the other layer's **measured** edge,
  and remember that a content-sized sibling's height is not knowable before layout — measure it,
  don't assume it.
- **THE APP HAS ONE KNOWN AA EXCEPTION, and it is deliberate.** The inquiry photo card's
  description line measures **4.08:1 over a pure-white photograph** at the shipped
  `PHOTO_OPACITY` of 0.34 (`apps/mobile/src/components/InquiryRow.tsx`). Owner decision,
  confirmed **2026-09-01**: the atmosphere matters more than the AA floor here.
  - **Do not silently raise it.** An accessibility sweep that "fixes" this is undoing four
    sessions of owner calibration — the only lever is darkening the card, which is precisely
    what those sessions were spent lightening. The realistic case (a client's photo, not a
    sheet of paper) reads 4.64 and passes.
  - **If AA ever becomes mandatory** — App Store, an enterprise customer's procurement, a
    studio's own policy — this is the line item that fails, and that constant is the lever.
    Nothing else in the app is knowingly under the floor. Raise it as a product decision, not
    as a bug fix.

## Money and deposits

- **`POST /inquiries/:id/schedule` consumes the client's deposit, and that is INTENDED.** It
  requires a non-empty `giftCardIds`, and in one transaction creates a CONFIRMED appointment and
  attaches those gift cards to it. Owner-confirmed as standard operating procedure,
  **2026-09-01**: a deposit is taken FOR a session, so booking that session is when it is applied.
- It is therefore **not a calendar action**, and it is not a coupling to unpick. Session AR-3b
  correctly escalated it rather than building on it; the answer is that it is working as designed.
- The money-free path is a **CONSULTATION** (`POST /appointments` with
  `appointmentType: 'CONSULTATION'`), which skips the gift-card requirement entirely. That is the
  one mobile books today.

## Shared types

- **`packages/shared-types` enums are DERIVED from `apps/api/prisma/schema.prisma`, never
  hand-retyped** — see `packages/shared-types/README.md` for the mechanism. `src/enums.generated.ts`
  is generated; editing it by hand is always wrong.
- The reason is a real defect, not a style preference: `InquiryStatus` shipped to mobile with
  11 of its 15 values because it was read by eye, which put transferred inquiries in the wrong
  bucket and rendered two live statuses in the wrong colour. That package's own `typecheck`
  script now re-derives from the schema and fails on drift, so the standard verification bar
  catches it.

## Mobile app (`apps/mobile`)

- **`apps/mobile` is intentionally pinned to Expo SDK 54 for Expo Go compatibility — do not
  upgrade the Expo SDK, or "fix" a version mismatch that `expo install --check` reports,
  without reading `apps/mobile/README.md` first.** The App Store build of Expo Go supports
  SDK 54, and that is currently the only way this app can be opened on a real iPhone (a
  custom dev client needs a paid Apple Developer account the project doesn't have yet).
  A newer SDK produces an app the owner's phone physically cannot open.
- The React version (`19.1.0`, matching what SDK 54's `react-native@0.81.5` was built
  against) and the `metro.config.js` / `babel.config.js` workarounds are load-bearing for
  the same reason — the workspace root holds a different React for `apps/web`, and without
  those two files the bundle either ships two Reacts or fails to build at all. Both files
  carry the full explanation inline.

## Views

- List and Kanban are VIEWS of the same entities — every capability available from one must be
  available from the other; capabilities attach to the entity, never the navigation path.

## Public unauthenticated flows

- Any new public, unauthenticated flow (client-facing links, estimate/deposit/waiver pages, etc.)
  reuses the established token pattern already in this codebase (random token + expiry column on
  the relevant model, verified server-side) rather than inventing a new auth mechanism.

## Rate limiting, and what else blocks a second replica

- Rate limiting is in-memory per process — before scaling API replicas above one, move it to a
  shared store.
- **It is not the only blocker, and fixing it alone would make replicas LOOK safe.** Measured in
  session BE, three things are per-process today:
  1. the two `express-rate-limit` limiters in `routes/auth.ts` (default MemoryStore);
  2. **Socket.IO presence and invalidation** — `lib/realtime/io.ts` says it in its own words: a
     client on replica A never sees an event emitted by replica B. Needs a shared adapter plus
     moving presence's in-memory Maps out of process;
  3. the **job scheduler**, which would otherwise run every cron job once per replica. Session BD
     gave it an `ENABLE_SCHEDULER` switch precisely so a second HTTP replica can turn it off.
- **CLOSED IN SESSION BG.** All six auth limiters now run on a SHARED store —
  `@acpr/rate-limit-postgresql` over the existing `DATABASE_URL`, so no Redis and no new service.
  It creates its own `rate_limit` SCHEMA, which is why Prisma (which manages `public`) can never
  see or drop those tables.
  - `/login`, `/auth/forgot-password` and `/auth/reset-password/:token` were **not limited at
    all** before that session. They are now.
  - Login is limited on **IP and on email**, and both count FAILURES only — a person using the
    app normally accrues nothing, while an attacker (≈100% failures) hits the wall immediately.
    An IP limiter alone is defeated by spreading across addresses, which is what credential
    stuffing is; an email limiter alone is defeated by attacking many accounts.
  - **Fail-open**: if the store is unreachable, requests are allowed. A limiter whose database
    hiccup takes down sign-in for every studio is worse than the abuse it prevents. The trade is
    stated in `lib/rateLimit.ts` so it can be argued with; during a store outage these endpoints
    are unprotected.
  - **The 429 body is JSON with an `error` string**, not express-rate-limit's plain-text default.
    That is not cosmetic: `apps/mobile` decides whether a failure came from the API by testing
    `typeof body.error === "string"`, so a plain-text 429 was shown to users as "Can't reach Ink
    Manager right now" — a deliberate refusal reported as a network outage.
- **Any new limiter goes through `makeLimiter` in `lib/rateLimit.ts`.** A bare `rateLimit({...})`
  gets the per-process MemoryStore back and silently makes the real limit `limit × replicas`.

## Environment

- This environment is Windows/PowerShell. Use `Invoke-RestMethod`/`Invoke-WebRequest` or
  `curl.exe` (not bare `curl`, which PowerShell aliases to `Invoke-WebRequest` with different
  semantics) for ad hoc HTTP checks — don't assume a POSIX shell unless a bash-specific tool is
  explicitly in use.

## Mobile session handoff (device gate)

Every `apps/mobile` session ends by preparing the owner's device gate, so that testing it requires
no git knowledge from him:

1. The session branch is committed and **pushed**.
2. **The session branch is checked out in the PRIMARY checkout** (the main `ink-manager` folder) —
   never left reachable only from a worktree. If this session's worktree holds the branch,
   `git worktree remove` it first; the work is pushed, so that is safe. If the branch has already
   been merged, `main` carries the identical commit and the primary checkout may stay on `main` —
   but say so explicitly in the report rather than leaving it implied.
3. Run `npm install` in the primary checkout **root**, and confirm `apps/mobile` typechecks
   **there** — not in the worktree the work was done in.
4. The report's walkthrough begins: **`cd apps\mobile`, then `npx expo start`** — from the primary
   checkout, nothing else.

Merge, push, and branch/worktree cleanup happen only **after** the owner's gate passes and he says
"merge". That is a separate step, not part of the handoff.

## End-of-session cleanup

Before ending a session that started dev servers, background shells, or scratch scripts:

- Verify **zero** background shells or dev servers remain running that this session started.
- Remove scratch/verification scripts from the repo (they belong in a scratchpad, not committed).
- Confirm the working tree is clean except for changes that predate this session and were
  deliberately left untouched.
