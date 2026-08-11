-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING_ARTIST', 'ACCEPTED', 'DECLINED', 'CANCELLED_BY_ORIGIN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TransferLineItemOutcome" AS ENUM ('PENDING', 'CREATED', 'MERGE_FLAGGED', 'FAILED');

-- AlterEnum
ALTER TYPE "InquiryStatus" ADD VALUE 'TRANSFERRED';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "transferredAt" TIMESTAMP(3),
ADD COLUMN     "transferredToStudioId" TEXT;

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "transferredAt" TIMESTAMP(3),
ADD COLUMN     "transferredToInquiryId" TEXT,
ADD COLUMN     "transferredToStudioId" TEXT;

-- CreateTable
CREATE TABLE "ArtistTransfer" (
    "id" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING_ARTIST',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "originStudioId" TEXT NOT NULL,
    "destinationStudioId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "respondedById" TEXT,
    "cancelledById" TEXT,

    CONSTRAINT "ArtistTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistTransferClient" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "originClientId" TEXT NOT NULL,
    "originInquiryId" TEXT,
    "destinationClientId" TEXT,
    "destinationInquiryId" TEXT,
    "outcome" "TransferLineItemOutcome" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ArtistTransferClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtistTransfer_originStudioId_idx" ON "ArtistTransfer"("originStudioId");

-- CreateIndex
CREATE INDEX "ArtistTransfer_destinationStudioId_idx" ON "ArtistTransfer"("destinationStudioId");

-- CreateIndex
CREATE INDEX "ArtistTransfer_artistId_idx" ON "ArtistTransfer"("artistId");

-- CreateIndex
CREATE INDEX "ArtistTransfer_status_idx" ON "ArtistTransfer"("status");

-- CreateIndex
CREATE INDEX "ArtistTransferClient_transferId_idx" ON "ArtistTransferClient"("transferId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistTransferClient_transferId_originClientId_key" ON "ArtistTransferClient"("transferId", "originClientId");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_transferredToInquiryId_key" ON "Inquiry"("transferredToInquiryId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_transferredToStudioId_fkey" FOREIGN KEY ("transferredToStudioId") REFERENCES "Studio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistTransfer" ADD CONSTRAINT "ArtistTransfer_originStudioId_fkey" FOREIGN KEY ("originStudioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistTransfer" ADD CONSTRAINT "ArtistTransfer_destinationStudioId_fkey" FOREIGN KEY ("destinationStudioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistTransfer" ADD CONSTRAINT "ArtistTransfer_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistTransfer" ADD CONSTRAINT "ArtistTransfer_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistTransfer" ADD CONSTRAINT "ArtistTransfer_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistTransfer" ADD CONSTRAINT "ArtistTransfer_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistTransferClient" ADD CONSTRAINT "ArtistTransferClient_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "ArtistTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistTransferClient" ADD CONSTRAINT "ArtistTransferClient_originClientId_fkey" FOREIGN KEY ("originClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistTransferClient" ADD CONSTRAINT "ArtistTransferClient_originInquiryId_fkey" FOREIGN KEY ("originInquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistTransferClient" ADD CONSTRAINT "ArtistTransferClient_destinationClientId_fkey" FOREIGN KEY ("destinationClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistTransferClient" ADD CONSTRAINT "ArtistTransferClient_destinationInquiryId_fkey" FOREIGN KEY ("destinationInquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_transferredToStudioId_fkey" FOREIGN KEY ("transferredToStudioId") REFERENCES "Studio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_transferredToInquiryId_fkey" FOREIGN KEY ("transferredToInquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

