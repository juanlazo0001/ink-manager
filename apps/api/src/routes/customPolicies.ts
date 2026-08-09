import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { diffObjects, logAudit } from "../lib/audit";
import { DEFAULT_THEME_PRESET } from "../lib/themePresets";
import { emitInvalidation } from "../lib/realtime/registry";
import { isSupportedLocale } from "../lib/locale";

// Multi-language public forms, Part 6: shared by POST/PATCH below --
// validates { es: { title?, bodyHtml? } }-shaped input against
// CustomPolicyTranslation's own two columns, same rules as the base
// title/bodyHtml validation right above each call site. Returns either the
// per-locale upsert data or a ready-to-send error response.
function parseCustomPolicyTranslations(
  translations: unknown,
): { ok: true; value: { locale: string; data: Record<string, unknown> }[] } | { ok: false; error: string } {
  if (typeof translations !== "object" || translations === null || Array.isArray(translations)) {
    return { ok: false, error: "translations must be an object keyed by locale" };
  }
  const result: { locale: string; data: Record<string, unknown> }[] = [];
  for (const [locale, fields] of Object.entries(translations as Record<string, unknown>)) {
    if (!isSupportedLocale(locale) || locale === "en") {
      return { ok: false, error: `translations key "${locale}" is not a supported non-English locale` };
    }
    if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
      return { ok: false, error: `translations.${locale} must be an object` };
    }
    const data: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      if (field !== "title" && field !== "bodyHtml") {
        return { ok: false, error: `translations.${locale}.${field} is not a translatable field` };
      }
      if (value !== null && typeof value !== "string") {
        return { ok: false, error: `translations.${locale}.${field} must be a string or null` };
      }
      data[field] = value;
    }
    result.push({ locale, data });
  }
  return { ok: true, value: result };
}

// Public: the studio's own /policies page lists every isPublic custom
// policy, keyed by studio slug -- same unauthenticated, studio-scoped GET
// shape as GET /artists/public?studioSlug=. Sanitization happens entirely
// client-side at render time (sanitizeHtml.ts), matching every other
// StudioSettings HTML policy field -- this route returns the raw stored
// HTML as-is, same as every other public route that returns policy text.
const publicRouter = Router();

publicRouter.get("/public", async (req, res) => {
  const studioSlug = req.query.studioSlug;
  if (typeof studioSlug !== "string" || !studioSlug) {
    return res.status(400).json({ error: "studioSlug is required" });
  }

  const studio = await prisma.studio.findUnique({
    where: { slug: studioSlug },
    include: { settings: { select: { themePreset: true } } },
  });
  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  const policies = await prisma.customPolicy.findMany({
    where: { studioId: studio.id, isPublic: true },
    select: { id: true, title: true, bodyHtml: true },
    orderBy: { order: "asc" },
  });

  res.json({
    studioName: studio.name,
    themePreset: studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
    policies,
  });
});

const staffRouter = Router();

staffRouter.use(requireAuth);

// View is OWNER + FRONT_DESK, matching the fixed 8 HTML policy fields'
// own view/edit split (Settings.tsx's canViewPolicies/canEditPolicies) --
// mutations below stay OWNER-only.
staffRouter.get("/", requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const policies = await prisma.customPolicy.findMany({
    where: { studioId: req.user!.studioId },
    orderBy: { order: "asc" },
    include: { translations: true },
  });
  // Multi-language public forms, Part 6: reshaped from the flat
  // CustomPolicyTranslation rows into { es: { title, bodyHtml } } -- same
  // by-locale object shape POST/PATCH accept, so the editor can round-trip
  // a policy's translations without reshaping on the frontend.
  res.json(
    policies.map(({ translations, ...policy }) => ({
      ...policy,
      translations: Object.fromEntries(translations.map((t) => [t.locale, { title: t.title, bodyHtml: t.bodyHtml }])),
    })),
  );
});

