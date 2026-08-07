import "dotenv/config";
import { createServer } from "node:http";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import compression from "compression";
import studiosRouter from "./routes/studios";
import authRouter from "./routes/auth";
import invitesRouter from "./routes/invites";
import artistInvitesRouter from "./routes/artistInvites";
import usersRouter from "./routes/users";
import artistsRouter from "./routes/artists";
import flashPiecesRouter from "./routes/flashPieces";
import flashPaymentsRouter from "./routes/flashPayments";
import clientsRouter from "./routes/clients";
import clientImportRouter from "./routes/clientImport";
import appointmentsRouter from "./routes/appointments";
import inquiriesRouter from "./routes/inquiries";
import estimatesRouter from "./routes/estimates";
import selfScheduleRouter from "./routes/selfSchedule";
import { publicRouter as depositsRouter, staffRouter as depositFormsRouter } from "./routes/deposits";
import uploadsRouter from "./routes/uploads";
import auditRouter from "./routes/audit";
import { publicRouter as studioSettingsPublicRouter, staffRouter as studioSettingsStaffRouter } from "./routes/studioSettings";
import { publicRouter as giftCardsPublicRouter, staffRouter as giftCardsStaffRouter } from "./routes/giftCards";
import { publicRouter as waiversPublicRouter, staffRouter as waiversStaffRouter } from "./routes/waivers";
import tasksRouter from "./routes/tasks";
import navCountsRouter from "./routes/navCounts";
import widgetLayoutsRouter from "./routes/widgetLayouts";
import calendarPreferencesRouter from "./routes/calendarPreferences";
import conversationsRouter from "./routes/conversations";
import prefillDraftsRouter from "./routes/prefillDrafts";
import intakeFormsRouter from "./routes/intakeForms";
import servicesRouter from "./routes/services";
import viewAsRouter from "./routes/viewAs";
import jobsRouter from "./routes/jobs";
import { publicRouter as integrationsPublicRouter, staffRouter as integrationsStaffRouter } from "./routes/integrations";
import webhooksRouter from "./routes/webhooks";
import searchRouter from "./routes/search";
import shortLinksRouter from "./routes/shortLinks";
import { publicRouter as customPoliciesPublicRouter, staffRouter as customPoliciesStaffRouter } from "./routes/customPolicies";
import schedulingRouter from "./routes/scheduling";
import themeRouter from "./routes/theme";
import reportsRouter from "./routes/reports";
import { startScheduler } from "./lib/jobs";
import { requireAuth } from "./middleware/auth";
import { initRealtime } from "./lib/realtime/io";

const app = express();
const port = process.env.PORT || 4000;

// Found live against production, not theorized: without this, Express's
// req.ip resolves to the immediate TCP peer -- behind Railway's edge
// proxy, that's an internal hop, not the real client, and it wasn't even
// stable across requests from the same real client. The two IP-keyed
// rate limiters below (routes/auth.ts's signupLimiter/
// resendVerificationLimiter) use express-rate-limit's default
// req.ip-based keyGenerator, so every request was silently landing in
// its own fresh bucket -- confirmed via a live signup burst against
// production returning `ratelimit-remaining: 4` on what should have been
// well past the limit. `1` trusts exactly the one hop Railway's edge
// itself adds, so req.ip becomes the real client IP -- and stays safe
// against a client spoofing its own X-Forwarded-For, since Railway's
// edge appends (never blindly forwards) the real connecting IP as that
// trusted hop.
app.set("trust proxy", 1);

app.use(cors());
app.use(compression());
// Stripe webhook signature verification (stripe.webhooks.constructEvent,
// see routes/webhooks.ts) needs the EXACT raw request bytes Stripe sent --
// a JSON.parse()'d-then-reserialized body is not guaranteed byte-identical
// and would make every signature check fail. This one path gets the raw
// Buffer instead of the global JSON parser below; every other route
// (including every other webhook -- Twilio's own signature check works
// off the parsed x-www-form-urlencoded body, not raw bytes) is unaffected.
app.use((req, res, next) => {
  if (req.originalUrl === "/webhooks/stripe") {
    return express.raw({ type: "application/json" })(req, res, next);
  }
  return express.json({ limit: "8mb" })(req, res, next); // logo/avatar uploads (base64, up to 5MB source) exceed Express's 100kb default
});
// Twilio POSTs webhooks as application/x-www-form-urlencoded, not JSON --
// needed so req.body is populated for /webhooks/twilio/* (both the params
// themselves and X-Twilio-Signature validation, which is computed over
// these same parsed params).
app.use(express.urlencoded({ extended: false }));

