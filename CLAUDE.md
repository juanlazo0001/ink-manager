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

## Concurrent sessions

- Each concurrent session works in its own isolated git worktree (`git worktree add`). Never share
  a working tree between sessions — uncommitted edits from one session must not be visible to, or
  clobbered by, another.
- **Concurrent sessions MUST be launched via `scripts/new-session.ps1`.** It creates the worktree
  (fresh branch off latest `main`), runs `npm ci` in it, and prints a free dev-port pair — the
  single entry point that ends shared-tree collisions at session-launch time, not after the fact.

## Trusting a build

- Trust a build/deploy as safe only when **both**: `git status` is fully clean (no uncommitted
  edits to tracked files that matter, no stray untracked files that anything imports) **and** a
  fresh `npm ci` + build passes from that clean state.
- An uncommitted-but-imported file has broken production twice in this repo's history. A diff
  review is not sufficient on its own — confirm with an actual clean-checkout build.

## Design

- Frosted glass (`backdrop-filter: blur(...)`) only on discrete cards/panels — never on lists or
  tables, where it hurts readability and scroll performance.
- Never combine `backdrop-filter` with animation without testing on a real phone first — this
  combination has caused real jank/frame drops on-device that didn't show up in desktop dev tools.
- Red is punctuation (errors, destructive actions, urgent flags) — never a fill color or a large
  surface area. Gold is the primary brand color.
- `backdrop-filter` establishes a containing block for `position: fixed` descendants, same as
  `transform`/`filter` — a fixed-position layer nested inside a `backdrop-filter` ancestor gets
  sized/clipped to that ancestor's box, not the viewport. Portal full-viewport fixed layers
  (background photo/wash, etc.) to `document.body` when they might end up nested inside one.

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

## End-of-session cleanup

Before ending a session that started dev servers, background shells, or scratch scripts:

- Verify **zero** background shells or dev servers remain running that this session started.
- Remove scratch/verification scripts from the repo (they belong in a scratchpad, not committed).
- Confirm the working tree is clean except for changes that predate this session and were
  deliberately left untouched.
