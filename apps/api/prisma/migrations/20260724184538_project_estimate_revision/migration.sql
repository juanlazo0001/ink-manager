-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "estimateRevisionApproved" BOOLEAN,
ADD COLUMN     "estimateRevisionReason" TEXT,
ADD COLUMN     "estimateRevisionRespondedAt" TIMESTAMP(3),
ADD COLUMN     "estimateRevisionSentAt" TIMESTAMP(3),
ADD COLUMN     "estimateRevisionToken" TEXT,
ADD COLUMN     "estimateRevisionTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_estimateRevisionToken_key" ON "Inquiry"("estimateRevisionToken");
