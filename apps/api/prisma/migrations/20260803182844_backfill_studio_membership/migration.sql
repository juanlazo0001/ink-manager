-- Hand-authored data migration (not schema-diff-generated) -- creates a
-- real HOME StudioMembership row for every existing Artist, pointed at
-- their current studio (reached via Artist.userId -> User.studioId, same
-- join 20260725153000_backfill_inquiry_service already used for the
-- identical "Artist has no direct studioId column" reason). Written as
-- real committed SQL that runs automatically via `prisma migrate deploy`
-- in production (not a throwaway script run only against dev), per the
-- discipline established after the referral-migration production outage --
-- see 20260723201202_referral_code_required's own comment for that
-- incident.
--
-- Judgment call, flagged explicitly (see REPORT.md, Part 2): every
-- backfilled row gets allowsStudioProfileEdits = true, NOT the schema's
-- own default of false. This is deliberate, not an oversight -- studio
-- staff have always been able to edit their artists' portfolio/bio/flash
-- gallery (there was no consent concept before this phase), so backfilling
-- to false would silently revoke a capability every existing studio
-- already relies on the instant Part 4's enforcement ships, with no studio
-- owner or artist having done anything to cause that change. Grandfathering
-- to true preserves today's exact behavior; the schema's own
-- @default(false) still governs every NEW membership row created after
-- this migration (a fresh solo-studio artist, or a future Phase 2 GUEST
-- row), matching the task's explicit "off by default, must be granted"
-- instruction for anything genuinely new.
--
-- Idempotent (guarded by WHERE NOT EXISTS), safe to re-run against a
-- partially-migrated database.

INSERT INTO "StudioMembership" ("id", "studioId", "artistId", "type", "allowsStudioProfileEdits", "createdAt")
SELECT
  substr(md5(random()::text || a."id" || clock_timestamp()::text), 1, 25),
  u."studioId",
  a."id",
  'HOME',
  true,
  now()
FROM "Artist" a
JOIN "User" u ON u."id" = a."userId"
WHERE NOT EXISTS (
  SELECT 1 FROM "StudioMembership" sm WHERE sm."artistId" = a."id" AND sm."type" = 'HOME'
);

-- Loud, specific failure instead of silently proceeding -- names the actual
-- remaining count rather than leaving a silent gap for Part 3/4's new
-- capabilities (solo-detection, delegation enforcement) to quietly treat
-- as "not a member of any studio."
DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM "Artist" a
  WHERE NOT EXISTS (SELECT 1 FROM "StudioMembership" sm WHERE sm."artistId" = a."id" AND sm."type" = 'HOME');
  IF remaining > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % Artist row(s) still have no HOME StudioMembership', remaining;
  END IF;
END $$;
