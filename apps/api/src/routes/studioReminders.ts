import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { ReminderAudience, ReminderCondition, Role } from "../../generated/prisma/enums";
import { diffObjects, logAudit } from "../lib/audit";
import { hasPermission } from "../lib/permissions";
import { placeholdersFor } from "../lib/reminderRules";

// Package BJ: CRUD for the reminders a studio configures itself. The
// built-in cadence's templates and send times stay where they were (two JSON
// columns on StudioSettings, edited through PATCH /studio-settings) -- this
// router owns only StudioReminder rows.
//
// Gated on the same permission as the rest of Defaults
// (settings.manageDefaults) rather than a new key, because that is the
// screen these live on and a studio that can retime the built-in reminders
// can already cause the same sends.
const router = Router();

router.use(requireAuth);

const MAX_BODY_LENGTH = 480; // ~3 SMS segments; the UI warns past one.
const MAX_OFFSET_DAYS = 365;
const MAX_REMINDERS_PER_STUDIO = 50;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface ParsedReminder {
  label: string;
  audience: ReminderAudience;
  condition: ReminderCondition;
  offsetDays: number;
  sendTime: string;
  body: string;
  enabled: boolean;
}

type ParseResult = { ok: true; value: ParsedReminder } | { ok: false; error: string };

// `partial` is the PATCH case: only the keys actually present are validated
// and returned, so a PATCH that touches one field can't be forced to resend
// the whole row.
function parseReminder(raw: unknown, partial: boolean): ParseResult | { ok: true; value: Partial<ParsedReminder> } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Body must be an object" };
  const body = raw as Record<string, unknown>;
  const out: Partial<ParsedReminder> = {};

  const has = (key: string) => body[key] !== undefined;
  const required = (key: string) => (partial ? has(key) : true);

  if (required("label")) {
    if (typeof body.label !== "string" || body.label.trim() === "") {
      return { ok: false, error: "label must be a non-empty string" };
    }
    if (body.label.length > 80) return { ok: false, error: "label must be 80 characters or fewer" };
    out.label = body.label.trim();
  }

  if (required("audience")) {
    if (body.audience !== ReminderAudience.CLIENT && body.audience !== ReminderAudience.ARTIST) {
      return { ok: false, error: `audience must be one of: ${Object.values(ReminderAudience).join(", ")}` };
    }
    out.audience = body.audience;
  }

  if (has("condition")) {
    if (body.condition !== ReminderCondition.NONE && body.condition !== ReminderCondition.WAIVER_UNSIGNED) {
      return { ok: false, error: `condition must be one of: ${Object.values(ReminderCondition).join(", ")}` };
    }
    out.condition = body.condition;
  } else if (!partial) {
    out.condition = ReminderCondition.NONE;
  }

  if (required("offsetDays")) {
    // Integer days only: the ticker compares CIVIL DATES in the studio's
    // timezone, so a fractional day has no meaning there and would silently
    // never match rather than failing loudly.
    if (typeof body.offsetDays !== "number" || !Number.isInteger(body.offsetDays)) {
      return { ok: false, error: "offsetDays must be a whole number" };
    }
    if (body.offsetDays < 0 || body.offsetDays > MAX_OFFSET_DAYS) {
      return { ok: false, error: `offsetDays must be between 0 and ${MAX_OFFSET_DAYS}` };
    }
    out.offsetDays = body.offsetDays;
  }

  if (required("sendTime")) {
    if (typeof body.sendTime !== "string" || !TIME_PATTERN.test(body.sendTime)) {
      return { ok: false, error: "sendTime must be a 24-hour HH:MM string" };
    }
    out.sendTime = body.sendTime;
  }

  if (required("body")) {
    if (typeof body.body !== "string" || body.body.trim() === "") {
      return { ok: false, error: "body must be a non-empty string" };
    }
    if (body.body.length > MAX_BODY_LENGTH) {
      return { ok: false, error: `body must be ${MAX_BODY_LENGTH} characters or fewer` };
    }
    out.body = body.body;
  }

  if (has("enabled")) {
    if (typeof body.enabled !== "boolean") return { ok: false, error: "enabled must be a boolean" };
    out.enabled = body.enabled;
  } else if (!partial) {
    out.enabled = true;
  }

  // Placeholder check runs last, once audience and body are both known --
  // a body may only use tokens its own audience actually gets rendered. An
  // unknown token would otherwise survive renderTemplate untouched and go
  // out to a real client as a literal "{{clientFirstName}}".
  const audienceForCheck = out.audience;
  const bodyForCheck = out.body;
  if (bodyForCheck !== undefined && audienceForCheck !== undefined) {
    const allowed = new Set(placeholdersFor(audienceForCheck));
    const used = [...bodyForCheck.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    const unknown = [...new Set(used.filter((token) => !allowed.has(token)))];
    if (unknown.length > 0) {
      return {
        ok: false,
        error: `Unknown placeholder(s) for ${audienceForCheck === ReminderAudience.ARTIST ? "an artist" : "a client"} reminder: ${unknown.join(", ")}. Allowed: ${[...allowed].join(", ")}`,
      };
    }
  }

  return { ok: true, value: out as ParsedReminder };
}

