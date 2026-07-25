-- CreateTable
CREATE TABLE "PlannedSession" (
    "id" TEXT NOT NULL,
    "sessionNumber" INTEGER NOT NULL,
    "estimatedHoursMin" DOUBLE PRECISION NOT NULL,
    "estimatedHoursMax" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "depositFormId" TEXT,
    "appointmentId" TEXT,

    CONSTRAINT "PlannedSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlannedSession_depositFormId_key" ON "PlannedSession"("depositFormId");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedSession_appointmentId_key" ON "PlannedSession"("appointmentId");

-- CreateIndex
CREATE INDEX "PlannedSession_inquiryId_idx" ON "PlannedSession"("inquiryId");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedSession_inquiryId_sessionNumber_key" ON "PlannedSession"("inquiryId", "sessionNumber");

-- AddForeignKey
ALTER TABLE "PlannedSession" ADD CONSTRAINT "PlannedSession_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedSession" ADD CONSTRAINT "PlannedSession_depositFormId_fkey" FOREIGN KEY ("depositFormId") REFERENCES "DepositForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedSession" ADD CONSTRAINT "PlannedSession_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
