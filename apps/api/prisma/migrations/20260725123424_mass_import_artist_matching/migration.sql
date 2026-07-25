-- AlterTable
ALTER TABLE "ImportRow" ADD COLUMN     "artistFlaggedForReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "matchedArtistId" TEXT;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_matchedArtistId_fkey" FOREIGN KEY ("matchedArtistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
