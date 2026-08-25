-- Post-add SMS consent: the self-serve half.
--
-- Purely additive -- two nullable columns and a unique index on one of
-- them. No existing row is read, rewritten or defaulted, so this is safe
-- to apply to a live database with traffic on it.
--
-- The unique index is what makes the public lookup (findUnique by token)
-- a single indexed hit rather than a scan, and structurally prevents two
-- clients ever sharing a live consent token.

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "smsConsentToken" TEXT,
ADD COLUMN     "smsConsentTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Client_smsConsentToken_key" ON "Client"("smsConsentToken");
