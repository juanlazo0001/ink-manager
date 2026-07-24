import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();
router.use(requireAuth);
router.use(requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST));

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Deliberately NOT audited: a personal display preference (widget order/
// collapsed state on the Inquiry/Project detail pages), same exception as
// SectionSeen-driven nav counts -- carries no business meaning. pageKey is
// never validated against a fixed list here; the frontend is the only
// caller and always sends one of its own known page keys, same trust level
// as e.g. POST /nav-counts/seen's section names (though that one DOES
// validate, since a bad section there would silently mis-track unread
// counts -- a bad pageKey here just creates an unused row, harmless).
router.get("/:pageKey", async (req, res) => {
  const { userId } = req.user!;
  const pageKey = req.params.pageKey as string;

  const layout = await prisma.userWidgetLayout.findUnique({
    where: { userId_pageKey: { userId, pageKey } },
  });

  res.json({
    widgetOrder: (layout?.widgetOrder as string[] | undefined) ?? [],
    collapsedWidgetIds: (layout?.collapsedWidgetIds as string[] | undefined) ?? [],
  });
});

router.put("/:pageKey", async (req, res) => {
  const { userId } = req.user!;
  const pageKey = req.params.pageKey as string;
  const { widgetOrder, collapsedWidgetIds } = req.body ?? {};

  if (!isStringArray(widgetOrder)) {
    return res.status(400).json({ error: "widgetOrder must be an array of strings" });
  }
  if (!isStringArray(collapsedWidgetIds)) {
    return res.status(400).json({ error: "collapsedWidgetIds must be an array of strings" });
  }

  const saved = await prisma.userWidgetLayout.upsert({
    where: { userId_pageKey: { userId, pageKey } },
    update: { widgetOrder, collapsedWidgetIds },
    create: { userId, pageKey, widgetOrder, collapsedWidgetIds },
  });

  res.json({
    widgetOrder: saved.widgetOrder as string[],
    collapsedWidgetIds: saved.collapsedWidgetIds as string[],
  });
});

export default router;
