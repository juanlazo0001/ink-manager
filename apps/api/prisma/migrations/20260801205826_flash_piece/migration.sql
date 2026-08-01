-- CreateEnum
CREATE TYPE "FlashPieceStatus" AS ENUM ('AVAILABLE', 'PENDING_APPROVAL', 'BOOKED', 'RETIRED');

-- CreateTable
CREATE TABLE "FlashPiece" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "estimatedDurationMinutes" INTEGER NOT NULL,
    "isOneOfOne" BOOLEAN NOT NULL DEFAULT false,
    "status" "FlashPieceStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studioId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,

    CONSTRAINT "FlashPiece_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlashPiece_studioId_artistId_idx" ON "FlashPiece"("studioId", "artistId");

-- CreateIndex
CREATE INDEX "FlashPiece_studioId_status_idx" ON "FlashPiece"("studioId", "status");

-- AddForeignKey
ALTER TABLE "FlashPiece" ADD CONSTRAINT "FlashPiece_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashPiece" ADD CONSTRAINT "FlashPiece_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

