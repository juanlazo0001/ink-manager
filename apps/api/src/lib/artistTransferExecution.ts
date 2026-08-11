import { prisma } from "./prisma";
import { AppointmentStatus, Channel, InquiryStatus, TransferLineItemOutcome, TransferStatus } from "../../generated/prisma/enums";
import type { ArtistTransfer, ArtistTransferClient } from "../../generated/prisma/client";
import { createClientFromFields } from "./clientContacts";
import { findMatchingClientForImportRow } from "./duplicateDetection";
import { generateUniqueReferralCode } from "./referrals";
import { logAudit } from "./audit";
import { emitInvalidation } from "./realtime/registry";

// Transfer-to-artist epic, Part 4 (execution). Called from POST
// /artist-transfers/:id/accept -- both on the real accept (PENDING_ARTIST
// -> ACCEPTED) and as a resume (already ACCEPTED, a prior run didn't
// finish). Resumable/idempotent by construction: only ever processes line
// items still `outcome: PENDING` (the @@unique([transferId,
// originClientId]) + processedAt pair from Part 1's schema is what makes a
// second call safe -- already-CREATED/MERGE_FLAGGED/FAILED line items are
// never touched again).
//
// Reads (duplicate-contact check, origin client/inquiry/service lookups)
// happen with the plain `prisma` client, before opening a transaction --
// findMatchingClientForImportRow (lib/duplicateDetection.ts) isn't
// parameterized to accept a transaction client, same as mass import's own
// use of it. Only the actual writes for one client are wrapped in
// `prisma.$transaction` -- "transactional per client" per the epic's own
// wording, not one giant transaction for the whole batch (a single bad
// client fails that client alone, same "clientImport.ts" philosophy this
// whole engine is modeled on).

interface ClientExecutionResult {
  lineItemId: string;
  originClientId: string;
  originInquiryId: string | null;
  outcome: TransferLineItemOutcome;
  destinationClientId?: string;
  destinationInquiryId?: string;
  errorMessage?: string;
  cancelledAppointmentCount: number;
}

async function resolveDestinationService(destinationStudioId: string, originSlug: string | undefined, originName: string | undefined) {
  if (originSlug) {
    const bySlug = await prisma.service.findFirst({ where: { studioId: destinationStudioId, slug: originSlug, isActive: true } });
    if (bySlug) return bySlug;
  }
  if (originName) {
    const byName = await prisma.service.findFirst({
      where: { studioId: destinationStudioId, name: { equals: originName, mode: "insensitive" }, isActive: true },
    });
    if (byName) return byName;
  }
  return prisma.service.findFirst({ where: { studioId: destinationStudioId, isActive: true }, orderBy: { createdAt: "asc" } });
}

async function markFailed(lineItemId: string, errorMessage: string): Promise<void> {
  await prisma.artistTransferClient.update({
    where: { id: lineItemId },
    data: { outcome: TransferLineItemOutcome.FAILED, errorMessage, processedAt: new Date() },
  });
}

