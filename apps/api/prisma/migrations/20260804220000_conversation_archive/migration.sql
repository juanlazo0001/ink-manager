-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_studioId_archivedAt_idx" ON "Conversation"("studioId", "archivedAt");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
