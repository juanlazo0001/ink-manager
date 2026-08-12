-- CreateEnum
CREATE TYPE "FlashReviewMode" AS ENUM ('ARTIST', 'STUDIO', 'NONE');

-- AlterTable: add nullable first so the backfill below can read the old
-- column before it's gone -- STUDIO never appears here since today's
-- Boolean never produced a front-desk-review state (see the removed
-- column's own migration comment history / FlashReviewMode's schema
-- comment).
ALTER TABLE "Artist" ADD COLUMN "flashReviewMode" "FlashReviewMode";

UPDATE "Artist"
SET "flashReviewMode" = CASE
  WHEN "reviewsFlashRequestsBeforeBooking" THEN 'ARTIST'::"FlashReviewMode"
  ELSE 'NONE'::"FlashReviewMode"
END;

ALTER TABLE "Artist" ALTER COLUMN "flashReviewMode" SET NOT NULL;
ALTER TABLE "Artist" ALTER COLUMN "flashReviewMode" SET DEFAULT 'ARTIST';

ALTER TABLE "Artist" DROP COLUMN "reviewsFlashRequestsBeforeBooking";
