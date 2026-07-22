-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "smsConsentGivenAt" TIMESTAMP(3),
ADD COLUMN     "smsConsentSource" TEXT;

-- AlterTable
ALTER TABLE "StudioSettings" ADD COLUMN     "privacyPolicy" TEXT,
ADD COLUMN     "termsAndConditions" TEXT;
