-- AlterEnum
ALTER TYPE "GiftCardStatus" ADD VALUE 'EXEMPT';

-- AlterTable
ALTER TABLE "GiftCard" ADD COLUMN     "exemptionReason" TEXT;
