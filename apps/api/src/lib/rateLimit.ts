import { PostgresStore } from "@acpr/rate-limit-postgresql";
import rateLimit, { type Options, type Store, type ClientRateLimitInfo } from "express-rate-limit";
import type { Request, Response } from "express";

/**
 * Rate limiting, on a store both API processes can see.
 *
 * ─── WHY THIS MODULE EXISTS ─────────────────────────────────────────
 *
 * Every limiter in this codebase used express-rate-limit's default
 * MemoryStore, which is per-process. With one replica that is merely
 * fragile; with two it is broken in a way nothing reports — each replica
 * would enforce its own private count, so the real limit becomes
 * `limit × replicas` and the system looks fine while allowing double the
 * traffic it promises. Session BE measured it as one of three things
 * blocking a second replica.
 *
 * ─── WHY POSTGRES AND NOT REDIS ─────────────────────────────────────
 *
 * There is no Redis in this project, and provisioning one to hold two
 * counters is a new service, a new bill and a new failure domain for a
 * problem the existing database solves. These are not hot-path limiters:
 * they guard six auth endpoints, at single-digit requests per window.
 *
 * `@acpr/rate-limit-postgresql` creates its own `rate_limit` SCHEMA
 * rather than tables in `public`, which matters more than it sounds:
 * Prisma manages `public`, so `prisma migrate diff` can never see these
 * tables, never generate a DROP for them, and never fight the library
 * over them. It also needs `CREATE SCHEMA` and the `uuid-ossp` extension
 * once, on first boot.
 *
 * ─── FAIL OPEN, DELIBERATELY ────────────────────────────────────────
 *
 * If the store is unreachable, requests are ALLOWED through rather than
 * rejected. A rate limiter whose database hiccup takes down sign-in for
 * every studio is worse than the abuse it exists to prevent — the limiter
 * protects against a cost that is measured in wasted compute and emails,
 * and failing closed converts that into a total outage of the product.
 *
 * This is a real trade and it is stated so it can be argued with: during
 * a store outage, these endpoints are unprotected. The alternative was
 * considered and rejected.
 */

/** Shared by every limiter so there is one pool, not six. */
const storeConfig = {
  connectionString: process.env.DATABASE_URL,
};

/**
 * Wraps a store so a store failure never rejects a request.
 *
 * `increment` is the only method whose failure could block traffic — it
 * is what the middleware awaits before deciding. On error it returns a
 * count of 1, which reads as "first request in the window" and therefore
 * always passes. `decrement` and `resetKey` are housekeeping; a failure
 * there is swallowed because there is nothing useful to do about it and
 * nothing depends on it.
 *
 * Logged, but only once per minute per store: a database outage would
 * otherwise produce a log line per request, which buries the outage in
 * the noise it caused.
 */
function failOpen(store: Store, label: string): Store {
  let lastLoggedAt = 0;

  const note = (err: unknown) => {
    const now = Date.now();
    if (now - lastLoggedAt > 60_000) {
      lastLoggedAt = now;
      console.error(
        `[ratelimit] store "${label}" is failing; requests are being ALLOWED through ` +
          `until it recovers. ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return {
    init: (options: Options) => store.init?.(options),
    async increment(key: string): Promise<ClientRateLimitInfo> {
      try {
        return await store.increment(key);
      } catch (err) {
        note(err);
        return { totalHits: 1, resetTime: undefined };
      }
    },
    async decrement(key: string) {
      try {
        await store.decrement(key);
      } catch (err) {
        note(err);
      }
    },
    async resetKey(key: string) {
      try {
        await store.resetKey(key);
      } catch (err) {
        note(err);
      }
    },
  };
}

/**
 * The 429 body.
 *
 * JSON with an `error` string, not express-rate-limit's default plain
 * text, and that is not cosmetic: apps/mobile decides whether a failure
 * came from the API at all by testing `typeof body.error === "string"`
 * (`lib/api.ts`). A plain-text 429 therefore arrived on the phone as
 * `fromApi: false` and was shown to the user as "Can't reach Ink Manager
 * right now" — a rate limit reported as a network outage. Measured on
 * the signup limiter, which has always answered in plain text.
 *
 * The message says what happened and what to do, and never how many
 * attempts remain — that would tell a script exactly how to pace itself.
 */
function limitHandler(minutes: number) {
  return (_req: Request, res: Response) => {
    res.status(429).json({
      error: `Too many attempts. Try again in about ${minutes} minutes.`,
      code: "rate_limited",
    });
  };
}

interface LimiterSpec {
  /** Unique per limiter — it is the store's session name. */
  name: string;
  windowMs: number;
  limit: number;
  /** IP, or something off the body such as the submitted email. */
  keyGenerator?: (req: Request) => string;
  /** Only count FAILURES. See the login limiters. */
  skipSuccessfulRequests?: boolean;
}

export function makeLimiter(spec: LimiterSpec) {
  const minutes = Math.round(spec.windowMs / 60_000);
  return rateLimit({
    windowMs: spec.windowMs,
    limit: spec.limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: spec.skipSuccessfulRequests ?? false,
    ...(spec.keyGenerator ? { keyGenerator: spec.keyGenerator } : {}),
    store: failOpen(new PostgresStore(storeConfig, spec.name), spec.name),
    handler: limitHandler(minutes),
  });
}

/**
 * Keys a limiter on the submitted email rather than the caller's IP.
 *
 * ─── THE ATTACK THIS CLOSES ─────────────────────────────────────────
 *
 * An IP limiter alone is defeated by spreading attempts across addresses,
 * which is exactly what a credential-stuffing run does — the whole point
 * of a botnet is that no single IP looks busy. Keying a second limiter on
 * the ACCOUNT means a thousand IPs attacking one account still share one
 * counter.
 *
 * Lowercased and trimmed so `Owner@Studio.com` and `owner@studio.com`
 * cannot be used as two separate budgets against the same account.
 *
 * A missing or non-string email falls back to a constant, which pools
 * every malformed request into one bucket. That is intentional: those
 * requests are 400s anyway, and giving each its own budget would let a
 * script exhaust nothing while still being counted separately.
 */
export function emailKey(req: Request): string {
  const raw = (req.body ?? {}).email;
  if (typeof raw !== "string" || !raw.trim()) return "no-email";
  return raw.trim().toLowerCase();
}
