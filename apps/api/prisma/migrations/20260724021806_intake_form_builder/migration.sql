-- CreateEnum
CREATE TYPE "IntakeFieldKind" AS ENUM ('SYSTEM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "IntakeCustomQuestionType" AS ENUM ('TEXT', 'PARAGRAPH', 'NUMBER', 'DATE', 'YES_NO', 'SELECT', 'MULTI_SELECT', 'PHOTO_UPLOAD');

-- CreateTable
CREATE TABLE "IntakeFormField" (
    "id" TEXT NOT NULL,
    "fieldKind" "IntakeFieldKind" NOT NULL,
    "systemFieldKey" TEXT,
    "customQuestionType" "IntakeCustomQuestionType",
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "IntakeFormField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntakeFormField_studioId_order_idx" ON "IntakeFormField"("studioId", "order");

-- AddForeignKey
ALTER TABLE "IntakeFormField" ADD CONSTRAINT "IntakeFormField_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
