-- AlterTable
ALTER TABLE "Studio" ADD COLUMN     "setupCompletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationToken" TEXT,
ADD COLUMN     "emailVerificationTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerificationToken_key" ON "User"("emailVerificationToken");

-- Backfill: every Studio/User row that already exists as of this migration
-- is considered already set up / already verified -- only a Studio or User
-- created AFTER this migration runs is ever eligible for the setup wizard
-- or subject to the email-verification login gate (see Studio.setupCompletedAt
-- and User.emailVerifiedAt's own schema comments).
UPDATE "Studio" SET "setupCompletedAt" = CURRENT_TIMESTAMP WHERE "setupCompletedAt" IS NULL;
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "emailVerifiedAt" IS NULL;

