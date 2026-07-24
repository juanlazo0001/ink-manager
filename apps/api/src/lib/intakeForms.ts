import { prisma } from "./prisma";
import { slugify } from "./slug";

// Unique within the studio only (not globally, unlike Studio.slug) --
// set once at creation and never changed afterward (no route lets a form
// be renamed in a way that changes its slug), same immutable-after-first-
// share reasoning Studio.slug itself follows.
export async function generateUniqueIntakeFormSlug(studioId: string, name: string): Promise<string> {
  const base = slugify(name) || "form";
  let candidate = base;
  let suffix = 2;

  while (await prisma.intakeForm.findUnique({ where: { studioId_slug: { studioId, slug: candidate } } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

// Self-healing, same "backfill on read" convention as
// intakeFormFields.ts's ensureDefaultSystemFields -- a studio created
// before this feature shipped (or bootstrapped/seeded through a path that
// doesn't know about IntakeForm at all, e.g. POST /studios/bootstrap or
// prisma/seed.ts, neither of which was updated to create one directly)
// would otherwise have zero forms and no way to resolve "the default,"
// breaking its public intake form entirely. Idempotent: a studio that
// already has a default form just gets it back, no write.
async function ensureDefaultIntakeForm(studioId: string): Promise<{ id: string; name: string; slug: string }> {
  const existing = await prisma.intakeForm.findFirst({
    where: { studioId, isDefault: true },
    select: { id: true, name: true, slug: true },
  });
  if (existing) return existing;

  const slug = await generateUniqueIntakeFormSlug(studioId, "Standard Inquiry");
  return prisma.intakeForm.create({
    data: { studioId, name: "Standard Inquiry", slug, isDefault: true },
    select: { id: true, name: true, slug: true },
  });
}

// Resolves which of a studio's (possibly several) forms a request means:
// a specific one by slug if given, else whichever is currently the
// default -- the one shared resolution point for /studio-settings/public,
// POST /inquiries, and POST /prefill-drafts, so "no formSlug" always means
// exactly the same thing (today's default form) everywhere it's checked.
export async function resolveIntakeForm(
  studioId: string,
  formSlug?: string | null,
): Promise<{ id: string; name: string; slug: string } | null> {
  if (formSlug) {
    return prisma.intakeForm.findUnique({
      where: { studioId_slug: { studioId, slug: formSlug } },
      select: { id: true, name: true, slug: true },
    });
  }
  return ensureDefaultIntakeForm(studioId);
}

// Every studio must always have exactly one isDefault: true form -- this
// is the one place that invariant is enforced, called from every route
// that could otherwise violate it (create/update/delete in routes/
// intakeForms.ts). Swaps atomically: the previous default (if any, and if
// different from the target) flips false in the same transaction the
// target flips true in, so there's never a moment with zero or two
// defaults visible to a concurrent read.
export async function setDefaultIntakeForm(studioId: string, formId: string): Promise<void> {
  await prisma.$transaction([
    prisma.intakeForm.updateMany({
      where: { studioId, isDefault: true, id: { not: formId } },
      data: { isDefault: false },
    }),
    prisma.intakeForm.update({ where: { id: formId }, data: { isDefault: true } }),
  ]);
}
