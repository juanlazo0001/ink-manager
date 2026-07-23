-- CreateTable
CREATE TABLE "AppointmentPhoto" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appointmentId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,

    CONSTRAINT "AppointmentPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppointmentPhoto_appointmentId_idx" ON "AppointmentPhoto"("appointmentId");

-- AddForeignKey
ALTER TABLE "AppointmentPhoto" ADD CONSTRAINT "AppointmentPhoto_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentPhoto" ADD CONSTRAINT "AppointmentPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
