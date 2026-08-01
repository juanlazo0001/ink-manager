-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'FLASH_GALLERY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InquiryStatus" ADD VALUE 'FLASH_PENDING_APPROVAL';
ALTER TYPE "InquiryStatus" ADD VALUE 'FLASH_PAYMENT_PENDING';

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "flashPieceId" TEXT;

-- CreateIndex
CREATE INDEX "Inquiry_flashPieceId_idx" ON "Inquiry"("flashPieceId");

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_flashPieceId_fkey" FOREIGN KEY ("flashPieceId") REFERENCES "FlashPiece"("id") ON DELETE SET NULL ON UPDATE CASCADE;

