-- Per-user conversation state: pin and mute.
--
-- Purely additive: one new table, no column added to and no row touched on
-- any existing one. Safe to apply to a live database under traffic, and
-- needs no backfill -- an absent row IS the default state (unpinned,
-- unmuted), which is what every existing conversation already effectively
-- has. Every read below is null-safe for exactly that reason.

-- CreateTable
CREATE TABLE "UserConversationState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "mutedUntil" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserConversationState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserConversationState_conversationId_idx" ON "UserConversationState"("conversationId");

-- CreateIndex
CREATE INDEX "UserConversationState_userId_isPinned_idx" ON "UserConversationState"("userId", "isPinned");

-- CreateIndex
CREATE UNIQUE INDEX "UserConversationState_userId_conversationId_key" ON "UserConversationState"("userId", "conversationId");

-- AddForeignKey
ALTER TABLE "UserConversationState" ADD CONSTRAINT "UserConversationState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConversationState" ADD CONSTRAINT "UserConversationState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