// Opt-in request timing, for diagnosing slow endpoints. Off by default;
// set DEBUG_TIMING=true to log method/path/status/duration per request.
if (process.env.DEBUG_TIMING === "true") {
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`[timing] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`);
    });
    next();
  });
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", app: "Ink Manager API" });
});

app.use("/studios", studiosRouter);
app.use(authRouter);
app.use(invitesRouter);
app.use(artistInvitesRouter);
app.use("/users", usersRouter);
app.use("/artists", artistsRouter);
app.use("/flash-pieces", flashPiecesRouter);
app.use("/flash-payment", flashPaymentsRouter);
app.use("/clients", clientsRouter);
app.use("/clients", clientImportRouter);
app.use("/appointments", appointmentsRouter);
app.use("/inquiries", inquiriesRouter);
app.use("/estimates", estimatesRouter);
// Public: client self-scheduling exploration, same unauthenticated
// crypto-token pattern as /estimates above.
app.use("/self-schedule", selfScheduleRouter);
app.use("/deposits", depositsRouter);
app.use("/deposit-forms", depositFormsRouter);
app.use("/uploads", uploadsRouter);
app.use("/audit", auditRouter);
// Public router first, same reasoning as gift-cards/waivers/custom-policies
// above: /studio-settings/public?studioSlug= (the /privacy and /terms pages)
// must be reachable before the staff router's requireAuth.
app.use("/studio-settings", studioSettingsPublicRouter);
app.use("/studio-settings", studioSettingsStaffRouter);
// Public router first: /gift-cards/view/:code must match before the
// staff router's /gift-cards/:id would otherwise swallow it.
app.use("/gift-cards", giftCardsPublicRouter);
app.use("/gift-cards", giftCardsStaffRouter);
// Public router first: /waivers/verify/:token and /waivers/sign/:token
// must match before the staff router's /waivers/:id would swallow them.
app.use("/waivers", waiversPublicRouter);
app.use("/waivers", waiversStaffRouter);
app.use("/tasks", tasksRouter);
app.use("/nav-counts", navCountsRouter);
app.use("/widget-layouts", widgetLayoutsRouter);
app.use("/calendar-preferences", calendarPreferencesRouter);
app.use("/conversations", conversationsRouter);
app.use("/prefill-drafts", prefillDraftsRouter);
app.use("/intake-forms", intakeFormsRouter);
app.use("/services", servicesRouter);
app.use("/view-as", viewAsRouter);
app.use("/jobs", jobsRouter);
// Public router first: /integrations/email/callback (Google's OAuth
// redirect, no Bearer JWT available) must match before the staff router's
// requireAuth, same public-router-first convention as gift-cards/waivers/
// custom-policies/studio-settings above.
app.use("/integrations", integrationsPublicRouter);
app.use("/integrations", integrationsStaffRouter);
app.use("/search", searchRouter);
// Public router first, same reasoning as gift-cards/waivers above: the
// public /policies page's studioSlug-keyed GET must be reachable before
// the staff router's requireAuth.
app.use("/custom-policies", customPoliciesPublicRouter);
app.use("/custom-policies", customPoliciesStaffRouter);
// Public: Twilio calls these directly, no requireAuth anywhere in this router.
app.use("/webhooks", webhooksRouter);
// Public: whoever taps a shortened link in a text has no auth yet.
app.use("/s", shortLinksRouter);
app.use("/scheduling", schedulingRouter);
// Public: every unauthenticated studio-scoped page applies the studio's
// theme preset the same way, no requireAuth here at all.
app.use("/theme", themeRouter);
app.use("/reports", reportsRouter);

app.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);

  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large." });
  }

  if (err?.code === "P2002") {
    return res.status(409).json({ error: `A record with that ${err.meta?.target ?? "value"} already exists` });
  }

  if (err?.code === "P2003") {
    return res.status(400).json({ error: "Referenced record does not exist" });
  }

  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);

// Socket.IO attaches to this same server rather than opening a second
// listener -- Railway only exposes the one port.
const httpServer = createServer(app);
initRealtime(httpServer);

httpServer.listen(port, () => {
  console.log(`Ink Manager API listening on port ${port}`);
});

startScheduler();
