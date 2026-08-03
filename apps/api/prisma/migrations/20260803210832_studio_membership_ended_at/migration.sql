-- DropIndex
DROP INDEX "StudioMembership_studioId_artistId_key";

-- AlterTable
ALTER TABLE "StudioMembership" ADD COLUMN     "endedAt" TIMESTAMP(3);

-- Partial unique indexes, hand-authored: Prisma's schema DSL has no WHERE
-- clause, so these can't be expressed as `@@unique` (see the model's own
-- comment in schema.prisma). At most one ACTIVE membership per
-- (studio, artist) pair -- rejoining a studio after leaving is allowed
-- (the old row stays, ended, as history; a fresh row is inserted for the
-- new stint).
CREATE UNIQUE INDEX "StudioMembership_studioId_artistId_active_key" ON "StudioMembership"("studioId", "artistId") WHERE "endedAt" IS NULL;

-- At most one ACTIVE HOME per artist, across every studio -- the actual
-- invariant every "go solo" / "change home" transition depends on,
-- enforced by the database rather than left purely application-level.
CREATE UNIQUE INDEX "StudioMembership_artistId_home_active_key" ON "StudioMembership"("artistId") WHERE "type" = 'HOME' AND "endedAt" IS NULL;

