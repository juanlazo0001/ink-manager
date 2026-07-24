/*
  Warnings:

  - Made the column `intakeFormId` on table `IntakeFormField` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "IntakeFormField" DROP CONSTRAINT "IntakeFormField_intakeFormId_fkey";

-- AlterTable
ALTER TABLE "IntakeFormField" ALTER COLUMN "intakeFormId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "IntakeFormField" ADD CONSTRAINT "IntakeFormField_intakeFormId_fkey" FOREIGN KEY ("intakeFormId") REFERENCES "IntakeForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
