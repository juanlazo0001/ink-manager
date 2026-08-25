// Unit tests for the post-add SMS consent eligibility gate -- run with
// `npx tsx --test src/lib/smsConsent.test.ts` (or `npm test`).
//
// This gate is the single point BOTH new consent paths funnel through
// (staff-recorded in routes/clients.ts, and the client's own self-serve
// link in routes/smsConsent.ts), so a mistake here is a mistake in both at
// once. The opted-out case in particular is a compliance rule, not a
// preference: see checkConsentEligibility's own comment on why staff must
// not be able to walk back a client's STOP.

import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConsentEligibility, resolveClientPhone } from "./smsConsent";

const PHONE = { phone: "9195551234", phones: [] };

test("a client with a phone and no consent yet is eligible", () => {
  const result = checkConsentEligibility({ ...PHONE, smsConsentGivenAt: null, smsOptedOutAt: null });
  assert.deepEqual(result, { ok: true });
});

test("a client with NO phone anywhere is refused -- consent to text an unreachable client is meaningless", () => {
  const result = checkConsentEligibility({
    phone: null,
    phones: [],
    smsConsentGivenAt: null,
    smsOptedOutAt: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "no_phone");
});

test("an opted-out client is REFUSED, even by staff -- only the client can undo a STOP", () => {
  const result = checkConsentEligibility({
    ...PHONE,
    smsConsentGivenAt: null,
    smsOptedOutAt: new Date("2026-08-01T00:00:00Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "opted_out");
  // The refusal has to actually tell staff what to do instead, or it just
  // reads as a bug to whoever hits it at the counter.
  assert.match(result.ok === false ? result.error : "", /START/);
});

test("opted-out beats already-consented: a client who consented THEN opted out is still refused", () => {
  // Ordering matters -- checking "already given" first would return a
  // cheerful already_given for someone who has actively opted out, and a
  // caller treating that as success would resume texting them.
  const result = checkConsentEligibility({
    ...PHONE,
    smsConsentGivenAt: new Date("2026-07-01T00:00:00Z"),
    smsOptedOutAt: new Date("2026-08-01T00:00:00Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "opted_out");
});

test("an already-consented client reports already_given, not a fresh grant", () => {
  const result = checkConsentEligibility({
    ...PHONE,
    smsConsentGivenAt: new Date("2026-07-01T00:00:00Z"),
    smsOptedOutAt: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "already_given");
});

test("no_phone is checked before opted_out, so a phoneless client never gets the START advice", () => {
  const result = checkConsentEligibility({
    phone: null,
    phones: [],
    smsConsentGivenAt: null,
    smsOptedOutAt: new Date("2026-08-01T00:00:00Z"),
  });
  assert.equal(result.ok === false && result.code, "no_phone");
});

test("resolveClientPhone falls back to the real phone rows when the legacy scalar drifted null", () => {
  // The exact drift lib/clientSms.ts documents: a client with a phone
  // visible in the UI but a null Client.phone scalar must still be
  // eligible, or consent is refused for someone who plainly has a number.
  assert.equal(resolveClientPhone({ phone: null, phones: [{ phone: "9195551234" }] }), "9195551234");
  assert.equal(resolveClientPhone({ phone: "9195559999", phones: [{ phone: "9195551234" }] }), "9195559999");
  assert.equal(resolveClientPhone({ phone: null, phones: [] }), null);
  assert.equal(resolveClientPhone({ phone: null }), null);

  const eligible = checkConsentEligibility({
    phone: null,
    phones: [{ phone: "9195551234" }],
    smsConsentGivenAt: null,
    smsOptedOutAt: null,
  });
  assert.deepEqual(eligible, { ok: true });
});
