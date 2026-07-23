-- DropForeignKey
ALTER TABLE "ConsentForm" DROP CONSTRAINT "ConsentForm_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "ConsentForm" DROP CONSTRAINT "ConsentForm_clientId_fkey";

-- DropTable
DROP TABLE "ConsentForm";

