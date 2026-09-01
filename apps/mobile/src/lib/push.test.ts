// Push routing: the pure half, which is the half that can be tested.
//
// Imports `./pushRouting`, not `./push` — the latter pulls in React
// Native and three expo-* modules that the test runner cannot transform.
// That split is the reason this file exists at all; see pushRouting.ts.
//
// ─── WHAT THIS COVERS AND WHAT IT CANNOT ────────────────────────────
//
// COVERED: given the `data` block the API attaches to a push, where does
// the app go. That is a pure function of the payload and the viewer's
// role, and every branch of it is asserted below.
//
// NOT COVERED, and not claimable from this machine: that a push is ever
// delivered. Expo Go has carried no push credentials since SDK 53, so
// receipt requires an EAS development build. `push.ts` says so in its own
// header and `isPushCapable()` makes the app decline to prompt rather
// than prompt for something that cannot work.
//
// ─── THE PAYLOAD IS THE API'S, NOT AN INVENTION ─────────────────────
//
// apps/api/src/lib/notifications.ts builds it as:
//
//     data: { type, entityType, entityId, ...payload }
//
// so the fixtures below are that shape exactly. If the server's shape
// changes, these should be the thing that goes red.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pushRoute } from "./pushRouting";

test("a message push opens the thread", () => {
  const route = pushRoute(
    { type: "MESSAGE_CREATED", entityType: "Conversation", entityId: "c1" },
    "OWNER",
  );
  assert.deepEqual(route, { pathname: "/conversation/[id]", params: { id: "c1" } });
});

test("an inquiry push respects the viewer's role", () => {
  // The staff route is role-gated server-side, so sending an ARTIST there
  // is a guaranteed 403. This is the one branch where getting it wrong
  // produces an error screen rather than a merely odd destination.
  assert.deepEqual(
    pushRoute({ entityType: "Inquiry", entityId: "i1" }, "ARTIST"),
    { pathname: "/inquiry/[id]", params: { id: "i1" } },
  );
  for (const role of ["OWNER", "FRONT_DESK", undefined]) {
    assert.deepEqual(
      pushRoute({ entityType: "Inquiry", entityId: "i1" }, role),
      { pathname: "/staff-inquiry/[id]", params: { id: "i1" } },
      `role=${role}`,
    );
  }
});

test("a task push opens the task list", () => {
  assert.deepEqual(
    pushRoute({ entityType: "PersonalTask", entityId: "t1" }, "OWNER"),
    { pathname: "/tasks" },
  );
});

test("an unroutable payload returns null rather than guessing", () => {
  // The caller opens the app without navigating. A default destination
  // here would send someone to a screen the push was not about.
  assert.equal(pushRoute(null, "OWNER"), null);
  assert.equal(pushRoute(undefined, "OWNER"), null);
  assert.equal(pushRoute({}, "OWNER"), null);
  assert.equal(pushRoute({ entityType: "Inquiry" }, "OWNER"), null, "no id");
  assert.equal(pushRoute({ entityId: "i1" }, "OWNER"), null, "no entityType");
});

test("extra payload keys do not disturb routing", () => {
  // `...payload` means the server can attach anything; routing reads
  // three fields and must ignore the rest rather than falling over.
  assert.deepEqual(
    pushRoute(
      { type: "MESSAGE_CREATED", entityType: "Conversation", entityId: "c1", conversationId: "c1", extra: 1 },
      "OWNER",
    ),
    { pathname: "/conversation/[id]", params: { id: "c1" } },
  );
});
