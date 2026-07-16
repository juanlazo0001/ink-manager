-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'VOID');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "preferredSchedule" JSONB;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- Backfill existing rows before tightening to NOT NULL below.
UPDATE "Client" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "Client" ALTER COLUMN "updatedAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "inquiryId" TEXT;

-- AlterTable
ALTER TABLE "DepositForm" ADD COLUMN     "giftCardId" TEXT;

-- CreateTable
CREATE TABLE "StudioSettings" (
    "id" TEXT NOT NULL,
    "refundPolicy" TEXT,
    "depositPolicy" TEXT,
    "reschedulePolicy" TEXT,
    "communicationPolicy" TEXT,
    "estimateFollowUpHours" INTEGER NOT NULL DEFAULT 24,
    "giftCardDefaultExpirationDays" INTEGER,
    "calendarInviteTemplate" TEXT,
    "messageTemplates" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "StudioSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studioId" TEXT NOT NULL,
    "actorUserId" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studioId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "issuedById" TEXT NOT NULL,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudioSettings_studioId_key" ON "StudioSettings"("studioId");

-- CreateIndex
CREATE INDEX "AuditLog_studioId_entityType_entityId_idx" ON "AuditLog"("studioId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_studioId_createdAt_idx" ON "AuditLog"("studioId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_code_key" ON "GiftCard"("code");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_appointmentId_key" ON "GiftCard"("appointmentId");

-- CreateIndex
CREATE INDEX "GiftCard_studioId_idx" ON "GiftCard"("studioId");

-- CreateIndex
CREATE INDEX "GiftCard_clientId_idx" ON "GiftCard"("clientId");

-- CreateIndex
CREATE INDEX "Appointment_inquiryId_idx" ON "Appointment"("inquiryId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositForm_giftCardId_key" ON "DepositForm"("giftCardId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioSettings" ADD CONSTRAINT "StudioSettings_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositForm" ADD CONSTRAINT "DepositForm_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

