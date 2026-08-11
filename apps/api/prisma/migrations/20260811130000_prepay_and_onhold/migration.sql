-- CreateEnum
CREATE TYPE "DepositAmountMode" AS ENUM ('DEPOSIT', 'FULL_PREPAY');

-- AlterEnum
ALTER TYPE "InquiryStatus" ADD VALUE 'ON_HOLD';

-- AlterTable
ALTER TABLE "DepositForm" ADD COLUMN     "amountMode" "DepositAmountMode" NOT NULL DEFAULT 'DEPOSIT';

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "heldAt" TIMESTAMP(3),
ADD COLUMN     "holdReason" TEXT,
ADD COLUMN     "statusBeforeHold" "InquiryStatus";

-- AlterTable
ALTER TABLE "StudioSettings" ADD COLUMN     "defaultDepositAmountMode" "DepositAmountMode" NOT NULL DEFAULT 'DEPOSIT';
