-- CreateEnum
CREATE TYPE "LiabilityWaiverStatus" AS ENUM ('PENDING', 'SIGNED', 'VERIFIED');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "checkedOutAt" TIMESTAMP(3),
ADD COLUMN     "checkedOutById" TEXT,
ADD COLUMN     "closeoutNotes" TEXT,
ADD COLUMN     "finalCostCents" INTEGER;

-- AlterTable
ALTER TABLE "StudioSettings" ADD COLUMN     "waiverAcknowledgment" TEXT,
ADD COLUMN     "waiverClauses" JSONB,
ADD COLUMN     "waiverHealthQuestions" JSONB,
ADD COLUMN     "waiverPhotoRelease" TEXT;

-- CreateTable
CREATE TABLE "LiabilityWaiver" (
    "id" TEXT NOT NULL,
    "status" "LiabilityWaiverStatus" NOT NULL DEFAULT 'PENDING',
    "token" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "legalName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "healthAnswers" JSONB,
    "idImageUrl" TEXT,
    "clauseInitials" JSONB,
    "signatureName" TEXT,
    "photoReleaseAccepted" BOOLEAN NOT NULL DEFAULT false,
    "photoReleaseSignatureName" TEXT,
    "healthQuestionsSnapshot" JSONB NOT NULL,
    "clausesSnapshot" JSONB NOT NULL,
    "acknowledgmentSnapshot" TEXT,
    "photoReleaseSnapshot" TEXT,
    "signedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studioId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "verifiedById" TEXT,

    CONSTRAINT "LiabilityWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiabilityWaiver_token_key" ON "LiabilityWaiver"("token");

-- CreateIndex
CREATE UNIQUE INDEX "LiabilityWaiver_appointmentId_key" ON "LiabilityWaiver"("appointmentId");

-- CreateIndex
CREATE INDEX "LiabilityWaiver_studioId_idx" ON "LiabilityWaiver"("studioId");

-- CreateIndex
CREATE INDEX "LiabilityWaiver_clientId_idx" ON "LiabilityWaiver"("clientId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_checkedOutById_fkey" FOREIGN KEY ("checkedOutById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiabilityWaiver" ADD CONSTRAINT "LiabilityWaiver_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiabilityWaiver" ADD CONSTRAINT "LiabilityWaiver_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiabilityWaiver" ADD CONSTRAINT "LiabilityWaiver_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiabilityWaiver" ADD CONSTRAINT "LiabilityWaiver_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

