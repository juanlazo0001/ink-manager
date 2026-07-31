-- AlterEnum
ALTER TYPE "GiftCardStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "GiftCard" ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripePaymentIntentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_stripeCheckoutSessionId_key" ON "GiftCard"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_stripePaymentIntentId_key" ON "GiftCard"("stripePaymentIntentId");
