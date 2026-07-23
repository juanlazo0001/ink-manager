-- Hotfix: this migration originally failed in production (23502: column
-- "referralCode" of relation "Client" contains null values) because the
-- backfill for existing rows was done as a throwaway script against the
-- dev database only during Package O -- never captured as a real
-- migration step. Resolved in production via
-- `prisma migrate resolve --rolled-back`, which causes Prisma to retry
-- THIS file (at its original position in the sequence) rather than a
-- later one -- so the fix has to live here, not in a new migration.
--
-- Backfills every remaining NULL row with a generated unique code, then
-- -- only once every row has a value -- applies the NOT NULL constraint.
-- Client_referralCode_key's unique index already exists (added
-- successfully by the earlier 20260723201011_referral_program migration),
-- so it is not recreated here. The generated codes are md5-derived
-- (uppercase hex), not the exact curated ambiguous-character-free
-- alphabet apps/api/src/lib/referrals.ts uses for new clients going
-- forward -- a deliberate choice: this is a one-time SQL-only backfill of
-- pre-existing legacy rows, not a code a client ever reads aloud from at
-- creation time, and it avoids any dependency beyond vanilla Postgres
-- functions during a live incident. The WHERE guard makes this UPDATE
-- itself idempotent if this file is ever re-run against a database that's
-- already been partially backfilled.
UPDATE "Client"
SET "referralCode" = upper(substr(md5(random()::text || "id" || clock_timestamp()::text), 1, 7))
WHERE "referralCode" IS NULL;

-- AlterTable
ALTER TABLE "Client" ALTER COLUMN "referralCode" SET NOT NULL;

