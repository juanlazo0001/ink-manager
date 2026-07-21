-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "facebookProfileUrl" TEXT,
ADD COLUMN     "instagramHandle" TEXT,
ADD COLUMN     "otherContact" TEXT;

-- CreateTable
CREATE TABLE "DismissedDuplicatePair" (
    "id" TEXT NOT NULL,
    "clientAId" TEXT NOT NULL,
    "clientBId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studioId" TEXT NOT NULL,
    "dismissedById" TEXT NOT NULL,

    CONSTRAINT "DismissedDuplicatePair_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DismissedDuplicatePair_studioId_idx" ON "DismissedDuplicatePair"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "DismissedDuplicatePair_clientAId_clientBId_key" ON "DismissedDuplicatePair"("clientAId", "clientBId");

-- AddForeignKey
ALTER TABLE "DismissedDuplicatePair" ADD CONSTRAINT "DismissedDuplicatePair_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DismissedDuplicatePair" ADD CONSTRAINT "DismissedDuplicatePair_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
