import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Channel } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";

const router = Router();

const REQUIRED_FIELDS = [
  "studioSlug",
  "firstName",
  "lastName",
  "email",
  "channel",
  "description",
  "colorOrBlackGrey",
  "placement",
  "estimatedSize",
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Public: the intake form is unauthenticated. Creates the Client (or reuses
// an existing one, matched by email within the studio) and the Inquiry
// together, so the studio's pipeline sees a single lead rather than a
// duplicate client every time the same person submits again.
router.post("/", async (req, res) => {
  const body = req.body ?? {};

  const missing = REQUIRED_FIELDS.filter((field) => !body[field]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  if (typeof body.hasBeenTattooedBefore !== "boolean") {
    return res.status(400).json({ error: "hasBeenTattooedBefore must be a boolean" });
  }

  if (!Object.values(Channel).includes(body.channel)) {
    return res.status(400).json({ error: `channel must be one of: ${Object.values(Channel).join(", ")}` });
  }

  if (body.referenceImages !== undefined && !isStringArray(body.referenceImages)) {
    return res.status(400).json({ error: "referenceImages must be an array of strings" });
  }

  if (body.placementImages !== undefined && !isStringArray(body.placementImages)) {
    return res.status(400).json({ error: "placementImages must be an array of strings" });
  }

  const {
    studioSlug,
    firstName,
    lastName,
    email,
    phone,
    channel,
    description,
    colorOrBlackGrey,
    placement,
    estimatedSize,
    hasBeenTattooedBefore,
    budget,
    desiredTiming,
    preferredArtistId,
    referenceImages,
    placementImages,
  } = body;

  const studio = await prisma.studio.findUnique({ where: { slug: studioSlug } });
  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  if (preferredArtistId) {
    const preferredArtist = await prisma.artist.findUnique({
      where: { id: preferredArtistId },
      include: { user: true },
    });

    if (!preferredArtist || preferredArtist.user.studioId !== studio.id) {
      return res.status(400).json({ error: "preferredArtistId must belong to this studio" });
    }
  }

  const existingClient = await prisma.client.findFirst({
    where: { studioId: studio.id, email },
  });

  const client =
    existingClient ??
    (await prisma.client.create({
      data: { studioId: studio.id, firstName, lastName, email, phone },
    }));

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId: studio.id,
      clientId: client.id,
      channel,
      description,
      colorOrBlackGrey,
      placement,
      estimatedSize,
      hasBeenTattooedBefore,
      budget,
      desiredTiming,
      preferredArtistId: preferredArtistId || null,
      referenceImages: referenceImages ?? [],
      placementImages: placementImages ?? [],
    },
  });

  res.status(201).json(inquiry);
});

const INQUIRY_INCLUDE = {
  client: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  preferredArtist: { select: { id: true, user: { select: { name: true } } } },
  assignedArtist: { select: { id: true, user: { select: { name: true } } } },
} as const;

// Staff-facing inbox: every inquiry submitted for this studio, newest first.
router.get("/", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const inquiries = await prisma.inquiry.findMany({
    where: { studioId: req.user!.studioId },
    include: INQUIRY_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  res.json(inquiries);
});

router.get("/:id", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, include: INQUIRY_INCLUDE });

  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  res.json(inquiry);
});

export default router;