async function canManage(req: Parameters<Parameters<typeof router.get>[1]>[0]): Promise<boolean> {
  const { studioId, role } = req.user!;
  return hasPermission(studioId, role, "settings.manageDefaults");
}

// Read is open to the same roles that can read the rest of studio settings.
// The list is not sensitive and the mobile client shows it read-only.
router.get("/", requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST), async (req, res) => {
  const reminders = await prisma.studioReminder.findMany({
    where: { studioId: req.user!.studioId },
    orderBy: [{ offsetDays: "desc" }, { sendTime: "asc" }, { createdAt: "asc" }],
  });
  res.json({ reminders });
});

router.post("/", async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: "Forbidden" });

  const parsed = parseReminder(req.body ?? {}, false) as ParseResult;
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const studioId = req.user!.studioId;
  const existing = await prisma.studioReminder.count({ where: { studioId } });
  if (existing >= MAX_REMINDERS_PER_STUDIO) {
    return res.status(400).json({ error: `A studio can have at most ${MAX_REMINDERS_PER_STUDIO} reminders` });
  }

  const reminder = await prisma.studioReminder.create({
    data: { ...parsed.value, studioId },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    action: "create",
    entityType: "StudioReminder",
    entityId: reminder.id,
    changes: { label: reminder.label, offsetDays: reminder.offsetDays, sendTime: reminder.sendTime },
  });

  res.status(201).json({ reminder });
});

router.patch("/:id", async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: "Forbidden" });

  const studioId = req.user!.studioId;
  const existing = await prisma.studioReminder.findUnique({ where: { id: req.params.id } });
  // Studio scoping is checked against the RECORD's own studioId, never
  // assumed from the token -- same rule as every other studio-scoped route.
  if (!existing || existing.studioId !== studioId) {
    return res.status(404).json({ error: "Reminder not found" });
  }

  const parsed = parseReminder(req.body ?? {}, true) as ParseResult;
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  // A PATCH that changes only the body still has to be validated against the
  // audience it will actually render under, which may be the stored one.
  const merged = { ...existing, ...parsed.value };
  const recheck = parseReminder(
    { label: merged.label, audience: merged.audience, condition: merged.condition, offsetDays: merged.offsetDays, sendTime: merged.sendTime, body: merged.body, enabled: merged.enabled },
    false,
  ) as ParseResult;
  if (!recheck.ok) return res.status(400).json({ error: recheck.error });

  const reminder = await prisma.studioReminder.update({
    where: { id: existing.id },
    data: parsed.value,
  });

  const changes = diffObjects(existing, reminder, ["label", "audience", "condition", "offsetDays", "sendTime", "body", "enabled"]);
  if (Object.keys(changes).length > 0) {
    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      action: "update",
      entityType: "StudioReminder",
      entityId: reminder.id,
      changes,
    });
  }

  res.json({ reminder });
});

router.delete("/:id", async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: "Forbidden" });

  const studioId = req.user!.studioId;
  const existing = await prisma.studioReminder.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.studioId !== studioId) {
    return res.status(404).json({ error: "Reminder not found" });
  }

  // Send history cascades with the row (see the model comment) -- the log of
  // "we sent this reminder" has no meaning once the reminder is gone.
  await prisma.studioReminder.delete({ where: { id: existing.id } });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    action: "delete",
    entityType: "StudioReminder",
    entityId: existing.id,
    changes: { label: existing.label, isSystem: existing.isSystem },
  });

  res.status(204).end();
});

export { router as studioRemindersRouter };
