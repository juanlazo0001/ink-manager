# Development setup

This covers local environment setup for `apps/api` (Express + Prisma + Postgres)
and `apps/web` (React + Vite). Read this before running anything against a
database — the rule at the bottom is not optional.

## Environment files (`apps/api`)

| File | Committed? | Purpose |
|---|---|---|
| `.env` | No (gitignored) | Your working environment. `DATABASE_URL` here must point at a **development** database. |
| `.env.production` | No (gitignored) | Production `DATABASE_URL` only. Never loaded automatically by `npm run dev`, `prisma migrate dev`, or the seed script — used only for deliberate, one-off release/verification commands (see below). |
| `.env.example` | Yes | Documents the shape of `.env` with no real secrets. Copy it to `.env` and fill in real values when setting up a fresh checkout. |

`apps/api/.gitignore` ignores `.env*` (everything env-shaped) except `.env.example`,
which is explicitly un-ignored. If you ever add a new env file variant, it's
covered automatically.

## Setting up a development database

Preferred: **local Docker Postgres** (not available on this machine as of this
writing — Docker wasn't installed, so the project currently runs against a
second Railway Postgres instead). If you have Docker available:

```bash
docker compose up -d   # once a docker-compose.yml exists at repo root
```

Otherwise (the current setup): provision a Postgres database in Railway,
ideally in a separate environment named `development` in the same project so
it's clearly distinguished from production in the dashboard. Paste its
connection string into `apps/api/.env` as `DATABASE_URL` — **never paste a
production connection string into a chat/browser tool; place it directly into
the env file yourself.**

Once `.env` points at a real, empty dev database:

```bash
cd apps/api
npx prisma migrate deploy   # applies the full committed migration history
npx prisma db seed          # populates it with the dev seed data (see below)
```

## `migrate dev` vs `migrate deploy`

- **`prisma migrate dev`** — use this while building a new schema change
  against your dev database. It creates a shadow database to compute the
  diff, generates a new migration file, and applies it. This requires a real
  dedicated dev database (shadow-DB creation needs schema-create permissions)
  — it will not work safely against production.
- **`prisma migrate deploy`** — applies already-committed migration files
  without generating new ones or touching a shadow database. This is what
  runs against production, and only as a deliberate release step. As of this
  change, it also runs automatically as part of `apps/api`'s `start` script
  (`npx prisma migrate deploy && node dist/src/index.js`), so deploying `main`
  to Railway applies any newly-committed migrations before the server boots —
  no more running migrations from a laptop against prod.

Day to day: build schema changes with `migrate dev` against your dev
database. `migrate deploy` against production should only ever happen via the
deploy step above, or as an explicit, deliberate one-off (e.g. the read-only
`migrate status` sanity checks described below) — never as part of normal
development.

## Seed script

`apps/api/prisma/seed.ts` is wired in as the Prisma seed command
(`prisma.migrations.seed` in `prisma.config.ts`). Run it with:

```bash
npx prisma db seed
```

It's deterministic and idempotent — every row is looked up by a stable key
first (studio slug, user email, etc.) and only created if missing, so
running it repeatedly never duplicates data or errors on unique constraints.
It creates:

- One studio (`dev-studio`) with `StudioSettings` populated (waiver template,
  estimate terms, policies — all obviously-fake placeholder text where no
  real wording existed anywhere in the codebase).
- An OWNER, a FRONT_DESK, and two ARTISTs (with `Artist` profiles).
- Four clients.
- Three inquiries at different pipeline stages: one freshly submitted, one
  with a paid deposit + issued gift card, and one with a paid deposit, gift
  card, and a scheduled appointment.

All seeded emails end in `@dev-studio.test` and phone numbers are `555-xxxx`.
Every seeded user's password is `password123`.

## Verifying things are in sync

Read-only, safe to run anytime:

```bash
npx prisma migrate status                     # checks against apps/api/.env's DATABASE_URL (dev)
```

To check production without ever putting its URL in your working `.env`,
point the command at `.env.production` for that one invocation instead of
editing `.env`.

---

**Development and testing never point at the production `DATABASE_URL`.**
Production's connection string lives only in `apps/api/.env.production`,
used exclusively for deliberate release/verification steps — never for
`npm run dev`, `prisma migrate dev`, the seed script, or any test run.
