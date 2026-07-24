import { Router } from "express";
import { prisma } from "../lib/prisma";
import { IntakeFieldKind, IntakeCustomQuestionType, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { diffObjects, logAudit } from "../lib/audit";
import {
  ensureDefaultSystemFields,
  validateIntakeFormFieldsPayload,
  IntakeFormFieldInput,
} from "../lib/intakeFormFields";
import { generateUniqueIntakeFormSlug, setDefaultIntakeForm } from "../lib/intakeForms";

const router = Router();
router.use(requireAuth);

// Same visibility level GET /studio-settings/intake-form-fields always
// had -- any staff role can read the list (the composer's/ClientDetail's
// form picker needs this too), only OWNER can write.
router.get("/", requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST), async (req, res) => {
  const forms = await prisma.intakeForm.findMany({
    where: { studioId: req.user!.studioId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  res.json(forms);
});

router.use(requireRole(Role.OWNER));

router.post("/", async (req, res) => {
  const studioId = req.user!.studioId;
  const { name } = req.body ?? {};

  if (typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "name is required" });
  }

  const slug = await generateUniqueIntakeFormSlug(studioId, name.trim());
  // A studio's very first form has nowhere else for the "exactly one
  // default" invariant to come from -- every subsequent form starts
  // non-default until an OWNER explicitly promotes it via PATCH.
  const isFirstForm = (await prisma.intakeForm.count({ where: { studioId } })) === 0;

  const form = await prisma.intakeForm.create({
    data: { studioId, name: name.trim(), slug, isDefault: isFirstForm },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "IntakeForm",
    entityId: form.id,
    action: "create",
    changes: { name: form.name, slug: form.slug, isDefault: form.isDefault },
  });

  res.status(201).json(form);
});

// name and/or isDefault. Slug is immutable once assigned (see IntakeForm's
// own doc comment) -- no route lets it change.
router.patch("/:id", async (req, res) => {
  const studioId = req.user!.studioId;
  const id = req.params.id as string;
  const body = req.body ?? {};

  const existing = await prisma.intakeForm.findUnique({ where: { id } });
  if (!existing || existing.studioId !== studioId) {
    return res.status(404).json({ error: "Intake form not found" });
  }

  const data: { name?: string } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    data.name = body.name.trim();
  }

  // isDefault: true triggers the atomic swap (this form becomes the
  // default, whichever form held it before does not). isDefault: false is
  // only meaningful as a side effect of a DIFFERENT form being promoted --
  // sending it directly for the CURRENT default would leave the studio
  // with zero default forms, so it's rejected the same way DELETE below
  // rejects deleting the current default: promote a different form first.
  if (body.isDefault === false && existing.isDefault) {
    return res.status(400).json({ error: "Set a different form as default first -- a studio must always have one." });
  }

  if (Object.keys(data).length > 0) {
    await prisma.intakeForm.update({ where: { id }, data });
  }
  if (body.isDefault === true && !existing.isDefault) {
    await setDefaultIntakeForm(studioId, id);
  }

  const updated = await prisma.intakeForm.findUnique({ where: { id } });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "IntakeForm",
    entityId: id,
    action: "update",
    changes: diffObjects(existing, { ...data, isDefault: updated!.isDefault }, ["name", "isDefault"]),
  });

  res.json(updated);
});

// Deleting a non-default form is allowed -- any inquiries that used it
// keep existing, just with intakeFormId nulled (ON DELETE SET NULL,
// Inquiry's own nullable relation) -- never delete real submitted inquiry
// data. The form's OWN field rows are deleted first in the same
// transaction (IntakeFormField.intakeFormId is required/RESTRICT, so the
// parent row can't be deleted while they still reference it).
router.delete("/:id", async (req, res) => {
  const studioId = req.user!.studioId;
  const id = req.params.id as string;

  const existing = await prisma.intakeForm.findUnique({ where: { id } });
  if (!existing || existing.studioId !== studioId) {
    return res.status(404).json({ error: "Intake form not found" });
  }

  if (existing.isDefault) {
    return res.status(400).json({ error: "Set a different form as default before deleting this one." });
  }

  const [, inquiriesUsingForm] = await prisma.$transaction([
    prisma.intakeFormField.deleteMany({ where: { intakeFormId: id } }),
    prisma.inquiry.count({ where: { intakeFormId: id } }),
    prisma.intakeForm.delete({ where: { id } }),
  ]);

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "IntakeForm",
    entityId: id,
    action: "delete",
    changes: { name: existing.name, slug: existing.slug, inquiriesDetached: inquiriesUsingForm },
  });

  res.json({ success: true });
});