async function processLineItem(
  transfer: ArtistTransfer,
  lineItem: ArtistTransferClient,
  destinationStudioName: string,
): Promise<ClientExecutionResult> {
  const base = { lineItemId: lineItem.id, originClientId: lineItem.originClientId, originInquiryId: lineItem.originInquiryId, cancelledAppointmentCount: 0 };

  const originClient = await prisma.client.findUnique({ where: { id: lineItem.originClientId } });
  if (!originClient) {
    await markFailed(lineItem.id, "Origin client no longer exists.");
    return { ...base, outcome: TransferLineItemOutcome.FAILED, errorMessage: "Origin client no longer exists." };
  }

  const originInquiry = lineItem.originInquiryId ? await prisma.inquiry.findUnique({ where: { id: lineItem.originInquiryId } }) : null;
  const originService = originInquiry ? await prisma.service.findUnique({ where: { id: originInquiry.serviceId } }) : null;

  const service = await resolveDestinationService(transfer.destinationStudioId, originService?.slug, originService?.name);
  if (!service) {
    const errorMessage = "Destination studio has no service configured.";
    await markFailed(lineItem.id, errorMessage);
    return { ...base, outcome: TransferLineItemOutcome.FAILED, errorMessage };
  }

  // Destination-side duplicate check: matches raise a merge flag for
  // destination staff to review -- never a silent auto-merge. Crucially,
  // a match means NO new Client row is created at all (Part 5's own
  // "zero duplicate records" requirement) -- the new project just attaches
  // to the client that's already there.
  const match = await findMatchingClientForImportRow(transfer.destinationStudioId, originClient.phone, originClient.email);

  const [secondaryPhones, secondaryEmails, plannedSessions] = await Promise.all([
    match ? Promise.resolve([]) : prisma.clientPhone.findMany({ where: { clientId: originClient.id, isPrimary: false } }),
    match ? Promise.resolve([]) : prisma.clientEmail.findMany({ where: { clientId: originClient.id, isPrimary: false } }),
    originInquiry ? prisma.plannedSession.findMany({ where: { inquiryId: originInquiry.id } }) : Promise.resolve([]),
  ]);

  try {
    const now = new Date();
    const txResult = await prisma.$transaction(async (tx) => {
      let destinationClientId: string;
      let outcome: TransferLineItemOutcome;

      if (match) {
        destinationClientId = match.id;
        outcome = TransferLineItemOutcome.MERGE_FLAGGED;
      } else {
        const referralCode = await generateUniqueReferralCode();
        const newClient = await createClientFromFields(tx, {
          studioId: transfer.destinationStudioId,
          firstName: originClient.firstName,
          lastName: originClient.lastName,
          email: originClient.email,
          phone: originClient.phone,
          instagramHandle: originClient.instagramHandle,
          facebookProfileUrl: originClient.facebookProfileUrl,
          otherContact: originClient.otherContact,
          address: originClient.address,
          referralCode,
        });
        destinationClientId = newClient.id;
        outcome = TransferLineItemOutcome.CREATED;

        // createClientFromFields already synced the PRIMARY phone/email
        // alias from the scalar fields above -- this copies any additional
        // secondary aliases the origin client had on file, so "phones,
        // emails" (plural, per the epic's own wording) genuinely carries
        // over, not just the one primary each.
        for (const p of secondaryPhones) {
          await tx.clientPhone.upsert({
            where: { clientId_phone: { clientId: destinationClientId, phone: p.phone } },
            update: {},
            create: { clientId: destinationClientId, phone: p.phone, isPrimary: false },
          });
        }
        for (const e of secondaryEmails) {
          await tx.clientEmail.upsert({
            where: { clientId_email: { clientId: destinationClientId, email: e.email } },
            update: {},
            create: { clientId: destinationClientId, email: e.email, isPrimary: false },
          });
        }
      }

      // Fresh open project carrying work state -- lands in SCHEDULING
      // (closest existing status to "needs scheduling, no appointment
      // exists yet"; there's no literal such value in InquiryStatus).
      // No InquiryNote copied -- internal notes stay at origin, per spec.
      const newInquiry = await tx.inquiry.create({
        data: {
          studioId: transfer.destinationStudioId,
          clientId: destinationClientId,
          serviceId: service.id,
          assignedArtistId: transfer.artistId,
          preferredArtistId: transfer.artistId,
          channel: originInquiry?.channel ?? Channel.PHONE,
          description: originInquiry?.description ?? "Transferred client -- no active project details from origin.",
          colorOrBlackGrey: originInquiry?.colorOrBlackGrey ?? "Not specified",
          placement: originInquiry?.placement ?? "Not specified",
          estimatedSize: originInquiry?.estimatedSize ?? "Not specified",
          hasBeenTattooedBefore: originInquiry?.hasBeenTattooedBefore ?? false,
          budget: originInquiry?.budget ?? null,
          desiredTiming: originInquiry?.desiredTiming ?? null,
          priceEstimateLow: originInquiry?.priceEstimateLow ?? null,
          priceEstimateHigh: originInquiry?.priceEstimateHigh ?? null,
          timeEstimateHoursMin: originInquiry?.timeEstimateHoursMin ?? null,
          timeEstimateHoursMax: originInquiry?.timeEstimateHoursMax ?? null,
          referenceImages: originInquiry?.referenceImages ?? [],
          placementImages: originInquiry?.placementImages ?? [],
          status: InquiryStatus.SCHEDULING,
        },
      });

      // "Session plan" -- recreated fresh against the new project, never
      // carrying depositFormId (financial, stays at origin) or
      // appointmentId (origin-specific; the new project starts with no
      // appointment by design).
      for (const ps of plannedSessions) {
        await tx.plannedSession.create({
          data: {
            inquiryId: newInquiry.id,
            sessionNumber: ps.sessionNumber,
            estimatedHoursMin: ps.estimatedHoursMin,
            estimatedHoursMax: ps.estimatedHoursMax,
            estimatedPriceLow: ps.estimatedPriceLow,
            estimatedPriceHigh: ps.estimatedPriceHigh,
            showDurationToClient: ps.showDurationToClient,
          },
        });
      }

      // Cancel this client's future appointments with this artist at
      // origin, visibly -- past appointments untouched.
      const futureAppointments = await tx.appointment.findMany({
        where: {
          studioId: transfer.originStudioId,
          clientId: originClient.id,
          artistId: transfer.artistId,
          startTime: { gte: now },
          status: { in: [AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED] },
        },
      });
      for (const appt of futureAppointments) {
        await tx.appointment.update({ where: { id: appt.id }, data: { status: AppointmentStatus.CANCELLED } });
        await tx.appointmentNote.create({
          data: {
            studioId: transfer.originStudioId,
            appointmentId: appt.id,
            // Reconsidered live during Part 5's browser walkthrough:
            // authorId: null was the original choice here (reasoning: "no
            // human clicked this, null is more honest"), but every
            // existing note-rendering call site across this app
            // (NotesSection.tsx, ClientDetail.tsx, MyProjectDetail.tsx)
            // treats a null author as "Deleted user" -- a label written
            // for the case of a real author whose account was later
            // removed, not "never had one." That reads as misleading here,
            // not honest. Attributing it to the artist who accepted (the
            // same actor the AuditLog rows for this whole execution
            // already use) is both more accurate -- their accept action is
            // literally what caused this cancellation -- and avoids the
            // mislabel.
            authorId: transfer.respondedById,
            bodyHtml: `<p>Cancelled: client transferred to ${destinationStudioName}.</p>`,
          },
        });
      }

      // Origin resolves as Transferred -- ended, full history intact,
      // never deleted. Nothing signed/financial/note-shaped touched.
      await tx.client.update({
        where: { id: originClient.id },
        data: { transferredAt: now, transferredToStudioId: transfer.destinationStudioId },
      });
      if (originInquiry) {
        await tx.inquiry.update({
          where: { id: originInquiry.id },
          data: {
            status: InquiryStatus.TRANSFERRED,
            transferredAt: now,
            transferredToStudioId: transfer.destinationStudioId,
            transferredToInquiryId: newInquiry.id,
          },
        });
      }

      await tx.artistTransferClient.update({
        where: { id: lineItem.id },
        data: { outcome, destinationClientId, destinationInquiryId: newInquiry.id, processedAt: now },
      });

      return { destinationClientId, destinationInquiryId: newInquiry.id, outcome, cancelledAppointmentCount: futureAppointments.length };
    });

    await logAudit({
      studioId: transfer.originStudioId,
      actorUserId: transfer.respondedById,
      entityType: "Client",
      entityId: originClient.id,
      action: "transferred",
      changes: {
        destinationStudioId: transfer.destinationStudioId,
        destinationClientId: txResult.destinationClientId,
        destinationInquiryId: txResult.destinationInquiryId,
        outcome: txResult.outcome,
        cancelledAppointmentCount: txResult.cancelledAppointmentCount,
      },
    });

    // Adversarial-review fix (Part 5): the row above is origin-only, by
    // this file's own established "one row, other studio folded into
    // changes" convention for a single cross-studio ACTION (matches
    // Part 3's accept/decline). But client/project creation is a second,
    // genuinely distinct, destination-scoped mutation -- without this,
    // destination staff had no activity-log explanation at all for why an
    // unfamiliar client/project just appeared in their own studio.
    await logAudit({
      studioId: transfer.destinationStudioId,
      actorUserId: transfer.respondedById,
      entityType: "Client",
      entityId: txResult.destinationClientId,
      action: "arrived_via_transfer",
      changes: {
        originStudioId: transfer.originStudioId,
        originClientId: originClient.id,
        destinationInquiryId: txResult.destinationInquiryId,
        outcome: txResult.outcome,
      },
    });

    return { ...base, outcome: txResult.outcome, destinationClientId: txResult.destinationClientId, destinationInquiryId: txResult.destinationInquiryId, cancelledAppointmentCount: txResult.cancelledAppointmentCount };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    await markFailed(lineItem.id, errorMessage);
    return { ...base, outcome: TransferLineItemOutcome.FAILED, errorMessage };
  }
}