staffRouter.post("/", requireRole(Role.OWNER), async (req, res) => {
  const body = req.body ?? {};

  if (typeof body.title !== "string" || body.title.trim().length === 0) {
    return res.status(400).json({ error: "title is required" });
  }
  if (body.bodyHtml !== undefined && body.bodyHtml !== null && typeof body.bodyHtml !== "string") {
    return res.status(400).json({ error: "bodyHtml must be a string or null" });
  }
  if (body.isPublic !== undefined && typeof body.isPublic !== "boolean") {
    return res.status(400).json({ error: "isPublic must be a boolean" });
  }

  let parsedTranslations: { locale: string; data: Record<string, unknown> }[] = [];
  if (body.translations !== undefined) {
    const parsed = parseCustomPolicyTranslations(body.translations);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }
    parsedTranslations = parsed.value;
  }

  // New policies land at the end of the existing order, not order: 0 --
  // otherwise every new policy would jump to the front of the list.
  const count = await prisma.customPolicy.count({ where: { studioId: req.user!.studioId } });

  const created = await prisma.customPolicy.create({
    data: {
      studioId: req.user!.studioId,
      title: body.title.trim(),
      bodyHtml: typeof body.bodyHtml === "string" ? body.bodyHtml : null,
      isPublic: body.isPublic ?? false,
      order: count,
    },
  });

  for (const { locale, data: translationData } of parsedTranslations) {
    await prisma.customPolicyTranslation.create({
      data: { customPolicyId: created.id, studioId: req.user!.studioId, locale, ...translationData },
    });
  }

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "CustomPolicy",
    entityId: created.id,
    action: "create",
    changes: { title: created.title, isPublic: created.isPublic },
  });

  emitInvalidation({ type: "customPolicy.changed", studioId: req.user!.studioId });

  res.status(201).json(created);
});

staffRouter.patch("/:id", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};

  const existing = await prisma.customPolicy.findUnique({ where: { id } });
  if (!existing || existing.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Custom policy not found" });
  }

  const data: Record<string, unknown> = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return res.status(400).json({ error: "title must be a non-empty string" });
    }
    data.title = body.title.trim();
  }

  if (body.bodyHtml !== undefined) {
    if (body.bodyHtml !== null && typeof body.bodyHtml !== "string") {
      return res.status(400).json({ error: "bodyHtml must be a string or null" });
    }
    data.bodyHtml = body.bodyHtml;
  }

  if (body.isPublic !== undefined) {
    if (typeof body.isPublic !== "boolean") {
      return res.status(400).json({ error: "isPublic must be a boolean" });
    }
    data.isPublic = body.isPublic;
  }

  let parsedTranslations: { locale: string; data: Record<string, unknown> }[] = [];
  if (body.translations !== undefined) {
    const parsed = parseCustomPolicyTranslations(body.translations);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }
    parsedTranslations = parsed.value;
  }

  const updated = await prisma.customPolicy.update({ where: { id }, data });

  for (const { locale, data: translationData } of parsedTranslations) {
    await prisma.customPolicyTranslation.upsert({
      where: { customPolicyId_locale: { customPolicyId: id, locale } },
      create: { customPolicyId: id, studioId: req.user!.studioId, locale, ...translationData },
      update: translationData,
    });
  }

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "CustomPolicy",
    entityId: id,
    action: "update",
    changes: diffObjects(existing, data, ["title", "bodyHtml", "isPublic"] as (keyof typeof existing)[]),
  });

  emitInvalidation({ type: "customPolicy.changed", studioId: req.user!.studioId });

  res.json(updated);
});

staffRouter.delete("/:id", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;

  const existing = await prisma.customPolicy.findUnique({ where: { id } });
  if (!existing || existing.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Custom policy not found" });
  }

  await prisma.customPolicy.delete({ where: { id } });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "CustomPolicy",
    entityId: id,
    action: "delete",
    changes: { title: existing.title },
  });

  emitInvalidation({ type: "customPolicy.changed", studioId: req.user!.studioId });

  res.status(204).end();
});

// Body: { orderedIds: string[] } -- every one of the studio's custom
// policy ids, in the new display order. All-or-nothing: rejects if the
// set of ids doesn't exactly match what the studio actually has, rather
// than silently reordering a partial list.
staffRouter.post("/reorder", requireRole(Role.OWNER), async (req, res) => {
  const body = req.body ?? {};
  const { orderedIds } = body;

  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
    return res.status(400).json({ error: "orderedIds must be an array of strings" });
  }

  const existing = await prisma.customPolicy.findMany({
    where: { studioId: req.user!.studioId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((p) => p.id));

  if (orderedIds.length !== existingIds.size || orderedIds.some((id) => !existingIds.has(id))) {
    return res.status(400).json({ error: "orderedIds must contain exactly the studio's current custom policy ids" });
  }

  await prisma.$transaction(
    orderedIds.map((id, index) => prisma.customPolicy.update({ where: { id }, data: { order: index } })),
  );

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "CustomPolicy",
    entityId: req.user!.studioId,
    action: "reorder",
    changes: { orderedIds },
  });

  emitInvalidation({ type: "customPolicy.changed", studioId: req.user!.studioId });

  const reordered = await prisma.customPolicy.findMany({
    where: { studioId: req.user!.studioId },
    orderBy: { order: "asc" },
  });
  res.json(reordered);
});

export { publicRouter, staffRouter };
