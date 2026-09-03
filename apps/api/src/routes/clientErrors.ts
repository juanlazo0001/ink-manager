import { Router } from "express";
import { prisma } from "../lib/prisma";
import { optionalAuth } from "../middleware/auth";
import { makeLimiter } from "../lib/rateLimit";

// Package BK: where a browser crash goes to be seen.
//
// The web ErrorBoundary used to render "let us know" and capture nothing, so a
// crash on a device nobody in the room owns was unreproducible by construction.
// This is the other half of the fix: the crash text, the component stack, and
// the BUILD COMMIT arrive server-side, so "what is deployed and what broke on
// it" stops being archaeology.
//
// Deliberately optionalAuth, not requireAuth: the crashes that matter most
// happen on public pages (invite acceptance, waiver signing, estimate views)
// where there is no token at all. An authenticated report additionally records
// who it happened to.
const router = Router();

// Anyone can POST here without a session, so it is rate limited on IP through
// the shared Postgres store like every other public limiter (see
// lib/rateLimit.ts -- a bare rateLimit() would silently become limit x
// replicas). 30/5min is generous for a real crash loop -- the client already
// dedupes to one report per distinct message per page load -- and cheap enough
// that a flood cannot fill the table.
const clientErrorLimiter = makeLimiter({
  name: "clientErrors",
  windowMs: 5 * 60 * 1000,
  limit: 30,
});

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, max);
}

router.post("/", clientErrorLimiter, optionalAuth, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const message = str(body.message, 2000);
  if (!message) return res.status(400).json({ error: "message is required" });

  const record = {
    message,
    stack: str(body.stack, 8000),
    componentStack: str(body.componentStack, 8000),
    boundary: str(body.boundary, 120),
    url: str(body.url, 2000),
    userAgent: str(body.userAgent, 500),
    appCommit: str(body.appCommit, 60),
    appBuiltAt: str(body.appBuiltAt, 60),
    viewport: str(body.viewport, 40),
    studioId: req.user?.studioId ?? null,
    userId: req.user?.userId ?? null,
  };

  // Logged as well as stored: Railway's log stream is where someone actually
  // looks first during an incident, and it survives even if the insert below
  // fails.
  console.error(
    `[client-error] ${record.appCommit ?? "unknown-build"} ${record.boundary ?? "-"} ` +
      `${record.url ?? "-"} :: ${record.message}\n  UA: ${record.userAgent ?? "-"}` +
      (record.componentStack ? `\n  componentStack: ${record.componentStack.slice(0, 1200)}` : ""),
  );

  try {
    await prisma.clientErrorReport.create({ data: record });
  } catch (err) {
    // A reporting endpoint must never be the thing that 500s. The console
    // line above is already written, so the report is not lost.
    console.error("[client-error] failed to persist report", err);
  }

  // 204: the client ignores the response entirely and a body would only be
  // parsed by something that shouldn't be parsing it.
  res.status(204).end();
});

export { router as clientErrorsRouter };
