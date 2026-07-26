-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "flatRateCents" INTEGER,
ADD COLUMN     "hourlyRateCents" INTEGER;

-- AlterTable
ALTER TABLE "PlannedSession" ADD COLUMN     "estimatedPriceHigh" DOUBLE PRECISION,
ADD COLUMN     "estimatedPriceLow" DOUBLE PRECISION;
