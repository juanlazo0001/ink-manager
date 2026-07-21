import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

// Public: whoever received the text taps this link before ever
// authenticating. This deliberately does NOT redirect itself -- apps/api
// and apps/web are separate Railway services with separate public
// domains, and every short link is built (lib/shortLinks.ts) to point at
// the WEB app's own domain (/s/:code there, see pages/ShortLinkRedirect.
// tsx), matching how every other public link in this app resolves to a
// page on that domain rather than the API directly. This route is just
// the resolve step that page calls: the code in, the real destination
// out, as plain JSON. A miss (bad/mistyped/never-issued code) is a plain
// 404 -- there's no sensible fallback destination to guess at.
router.get("/:code", async (req, res) => {
  const code = req.params.code as string;

  const link = await prisma.shortLink.findUnique({ where: { code } });
  if (!link) {
    return res.status(404).json({ error: "This link isn't valid." });
  }

  res.json({ targetUrl: link.targetUrl });
});

export default router;
