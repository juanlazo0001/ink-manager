-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('TATTOO_SESSION', 'CONSULTATION');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "appointmentType" "AppointmentType" NOT NULL DEFAULT 'TATTOO_SESSION';
