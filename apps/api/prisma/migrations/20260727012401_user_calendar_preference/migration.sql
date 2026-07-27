-- CreateTable
CREATE TABLE "UserCalendarPreference" (
    "id" TEXT NOT NULL,
    "view" TEXT NOT NULL DEFAULT 'month',
    "selectedArtistIds" JSONB,
    "selectedLocationId" TEXT,
    "includePastGuests" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserCalendarPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCalendarPreference_userId_key" ON "UserCalendarPreference"("userId");

-- AddForeignKey
ALTER TABLE "UserCalendarPreference" ADD CONSTRAINT "UserCalendarPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
