// Unit tests for the A2P sender-precedence rule -- run with
// `npx tsx --test src/lib/twilioSender.test.ts` (or `npm test`). Node's
// built-in runner + assert, matching this codebase's existing
// "no test framework installed" state.
//
// What these guard: routing a send through the studio's Messaging Service
// is what attaches it to the approved A2P campaign, its Sender Pool and
// Advanced Opt-Out. Before this, StudioIntegration.metadata held only a raw
// phoneNumber and every send went out as a bare long code -- so the
// campaign, the pool and the opt-out config simply did not apply. The
// precedence below is the whole fix, and it is shared by the real send path
// (lib/clientSms.ts) and the Settings test-message (routes/integrations.ts),
// which is exactly why it is worth pinning here rather than in either one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTwilioSender, twilioOwnsKeywordReplies } from "./twilio";

test("a configured Messaging Service wins over the raw From number", () => {
  const sender = resolveTwilioSender({
    phoneNumber: "+18508804483",
    messagingServiceSid: "MGe6606bd387959d7a74f4b2f91b9d8b93",
  });

  assert.deepEqual(sender, {
    kind: "messagingService",
    messagingServiceSid: "MGe6606bd387959d7a74f4b2f91b9d8b93",
  });
});

test("the Messaging Service case carries NO from -- Twilio must pick from the Sender Pool", () => {
  const sender = resolveTwilioSender({
    phoneNumber: "+18508804483",
    messagingServiceSid: "MGe6606bd387959d7a74f4b2f91b9d8b93",
  });

  // The point of the discriminated union: passing `from` alongside the
  // service SID would pin the send to that one number and bypass the pool,
  // which defeats most of the reason for having a Messaging Service. There
  // must be no way to spell that.
  assert.equal("from" in sender!, false);
});

test("a studio with no Messaging Service still sends from its bare number (no regression)", () => {
  const sender = resolveTwilioSender({ phoneNumber: "+19195551234" });

  assert.deepEqual(sender, { kind: "number", from: "+19195551234" });
});

test("an all-whitespace Messaging Service SID is treated as absent, not as a sender", () => {
  // A blank field submitted from Settings arrives as "" (and a fat-fingered
  // "  " is the same intent). Trusting it as a SID would hand Twilio an
  // empty messagingServiceSid and drop the send entirely.
  const sender = resolveTwilioSender({ phoneNumber: "+19195551234", messagingServiceSid: "   " });

  assert.deepEqual(sender, { kind: "number", from: "+19195551234" });
});

test("no sender at all when the integration metadata has neither field", () => {
  assert.equal(resolveTwilioSender({}), null);
  assert.equal(resolveTwilioSender(null), null);
  assert.equal(resolveTwilioSender(undefined), null);
  assert.equal(resolveTwilioSender({ phoneNumber: "  " }), null);
});

test("surrounding whitespace is trimmed off both sender kinds", () => {
  assert.deepEqual(resolveTwilioSender({ phoneNumber: " +19195551234 " }), {
    kind: "number",
    from: "+19195551234",
  });
  assert.deepEqual(
    resolveTwilioSender({ phoneNumber: "+18508804483", messagingServiceSid: " MGe6606bd387959d7a74f4b2f91b9d8b93 " }),
    { kind: "messagingService", messagingServiceSid: "MGe6606bd387959d7a74f4b2f91b9d8b93" },
  );
});

// --- Keyword auto-reply suppression -------------------------------------
//
// Observed live during the A2P verification: with a Messaging Service in
// play, texting START landed BOTH Twilio's own opt-in confirmation and the
// app's optInConfirmation template on the handset; HELP did the same. These
// pin which side stands down.

test("Twilio owns the keyword replies when a Messaging Service is configured", () => {
  assert.equal(
    twilioOwnsKeywordReplies({
      phoneNumber: "+18508804483",
      messagingServiceSid: "MGe6606bd387959d7a74f4b2f91b9d8b93",
    }),
    true,
  );
});

test("a studio on a bare From number keeps its own keyword replies", () => {
  // Narrow on purpose: no duplication has been observed without a Messaging
  // Service, and suppressing there could leave a keyword with NO reply.
  assert.equal(twilioOwnsKeywordReplies({ phoneNumber: "+19195551234" }), false);
});

test("a blank or whitespace Messaging Service SID does not suppress our replies", () => {
  // Same trap resolveTwilioSender guards: a blank field submitted from
  // Settings arrives as "". Treating it as a configured service would
  // silence the only reply the client would get.
  assert.equal(twilioOwnsKeywordReplies({ phoneNumber: "+19195551234", messagingServiceSid: "" }), false);
  assert.equal(twilioOwnsKeywordReplies({ phoneNumber: "+19195551234", messagingServiceSid: "   " }), false);
});

test("missing metadata never suppresses", () => {
  assert.equal(twilioOwnsKeywordReplies(null), false);
  assert.equal(twilioOwnsKeywordReplies(undefined), false);
  assert.equal(twilioOwnsKeywordReplies({}), false);
});
