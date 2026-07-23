-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'REFERRAL';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referralRewardGiftCardId" TEXT,
ADD COLUMN     "referralRewardIssuedAt" TIMESTAMP(3),
ADD COLUMN     "referredByClientId" TEXT;

-- AlterTable
ALTER TABLE "StudioSettings" ADD COLUMN     "referralRewardAmountCents" INTEGER NOT NULL DEFAULT 2500;

-- CreateIndex
CREATE UNIQUE INDEX "Client_referralCode_key" ON "Client"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "Client_referralRewardGiftCardId_key" ON "Client"("referralRewardGiftCardId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_referredByClientId_fkey" FOREIGN KEY ("referredByClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_referralRewardGiftCardId_fkey" FOREIGN KEY ("referralRewardGiftCardId") REFERENCES "GiftCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

