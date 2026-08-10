-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "preferredLocale" TEXT;

-- AlterTable
ALTER TABLE "DepositForm" ADD COLUMN     "signedLocale" TEXT,
ADD COLUMN     "termsSnapshot" JSONB;

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "signedLocale" TEXT;

-- AlterTable
ALTER TABLE "LiabilityWaiver" ADD COLUMN     "signedLocale" TEXT;

-- AlterTable
ALTER TABLE "StudioSettings" ADD COLUMN     "defaultLocale" TEXT NOT NULL DEFAULT 'en';

-- CreateTable
CREATE TABLE "FlashPieceTranslation" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "flashPieceId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "FlashPieceTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTranslation" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT,
    "depositBreakdownNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "serviceId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "ServiceTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeFormFieldTranslation" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "label" TEXT,
    "helpText" TEXT,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "intakeFormFieldId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "IntakeFormFieldTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioSettingsTranslation" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "refundPolicy" TEXT,
    "depositPolicy" TEXT,
    "reschedulePolicy" TEXT,
    "communicationPolicy" TEXT,
    "estimateTerms" TEXT,
    "waiverHealthQuestions" JSONB,
    "waiverClauses" JSONB,
    "waiverAcknowledgment" TEXT,
    "waiverPhotoRelease" TEXT,
    "privacyPolicy" TEXT,
    "termsAndConditions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studioSettingsId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "StudioSettingsTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomPolicyTranslation" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT,
    "bodyHtml" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customPolicyId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "CustomPolicyTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlashPieceTranslation_studioId_locale_idx" ON "FlashPieceTranslation"("studioId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "FlashPieceTranslation_flashPieceId_locale_key" ON "FlashPieceTranslation"("flashPieceId", "locale");

-- CreateIndex
CREATE INDEX "ServiceTranslation_studioId_locale_idx" ON "ServiceTranslation"("studioId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTranslation_serviceId_locale_key" ON "ServiceTranslation"("serviceId", "locale");

-- CreateIndex
CREATE INDEX "IntakeFormFieldTranslation_studioId_locale_idx" ON "IntakeFormFieldTranslation"("studioId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeFormFieldTranslation_intakeFormFieldId_locale_key" ON "IntakeFormFieldTranslation"("intakeFormFieldId", "locale");

-- CreateIndex
CREATE INDEX "StudioSettingsTranslation_studioId_locale_idx" ON "StudioSettingsTranslation"("studioId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "StudioSettingsTranslation_studioSettingsId_locale_key" ON "StudioSettingsTranslation"("studioSettingsId", "locale");

-- CreateIndex
CREATE INDEX "CustomPolicyTranslation_studioId_locale_idx" ON "CustomPolicyTranslation"("studioId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "CustomPolicyTranslation_customPolicyId_locale_key" ON "CustomPolicyTranslation"("customPolicyId", "locale");

-- AddForeignKey
ALTER TABLE "FlashPieceTranslation" ADD CONSTRAINT "FlashPieceTranslation_flashPieceId_fkey" FOREIGN KEY ("flashPieceId") REFERENCES "FlashPiece"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashPieceTranslation" ADD CONSTRAINT "FlashPieceTranslation_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTranslation" ADD CONSTRAINT "ServiceTranslation_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTranslation" ADD CONSTRAINT "ServiceTranslation_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeFormFieldTranslation" ADD CONSTRAINT "IntakeFormFieldTranslation_intakeFormFieldId_fkey" FOREIGN KEY ("intakeFormFieldId") REFERENCES "IntakeFormField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeFormFieldTranslation" ADD CONSTRAINT "IntakeFormFieldTranslation_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioSettingsTranslation" ADD CONSTRAINT "StudioSettingsTranslation_studioSettingsId_fkey" FOREIGN KEY ("studioSettingsId") REFERENCES "StudioSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioSettingsTranslation" ADD CONSTRAINT "StudioSettingsTranslation_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPolicyTranslation" ADD CONSTRAINT "CustomPolicyTranslation_customPolicyId_fkey" FOREIGN KEY ("customPolicyId") REFERENCES "CustomPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPolicyTranslation" ADD CONSTRAINT "CustomPolicyTranslation_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

