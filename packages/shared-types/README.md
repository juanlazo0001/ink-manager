# @ink-manager/shared-types

Types for the Ink Manager API's HTTP surface, shared between clients.

**Types only.** No runtime logic, no dependencies, no build step — consumers import the
`.ts` source directly (`"main"` and `"types"` both point at `src/index.ts`). That is
deliberate: `apps/mobile` bundles this through Metro, and a package with no build output
and no dependencies is the one shape that needs no Metro configuration at all beyond the
repo-root `watchFolders` already in place.

The only runtime *values* here are frozen `as const` objects standing in for Prisma enums
(`MessageChannel.SMS` rather than a bare `'SMS'`). TypeScript `enum` is avoided on purpose:
it emits real code and is not erasable.

## Enums are generated, not written

`src/enums.generated.ts` is produced from `apps/api/prisma/schema.prisma` by
`scripts/generate-enums.mjs`. **Never edit it by hand.**

```bash
npm run generate:enums --workspace=packages/shared-types   # regenerate
npm run typecheck      --workspace=packages/shared-types   # regenerate in memory, fail on drift
```

The drift check is part of `typecheck`, so the verification every session already runs will
fail if the schema gains a value this package has not picked up.

**Why codegen rather than importing Prisma's own generated types.** Two reasons, both
disqualifying on their own:

1. `apps/api/generated/` is **gitignored** — it exists only after `prisma generate` runs on
   `apps/api`'s postinstall. A fresh clone would fail to typecheck this package before install.
2. This package is deliberately dependency-free, and `apps/mobile` bundles its **source**
   through Metro. Pointing it into `apps/api` couples the mobile bundle's resolution graph to
   the API's, which is the exact thing this package exists to prevent.

`schema.prisma` is committed and is the real source of truth, so parsing it needs no Prisma
runtime and no build ordering.

**This exists because hand-retyping failed.** `InquiryStatus` was read by eye and shipped with
11 of its 15 values — see `apps/mobile/PARITY-AUDIT.md`. Everything hand-written here now
lives in `enums.ts` alongside the re-exports, and is limited to genuinely derived constants
like `CLIENT_CHANNELS` (a deliberate subset, not an enum).

## Source of truth

These types describe **what crosses the wire**, and were derived by reading
`apps/api/src/routes/` and `apps/api/prisma/schema.prisma`, not by inference from a client.
They are not generated, so they can drift. When an API route changes shape, this package
has to be updated by hand — treat a mismatch here as a bug in this package, never as a
reason to work around it in a client.

Scope so far is what `apps/mobile` actually consumes: auth (`POST /login`,
`GET /users/me`, `GET /studios/:id`), conversations (list, thread, send), and the enums
those depend on.

## apps/web adoption is a separate, future task

`apps/web` still declares its own local copies of these shapes and is **not** wired to this
package. Migrating it is worthwhile but is its own piece of work with its own review — it
touches a large, live surface, and doing it as a side effect of a mobile session would put
the risk in the wrong place. Nothing here depends on that migration happening.
