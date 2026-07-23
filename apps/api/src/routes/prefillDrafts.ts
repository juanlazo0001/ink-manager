import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { PREFILLABLE_FIELDS, sanitizePrefillPayload } from "../lib/prefill";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { shortenUrl } from "../lib/shortLinks";
import { getOrCreateClientConversation } from "../lib/conversations";
import { sendClientSms } from "../lib/clientSms";

const router = Router();

const PREFILL_TOKEN_TTL_DAYS = 7;

// Staff-side creation -- used directly as a manual prefill mechanism, and
// internally by the Claude-assisted draft-inquiry flow (6C-2) once staff
// confirm the extracted fields.
router.post("/", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const { studioId, userId } = req.user!;
  const { payload, conversationId, clientId } = req.body ?? {};

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

  // clientId is transient -- used only to route the auto-send below, never
  // stored on PrefillDraft (which stays client-agnostic, same as before).
  // Only ClientDetail's standalone "Copy prefilled link" passes it; the
  // composer's own prefill-link insert passes conversationId instead and
  // deliberately omits clientId, since that flow inserts the link into the
  // draft for staff to compose their own message around (same reasoning as
  // the composer's deposit-form/waiver create-then-insert actions).
  let client: { firstName: string; studioId: string } | null = null;
  if (clientId !== undefined && clientId !== null) {
    if (typeof clientId !== "string") {
      return res.status(400).json({ error: "clientId must be a string" });
    }
    client = await prisma.client.findUnique({ where: { id: clientId }, select: { firstName: true, studioId: true } });
    if (!client || client.studioId !== studioId) {
      return res.status(400).json({ error: "clientId must belong to your studio" });
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

  const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { slug: true, name: true } });

  const prefillUrl = await shortenUrl(`${PUBLIC_APP_URL}/inquiry/${studio!.slug}?draft=${token}`);

  // Auto-send through the same real-SMS path as the estimate auto-send --
  // only when clientId was passed (ClientDetail's standalone "Copy
  // prefilled link", the one caller that isn't already headed for a
  // composer Send). Best-effort, same as the other auto-sends in this
  // package.
  let prefillSendResult: Awaited<ReturnType<typeof sendClientSms>> | null = null;
  if (client) {
    prefillSendResult = await sendClientSms({
      studioId,
      clientId,
      conversationId: (await getOrCreateClientConversation(studioId, clientId, userId)).conversation.id,
      body: `Hi ${client.firstName}, here's a link to start a new inquiry with ${studio?.name ?? "our studio"} -- your info's already filled in: ${prefillUrl}`,
      actorUserId: userId,
    });
  }

  res.status(201).json({
    ...draft,
    prefillUrl,
    prefillSendResult,
  });
});

export default router;