export async function executeArtistTransfer(transferId: string) {
  const transfer = await prisma.artistTransfer.findUnique({ where: { id: transferId } });
  if (!transfer || transfer.status !== TransferStatus.ACCEPTED) {
    return { transfer, results: [] as ClientExecutionResult[] };
  }

  const destinationStudio = await prisma.studio.findUnique({ where: { id: transfer.destinationStudioId }, select: { name: true } });
  const pendingLineItems = await prisma.artistTransferClient.findMany({
    where: { transferId, outcome: TransferLineItemOutcome.PENDING },
  });

  const results: ClientExecutionResult[] = [];
  for (const lineItem of pendingLineItems) {
    results.push(await processLineItem(transfer, lineItem, destinationStudio?.name ?? "the destination studio"));
  }

  const remainingPending = await prisma.artistTransferClient.count({
    where: { transferId, outcome: TransferLineItemOutcome.PENDING },
  });
  if (remainingPending === 0) {
    await prisma.artistTransfer.update({
      where: { id: transferId },
      data: { status: TransferStatus.COMPLETED, completedAt: new Date() },
    });
  }

  if (results.length > 0) {
    const createdCount = results.filter((r) => r.outcome === TransferLineItemOutcome.CREATED).length;
    const mergeFlaggedCount = results.filter((r) => r.outcome === TransferLineItemOutcome.MERGE_FLAGGED).length;
    const failedCount = results.filter((r) => r.outcome === TransferLineItemOutcome.FAILED).length;
    const anySuccess = createdCount + mergeFlaggedCount > 0;
    const anyCancelled = results.some((r) => r.cancelledAppointmentCount > 0);

    await logAudit({
      studioId: transfer.originStudioId,
      actorUserId: transfer.respondedById,
      entityType: "ArtistTransfer",
      entityId: transfer.id,
      action: "executed",
      changes: { createdCount, mergeFlaggedCount, failedCount, completed: remainingPending === 0 },
    });

    // Realtime, both studios -- matches clientImport.ts's own "final
    // emitInvalidation calls after the loop, not per-row" shape.
    if (anySuccess) {
      emitInvalidation({ type: "client.imported", studioId: transfer.originStudioId });
      for (const r of results) {
        if (r.originInquiryId) {
          emitInvalidation({ type: "inquiry.updated", studioId: transfer.originStudioId, inquiryId: r.originInquiryId });
        }
      }
      emitInvalidation({ type: "client.imported", studioId: transfer.destinationStudioId });
      emitInvalidation({ type: "inquiry.created", studioId: transfer.destinationStudioId });
    }
    if (anyCancelled) {
      emitInvalidation({ type: "appointment.changed", studioId: transfer.originStudioId });
    }
    emitInvalidation({ type: "transfer.changed", studioId: transfer.originStudioId, artistId: transfer.artistId });
    emitInvalidation({ type: "transfer.changed", studioId: transfer.destinationStudioId, artistId: transfer.artistId });
  }

  const finalTransfer = await prisma.artistTransfer.findUnique({ where: { id: transferId } });
  return { transfer: finalTransfer, results };
}
