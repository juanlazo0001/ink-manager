-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_inquiryId_fkey";

-- AlterTable
ALTER TABLE "Appointment" ALTER COLUMN "inquiryId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

