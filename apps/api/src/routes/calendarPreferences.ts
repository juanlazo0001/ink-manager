import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();
router.use(requireAuth);
router.use(requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST));

const VALID_VIEWS = ["month", "week", "day"] as const;
type CalendarView = (typeof VALID_VIEWS)[number];

function isValidView(value: unknown): value is CalendarView {
  return typeof value === "string" && (VALID_VIEWS as readonly string[]).includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Deliberately NOT audited: a personal display preference (which view,
// which artists/location are filtered to, whether past guests are
// included), same exception as UserWidgetLayout (widgetLayouts.ts) --
// carries no business meaning. One row per user, no pageKey -- there's
// only one Calendar page, unlike the Inquiry/Project detail pages'
// per-page-type widget layouts.
router.get("/", async (req, res) => {
  const { userId } = req.user!;

  const pref = await prisma.userCalendarPreference.findUnique({ where: { userId } });

  res.json({
    view: pref?.view ?? "month",
    selectedArtistIds: (pref?.selectedArtistIds as string[] | null | undefined) ?? null,
    selectedLocationId: pref?.selectedLocationId ?? null,
    includePastGuests: pref?.includePastGuests ?? false,
  });
});

router.put("/", async (req, res) => {
  const { userId } = req.user!;
  const { view, selectedArtistIds, selectedLocationId, includePastGuests } = req.body ?? {};

  if (!isValidView(view)) {
    return res.status(400).json({ error: `view must be one of: ${VALID_VIEWS.join(", ")}` });
  }
  if (selectedArtistIds !== null && !isStringArray(selectedArtistIds)) {
    return res.status(400).json({ error: "selectedArtistIds must be an array of strings or null" });
  }
  if (selectedLocationId !== null && typeof selectedLocationId !== "string") {
    return res.status(400).json({ error: "selectedLocationId must be a string or null" });
  }
  if (typeof includePastGuests !== "boolean") {
    return res.status(400).json({ error: "includePastGuests must be a boolean" });
  }

  const saved = await prisma.userCalendarPreference.upsert({
    where: { userId },
    update: { view, selectedArtistIds, selectedLocationId, includePastGuests },
    create: { userId, view, selectedArtistIds, selectedLocationId, includePastGuests },
  });

  res.json({
    view: saved.view,
    selectedArtistIds: saved.selectedArtistIds as string[] | null,
    selectedLocationId: saved.selectedLocationId,
    includePastGuests: saved.includePastGuests,
  });
});

export default router;
