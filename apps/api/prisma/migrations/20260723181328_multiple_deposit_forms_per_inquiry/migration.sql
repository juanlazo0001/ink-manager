-- DropIndex
DROP INDEX "DepositForm_inquiryId_key";

-- AlterTable
ALTER TABLE "DepositForm" ADD COLUMN     "sessionNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "DepositForm_inquiryId_sessionNumber_idx" ON "DepositForm"("inquiryId", "sessionNumber");
