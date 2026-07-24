-- DropForeignKey
ALTER TABLE "AppointmentPhoto" DROP CONSTRAINT "AppointmentPhoto_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "ConversationTag" DROP CONSTRAINT "ConversationTag_createdById_fkey";

-- DropForeignKey
ALTER TABLE "GiftCard" DROP CONSTRAINT "GiftCard_issuedById_fkey";

-- DropForeignKey
ALTER TABLE "InquiryNote" DROP CONSTRAINT "InquiryNote_authorId_fkey";

-- DropForeignKey
ALTER TABLE "PersonalTask" DROP CONSTRAINT "PersonalTask_createdById_fkey";

-- AlterTable
ALTER TABLE "AppointmentPhoto" ALTER COLUMN "uploadedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ConversationTag" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "GiftCard" ALTER COLUMN "issuedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InquiryNote" ALTER COLUMN "authorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PersonalTask" ALTER COLUMN "createdById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AppointmentPhoto" ADD CONSTRAINT "AppointmentPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryNote" ADD CONSTRAINT "InquiryNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTag" ADD CONSTRAINT "ConversationTag_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTask" ADD CONSTRAINT "PersonalTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
