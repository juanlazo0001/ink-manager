// The scheduler must not start outside production unless told to.
//
// ─── WHAT THIS IS PROTECTING ────────────────────────────────────────
//
// `startScheduler()` registers a 15-minute reminder ticker that calls
// `sendClientSms`. Before session BD it ran at every boot in every
// environment, so a developer running the API against the dev database
// had a live path to texting real phone numbers on a timer. `SMS_DRY_RUN`
// was the mitigation, and it is one forgotten variable away from sending.
//
// ─── HOW THIS TEST IS BUILT TO FAIL ─────────────────────────────────
//
// The failing case is asserted DIRECTLY: `startScheduler` is called with
// a dev-shaped env and the assertion is that it scheduled ZERO jobs. If
// the guard is removed, weakened, or inverted, this test goes red rather
// than quietly passing — a zero-count assertion on its own can pass for
// the wrong reason (nothing registered at all), so it is paired with a
// strict positive sibling: the SAME registry, under a production-shaped
// env, must schedule MORE THAN ZERO. Neither half is meaningful alone;
// together they pin the guard rather than the registry's contents.
//
// Real jobs are registered by importing `../jobs`, so this runs against
// the actual registry rather than a fixture that could drift from it.
//
// No database, no network, no env mutation of the running process: the
// env is passed in as a value, which is the reason `startScheduler` and
// `schedulerEnabled` take one.

import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";

import { listJobs, schedulerEnabled, startScheduler } from "./index";

/** A dev box: NODE_ENV unset, as `tsx watch` leaves it. */
const DEV: NodeJS.ProcessEnv = {};
/** A dev box that someone has pointed at a real database. Still dev. */
const DEV_WITH_DB: NodeJS.ProcessEnv = { DATABASE_URL: "postgres://real/db" };
/** `NODE_ENV=development`, as some tooling sets explicitly. */
const DEV_EXPLICIT: NodeJS.ProcessEnv = { NODE_ENV: "development" };
/** Test runners set this. A test run must never schedule jobs either. */
const TEST_ENV: NodeJS.ProcessEnv = { NODE_ENV: "test" };
const PROD: NodeJS.ProcessEnv = { NODE_ENV: "production" };

test("the registry actually has jobs in it — the control for every zero below", () => {
  // Without this, "scheduled 0 jobs" would be satisfied by an empty
  // registry and every assertion in this file would be vacuous.
  assert.ok(listJobs().length > 0, "expected the job registry to be non-empty");
});

test("scheduler does NOT start under a dev-shaped env", () => {
  for (const [label, env] of [
    ["NODE_ENV unset", DEV],
    ["NODE_ENV unset, DATABASE_URL set", DEV_WITH_DB],
    ["NODE_ENV=development", DEV_EXPLICIT],
    ["NODE_ENV=test", TEST_ENV],
  ] as const) {
    assert.equal(schedulerEnabled(env), false, `${label}: expected disabled`);
    assert.equal(startScheduler(env).length, 0, `${label}: expected 0 jobs scheduled`);
  }
});

test("scheduler DOES start under a production-shaped env", () => {
  // The strict positive sibling. If this ever fails, the guard has been
  // made too tight and production has silently lost its reminders.
  assert.equal(schedulerEnabled(PROD), true);
  const tasks = startScheduler(PROD);
  assert.ok(tasks.length > 0, "expected production to schedule at least one job");
  // Stop them, or the registered timers keep the event loop alive and the
  // runner never exits. This is the reason startScheduler returns handles.
  for (const task of tasks) task.stop();
});

test("ENABLE_SCHEDULER overrides NODE_ENV in both directions", () => {
  // On in dev — a staging box or a dedicated worker.
  assert.equal(schedulerEnabled({ ENABLE_SCHEDULER: "true" }), true);
  assert.equal(schedulerEnabled({ ENABLE_SCHEDULER: "1" }), true);

  // Off in production — a second HTTP replica that must not double every
  // scheduled job. This direction is why the override is not just a
  // dev-only escape hatch.
  assert.equal(
    schedulerEnabled({ NODE_ENV: "production", ENABLE_SCHEDULER: "false" }),
    false,
  );
  assert.equal(
    schedulerEnabled({ NODE_ENV: "production", ENABLE_SCHEDULER: "0" }),
    false,
  );
  assert.equal(
    startScheduler({ NODE_ENV: "production", ENABLE_SCHEDULER: "false" }).length,
    0,
  );
});

test("a malformed ENABLE_SCHEDULER falls through to NODE_ENV rather than enabling", () => {
  // "yes" is not one of the accepted values. The safe reading of an
  // unrecognised value is "you did not say", not "you said on".
  assert.equal(schedulerEnabled({ ENABLE_SCHEDULER: "yes" }), false);
  assert.equal(schedulerEnabled({ ENABLE_SCHEDULER: "" }), false);
  assert.equal(schedulerEnabled({ NODE_ENV: "production", ENABLE_SCHEDULER: "yes" }), true);
});
