-- AlterEnum
ALTER TYPE "IntegrationChannel" ADD VALUE 'STRIPE';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "paidVia" TEXT,
ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripePaymentIntentId" TEXT;

-- AlterTable
ALTER TABLE "DepositForm" ADD COLUMN     "paidVia" TEXT,
ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripePaymentIntentId" TEXT;

-- AlterTable
ALTER TABLE "GiftCard" ADD COLUMN     "derivedFromGiftCardId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_stripeCheckoutSessionId_key" ON "Appointment"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_stripePaymentIntentId_key" ON "Appointment"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositForm_stripeCheckoutSessionId_key" ON "DepositForm"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositForm_stripePaymentIntentId_key" ON "DepositForm"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "GiftCard_derivedFromGiftCardId_idx" ON "GiftCard"("derivedFromGiftCardId");

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_derivedFromGiftCardId_fkey" FOREIGN KEY ("derivedFromGiftCardId") REFERENCES "GiftCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

