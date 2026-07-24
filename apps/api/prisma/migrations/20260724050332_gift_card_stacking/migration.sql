-- DropIndex
DROP INDEX "GiftCard_appointmentId_key";

-- CreateIndex
CREATE INDEX "GiftCard_appointmentId_idx" ON "GiftCard"("appointmentId");
