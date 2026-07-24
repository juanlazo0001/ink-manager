-- Hand-authored data migration (not schema-diff-generated) -- backfills
-- the new IntakeForm/IntakeFormField.intakeFormId relationship for every
-- studio that predates the multiple-named-forms feature: one default
-- "Standard Inquiry" form per studio, then every existing IntakeFormField
-- row re-pointed at its own studio's new form. Written as real committed
-- SQL that runs automatically via `prisma migrate deploy` in production
-- (not a throwaway script run only against dev), per the discipline
-- established after the referral-migration production outage -- see
-- 20260723201202_referral_code_required's own comment for that incident.
--
-- Both statements below are idempotent (guarded by WHERE NOT EXISTS /
-- WHERE ... IS NULL), safe to re-run against a partially-migrated database.

-- One default form per studio that doesn't already have one. Each
-- studio's own single form needs no collision-avoidance suffix on its
-- slug (uniqueness is per-studio, and this is the only form that studio
-- has at this point) -- id generated the same md5-derived-string technique
-- the referral hotfix migration already used for a one-time SQL-only
-- backfill (no pgcrypto/uuid extension dependency).
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

-- Every existing field re-pointed at its own studio's new default form.
UPDATE "IntakeFormField" AS field
SET "intakeFormId" = form."id"
FROM "IntakeForm" AS form
WHERE form."studioId" = field."studioId"
  AND form."isDefault" = true
  AND field."intakeFormId" IS NULL;

-- Loud, specific failure instead of silently proceeding -- the next
-- migration's ALTER COLUMN SET NOT NULL would fail anyway if any row were
-- still unbackfilled, but this names the actual remaining count rather
-- than a generic constraint-violation error.
DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining FROM "IntakeFormField" WHERE "intakeFormId" IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % IntakeFormField row(s) still have a NULL intakeFormId', remaining;
  END IF;
END $$;
