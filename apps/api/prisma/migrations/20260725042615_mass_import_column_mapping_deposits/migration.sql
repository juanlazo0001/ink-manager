-- CreateEnum
CREATE TYPE "ImportRowDepositDecision" AS ENUM ('IMPORT', 'SKIP', 'EDIT');

-- AlterEnum
ALTER TYPE "ImportBatchStatus" ADD VALUE 'MAPPING';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "address" TEXT;

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "columnMapping" JSONB,
ALTER COLUMN "status" SET DEFAULT 'MAPPING';

-- AlterTable
ALTER TABLE "ImportRow" ADD COLUMN     "depositDecision" "ImportRowDepositDecision",
ADD COLUMN     "depositFlaggedAsOutlier" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parsedDepositCents" INTEGER;
