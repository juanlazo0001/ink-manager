import { prisma } from "../prisma";
import { TransferStatus } from "../../../generated/prisma/enums";
import { type SystemTask, type TaskSource } from "./types";

// Transfer-to-artist epic, Part 3. Deliberately NOT in TASK_SOURCE_REGISTRY
// (registry.ts), same reasoning as artistInvitePending.ts: this is personal
// to whoever the transfer's own artistId belongs to, not studioId-scoped
// front-desk work -- called directly from routes/tasks.ts's GET / instead,
// merged into `system` unconditionally regardless of tasks.viewQueue.
async function fetch(_studioId: string, userId: string): Promise<SystemTask[]> {
  const artist = await prisma.artist.findUnique({ where: { userId }, select: { id: true } });
  if (!artist) return [];

  const transfers = await prisma.artistTransfer.findMany({
    where: { artistId: artist.id, status: TransferStatus.PENDING_ARTIST },
    include: {
      originStudio: { select: { name: true } },
      destinationStudio: { select: { name: true } },
      lineItems: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return transfers.map((transfer) => {
    const clientCount = transfer.lineItems.length;
    return {
      type: "ARTIST_TRANSFER_PENDING",
      title: `${transfer.originStudio.name} wants ${clientCount} client${clientCount === 1 ? "" : "s"} to follow you to ${transfer.destinationStudio.name}`,
      entityType: "ArtistTransfer",
      entityId: transfer.id,
      // No resend concept for a transfer (unlike an invite's token), so
      // the transfer's own id is the dismissal key verbatim.
      dismissalKey: transfer.id,
      deepLink: `/my-transfers/${transfer.id}`,
      actionableAt: transfer.createdAt,
    };
  });
}

export const artistTransferPendingSource: TaskSource = {
  type: "ARTIST_TRANSFER_PENDING",
  label: "Client transfers awaiting your response",
  fetch,
};
