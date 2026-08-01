-- AlterTable
ALTER TABLE "StudioSettings" ADD COLUMN     "depositFeeCents" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "reminderNightBeforeDays" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "reminderWeekBeforeDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "schedulingBufferMinutes" INTEGER NOT NULL DEFAULT 90;
