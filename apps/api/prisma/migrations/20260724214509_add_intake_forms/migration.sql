-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "intakeFormId" TEXT;

-- AlterTable
ALTER TABLE "IntakeFormField" ADD COLUMN     "intakeFormId" TEXT;

-- CreateTable
CREATE TABLE "IntakeForm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "IntakeForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntakeForm_studioId_idx" ON "IntakeForm"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeForm_studioId_slug_key" ON "IntakeForm"("studioId", "slug");

-- CreateIndex
CREATE INDEX "IntakeFormField_intakeFormId_order_idx" ON "IntakeFormField"("intakeFormId", "order");

-- AddForeignKey
ALTER TABLE "IntakeForm" ADD CONSTRAINT "IntakeForm_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeFormField" ADD CONSTRAINT "IntakeFormField_intakeFormId_fkey" FOREIGN KEY ("intakeFormId") REFERENCES "IntakeForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_intakeFormId_fkey" FOREIGN KEY ("intakeFormId") REFERENCES "IntakeForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
