import { prisma } from "../prisma";
import { InquiryStatus } from "../../../generated/prisma/enums";
import { truncate, type SystemTask, type TaskSource } from "./types";

// Artist estimate parity, Part 3: when a studio has inquiries.
// artistSendEstimate turned OFF, an artist's own PATCH /:id/respond APPROVE
// (routes/inquiries.ts) saves the estimate (price/time, or a full session
// plan) but never sends it -- lib/estimates.ts's saveEstimateDraft
// deliberately leaves status at ARTIST_ASSIGNED and estimateSentAt null,
// since nothing has actually reached the client yet. priceEstimateLow being
// set is what distinguishes "an estimate was actually entered and saved"
// from the ordinary pre-estimate ARTIST_ASSIGNED state every inquiry passes
// through first -- saveEstimateDraft's own validation never lets it save
// without one. Once front desk sends (Generate & Send Estimate) or the
// artist's own permission gets turned back on and they send directly,
// estimateSentAt stops being null and this stops matching -- no separate
// dismissal-clearing needed.
async function fetch(studioId: string, _userId: string): Promise<SystemTask[]> {
  const pending = await prisma.inquiry.findMany({
    where: {
      studioId,
      status: InquiryStatus.ARTIST_ASSIGNED,
      assignedArtistId: { not: null },
      estimateSentAt: null,
      priceEstimateLow: { not: null },
    },
    select: { id: true, updatedAt: true, client: { select: { firstName: true, lastName: true } } },
    orderBy: { updatedAt: "asc" },
  });

  return pending.map((inquiry) => ({
    type: "ARTIST_ESTIMATE_NEEDS_REVIEW",
    title: `Artist estimate ready to send — ${truncate(`${inquiry.client.firstName} ${inquiry.client.lastName}`)}`,
    entityType: "Inquiry",
    entityId: inquiry.id,
    dismissalKey: inquiry.id,
    deepLink: `/inquiries/${inquiry.id}`,
    actionableAt: inquiry.updatedAt,
  }));
}

export const artistEstimateNeedsReviewSource: TaskSource = {
  type: "ARTIST_ESTIMATE_NEEDS_REVIEW",
  label: "Artist prepared an estimate — needs review & send",
  fetch,
};
