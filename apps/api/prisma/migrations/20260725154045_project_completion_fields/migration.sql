-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "projectCompletedAt" TIMESTAMP(3),
ADD COLUMN     "projectCompletedById" TEXT;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_projectCompletedById_fkey" FOREIGN KEY ("projectCompletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
