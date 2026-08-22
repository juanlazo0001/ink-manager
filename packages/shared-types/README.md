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
