import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { PREFILLABLE_FIELDS, sanitizePrefillPayload } from "../lib/prefill";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { shortenUrl } from "../lib/shortLinks";

const router = Router();

const PREFILL_TOKEN_TTL_DAYS = 7;

// Staff-side creation -- used directly as a manual prefill mechanism, and
// internally by the Claude-assisted draft-inquiry flow (6C-2) once staff
// confirm the extracted fields.
router.post("/", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const { studioId, userId } = req.user!;
  const { payload, conversationId } = req.body ?? {};

  const sanitized = sanitizePrefillPayload(payload);
  if (Object.keys(sanitized).length === 0) {
    return res.status(400).json({ error: `payload must include at least one of: ${PREFILLABLE_FIELDS.join(", ")}` });
  }

  if (conversationId !== undefined && conversationId !== null) {
    if (typeof conversationId !== "string") {
      return res.status(400).json({ error: "conversationId must be a string" });
    }
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.studioId !== studioId) {
      return res.status(400).json({ error: "conversationId must belong to your studio" });
    }
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PREFILL_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const draft = await prisma.prefillDraft.create({
    data: {
      studioId,
      token,
      payload: sanitized,
      expiresAt,
      createdById: userId,
      conversationId: conversationId || null,
    },
  });

  await logAudit({
    studioId,
    actorUserId: userId,
    entityType: "PrefillDraft",
    entityId: draft.id,
    action: "create",
    changes: { conversationId: conversationId || null, fields: Object.keys(sanitized) },
  });

  const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { slug: true } });

  res.status(201).json({
    ...draft,
    prefillUrl: await shortenUrl(`${PUBLIC_APP_URL}/inquiry/${studio!.slug}?draft=${token}`),
  });
});

export default router;
