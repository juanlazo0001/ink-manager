// A rate-limited sign-in must not be reported as a network problem.
//
// ─── THE BUG THIS PINS ──────────────────────────────────────────────
//
// `apps/mobile/src/lib/api.ts` decides `fromApi` by testing
// `typeof body.error === "string"`. express-rate-limit's DEFAULT 429 body
// is PLAIN TEXT, so a rate-limited request arrived with `fromApi: false`
// and fell into the "can't reach the server" branch — the app told the
// user to check their connection while the server was working perfectly
// and deliberately refusing them.
//
// Session BG makes the API answer with JSON, so the common path is now a
// real sentence. This file asserts BOTH: the JSON path passes the
// server's own words through, and the plain-text path — which a proxy,
// an edge, or the next limiter someone adds can still produce — says
// something true instead of blaming the network.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "./api";
import { loginErrorMessage } from "./loginError";

test("a JSON 429 shows the server's own sentence", () => {
  const err = new ApiError("Too many attempts. Try again in about 15 minutes.", 429, "rate_limited", true);
  assert.equal(loginErrorMessage(err), "Too many attempts. Try again in about 15 minutes.");
});

test("a PLAIN-TEXT 429 still reads as a rate limit, not an outage", () => {
  // fromApi: false — exactly the shape that produced the bug.
  const err = new ApiError("Too many requests, please try again later.", 429, undefined, false);
  const message = loginErrorMessage(err);
  assert.match(message, /too many attempts/i);
  assert.doesNotMatch(
    message,
    /can't reach|connection/i,
    "a 429 must never be reported as a connectivity problem",
  );
});

test("a genuine connectivity failure still says so — the positive sibling", () => {
  // Without this, the 429 branch above could be satisfied by a mapper
  // that had simply stopped producing the network message at all.
  const err = new ApiError("Can't reach Ink Manager.", 0, undefined, false);
  assert.match(loginErrorMessage(err), /can't reach/i);
});

test("a bad password is still a bad password", () => {
  const err = new ApiError("invalid credentials", 401, undefined, true);
  assert.equal(loginErrorMessage(err), "Email or password is incorrect.");
});

test("the other 401s pass through as written", () => {
  // Deactivated accounts, pending invites and unverified emails are all
  // real sentences from the API and must not be flattened into the
  // generic credentials message.
  const err = new ApiError("This account has been deactivated. Contact your studio owner.", 401, undefined, true);
  assert.equal(loginErrorMessage(err), "This account has been deactivated. Contact your studio owner.");
});
