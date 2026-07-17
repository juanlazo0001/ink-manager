import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import compression from "compression";
import studiosRouter from "./routes/studios";
import authRouter from "./routes/auth";
import usersRouter from "./routes/users";
import artistsRouter from "./routes/artists";
import clientsRouter from "./routes/clients";
import appointmentsRouter from "./routes/appointments";
import consentFormsRouter from "./routes/consentForms";
import inquiriesRouter from "./routes/inquiries";
import estimatesRouter from "./routes/estimates";
import { publicRouter as depositsRouter, staffRouter as depositFormsRouter } from "./routes/deposits";
import uploadsRouter from "./routes/uploads";
import auditRouter from "./routes/audit";
import studioSettingsRouter from "./routes/studioSettings";
import { publicRouter as giftCardsPublicRouter, staffRouter as giftCardsStaffRouter } from "./routes/giftCards";
import { publicRouter as waiversPublicRouter, staffRouter as waiversStaffRouter } from "./routes/waivers";
import tasksRouter from "./routes/tasks";
import navCountsRouter from "./routes/navCounts";
import conversationsRouter from "./routes/conversations";
import { requireAuth } from "./middleware/auth";

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(compression());
app.use(express.json({ limit: "8mb" })); // logo/avatar uploads (base64, up to 5MB source) exceed Express's 100kb default

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
app.use("/users", usersRouter);
app.use("/artists", artistsRouter);
app.use("/clients", clientsRouter);
app.use("/appointments", appointmentsRouter);
app.use("/consent-forms", consentFormsRouter);
app.use("/inquiries", inquiriesRouter);
app.use("/estimates", estimatesRouter);
app.use("/deposits", depositsRouter);
app.use("/deposit-forms", depositFormsRouter);
app.use("/uploads", uploadsRouter);
app.use("/audit", auditRouter);
app.use("/studio-settings", studioSettingsRouter);
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
app.use("/conversations", conversationsRouter);

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

app.listen(port, () => {
  console.log(`Ink Manager API listening on port ${port}`);
});
