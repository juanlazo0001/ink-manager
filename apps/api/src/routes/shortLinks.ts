import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

// Public: whoever received the text taps this link before ever
// authenticating. A miss (bad/mistyped code) is a plain 404, not a
// redirect anywhere -- there's no sensible fallback destination for a
// code that was never issued.
router.get("/:code", async (req, res) => {
  const code = req.params.code as string;

  const link = await prisma.shortLink.findUnique({ where: { code } });
  if (!link) {
    return res.status(404).send("This link isn't valid.");
  }

  res.redirect(302, link.targetUrl);
});

export default router;
