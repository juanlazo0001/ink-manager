-- CreateTable
CREATE TABLE "PrefillDraft" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studioId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "conversationId" TEXT,

    CONSTRAINT "PrefillDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrefillDraft_token_key" ON "PrefillDraft"("token");

-- CreateIndex
CREATE INDEX "PrefillDraft_studioId_idx" ON "PrefillDraft"("studioId");

-- AddForeignKey
ALTER TABLE "PrefillDraft" ADD CONSTRAINT "PrefillDraft_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrefillDraft" ADD CONSTRAINT "PrefillDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrefillDraft" ADD CONSTRAINT "PrefillDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
