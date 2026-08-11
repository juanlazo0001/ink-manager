import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role, StudioMembershipType, TransferStatus } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import { logAudit } from "../lib/audit";
import { emitInvalidation } from "../lib/realtime/registry";
import { gatherTransferPreview, TERMINAL_INQUIRY_STATUSES } from "../lib/artistTransferPreview";

// Transfer-to-artist epic, Part 2 (origin flow). Every route here is
// OWNER-only, hardcoded -- same trust tier as studios.ts's own
// /:studioId/artists/:artistId/remove (ending/redirecting an artist's
// relationship with the studio is kept off the configurable permission
// matrix regardless of what a studio grants FRONT_DESK/ARTIST). The
// studioId-in-path check below mirrors that same route's bare
// `studioId !== req.user!.studioId` guard -- a pure staff OWNER's own
// studioId is immutable post-creation (only artist mobility features move a
// User's home), so this isn't the JWT-staleness case artistAccess.ts exists
// for.
const router = Router();
router.use(requireAuth);
router.use(requireRole(Role.OWNER));

const NOT_MERGED = { mergedIntoId: null } as const;
const NOT_ARCHIVED = { archivedAt: null } as const;

function requireOwnStudio(req: Request, res: Response, studioId: string): boolean {
  if (studioId !== req.user!.studioId) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// Every artist with a past-or-present membership at this studio, annotated
// with their current home studio (the only valid transfer destination) and
// whether that makes them eligible -- the "already-left" artist (no active
// membership here anymore) is the primary case per the epic's own design,
// which is why this queries ALL memberships, not just endedAt: null ones.
router.get("/:studioId/artist-transfers/eligible-artists", async (req, res) => {
  const studioId = req.params.studioId as string;
  if (!requireOwnStudio(req, res, studioId)) return;

  const memberships = await prisma.studioMembership.findMany({
    where: { studioId },
    select: { artistId: true },
    distinct: ["artistId"],
  });
  const artistIds = memberships.map((m) => m.artistId);
  if (artistIds.length === 0) {
    return res.json([]);
  }

  const [artists, homeMemberships] = await Promise.all([
    prisma.artist.findMany({
      where: { id: { in: artistIds } },
      select: { id: true, user: { select: { name: true, email: true } } },
    }),
    prisma.studioMembership.findMany({
      where: { artistId: { in: artistIds }, type: StudioMembershipType.HOME, endedAt: null },
      select: { artistId: true, studio: { select: { id: true, name: true } } },
    }),
  ]);
  const homeByArtist = new Map(homeMemberships.map((m) => [m.artistId, m.studio]));

  const results = artists.map((artist) => {
    const destinationStudio = homeByArtist.get(artist.id) ?? null;
    let eligible = true;
    let ineligibleReason: string | null = null;
    if (!destinationStudio) {
      eligible = false;
      ineligibleReason = "This artist doesn't currently have a home studio.";
    } else if (destinationStudio.id === studioId) {
      eligible = false;
      ineligibleReason = "This artist's home studio is already here -- there's nowhere to transfer to.";
    }
    return {
      artistId: artist.id,
      name: artist.user.name || artist.user.email,
      eligible,
      ineligibleReason,
      destinationStudio,
    };
  });

  results.sort((a, b) => (a.eligible === b.eligible ? a.name.localeCompare(b.name) : a.eligible ? -1 : 1));

  res.json(results);
});

// No `search`: clients already tied to this artist's work at this studio
// (default filter). With `search`: any client in the studio, so "any client
// addable" (the epic's own requirement) works -- same word-split AND/OR
// search shape as clients.ts's own /merge-search.
router.get("/:studioId/artist-transfers/artists/:artistId/clients", async (req, res) => {
  const studioId = req.params.studioId as string;
  if (!requireOwnStudio(req, res, studioId)) return;
  const artistId = req.params.artistId as string;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

  const baseWhere: Prisma.ClientWhereInput = { studioId, ...NOT_MERGED, ...NOT_ARCHIVED };
  const where: Prisma.ClientWhereInput =
    search.length >= 2
      ? {
          ...baseWhere,
          AND: search.split(/\s+/).filter(Boolean).map((word) => {
            const contains = { contains: word, mode: "insensitive" as const };
            return { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }] };
          }),
        }
      : {
          ...baseWhere,
          OR: [{ inquiries: { some: { assignedArtistId: artistId } } }, { appointments: { some: { artistId } } }],
        };

  const clients = await prisma.client.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      inquiries: {
        where: { assignedArtistId: artistId, status: { notIn: TERMINAL_INQUIRY_STATUSES } },
        select: { id: true, description: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json(
    clients.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      openProject: c.inquiries[0] ?? null,
    })),
  );
});

