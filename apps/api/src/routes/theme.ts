import { Router } from "express";
import { prisma } from "../lib/prisma";
import { DEFAULT_THEME_PRESET } from "../lib/themePresets";

const router = Router();

// Public: every unauthenticated, studio-scoped page (intake form, public
// policies, etc.) applies the studio's chosen theme preset the same way
// the authenticated app shell does, via this one small studioSlug-keyed
// GET -- same pattern as GET /artists/public?studioSlug=. Token-keyed
// public pages (deposit/estimate/waiver/gift-card verify) don't need this
// route at all: they already load the related Studio server-side, so
// their own response just includes settings.themePreset directly.
router.get("/", async (req, res) => {
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

  res.json({ themePreset: studio.settings?.themePreset ?? DEFAULT_THEME_PRESET });
});

export default router;
