-- AlterTable
ALTER TABLE "StudioSettings" ADD COLUMN     "depositTiers" JSONB;

-- CreateTable
CREATE TABLE "CustomPolicy" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "CustomPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomPolicy_studioId_idx" ON "CustomPolicy"("studioId");

-- AddForeignKey
ALTER TABLE "CustomPolicy" ADD CONSTRAINT "CustomPolicy_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
