-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "previousEstimateToken" TEXT,
ADD COLUMN     "previousSelfScheduleToken" TEXT,
ADD COLUMN     "selfScheduleBookedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_previousSelfScheduleToken_key" ON "Inquiry"("previousSelfScheduleToken");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_previousEstimateToken_key" ON "Inquiry"("previousEstimateToken");

