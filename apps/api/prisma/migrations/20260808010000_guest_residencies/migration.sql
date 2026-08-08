-- CreateEnum
CREATE TYPE "ResidencyStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "publicSlug" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Residency" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "ResidencyStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Residency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Residency_membershipId_idx" ON "Residency"("membershipId");

-- CreateIndex
CREATE INDEX "Residency_artistId_status_idx" ON "Residency"("artistId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_publicSlug_key" ON "Artist"("publicSlug");

-- AddForeignKey
ALTER TABLE "Residency" ADD CONSTRAINT "Residency_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "StudioMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Residency" ADD CONSTRAINT "Residency_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-authored (not representable in Prisma's schema DSL, same reason
-- StudioMembership's own two partial unique indexes are hand-authored):
-- an artist can have no date-overlapping CONFIRMED residencies across ANY
-- studios. This is belt-and-suspenders DB-level backing for the real
-- enforcement point (the application-layer check in
-- routes/residencies.ts, run on create AND on accept) -- never the
-- primary defense, since app-level is what the task explicitly requires
-- and what carries the actual user-facing error message.
--
-- EXCLUDE constraints need the btree_gist extension for the plain-equality
-- "artistId WITH =" term to coexist with the range-overlap "&&" term in
-- the same GiST index.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- daterange(..., '[]') = inclusive on both ends, matching how
-- startDate/endDate are actually compared elsewhere (civil dates, both
-- boundaries counted as part of the stint) -- an artist can't be
-- CONFIRMED at two studios even on the single shared day where one
-- residency ends and another begins.
ALTER TABLE "Residency" ADD CONSTRAINT "residency_no_overlap_confirmed"
  EXCLUDE USING gist (
    "artistId" WITH =,
    daterange("startDate"::date, "endDate"::date, '[]') WITH &&
  )
  WHERE (status = 'CONFIRMED');

