-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "facebookProfileUrl" TEXT,
ADD COLUMN     "instagramHandle" TEXT;

-- AlterTable
ALTER TABLE "Inquiry" ALTER COLUMN "updatedAt" DROP DEFAULT;
