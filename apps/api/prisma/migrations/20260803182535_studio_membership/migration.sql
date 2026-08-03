-- CreateEnum
CREATE TYPE "StudioMembershipType" AS ENUM ('HOME', 'GUEST');

-- CreateTable
CREATE TABLE "StudioMembership" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "type" "StudioMembershipType" NOT NULL DEFAULT 'HOME',
    "allowsStudioProfileEdits" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioMembership_artistId_idx" ON "StudioMembership"("artistId");

-- CreateIndex
CREATE INDEX "StudioMembership_studioId_idx" ON "StudioMembership"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "StudioMembership_studioId_artistId_key" ON "StudioMembership"("studioId", "artistId");

-- AddForeignKey
ALTER TABLE "StudioMembership" ADD CONSTRAINT "StudioMembership_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioMembership" ADD CONSTRAINT "StudioMembership_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

