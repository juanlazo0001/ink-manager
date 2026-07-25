import { prisma } from "./prisma";
import { slugify } from "./slug";

// Unique within the studio only (not globally, unlike Studio.slug) -- same
// convention as generateUniqueIntakeFormSlug in lib/intakeForms.ts.
export async function generateUniqueServiceSlug(studioId: string, name: string): Promise<string> {
  const base = slugify(name) || "service";
  let candidate = base;
  let suffix = 2;

  while (await prisma.service.findUnique({ where: { studioId_slug: { studioId, slug: candidate } } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

// Which of the studio's services a submission through a given IntakeForm is
// for -- every Service points at exactly one form (Service.intakeFormId is
// required), so the form a client submitted through identifies the service
// unambiguously. Falls back to the studio's "tattoo" service only if
// somehow no active service points at this form (shouldn't happen once the
// backfill migration has run, since every studio's default form always has
// its Tattoo service pointing at it) -- this keeps a brand-new form that
// hasn't been attached to a service yet from hard-failing every submission.
export async function resolveServiceForIntakeForm(
  studioId: string,
  intakeFormId: string,
): Promise<{ id: string; requiresCandidacyReview: boolean } | null> {
  const direct = await prisma.service.findFirst({
    where: { studioId, intakeFormId, isActive: true },
    select: { id: true, requiresCandidacyReview: true },
  });
  if (direct) return direct;

  return prisma.service.findFirst({
    where: { studioId, slug: "tattoo" },
    select: { id: true, requiresCandidacyReview: true },
  });
}
