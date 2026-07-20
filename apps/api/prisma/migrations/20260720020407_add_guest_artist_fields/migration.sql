-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "guestEndDate" TIMESTAMP(3),
ADD COLUMN     "guestStartDate" TIMESTAMP(3),
ADD COLUMN     "isGuest" BOOLEAN NOT NULL DEFAULT false;
