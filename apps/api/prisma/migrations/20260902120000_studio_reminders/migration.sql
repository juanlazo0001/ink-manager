-- Package BJ: studio-configured reminders.
--
-- Generated with `prisma migrate diff --from-config-datasource`, which
-- diffs the LIVE database and therefore also emitted a `DROP TABLE
-- "migrations"` for a third-party library's own migration tracker that
-- lives in `public` but is not in schema.prisma. That drop was removed by
-- hand -- it is not part of this change and would break that library.
-- Everything below is purely additive.

-- CreateEnum
CREATE TYPE "ReminderAudience" AS ENUM ('CLIENT', 'ARTIST');

-- CreateEnum
CREATE TYPE "ReminderCondition" AS ENUM ('NONE', 'WAIVER_UNSIGNED');

-- CreateTable
CREATE TABLE "StudioReminder" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "audience" "ReminderAudience" NOT NULL DEFAULT 'CLIENT',
    "condition" "ReminderCondition" NOT NULL DEFAULT 'NONE',
    "offsetDays" INTEGER NOT NULL,
    "sendTime" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "systemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "StudioReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentReminderSend" (
    "id" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appointmentId" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,

    CONSTRAINT "AppointmentReminderSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioReminder_studioId_idx" ON "StudioReminder"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "StudioReminder_studioId_systemKey_key" ON "StudioReminder"("studioId", "systemKey");

-- CreateIndex
CREATE INDEX "AppointmentReminderSend_reminderId_idx" ON "AppointmentReminderSend"("reminderId");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentReminderSend_appointmentId_reminderId_key" ON "AppointmentReminderSend"("appointmentId", "reminderId");

-- AddForeignKey
ALTER TABLE "StudioReminder" ADD CONSTRAINT "StudioReminder_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentReminderSend" ADD CONSTRAINT "AppointmentReminderSend_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentReminderSend" ADD CONSTRAINT "AppointmentReminderSend_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "StudioReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
