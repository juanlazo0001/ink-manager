-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "flashPaidAt" TIMESTAMP(3),
ADD COLUMN     "flashPaymentToken" TEXT,
ADD COLUMN     "flashPaymentTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripePaymentIntentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_flashPaymentToken_key" ON "Inquiry"("flashPaymentToken");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_stripeCheckoutSessionId_key" ON "Inquiry"("stripeCheckoutSessionId");
