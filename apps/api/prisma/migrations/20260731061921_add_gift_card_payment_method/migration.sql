-- CreateEnum
CREATE TYPE "GiftCardPaymentMethod" AS ENUM ('STRIPE', 'CASH', 'EXEMPT');

-- AlterTable
ALTER TABLE "GiftCard" ADD COLUMN     "paymentMethod" "GiftCardPaymentMethod";
