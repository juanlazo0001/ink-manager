-- Hand-authored data migration (not schema-diff-generated) -- backfills
-- GiftCard.paymentMethod for every existing row where the actual payment
-- method is genuinely knowable from data that already exists elsewhere.
-- Written as real committed SQL that runs automatically via
-- `prisma migrate deploy` in production, per this project's own established
-- discipline for backfills (see 20260725153000_backfill_inquiry_service's
-- own comment for the precedent/incident this convention comes from).
-- Every statement is idempotent (guarded by "paymentMethod" IS NULL), safe
-- to re-run against a partially-migrated database.
--
-- Deliberately does NOT attempt to backfill every row -- see
-- GiftCardPaymentMethod's own schema comment for why the column stays
-- nullable permanently. Rows this migration cannot honestly resolve (the
-- bulk client-import gift-card backfill, and checkout's multi-card-overage
-- derivation when more than one origin card combines) are left NULL on
-- purpose, not an oversight.

-- EXEMPT-status cards: the status itself already says how they were
-- "paid" (they weren't, deliberately, by an OWNER override) -- same value
-- either way you look at it.
UPDATE "GiftCard"
SET "paymentMethod" = 'EXEMPT'
WHERE "status" = 'EXEMPT' AND "paymentMethod" IS NULL;

-- Cards issued for a paid deposit: DepositForm.paidVia ('STRIPE' or
-- 'MANUAL', a pre-existing free-text field) already records exactly which
-- of the two real payment paths was used. 'MANUAL' maps to 'CASH' -- the
-- only manual/non-Stripe payment concept this app has ever had is staff
-- confirming an in-person payment was actually collected.
UPDATE "GiftCard" AS gc
SET "paymentMethod" = 'STRIPE'
FROM "DepositForm" AS df
WHERE df."giftCardId" = gc."id"
  AND df."paidVia" = 'STRIPE'
  AND gc."paymentMethod" IS NULL;

UPDATE "GiftCard" AS gc
SET "paymentMethod" = 'CASH'
FROM "DepositForm" AS df
WHERE df."giftCardId" = gc."id"
  AND df."paidVia" = 'MANUAL'
  AND gc."paymentMethod" IS NULL;
