// The limiter counts ACROSS PROCESSES, which is the only thing that
// matters about moving it off MemoryStore.
//
// ─── WHY THIS SPAWNS TWO REAL PROCESSES ─────────────────────────────
//
// A single-process assertion cannot tell a shared store from a private
// one: MemoryStore passes every such test perfectly, which is exactly how
// this defect survived. Two Express apps inside ONE node process would be
// no better — they would share a MemoryStore too, and the test would pass
// against the very implementation it is supposed to reject.
//
// So this boots two genuine `tsx src/index.ts` processes on different
// ports and alternates requests between them. Under MemoryStore each has
// its own counter and the shared limit is never reached; under the
// Postgres store they share one.
//
// ─── HOW IT IS BUILT TO FAIL ────────────────────────────────────────
//
// The positive and negative halves are both asserted against the same
// run: attempts up to the limit must be 401 (the limiter is not firing
// early, on either port), and the attempt past it must be 429 (it is
// firing at all). A test that only checked for a 429 somewhere would pass
// against a limiter stuck permanently on.
//
// The 429 is also asserted to arrive on the OTHER process from the one
// that did most of the counting — that is the cross-process claim itself,
// and it is the assertion MemoryStore cannot satisfy.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { Pool } from "pg";

const A_PORT = 4111;
const B_PORT = 4112;
// `__dirname`, not `import.meta.dirname`: this package compiles as CJS
// and tsc rejects import.meta under that module setting.
const API_DIR = path.resolve(__dirname, "..", "..");

/** Unique per run, so the email limiter starts from a clean window. */
const EMAIL = `ratelimit-probe-${Date.now()}@example.test`;
/** From routes/auth.ts. Failures only; the 9th attempt is refused. */
const EMAIL_LIMIT = 8;

let a: ChildProcess;
let b: ChildProcess;
let pool: Pool;

/**
 * Kill whatever holds a port, tree and all.
 *
 * ─── THIS IS NOT HOUSEKEEPING; IT IS THE TEST'S CORRECTNESS ─────────
 *
 * On Windows, `child.kill()` on a `shell: true` spawn kills the SHELL and
 * leaves the node process holding the port. The first version of this
 * file did exactly that, so a later run found the previous run's servers
 * still listening, `waitUntilUp` went green against them immediately, and
 * the test measured BINARIES FROM A PREVIOUS BUILD.
 *
 * That is not a slow-cleanup annoyance. It made the falsifiability check
 * pass: with the Postgres store swapped out for MemoryStore, the suite
 * still went green — because it was still talking to the old
 * Postgres-store servers. A test that cannot fail is worth nothing, and
 * this one could not fail for a reason invisible from its own output.
 */
function killPort(port: number) {
  if (process.platform !== "win32") return;
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
    const pids = new Set(
      out
        .split(/\r?\n/)
        .filter((l) => l.includes("LISTENING"))
        .map((l) => l.trim().split(/\s+/).pop())
        .filter(Boolean) as string[],
    );
    for (const pid of pids) {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
    }
  } catch {
    /* nothing listening */
  }
}

function boot(port: number): ChildProcess {
  return spawn("npx", ["tsx", "src/index.ts"], {
    cwd: API_DIR,
    env: { ...process.env, PORT: String(port), SMS_DRY_RUN: "true", ENABLE_SCHEDULER: "false" },
    stdio: "ignore",
    shell: true,
  });
}

async function waitUntilUp(port: number, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`api on :${port} never became healthy`);
}

async function attempt(port: number) {
  const res = await fetch(`http://localhost:${port}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: "definitely-not-the-password" }),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body: body as { error?: string; code?: string } | null };
}

before(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Before, not only after: a previous run's orphan would otherwise be
  // silently reused. See killPort.
  killPort(A_PORT);
  killPort(B_PORT);

  a = boot(A_PORT);
  b = boot(B_PORT);
  await Promise.all([waitUntilUp(A_PORT), waitUntilUp(B_PORT)]);

  /*
   * ONE WARMUP REQUEST BEFORE CLEARING, and the order is load-bearing.
   *
   * The store creates its `rate_limit` schema lazily, on first USE, not
   * at boot — so on a fresh database the tables do not exist until a
   * limited endpoint has been hit once. Clearing before that point threw
   * `relation "rate_limit.records_aggregated" does not exist` and failed
   * the run for a reason that had nothing to do with the limiter.
   */
  await attempt(A_PORT);

  /*
   * Clear the IP counter. The email key is unique per run and starts
   * empty; the IP key is 127.0.0.1 every time, so without this the
   * second run of this file inside a 15-minute window trips the IP
   * limiter first and reports a cross-process failure that is really its
   * own residue. The warmup request above is cleared along with it.
   */
  await pool.query(
    `DELETE FROM rate_limit.records_aggregated
      WHERE session_id IN (SELECT id FROM rate_limit.sessions WHERE name_ LIKE 'login-%')`,
  );
});

after(async () => {
  a?.kill();
  b?.kill();
  killPort(A_PORT);
  killPort(B_PORT);
  await pool?.end();
});

test("two processes share one login counter", async () => {
  const seen: Array<{ port: number; status: number }> = [];

  // Alternate. Neither process sees more than half the attempts, so
  // neither could reach the limit on its own.
  for (let i = 0; i < EMAIL_LIMIT; i += 1) {
    const port = i % 2 === 0 ? A_PORT : B_PORT;
    const { status } = await attempt(port);
    seen.push({ port, status });
  }

  const perPort = seen.reduce<Record<number, number>>((acc, s) => {
    acc[s.port] = (acc[s.port] ?? 0) + 1;
    return acc;
  }, {});
  assert.ok(
    Math.max(...Object.values(perPort)) < EMAIL_LIMIT,
    `neither process should have seen ${EMAIL_LIMIT} attempts on its own; saw ${JSON.stringify(perPort)}`,
  );

  // POSITIVE SIBLING: every attempt up to the limit was answered on its
  // merits, not refused. A limiter stuck on would fail here.
  assert.deepEqual(
    [...new Set(seen.map((s) => s.status))],
    [401],
    `expected every attempt up to the limit to be 401; got ${JSON.stringify(seen)}`,
  );

  // THE CLAIM: the next attempt is refused, on the process that has
  // counted the FEWER of the two. Under MemoryStore this is a 401.
  const next = await attempt(B_PORT);
  assert.equal(
    next.status,
    429,
    "the attempt past the shared limit must be refused by the other process — " +
      "a 401 here means each process is counting privately",
  );
});

test("the 429 is JSON both clients can read", async () => {
  // apps/mobile decides whether a failure came from the API at all by
  // testing `typeof body.error === "string"`. A plain-text 429 arrives on
  // the phone as a network outage and is shown as "Can't reach Ink
  // Manager right now" — see lib/loginError.ts.
  const refused = await attempt(A_PORT);
  assert.equal(refused.status, 429);
  assert.equal(typeof refused.body?.error, "string");
  assert.equal(refused.body?.code, "rate_limited");
  assert.match(refused.body!.error!, /too many attempts/i);
  // Never tells a script how many attempts remain.
  assert.doesNotMatch(refused.body!.error!, /\b(remaining|attempts left)\b/i);
});
