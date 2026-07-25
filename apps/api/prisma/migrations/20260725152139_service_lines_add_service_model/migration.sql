-- CreateEnum
CREATE TYPE "ServicePricingModel" AS ENUM ('RANGE', 'FLAT');

-- CreateEnum
CREATE TYPE "ServiceDepositModel" AS ENUM ('TIER_BASED', 'FLAT');

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "serviceId" TEXT;

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "pricingModel" "ServicePricingModel" NOT NULL,
    "depositModel" "ServiceDepositModel" NOT NULL,
    "flatPriceCents" INTEGER,
    "flatDepositCents" INTEGER,
    "depositBreakdownNote" TEXT,
    "requiresCandidacyReview" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studioId" TEXT NOT NULL,
    "intakeFormId" TEXT NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistService" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "artistId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "ArtistService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Service_studioId_idx" ON "Service"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_studioId_slug_key" ON "Service"("studioId", "slug");

-- CreateIndex
CREATE INDEX "ArtistService_serviceId_idx" ON "ArtistService"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistService_artistId_serviceId_key" ON "ArtistService"("artistId", "serviceId");

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_intakeFormId_fkey" FOREIGN KEY ("intakeFormId") REFERENCES "IntakeForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistService" ADD CONSTRAINT "ArtistService_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistService" ADD CONSTRAINT "ArtistService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
