-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "reminderMorningOfSentAt" TIMESTAMP(3),
ADD COLUMN     "reminderNightBeforeSentAt" TIMESTAMP(3),
ADD COLUMN     "reminderWeekSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "estimateFollowUpSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StudioSettings" ADD COLUMN     "reminderSendTimes" JSONB,
ADD COLUMN     "reminderTemplates" JSONB;

-- CreateTable
CREATE TABLE "ArtistReminderLog" (
    "id" TEXT NOT NULL,
    "forDate" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studioId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,

    CONSTRAINT "ArtistReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtistReminderLog_artistId_forDate_key" ON "ArtistReminderLog"("artistId", "forDate");

-- AddForeignKey
ALTER TABLE "ArtistReminderLog" ADD CONSTRAINT "ArtistReminderLog_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistReminderLog" ADD CONSTRAINT "ArtistReminderLog_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
