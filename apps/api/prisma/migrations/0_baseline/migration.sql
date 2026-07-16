-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'FRONT_DESK', 'ARTIST', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'INSTAGRAM', 'FACEBOOK');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'ARTIST_ASSIGNED', 'AWAITING_CLIENT_RESPONSE', 'BUDGET_NEGOTIATION', 'SCHEDULING', 'WAITLISTED', 'DEPOSIT_PENDING', 'CONFIRMED', 'CLOSED_LOST', 'COLD_LEAD');

-- CreateTable
CREATE TABLE "Studio" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Studio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT false,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "hours" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "bio" TEXT,
    "specialties" TEXT[],
    "portfolioImages" TEXT[],
    "userId" TEXT NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studioId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "depositPaid" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studioId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentForm" (
    "id" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "signatureData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signingToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "clientId" TEXT NOT NULL,
    "appointmentId" TEXT,

    CONSTRAINT "ConsentForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "description" TEXT NOT NULL,
    "colorOrBlackGrey" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "estimatedSize" TEXT NOT NULL,
    "hasBeenTattooedBefore" BOOLEAN NOT NULL,
    "budget" TEXT,
    "desiredTiming" TEXT,
    "referenceImages" TEXT[],
    "placementImages" TEXT[],
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "priceEstimateLow" DOUBLE PRECISION,
    "priceEstimateHigh" DOUBLE PRECISION,
    "timeEstimateHours" DOUBLE PRECISION,
    "declineNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    "estimateToken" TEXT,
    "estimateTokenExpiresAt" TIMESTAMP(3),
    "estimateSentAt" TIMESTAMP(3),
    "clientStatedBudget" TEXT,
    "closedReason" TEXT,
    "studioId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "preferredArtistId" TEXT,
    "assignedArtistId" TEXT,
    "appointmentId" TEXT,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositForm" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "agreedNonRefundable" BOOLEAN NOT NULL DEFAULT false,
    "agreedLatePolicy" BOOLEAN NOT NULL DEFAULT false,
    "agreedNoShowForfeit" BOOLEAN NOT NULL DEFAULT false,
    "agreedNewDepositAfterNoShow" BOOLEAN NOT NULL DEFAULT false,
    "agreedRescheduleLimit" BOOLEAN NOT NULL DEFAULT false,
    "agreedExpiration" BOOLEAN NOT NULL DEFAULT false,
    "agreedIdAndVoucher" BOOLEAN NOT NULL DEFAULT false,
    "agreedAge18" BOOLEAN NOT NULL DEFAULT false,
    "signatureName" TEXT,
    "signedAt" TIMESTAMP(3),
    "depositAmount" DOUBLE PRECISION NOT NULL,
    "feeAmount" DOUBLE PRECISION NOT NULL,
    "totalCharged" DOUBLE PRECISION NOT NULL,
    "paidManually" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inquiryId" TEXT NOT NULL,

    CONSTRAINT "DepositForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Studio_slug_key" ON "Studio"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_studioId_role_permissionKey_key" ON "RolePermission"("studioId", "role", "permissionKey");

-- CreateIndex
CREATE INDEX "Location_studioId_idx" ON "Location"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_studioId_idx" ON "User"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_userId_key" ON "Artist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_userId_key" ON "Client"("userId");

-- CreateIndex
CREATE INDEX "Client_studioId_idx" ON "Client"("studioId");

-- CreateIndex
CREATE INDEX "Appointment_studioId_startTime_idx" ON "Appointment"("studioId", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentForm_signingToken_key" ON "ConsentForm"("signingToken");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentForm_appointmentId_key" ON "ConsentForm"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_estimateToken_key" ON "Inquiry"("estimateToken");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_appointmentId_key" ON "Inquiry"("appointmentId");

-- CreateIndex
CREATE INDEX "Inquiry_studioId_idx" ON "Inquiry"("studioId");

-- CreateIndex
CREATE INDEX "Inquiry_studioId_status_idx" ON "Inquiry"("studioId", "status");

-- CreateIndex
CREATE INDEX "Inquiry_clientId_idx" ON "Inquiry"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositForm_token_key" ON "DepositForm"("token");

-- CreateIndex
CREATE UNIQUE INDEX "DepositForm_inquiryId_key" ON "DepositForm"("inquiryId");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artist" ADD CONSTRAINT "Artist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentForm" ADD CONSTRAINT "ConsentForm_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentForm" ADD CONSTRAINT "ConsentForm_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_preferredArtistId_fkey" FOREIGN KEY ("preferredArtistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_assignedArtistId_fkey" FOREIGN KEY ("assignedArtistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositForm" ADD CONSTRAINT "DepositForm_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

