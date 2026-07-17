-- CreateTable
CREATE TABLE "TaskDismissal" (
    "id" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studioId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TaskDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studioId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PersonalTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionSeen" (
    "id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studioId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SectionSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskDismissal_studioId_idx" ON "TaskDismissal"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDismissal_userId_taskType_entityId_key" ON "TaskDismissal"("userId", "taskType", "entityId");

-- CreateIndex
CREATE INDEX "PersonalTask_studioId_idx" ON "PersonalTask"("studioId");

-- CreateIndex
CREATE INDEX "PersonalTask_userId_idx" ON "PersonalTask"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SectionSeen_userId_section_key" ON "SectionSeen"("userId", "section");

-- CreateIndex
CREATE INDEX "Appointment_studioId_createdAt_idx" ON "Appointment"("studioId", "createdAt");

-- CreateIndex
CREATE INDEX "Appointment_artistId_createdAt_idx" ON "Appointment"("artistId", "createdAt");

-- CreateIndex
CREATE INDEX "Client_studioId_createdAt_idx" ON "Client"("studioId", "createdAt");

-- CreateIndex
CREATE INDEX "Inquiry_studioId_createdAt_idx" ON "Inquiry"("studioId", "createdAt");

-- CreateIndex
CREATE INDEX "Inquiry_assignedArtistId_createdAt_idx" ON "Inquiry"("assignedArtistId", "createdAt");

-- AddForeignKey
ALTER TABLE "TaskDismissal" ADD CONSTRAINT "TaskDismissal_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDismissal" ADD CONSTRAINT "TaskDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTask" ADD CONSTRAINT "PersonalTask_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTask" ADD CONSTRAINT "PersonalTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionSeen" ADD CONSTRAINT "SectionSeen_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionSeen" ADD CONSTRAINT "SectionSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
