-- CreateTable
CREATE TABLE "ArtistMembershipInvite" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "membershipType" "StudioMembershipType" NOT NULL,
    "token" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistMembershipInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtistMembershipInvite_token_key" ON "ArtistMembershipInvite"("token");

-- CreateIndex
CREATE INDEX "ArtistMembershipInvite_studioId_idx" ON "ArtistMembershipInvite"("studioId");

-- CreateIndex
CREATE INDEX "ArtistMembershipInvite_email_idx" ON "ArtistMembershipInvite"("email");

-- AddForeignKey
ALTER TABLE "ArtistMembershipInvite" ADD CONSTRAINT "ArtistMembershipInvite_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

