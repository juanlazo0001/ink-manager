-- Hand-authored data migration (not schema-diff-generated) -- backfills the
-- new Service/ArtistService/Inquiry.serviceId relationships for every
-- studio that predates the multi-service-line feature: one "Tattoo" Service
-- per studio (RANGE pricing, TIER_BASED deposit, requiresCandidacyReview
-- false -- exactly the pre-existing tattoo-only behavior, just modeled
-- explicitly now), every existing Inquiry re-pointed at its own studio's
-- new Tattoo service, and every existing Artist tagged as offering it (the
-- only service any artist could have offered before this feature existed).
-- Written as real committed SQL that runs automatically via
-- `prisma migrate deploy` in production (not a throwaway script run only
-- against dev), per the discipline established after the referral-migration
-- production outage -- see 20260723201202_referral_code_required's own
-- comment for that incident, and 20260724214543_backfill_intake_forms for
-- the most recent precedent this migration mirrors.
--
-- Every statement below is idempotent (guarded by WHERE NOT EXISTS /
-- WHERE ... IS NULL), safe to re-run against a partially-migrated database.

-- Defensive only: a studio with zero IntakeForm rows at all (possible only
-- if it was created and never had its public intake form or POST /inquiries
-- hit even once, since IntakeForm otherwise self-heals on read via
-- ensureDefaultIntakeForm -- see lib/intakeForms.ts) gets the exact same
-- one-time default form the original multi-forms migration gave every
-- other studio, so the Tattoo service backfill below always has a form to
-- point at.
INSERT INTO "IntakeForm" ("id", "studioId", "name", "slug", "isDefault", "createdAt", "updatedAt")
SELECT
  substr(md5(random()::text || s."id" || clock_timestamp()::text), 1, 25),
  s."id",
  'Standard Inquiry',
  'standard-inquiry',
  true,
  now(),
  now()
FROM "Studio" s
WHERE NOT EXISTS (SELECT 1 FROM "IntakeForm" f WHERE f."studioId" = s."id");

-- One "Tattoo" Service per studio that doesn't already have one, linked to
-- that studio's current default IntakeForm. Each studio's own single
-- "tattoo" slug needs no collision-avoidance suffix (uniqueness is
-- per-studio, and this is the first service that studio has).
INSERT INTO "Service" (
  "id", "studioId", "name", "slug", "pricingModel", "depositModel",
  "requiresCandidacyReview", "isActive", "intakeFormId", "createdAt", "updatedAt"
)
SELECT
  substr(md5(random()::text || s."id" || clock_timestamp()::text), 1, 25),
  s."id",
  'Tattoo',
  'tattoo',
  'RANGE',
  'TIER_BASED',
  false,
  true,
  f."id",
  now(),
  now()
FROM "Studio" s
JOIN "IntakeForm" f ON f."studioId" = s."id" AND f."isDefault" = true
WHERE NOT EXISTS (SELECT 1 FROM "Service" sv WHERE sv."studioId" = s."id" AND sv."slug" = 'tattoo');

-- Every existing Inquiry re-pointed at its own studio's new Tattoo service.
UPDATE "Inquiry" AS inquiry
SET "serviceId" = service."id"
FROM "Service" AS service
WHERE service."studioId" = inquiry."studioId"
  AND service."slug" = 'tattoo'
  AND inquiry."serviceId" IS NULL;

-- Every existing Artist tagged as offering their studio's Tattoo service --
-- Artist has no direct studioId column (unlike most other studio-scoped
-- models in this schema), so its studio is reached through
-- Artist.userId -> User.studioId.
INSERT INTO "ArtistService" ("id", "artistId", "serviceId", "createdAt")
SELECT
  substr(md5(random()::text || a."id" || clock_timestamp()::text), 1, 25),
  a."id",
  service."id",
  now()
FROM "Artist" a
JOIN "User" u ON u."id" = a."userId"
JOIN "Service" service ON service."studioId" = u."studioId" AND service."slug" = 'tattoo'
WHERE NOT EXISTS (
  SELECT 1 FROM "ArtistService" existing
  WHERE existing."artistId" = a."id" AND existing."serviceId" = service."id"
);

-- Loud, specific failure instead of silently proceeding -- the next
-- migration's ALTER COLUMN SET NOT NULL would fail anyway if any row were
-- still unbackfilled, but this names the actual remaining count rather
-- than a generic constraint-violation error.
DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining FROM "Inquiry" WHERE "serviceId" IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % Inquiry row(s) still have a NULL serviceId', remaining;
  END IF;
END $$;
