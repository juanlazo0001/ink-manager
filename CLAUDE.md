# Standing rules for this repo

Concise operating rules, not a project history — see REPORT.md for history.

## Database / Prisma

- **NEVER run `prisma migrate dev`.** It hangs on an interactive reset prompt (known checksum
  mismatch in this repo's migration history) and will block waiting for input that never comes.
  Use `prisma migrate diff` to generate the SQL, then `prisma migrate deploy` to apply it.
- **Never accept a database reset, ever.** If any tool or prompt offers to reset the dev database,
  decline. There is no scenario in this repo where that's the right call.

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

## Concurrent sessions

- Each concurrent session works in its own isolated git worktree (`git worktree add`). Never share
  a working tree between sessions — uncommitted edits from one session must not be visible to, or
  clobbered by, another.
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
- "Typecheck passed" means the **full production build** (`tsc -b && vite build` for `apps/web`,
  `tsc` for `apps/api`) — not `tsc --noEmit -p .` alone. `--noEmit` on its own has already missed a
  real error (`ConversationsPanel.tsx`'s separate `Record<Tone, string>` maps needing a new `hold`
  key) that only the real `vite build` caught, after passing silently all session.

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
  - **Owner ruling (Juan, 2026-08-26):** `chat.bubble.own.bg` = `colors.dangerStrong` (#C2402F).
    Outgoing chat bubbles are the second sanctioned red fill, alongside the chat entry point.
    Compensating rule: failure affordances in chat (failed-send badge, NOT DELIVERED line, unread
    indicators) are always **surface-anchored** — rendered on the screen surface adjacent to or
    below the bubble, never as a recolor of the bubble fill — so alert-red remains legible against
    brand-red.
- `backdrop-filter` establishes a containing block for `position: fixed` descendants, same as
  `transform`/`filter` — a fixed-position layer nested inside a `backdrop-filter` ancestor gets
  sized/clipped to that ancestor's box, not the viewport. Portal full-viewport fixed layers
  (background photo/wash, etc.) to `document.body` when they might end up nested inside one.

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

## Rate limiting

- Rate limiting is in-memory per process — before scaling API replicas above one, move it to a
  shared store.

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
