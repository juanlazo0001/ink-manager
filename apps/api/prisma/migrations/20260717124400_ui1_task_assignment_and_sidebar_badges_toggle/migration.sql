/*
  Warnings:

  - Added the required column `createdById` to the `PersonalTask` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PersonalTask" ADD COLUMN     "createdById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "StudioSettings" ADD COLUMN     "showSidebarBadges" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "PersonalTask" ADD CONSTRAINT "PersonalTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
