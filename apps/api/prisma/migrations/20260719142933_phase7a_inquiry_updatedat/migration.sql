-- AlterTable
-- Manually written (prisma migrate dev --create-only refuses to generate a
-- file at all for a required column added to a non-empty table -- it hard-
-- errors rather than prompting). DEFAULT CURRENT_TIMESTAMP backfills the 4
-- existing rows sensibly (their updatedAt becomes "now", i.e. no false
-- signal of recent activity for the cold-lead sweep); every column write
-- going forward is still fully managed by Prisma's @updatedAt, the DB-level
-- default is only ever exercised for pre-existing rows on this one migration.
ALTER TABLE "Inquiry" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
