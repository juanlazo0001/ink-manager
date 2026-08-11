import { prisma } from "./prisma";
import { AppointmentStatus, InquiryStatus, StudioMembershipType } from "../../generated/prisma/enums";

// Transfer-to-artist epic, Part 2: the same "one function, called by both the
// preview GET and the confirm POST" shape clients.ts's own
// gatherClientDeletionSummary uses -- the preview screen and the write that
// actually creates the ArtistTransfer must never be able to disagree about
// what's eligible or what moves.

// A client's work state only carries over if the project isn't already
// closed out -- same terminal set the epic's own schema comments describe
// (TRANSFERRED itself is here too, defensively, in case this ever runs
// against a client who was already transferred once and picked up a new
// assigned project since).
export const TERMINAL_INQUIRY_STATUSES: InquiryStatus[] = [
  InquiryStatus.CLOSED_LOST,
  InquiryStatus.COLD_LEAD,
  InquiryStatus.TRANSFERRED,
];

// Still-live appointments a transfer's execution (Part 4) would cancel --
// COMPLETED/CANCELLED/NO_SHOW are already terminal and irrelevant to a
// forward-looking preview.
const CANCELLABLE_APPOINTMENT_STATUSES: AppointmentStatus[] = [AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED];

// Named explicitly per the epic's own instruction, not inferred from data --
// every one of these record types stays at origin, full history intact, on
// every transfer this feature will ever execute.
const STAYS_AT_ORIGIN = [
  "Signed documents (liability waivers, deposit forms)",
  "Financial records (deposits, gift cards, payment history)",
  "Internal notes",
];

export interface TransferPreviewClient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  openProject: { id: string; description: string; status: InquiryStatus } | null;
  futureAppointments: { id: string; startTime: Date; endTime: Date }[];
}

export interface TransferPreview {
  eligible: boolean;
  ineligibleReason: string | null;
  artist: { id: string; name: string } | null;
  originStudio: { id: string; name: string };
  destinationStudio: { id: string; name: string } | null;
  clients: TransferPreviewClient[];
  // clientIds that were asked for but don't actually belong to this studio --
  // never silently dropped, since that could move fewer clients than staff
  // explicitly selected.
  invalidClientIds: string[];
  totalFutureAppointmentsToCancel: number;
  staysAtOrigin: string[];
  ready: boolean;
}

export async function gatherTransferPreview(
  originStudioId: string,
  artistId: string,
  clientIds: string[],
): Promise<TransferPreview> {
  const [originStudio, artist] = await Promise.all([
    prisma.studio.findUnique({ where: { id: originStudioId }, select: { id: true, name: true } }),
    prisma.artist.findUnique({
      where: { id: artistId },
      select: { id: true, user: { select: { name: true, email: true, studioId: true } } },
    }),
  ]);

  if (!originStudio) {
    throw new Error("Origin studio not found");
  }

  const emptyClients: TransferPreviewClient[] = [];

  if (!artist) {
    return {
      eligible: false,
      ineligibleReason: "Artist not found.",
      artist: null,
      originStudio,
      destinationStudio: null,
      clients: emptyClients,
      invalidClientIds: clientIds,
      totalFutureAppointmentsToCancel: 0,
      staysAtOrigin: STAYS_AT_ORIGIN,
      ready: false,
    };
  }

  const artistName = artist.user.name || artist.user.email;

  const [hasOriginMembership, homeMembership] = await Promise.all([
    prisma.studioMembership.findFirst({ where: { studioId: originStudioId, artistId }, select: { id: true } }),
    prisma.studioMembership.findFirst({
      where: { artistId, type: StudioMembershipType.HOME, endedAt: null },
      select: { studio: { select: { id: true, name: true } } },
    }),
  ]);

  let eligible = true;
  let ineligibleReason: string | null = null;
  const destinationStudio = homeMembership?.studio ?? null;

  if (!hasOriginMembership) {
    eligible = false;
    ineligibleReason = "This artist has never had a membership at your studio.";
  } else if (!destinationStudio) {
    eligible = false;
    ineligibleReason = "This artist doesn't currently have a home studio.";
  } else if (destinationStudio.id === originStudioId) {
    eligible = false;
    ineligibleReason = "This artist's home studio is already here -- there's nowhere to transfer to.";
  }

  const uniqueClientIds = [...new Set(clientIds)];
  const clientRows =
    uniqueClientIds.length === 0
      ? []
      : await prisma.client.findMany({
          where: { id: { in: uniqueClientIds }, studioId: originStudioId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            inquiries: {
              where: { assignedArtistId: artistId, status: { notIn: TERMINAL_INQUIRY_STATUSES } },
              select: { id: true, description: true, status: true, createdAt: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            appointments: {
              where: {
                artistId,
                startTime: { gte: new Date() },
                status: { in: CANCELLABLE_APPOINTMENT_STATUSES },
              },
              select: { id: true, startTime: true, endTime: true },
              orderBy: { startTime: "asc" },
            },
          },
        });

  const foundIds = new Set(clientRows.map((c) => c.id));
  const invalidClientIds = uniqueClientIds.filter((id) => !foundIds.has(id));

  const clients: TransferPreviewClient[] = clientRows.map((c) => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName}`.trim(),
    email: c.email,
    phone: c.phone,
    openProject: c.inquiries[0] ? { id: c.inquiries[0].id, description: c.inquiries[0].description, status: c.inquiries[0].status } : null,
    futureAppointments: c.appointments,
  }));

  const totalFutureAppointmentsToCancel = clients.reduce((sum, c) => sum + c.futureAppointments.length, 0);

  return {
    eligible,
    ineligibleReason,
    artist: { id: artist.id, name: artistName },
    originStudio,
    destinationStudio,
    clients,
    invalidClientIds,
    totalFutureAppointmentsToCancel,
    staysAtOrigin: STAYS_AT_ORIGIN,
    ready: eligible && clients.length > 0 && invalidClientIds.length === 0,
  };
}
