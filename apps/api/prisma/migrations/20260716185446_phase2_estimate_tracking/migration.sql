-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "estimateOpenedAt" TIMESTAMP(3),
ADD COLUMN     "estimateRespondedAt" TIMESTAMP(3),
ADD COLUMN     "estimateTermsSnapshot" TEXT,
ADD COLUMN     "timeEstimateHoursMax" DOUBLE PRECISION,
ADD COLUMN     "timeEstimateHoursMin" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "StudioSettings" ADD COLUMN     "estimateTerms" TEXT;

