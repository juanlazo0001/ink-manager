-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "allowsClientSelfScheduling" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "selfScheduleToken" TEXT,
ADD COLUMN     "selfScheduleTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_selfScheduleToken_key" ON "Inquiry"("selfScheduleToken");

