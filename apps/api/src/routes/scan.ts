import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { callerBelongsToStudio, hasPermissionAt } from "../lib/artistAccess";

// Front-desk QR scanner: staff-authenticated resolution of whatever a
// scanned QR or manually-typed code turns out to be, and "what record is
// this and where does staff go." Deliberately separate from
// routes/shortLinks.ts's own GET /:code -- that one is public/
// unauthenticated by design (a real client following a texted link), and
// echoes back whatever targetUrl was stored with no permission check at
// all. This route exists specifically because that one is NOT staff-safe
// to reuse: a code belonging to a DIFFERENT studio must come back as a
// clean "not found," identical to a genuinely invalid code -- never
// distinguishable from it, and never leaking that a real record exists at
// another studio the caller has no access to.
const router = Router();
router.use(requireAuth);

// ShortLink.targetUrl and a gift card's own public page both only ever
// store/link to a full web-app URL, never a type+id pair -- the record
// type is identified purely by pattern-matching the path segment, same as
// every other consumer of one of these links has to. Only gift cards are
// wired to a real staff destination in this pass (the task's own "gift
// cards first"); every other known shape this app's shortenUrl() ever
// produces (deposit, waiver, estimate, estimate-revision, flash-payment,
// schedule, flash gallery, intake, the policy pages) is reported as a
// recognized-but-unsupported record type rather than silently folded into
// "not found" -- that distinction costs nothing (it's derived from the URL
// string alone, no DB lookup, so it can't leak anything studio-specific)
// and is more honest than pretending the code doesn't exist.
const KNOWN_UNSUPPORTED_PATTERNS: Array<{ recordType: string; pattern: RegExp }> = [
  { recordType: "deposit", pattern: /^\/deposit\/[^/]+$/ },
  { recordType: "waiver", pattern: /^\/waiver\/[^/]+$/ },
  { recordType: "estimate", pattern: /^\/estimate\/[^/]+$/ },
  { recordType: "estimateRevision", pattern: /^\/estimate-revision\/[^/]+$/ },
  { recordType: "flashPayment", pattern: /^\/flash-payment\/[^/]+$/ },
  { recordType: "selfSchedule", pattern: /^\/schedule\/[^/]+$/ },
  { recordType: "flashGallery", pattern: /^\/flash\/[^/]+\/[^/]+$/ },
  { recordType: "intake", pattern: /^\/inquiry\/[^/]+/ },
  { recordType: "policy", pattern: /^\/(policies|privacy|terms|refund-policy|deposit-policy|reschedule-policy|communication-policy)\/[^/]+$/ },
];

type ResolveResult = { status: 200; body: Record<string, unknown> } | { status: 404; body: { error: string } };

const NOT_FOUND: ResolveResult = { status: 404, body: { error: "Code not found" } };

// Shared by both the QR-scanned "/gift-card/:code" page URL and manual
// entry of the bare code printed under it -- same cross-studio-safe
// collapsing as the short-link path below: a real card at a studio this
// caller can't see resolves identically to a code that doesn't exist at
// all.
async function resolveGiftCardCode(code: string, user: Express.Request["user"]): Promise<ResolveResult> {
  const card = await prisma.giftCard.findUnique({ where: { code }, select: { id: true, studioId: true } });
  if (!card || !(await callerBelongsToStudio(user!, card.studioId)) || !(await hasPermissionAt(user!, card.studioId, "giftCards.view"))) {
    return NOT_FOUND;
  }
  return { status: 200, body: { recordType: "giftCard", giftCardId: card.id } };
}

async function resolvePath(path: string, user: Express.Request["user"]): Promise<ResolveResult> {
  const giftCardMatch = /^\/gift-card\/([^/]+)$/.exec(path);
  if (giftCardMatch) {
    return resolveGiftCardCode(giftCardMatch[1] as string, user);
  }

  // Only ever texted (shortened for SMS length, not itself the thing a QR
  // is generated from today), but resolved generically here in case that
  // changes -- one level of indirection, since a ShortLink's own target is
  // never another short link.
  const shortLinkMatch = /^\/s\/([^/]+)$/.exec(path);
  if (shortLinkMatch) {
    const link = await prisma.shortLink.findUnique({ where: { code: shortLinkMatch[1] as string } });
    if (!link) return NOT_FOUND;

    let targetPath: string;
    try {
      targetPath = new URL(link.targetUrl).pathname;
    } catch {
      return NOT_FOUND;
    }
    return resolvePath(targetPath, user);
  }

  const known = KNOWN_UNSUPPORTED_PATTERNS.find((entry) => entry.pattern.test(path));
  if (known) {
    return { status: 200, body: { recordType: known.recordType, supported: false } };
  }

  return NOT_FOUND;
}

router.get("/resolve/:code", async (req, res) => {
  // Route param is named :code for readability, but it doubles as the raw
  // scanned/typed input -- a QR decode returns the full page URL a client's
  // browser was showing (e.g. .../gift-card/abc123), while manual entry is
  // just the bare code printed under it. Both arrive here as one string;
  // whether it parses as a URL decides which path below handles it.
  const raw = req.params.code as string;

  let pathname: string | null;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = null;
  }

  const result = pathname !== null ? await resolvePath(pathname, req.user) : await resolveGiftCardCode(raw, req.user);
  res.status(result.status).json(result.body);
});

export default router;
