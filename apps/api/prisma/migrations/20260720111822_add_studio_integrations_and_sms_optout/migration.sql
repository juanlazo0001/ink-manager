-- CreateEnum
CREATE TYPE "IntegrationChannel" AS ENUM ('SMS', 'EMAIL', 'INSTAGRAM', 'FACEBOOK', 'GOOGLE_CALENDAR');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'ERROR');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "smsOptedOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StudioIntegration" (
    "id" TEXT NOT NULL,
    "channel" "IntegrationChannel" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "displayName" TEXT,
    "encryptedSecret" TEXT,
    "metadata" JSONB,
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "StudioIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudioIntegration_studioId_channel_key" ON "StudioIntegration"("studioId", "channel");

-- AddForeignKey
ALTER TABLE "StudioIntegration" ADD CONSTRAINT "StudioIntegration_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