// Staff-facing field list for ONE form -- moved here from
// GET /studio-settings/intake-form-fields once a studio could have more
// than one form. Returns every field including disabled ones, since the
// Settings editor needs to show (and let OWNER re-enable) a field a studio
// previously turned off, not just what the public form currently renders.
router.get("/:id/fields", requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST), async (req, res) => {
  const studioId = req.user!.studioId;
  const formId = req.params.id as string;

  const form = await prisma.intakeForm.findUnique({ where: { id: formId } });
  if (!form || form.studioId !== studioId) {
    return res.status(404).json({ error: "Intake form not found" });
  }

  await ensureDefaultSystemFields(studioId, formId);
  const fields = await prisma.intakeFormField.findMany({
    where: { intakeFormId: formId },
    orderBy: { order: "asc" },
  });
  res.json(fields);
});

// Full-list replace, scoped to one form -- the drag-and-drop editor always
// sends the complete ordered list back for the form it has open (system
// rows can never be removed from the payload, only reordered/disabled --
// enforced below), so delete-all-then-recreate for THIS form's own rows
// only is safe and simpler than diffing. IDs are preserved because the
// client always round-trips each row's existing id (and mints one
// client-side for a brand-new custom question via crypto.randomUUID()) --
// nothing here generates a fresh id itself, so a CUSTOM row's id -- and
// therefore its historical Inquiry.customFieldAnswers linkage -- never
// changes just because the list around it was reordered or edited.
router.put("/:id/fields", requireRole(Role.OWNER), async (req, res) => {
  const studioId = req.user!.studioId;
  const formId = req.params.id as string;
  const body = req.body as IntakeFormFieldInput[];

  const form = await prisma.intakeForm.findUnique({ where: { id: formId } });
  if (!form || form.studioId !== studioId) {
    return res.status(404).json({ error: "Intake form not found" });
  }

  const validationError = validateIntakeFormFieldsPayload(body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const before = await prisma.intakeFormField.findMany({ where: { intakeFormId: formId }, orderBy: { order: "asc" } });

  const rows = body.map((row, i) => ({
    id: row.id || undefined,
    studioId,
    intakeFormId: formId,
    fieldKind: row.fieldKind as IntakeFieldKind,
    systemFieldKey: row.fieldKind === IntakeFieldKind.SYSTEM ? row.systemFieldKey! : null,
    customQuestionType:
      row.fieldKind === IntakeFieldKind.CUSTOM ? (row.customQuestionType as IntakeCustomQuestionType) : null,
    label: row.label.trim(),
    helpText: row.helpText?.trim() || null,
    required: row.required,
    enabled: row.enabled,
    options: row.fieldKind === IntakeFieldKind.CUSTOM ? row.options ?? undefined : undefined,
    order: i,
  }));

  await prisma.$transaction([
    prisma.intakeFormField.deleteMany({ where: { intakeFormId: formId } }),
    prisma.intakeFormField.createMany({ data: rows }),
  ]);

  const after = await prisma.intakeFormField.findMany({ where: { intakeFormId: formId }, orderBy: { order: "asc" } });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "IntakeFormField",
    entityId: formId,
    action: "update",
    changes: {
      fieldCount: { from: before.length, to: after.length },
      labels: { from: before.map((f) => f.label), to: after.map((f) => f.label) },
    },
  });

  res.json(after);
});

export default router;
