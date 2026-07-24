-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "placementImagesMeta" JSONB,
ADD COLUMN     "referenceImagesMeta" JSONB;

-- CreateTable
CREATE TABLE "UserWidgetLayout" (
    "id" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "widgetOrder" JSONB NOT NULL,
    "collapsedWidgetIds" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserWidgetLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserWidgetLayout_userId_pageKey_key" ON "UserWidgetLayout"("userId", "pageKey");

-- AddForeignKey
ALTER TABLE "UserWidgetLayout" ADD CONSTRAINT "UserWidgetLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