router.get("/:studioId/artist-transfers/preview", async (req, res) => {
  const studioId = req.params.studioId as string;
  if (!requireOwnStudio(req, res, studioId)) return;

  const artistId = typeof req.query.artistId === "string" ? req.query.artistId : "";
  if (!artistId) {
    return res.status(400).json({ error: "artistId is required" });
  }
  const clientIds =
    typeof req.query.clientIds === "string" && req.query.clientIds.length > 0 ? req.query.clientIds.split(",") : [];

  const preview = await gatherTransferPreview(studioId, artistId, clientIds);
  res.json(preview);
});

router.get("/:studioId/artist-transfers", async (req, res) => {
  const studioId = req.params.studioId as string;
  if (!requireOwnStudio(req, res, studioId)) return;

  const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
  const status =
    statusParam && (Object.values(TransferStatus) as string[]).includes(statusParam)
      ? (statusParam as TransferStatus)
      : undefined;

  const transfers = await prisma.artistTransfer.findMany({
    where: { originStudioId: studioId, ...(status ? { status } : {}) },
    include: {
      artist: { select: { id: true, user: { select: { name: true, email: true } } } },
      destinationStudio: { select: { id: true, name: true } },
      lineItems: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    transfers.map((t) => ({
      id: t.id,
      status: t.status,
      createdAt: t.createdAt,
      artistId: t.artistId,
      artistName: t.artist.user.name || t.artist.user.email,
      destinationStudio: t.destinationStudio,
      clientCount: t.lineItems.length,
    })),
  );
});

router.post("/:studioId/artist-transfers", async (req, res) => {
  const studioId = req.params.studioId as string;
  if (!requireOwnStudio(req, res, studioId)) return;

  const { artistId, clientIds } = req.body as { artistId?: string; clientIds?: string[] };
  if (!artistId || !Array.isArray(clientIds) || clientIds.length === 0) {
    return res.status(400).json({ error: "artistId and at least one clientId are required" });
  }

  // Re-runs the exact same gathering the review screen showed -- never
  // trusts a client-submitted preview, so the two can never disagree.
  const preview = await gatherTransferPreview(studioId, artistId, clientIds);
  if (!preview.ready || !preview.destinationStudio) {
    return res.status(400).json({ error: preview.ineligibleReason ?? "This transfer isn't ready to confirm." });
  }

  const transfer = await prisma.artistTransfer.create({
    data: {
      originStudioId: studioId,
      destinationStudioId: preview.destinationStudio.id,
      artistId,
      initiatedById: req.user!.userId,
      lineItems: {
        create: preview.clients.map((c) => ({
          originClientId: c.id,
          originInquiryId: c.openProject?.id ?? null,
        })),
      },
    },
    include: { lineItems: true },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "ArtistTransfer",
    entityId: transfer.id,
    action: "initiated",
    changes: {
      artistId,
      artistName: preview.artist?.name,
      destinationStudioId: preview.destinationStudio.id,
      destinationStudioName: preview.destinationStudio.name,
      clientCount: preview.clients.length,
      clientIds: preview.clients.map((c) => c.id),
    },
  });

  emitInvalidation({ type: "transfer.changed", studioId, artistId });

  res.status(201).json(transfer);
});

router.post("/:studioId/artist-transfers/:transferId/cancel", async (req, res) => {
  const studioId = req.params.studioId as string;
  if (!requireOwnStudio(req, res, studioId)) return;
  const transferId = req.params.transferId as string;

  const transfer = await prisma.artistTransfer.findUnique({ where: { id: transferId } });
  if (!transfer || transfer.originStudioId !== studioId) {
    return res.status(404).json({ error: "Transfer not found" });
  }
  if (transfer.status !== TransferStatus.PENDING_ARTIST) {
    return res.status(409).json({ error: "This transfer has already been responded to and can no longer be cancelled." });
  }

  const updated = await prisma.artistTransfer.update({
    where: { id: transferId },
    data: { status: TransferStatus.CANCELLED_BY_ORIGIN, cancelledAt: new Date(), cancelledById: req.user!.userId },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "ArtistTransfer",
    entityId: transfer.id,
    action: "cancelled",
    changes: { artistId: transfer.artistId },
  });

  emitInvalidation({ type: "transfer.changed", studioId, artistId: transfer.artistId });

  res.json(updated);
});

export default router;
