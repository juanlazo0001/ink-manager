-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "profileSetupCompletedAt" TIMESTAMP(3);

-- Backfill: every Artist row that already exists as of this migration is
-- considered already set up -- only a row created AFTER this migration runs
-- should ever see the onboarding wizard (see Artist.profileSetupCompletedAt's
-- own schema comment).
UPDATE "Artist" SET "profileSetupCompletedAt" = CURRENT_TIMESTAMP WHERE "profileSetupCompletedAt" IS NULL;
