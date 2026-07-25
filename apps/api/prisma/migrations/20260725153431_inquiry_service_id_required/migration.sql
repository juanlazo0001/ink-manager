/*
  Warnings:

  - Made the column `serviceId` on table `Inquiry` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Inquiry" DROP CONSTRAINT "Inquiry_serviceId_fkey";

-- AlterTable
ALTER TABLE "Inquiry" ALTER COLUMN "serviceId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
