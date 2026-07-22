import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import type { Prisma } from "../../generated/prisma/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { requirePermission } from "../lib/permissions";
import { diffObjects, logAudit } from "../lib/audit";
import { normalizePhone } from "../lib/phone";
import { syncPrimaryEmail, syncPrimaryPhone } from "../lib/clientContacts";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { shortenUrl } from "../lib/shortLinks";

const router = Router();

const CONSENT_FORM_TOKEN_TTL_HOURS = 48;

router.use(requireAuth);
router.use(requirePermission("clients.manage"));

router.post("/", async (req, res) => {
  const body = req.body ?? {};

  const missing = ["firstName", "lastName"].filter((field) => !body[field]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  const { firstName, lastName, email, phone } = body;

  const client = await prisma.$transaction(async (tx) => {
    const created = await tx.client.create({
      data: { firstName, lastName, email, phone: phone ? normalizePhone(phone) : phone, studioId: req.user!.studioId },
    });
    await syncPrimaryPhone(tx, created.id, created.phone);
    await syncPrimaryEmail(tx, created.id, created.email);
    return created;
  });

  res.status(201).json(client);
});

// Merged clients are folded into their survivor and excluded from every
// list -- they still exist (soft-merge), but shouldn't show up as if they
// were a separate active client.
const NOT_MERGED = { mergedIntoId: null } as const;

// Same exclude-from-default-list-views treatment as NOT_MERGED, but the
// underlying record is otherwise fully intact and directly reachable via
// GET /:id -- see Client.archivedAt.
const NOT_ARCHIVED = { archivedAt: null } as const;

router.get("/", async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { studioId: req.user!.studioId, ...NOT_MERGED, ...NOT_ARCHIVED },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(clients);
});

// Backs the manual-merge search picker (§2): find ANY client in the
// studio by name/email/phone, not just contact-matching auto-suggestions.
// A static path, so it must be registered before GET /:id below --
// otherwise Express would match "/merge-search" as :id.
router.get("/merge-search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const excludeId = typeof req.query.excludeId === "string" ? req.query.excludeId : undefined;

  if (q.length < 2) {
    return res.json([]);
  }

  // Split on whitespace and require every word to match SOME field --
  // otherwise a two-word query like "Casey Testperson" would never match
  // anything, since neither firstName nor lastName alone contains the full
  // string (the pitfall in the single-string `OR` the global omnibox search
  // uses, fine there since it's usually a single token).
  const words = q.split(/\s+/).filter(Boolean);
  const results = await prisma.client.findMany({
    where: {
      studioId: req.user!.studioId,
      ...NOT_MERGED,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      AND: words.map((word) => {
        const contains = { contains: word, mode: "insensitive" as const };
        return { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }] };
      }),
    },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  res.json(results);
});

router.get("/:id", async (req, res) => {
  const id = req.params.id as string;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      consentForms: { select: { id: true, signedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } },
      inquiries: {
        select: {
          id: true,
          description: true,
          status: true,
          channel: true,
          createdAt: true,
          // Needed to compute which inquiries are eligible for a "Send
          // Deposit Form" click on the client page (DEPOSIT_PENDING status
          // + both bounds set + not already signed -- same rule POST
          // /inquiries/:id/deposit-form itself enforces).
          priceEstimateLow: true,
          priceEstimateHigh: true,
          // AppointmentForm's suggested-times feature needs the artist's
          // own time estimate for this project to know how long a slot to
          // look for -- both bounds required before suggestions can use it
          // (see the max() logic in AppointmentForm.tsx).
          timeEstimateHoursMin: true,
          timeEstimateHoursMax: true,
          depositForm: {
            select: {
              id: true,
              depositAmount: true,
              feeAmount: true,
              totalCharged: true,
              signedAt: true,
              paidManually: true,
              paidAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      giftCards: {
        select: {
          id: true,
          code: true,
          amountCents: true,
          status: true,
          expiresAt: true,
          appointmentId: true,
          createdAt: true,
          exemptionReason: true,
        },
        orderBy: { createdAt: "desc" },
      },
      // Non-PII summary only -- the health data and ID image live behind
      // GET /waivers/:id, which is OWNER/FRONT_DESK only.
      liabilityWaivers: {
        select: { id: true, status: true, signedAt: true, verifiedAt: true, appointmentId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
      mergedInto: { select: { id: true, firstName: true, lastName: true } },
      phones: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      emails: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
    },
  });

  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  // A direct fetch of a merged client still succeeds (rather than 404) --
  // a stale bookmark, an old audit-log link, or a duplicate-detection result
  // should be able to show what it was merged into rather than dead-end.
  res.json(client);
});

// Backs the conversation composer's "+" form-link menu: every shareable
// public link this client already has, plus disabled placeholders (with a
// hint) for entities that exist but have no active link yet. Deliberately
// does NOT generate/rotate any token -- that stays on the inquiry/
// appointment pages, this is read-only.
router.get("/:id/shareable-links", async (req, res) => {
  const id = req.params.id as string;
  const now = new Date();

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      studio: { select: { slug: true } },
      inquiries: {
        select: {
          id: true,
          description: true,
          estimateToken: true,
          estimateTokenExpiresAt: true,
          // status/priceEstimate* back the new depositFormEligible flag
          // below -- same DEPOSIT_PENDING + both bounds set + not signed
          // rule POST /inquiries/:id/deposit-form itself enforces.
          status: true,
          priceEstimateLow: true,
          priceEstimateHigh: true,
          depositForm: { select: { token: true, tokenExpiresAt: true, signedAt: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      giftCards: { select: { id: true, code: true, amountCents: true, status: true }, orderBy: { createdAt: "desc" } },
      appointments: {
        select: {
          id: true,
          startTime: true,
          // Backs waiverEligible below -- POST /appointments/:id/waiver
          // only makes sense for a session that's actually happening.
          status: true,
          liabilityWaiver: { select: { token: true, tokenExpiresAt: true, status: true } },
        },
        orderBy: { startTime: "desc" },
      },
    },
  });

  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  const estimateLinks = await Promise.all(
    client.inquiries.map(async (inquiry) => {
      const active = inquiry.estimateToken && inquiry.estimateTokenExpiresAt && inquiry.estimateTokenExpiresAt > now;
      return {
        inquiryId: inquiry.id,
        label: `Estimate — ${inquiry.description.slice(0, 40)}`,
        url: active ? await shortenUrl(`${PUBLIC_APP_URL}/estimate/${inquiry.estimateToken}`) : null,
        hint: active ? null : "Generate from the inquiry page",
      };
    }),
  );

  const depositLinks = await Promise.all(
    client.inquiries
      .filter((inquiry) => inquiry.depositForm)
      .map(async (inquiry) => {
        const form = inquiry.depositForm!;
        const active = !form.signedAt && form.tokenExpiresAt > now;
        return {
          inquiryId: inquiry.id,
          label: `Deposit form — ${inquiry.description.slice(0, 40)}`,
          url: active ? await shortenUrl(`${PUBLIC_APP_URL}/deposit/${form.token}`) : null,
          hint: active ? null : form.signedAt ? "Already signed" : "Generate from the inquiry page",
        };
      }),
  );

  const waiverLinks = await Promise.all(
    client.appointments
      .filter((appointment) => appointment.liabilityWaiver)
      .map(async (appointment) => {
        const waiver = appointment.liabilityWaiver!;
        const active =
          waiver.status === "PENDING" && waiver.token && waiver.tokenExpiresAt && waiver.tokenExpiresAt > now;
        return {
          appointmentId: appointment.id,
          label: `Waiver — ${new Date(appointment.startTime).toLocaleDateString()}`,
          url: active ? await shortenUrl(`${PUBLIC_APP_URL}/waiver/${waiver.token}`) : null,
          hint: active ? null : "Generate from the appointment page",
        };
      }),
  );

  // Gift card public pages never expire (the code is a permanent bearer
  // token -- Phase 3), so every gift card the client has is always active.
  // EXEMPT cards (Package F deposit exemptions) are excluded entirely --
  // there's no reason to text a client a public link/QR for their own
  // internal scheduling exemption.
  const giftCardLinks = await Promise.all(
    client.giftCards
      .filter((card) => card.status !== "EXEMPT")
      .map(async (card) => ({
        giftCardId: card.id,
        label: `Gift card — $${(card.amountCents / 100).toFixed(2)}`,
        url: await shortenUrl(`${PUBLIC_APP_URL}/gift-card/${card.code}`),
        hint: null,
      })),
  );

  // Distinct from depositLinks/waiverLinks above (which only ever list
  // entities that ALREADY have a form/waiver row) -- these back the
  // composer's "Send Deposit Form"/"Send Waiver" actions, which need to
  // create one that doesn't exist yet. Same eligibility rules the actual
  // POST routes enforce (deposit-form upserts, so an inquiry with an
  // existing-but-unsigned one is still eligible == "resend"; waiver
  // rejects outright if one exists, so eligibility there is "none yet").
  //
  // An inquiry whose existing deposit form is still active (unsigned,
  // unexpired) is deliberately EXCLUDED here even though the route would
  // technically allow resending -- it already has a row in depositLinks
  // above with the identical label, and offering both would just be two
  // near-identical-looking rows in the same menu, one of which silently
  // invalidates the other's token. Only offer the fresh-send action when
  // there's no live link to just insert instead (none yet, or expired).
  const depositFormOptions = client.inquiries
    .filter((inquiry) => {
      if (inquiry.status !== "DEPOSIT_PENDING") return false;
      if (inquiry.priceEstimateLow == null || inquiry.priceEstimateHigh == null) return false;
      if (inquiry.depositForm?.signedAt) return false;
      const hasActiveLink = inquiry.depositForm && inquiry.depositForm.tokenExpiresAt > now;
      return !hasActiveLink;
    })
    .map((inquiry) => ({ inquiryId: inquiry.id, label: inquiry.description }));

  const waiverOptions = client.appointments
    .filter(
      (appointment) =>
        !appointment.liabilityWaiver && (appointment.status === "CONFIRMED" || appointment.status === "COMPLETED"),
    )
    .map((appointment) => ({ appointmentId: appointment.id, label: appointment.startTime.toISOString() }));

  res.json({
    intakeFormUrl: await shortenUrl(`${PUBLIC_APP_URL}/inquiry/${client.studio.slug}`),
    estimateLinks,
    depositLinks,
    depositFormOptions,
    waiverOptions,
    waiverLinks,
    giftCardLinks,
  });
});

// clientAId/clientBId are always stored with the lexicographically smaller
// id first, so a dismissed pair is unique/matchable regardless of which of
// the two clients the dismiss action was fired from.
function normalizeDuplicatePair(clientId1: string, clientId2: string): [string, string] {
  return clientId1 < clientId2 ? [clientId1, clientId2] : [clientId2, clientId1];
}

// Other non-merged clients in this studio sharing an email or phone.
// Exact-match only (after normalizing phone formatting) -- no fuzzy name
// matching, keeping false positives at zero. Excludes any pair staff has
// already dismissed as "not a duplicate" -- manual merge via search stays
// available for a dismissed pair regardless, this only suppresses the
// automatic suggestion banner.
router.get("/:id/potential-duplicates", async (req, res) => {
  const id = req.params.id as string;

  const client = await prisma.client.findUnique({ where: { id }, include: { phones: true, emails: true } });
  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  const [candidates, dismissedPairs] = await Promise.all([
    prisma.client.findMany({
      where: { studioId: req.user!.studioId, id: { not: id }, ...NOT_MERGED },
      include: { phones: true, emails: true },
    }),
    prisma.dismissedDuplicatePair.findMany({
      where: { studioId: req.user!.studioId, OR: [{ clientAId: id }, { clientBId: id }] },
    }),
  ]);

  const dismissedOtherIds = new Set(
    dismissedPairs.map((pair) => (pair.clientAId === id ? pair.clientBId : pair.clientAId)),
  );

  // Every known alias, not just the primary scalar fields -- a secondary
  // phone/email is just as real a match signal as the primary one. The
  // scalar fields are included defensively too, in case a row was somehow
  // never mirrored into the alias tables.
  const clientPhones = new Set(client.phones.map((p) => p.phone));
  if (client.phone) clientPhones.add(normalizePhone(client.phone));
  const clientEmails = new Set(client.emails.map((e) => e.email));
  if (client.email) clientEmails.add(client.email.toLowerCase());

  const duplicates = candidates.filter((candidate) => {
    if (dismissedOtherIds.has(candidate.id)) return false;

    const candidatePhones = candidate.phones.map((p) => p.phone);
    if (candidate.phone) candidatePhones.push(normalizePhone(candidate.phone));
    if (candidatePhones.some((phone) => clientPhones.has(phone))) return true;

    const candidateEmails = candidate.emails.map((e) => e.email);
    if (candidate.email) candidateEmails.push(candidate.email.toLowerCase());
    if (candidateEmails.some((email) => clientEmails.has(email))) return true;

    return false;
  });

  res.json(duplicates.map(({ phones, emails, ...rest }) => rest));
});

// Suppresses the automatic potential-duplicate suggestion for this pair --
// staff decided these two clients are NOT the same person. Does not touch
// merge eligibility: the pair remains fully mergeable via the manual
// search picker (§2), since staff might reconsider later. Idempotent --
// dismissing an already-dismissed pair just re-confirms it (upsert).
router.post("/:id/dismiss-duplicate", async (req, res) => {
  const id = req.params.id as string;
  const { otherClientId } = req.body ?? {};

  if (!otherClientId || typeof otherClientId !== "string") {
    return res.status(400).json({ error: "otherClientId is required" });
  }
  if (otherClientId === id) {
    return res.status(400).json({ error: "A client cannot be dismissed as its own duplicate" });
  }

  const [client, other] = await Promise.all([
    prisma.client.findUnique({ where: { id } }),
    prisma.client.findUnique({ where: { id: otherClientId } }),
  ]);

  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }
  if (!other || other.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Other client not found" });
  }

  const [clientAId, clientBId] = normalizeDuplicatePair(id, otherClientId);

  const dismissal = await prisma.dismissedDuplicatePair.upsert({
    where: { clientAId_clientBId: { clientAId, clientBId } },
    update: {},
    create: { studioId: req.user!.studioId, clientAId, clientBId, dismissedById: req.user!.userId },
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "dismiss_duplicate",
    changes: { otherClientId },
  });

  res.json(dismissal);
});

const EDITABLE_CLIENT_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "instagramHandle",
  "facebookProfileUrl",
  "otherContact",
] as const;

router.patch("/:id", async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (client.mergedIntoId) {
    return res.status(400).json({ error: "This client has been merged and can no longer be edited directly" });
  }

  const data: Record<string, string | null> = {};

  for (const field of EDITABLE_CLIENT_FIELDS) {
    if (body[field] === undefined) continue;

    if (field === "firstName" || field === "lastName") {
      if (typeof body[field] !== "string" || body[field].trim().length === 0) {
        return res.status(400).json({ error: `${field} must be a non-empty string` });
      }
      data[field] = body[field].trim();
    } else if (field === "phone") {
      if (body.phone !== null && typeof body.phone !== "string") {
        return res.status(400).json({ error: "phone must be a string or null" });
      }
      data.phone = typeof body.phone === "string" && body.phone.trim() ? normalizePhone(body.phone) : null;
    } else {
      if (body[field] !== null && typeof body[field] !== "string") {
        return res.status(400).json({ error: `${field} must be a string or null` });
      }
      data[field] = typeof body[field] === "string" ? body[field].trim() || null : null;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.client.update({ where: { id }, data });
    if ("phone" in data) await syncPrimaryPhone(tx, id, result.phone);
    if ("email" in data) await syncPrimaryEmail(tx, id, result.email);
    return result;
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "update",
    changes: diffObjects(client, data, EDITABLE_CLIENT_FIELDS as unknown as (keyof typeof client)[]),
  });

  res.json(updated);
});

// Shared existence/ownership check for every phone/email sub-route below.
async function loadOwnedClient(id: string, studioId: string) {
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || client.studioId !== studioId) return null;
  return client;
}

const P2002_UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === P2002_UNIQUE_VIOLATION;
}

// Always added as a secondary contact -- never auto-promoted to primary,
// even for a client with no phone on file yet. Making it primary is a
// separate, explicit action (see make-primary below), so a client always
// ends up with the primary contact staff actually chose, not whichever one
// happened to be added first.
router.post("/:id/phones", async (req, res) => {
  const id = req.params.id as string;
  const { phone, label } = req.body ?? {};

  if (typeof phone !== "string" || normalizePhone(phone).length === 0) {
    return res.status(400).json({ error: "phone is required" });
  }
  if (label !== undefined && label !== null && typeof label !== "string") {
    return res.status(400).json({ error: "label must be a string or null" });
  }

  const client = await loadOwnedClient(id, req.user!.studioId);
  if (!client) return res.status(404).json({ error: "Client not found" });

  const normalized = normalizePhone(phone);

  let created;
  try {
    created = await prisma.clientPhone.create({
      data: { clientId: id, phone: normalized, label: label || null },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(400).json({ error: "This phone number is already on file for this client" });
    }
    throw err;
  }

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "add_phone",
    changes: { phone: normalized, label: label || null },
  });

  res.status(201).json(created);
});

router.delete("/:id/phones/:phoneId", async (req, res) => {
  const id = req.params.id as string;
  const phoneId = req.params.phoneId as string;

  const client = await loadOwnedClient(id, req.user!.studioId);
  if (!client) return res.status(404).json({ error: "Client not found" });

  const target = await prisma.clientPhone.findUnique({ where: { id: phoneId } });
  if (!target || target.clientId !== id) {
    return res.status(404).json({ error: "Phone not found" });
  }

  if (target.isPrimary) {
    const otherCount = await prisma.clientPhone.count({ where: { clientId: id, id: { not: phoneId } } });
    if (otherCount > 0) {
      return res.status(400).json({ error: "Make another phone primary before removing this one" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.clientPhone.delete({ where: { id: phoneId } });
      await tx.client.update({ where: { id }, data: { phone: null } });
    });
  } else {
    await prisma.clientPhone.delete({ where: { id: phoneId } });
  }

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "remove_phone",
    changes: { phone: target.phone, wasPrimary: target.isPrimary },
  });

  res.status(204).end();
});

router.post("/:id/phones/:phoneId/make-primary", async (req, res) => {
  const id = req.params.id as string;
  const phoneId = req.params.phoneId as string;

  const client = await loadOwnedClient(id, req.user!.studioId);
  if (!client) return res.status(404).json({ error: "Client not found" });

  const target = await prisma.clientPhone.findUnique({ where: { id: phoneId } });
  if (!target || target.clientId !== id) {
    return res.status(404).json({ error: "Phone not found" });
  }

  if (!target.isPrimary) {
    await prisma.$transaction(async (tx) => {
      await tx.clientPhone.updateMany({ where: { clientId: id, isPrimary: true }, data: { isPrimary: false } });
      await tx.clientPhone.update({ where: { id: phoneId }, data: { isPrimary: true } });
      await tx.client.update({ where: { id }, data: { phone: target.phone } });
    });

    await logAudit({
      studioId: req.user!.studioId,
      actorUserId: req.user!.userId,
      entityType: "Client",
      entityId: id,
      action: "make_primary_phone",
      changes: { phone: target.phone },
    });
  }

  const updatedClient = await prisma.client.findUnique({ where: { id } });
  res.json(updatedClient);
});

router.post("/:id/emails", async (req, res) => {
  const id = req.params.id as string;
  const { email, label } = req.body ?? {};

  if (typeof email !== "string" || email.trim().length === 0) {
    return res.status(400).json({ error: "email is required" });
  }
  if (label !== undefined && label !== null && typeof label !== "string") {
    return res.status(400).json({ error: "label must be a string or null" });
  }

  const client = await loadOwnedClient(id, req.user!.studioId);
  if (!client) return res.status(404).json({ error: "Client not found" });

  const normalized = email.trim().toLowerCase();

  let created;
  try {
    created = await prisma.clientEmail.create({
      data: { clientId: id, email: normalized, label: label || null },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(400).json({ error: "This email is already on file for this client" });
    }
    throw err;
  }

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "add_email",
    changes: { email: normalized, label: label || null },
  });

  res.status(201).json(created);
});

router.delete("/:id/emails/:emailId", async (req, res) => {
  const id = req.params.id as string;
  const emailId = req.params.emailId as string;

  const client = await loadOwnedClient(id, req.user!.studioId);
  if (!client) return res.status(404).json({ error: "Client not found" });

  const target = await prisma.clientEmail.findUnique({ where: { id: emailId } });
  if (!target || target.clientId !== id) {
    return res.status(404).json({ error: "Email not found" });
  }

  if (target.isPrimary) {
    const otherCount = await prisma.clientEmail.count({ where: { clientId: id, id: { not: emailId } } });
    if (otherCount > 0) {
      return res.status(400).json({ error: "Make another email primary before removing this one" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.clientEmail.delete({ where: { id: emailId } });
      await tx.client.update({ where: { id }, data: { email: null } });
    });
  } else {
    await prisma.clientEmail.delete({ where: { id: emailId } });
  }

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "remove_email",
    changes: { email: target.email, wasPrimary: target.isPrimary },
  });

  res.status(204).end();
});

router.post("/:id/emails/:emailId/make-primary", async (req, res) => {
  const id = req.params.id as string;
  const emailId = req.params.emailId as string;

  const client = await loadOwnedClient(id, req.user!.studioId);
  if (!client) return res.status(404).json({ error: "Client not found" });

  const target = await prisma.clientEmail.findUnique({ where: { id: emailId } });
  if (!target || target.clientId !== id) {
    return res.status(404).json({ error: "Email not found" });
  }

  if (!target.isPrimary) {
    await prisma.$transaction(async (tx) => {
      await tx.clientEmail.updateMany({ where: { clientId: id, isPrimary: true }, data: { isPrimary: false } });
      await tx.clientEmail.update({ where: { id: emailId }, data: { isPrimary: true } });
      await tx.client.update({ where: { id }, data: { email: target.email } });
    });

    await logAudit({
      studioId: req.user!.studioId,
      actorUserId: req.user!.userId,
      entityType: "Client",
      entityId: id,
      action: "make_primary_email",
      changes: { email: target.email },
    });
  }

  const updatedClient = await prisma.client.findUnique({ where: { id } });
  res.json(updatedClient);
});

// Every model with a direct clientId FK -- re-enumerate this on future
// schema changes rather than assuming the list below stays complete.
// (DepositForm relates via Inquiry, not Client directly, so it moves for
// free when Inquiry does and doesn't need its own re-point here.)
async function repointClientRelations(tx: Prisma.TransactionClient, sourceId: string, survivorId: string) {
  const [appointments, consentForms, inquiries, giftCards] = await Promise.all([
    tx.appointment.updateMany({ where: { clientId: sourceId }, data: { clientId: survivorId } }),
    tx.consentForm.updateMany({ where: { clientId: sourceId }, data: { clientId: survivorId } }),
    tx.inquiry.updateMany({ where: { clientId: sourceId }, data: { clientId: survivorId } }),
    tx.giftCard.updateMany({ where: { clientId: sourceId }, data: { clientId: survivorId } }),
  ]);

  return {
    Appointment: appointments.count,
    ConsentForm: consentForms.count,
    Inquiry: inquiries.count,
    GiftCard: giftCards.count,
  };
}

// Conversation.clientId is unique (one thread per client, ever) so it
// can't be handled by the blind updateMany in repointClientRelations above
// -- if the survivor already has its own thread, re-pointing the source's
// thread onto the same clientId would violate that constraint and blow up
// the whole merge transaction. Handled as its own step instead:
//   - source has no thread: nothing to do.
//   - only source has a thread: simple re-point.
//   - both have one: fold the source thread's messages into the survivor's
//     thread (so nothing is lost), merge per-user read state (keep the
//     more recent lastReadAt), then delete the now-empty source thread.
async function mergeConversations(
  tx: Prisma.TransactionClient,
  sourceClientId: string,
  survivorClientId: string,
): Promise<{ merged: boolean; movedMessages: number }> {
  const [sourceConversation, survivorConversation] = await Promise.all([
    tx.conversation.findUnique({ where: { clientId: sourceClientId } }),
    tx.conversation.findUnique({ where: { clientId: survivorClientId } }),
  ]);

  if (!sourceConversation) {
    return { merged: false, movedMessages: 0 };
  }

  if (!survivorConversation) {
    await tx.conversation.update({ where: { id: sourceConversation.id }, data: { clientId: survivorClientId } });
    return { merged: false, movedMessages: 0 };
  }

  const movedMessages = await tx.message.updateMany({
    where: { conversationId: sourceConversation.id },
    data: { conversationId: survivorConversation.id },
  });

  const newestLastMessageAt =
    [sourceConversation.lastMessageAt, survivorConversation.lastMessageAt]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  await tx.conversation.update({
    where: { id: survivorConversation.id },
    data: { lastMessageAt: newestLastMessageAt },
  });

  const sourceReads = await tx.conversationRead.findMany({ where: { conversationId: sourceConversation.id } });

  for (const read of sourceReads) {
    const survivorRead = await tx.conversationRead.findUnique({
      where: { conversationId_userId: { conversationId: survivorConversation.id, userId: read.userId } },
    });

    if (survivorRead) {
      if (read.lastReadAt > survivorRead.lastReadAt) {
        await tx.conversationRead.update({ where: { id: survivorRead.id }, data: { lastReadAt: read.lastReadAt } });
      }
      await tx.conversationRead.delete({ where: { id: read.id } });
    } else {
      await tx.conversationRead.update({ where: { id: read.id }, data: { conversationId: survivorConversation.id } });
    }
  }

  await tx.conversation.delete({ where: { id: sourceConversation.id } });

  return { merged: true, movedMessages: movedMessages.count };
}

// Unlike repointClientRelations above, these aren't re-pointed (the
// source keeps its own ClientPhone/ClientEmail rows -- it still exists,
// history stays inspectable there too) -- they're copied onto the
// survivor as secondary aliases, skipping anything already identical on
// the survivor. Reading the source's full ClientPhone/ClientEmail set
// (not just its Client.phone/email scalar) means this also picks up
// aliases the source itself carried over from an earlier merge, so a
// chain of merges never loses a contact along the way. The survivor's
// own primary is never touched here.
async function carryOverContactAliases(tx: Prisma.TransactionClient, sourceId: string, survivorId: string) {
  const [sourcePhones, survivorPhones, sourceEmails, survivorEmails] = await Promise.all([
    tx.clientPhone.findMany({ where: { clientId: sourceId } }),
    tx.clientPhone.findMany({ where: { clientId: survivorId } }),
    tx.clientEmail.findMany({ where: { clientId: sourceId } }),
    tx.clientEmail.findMany({ where: { clientId: survivorId } }),
  ]);

  const survivorPhoneSet = new Set(survivorPhones.map((p) => p.phone));
  const addedPhones: { phone: string; label: string | null }[] = [];
  for (const p of sourcePhones) {
    if (survivorPhoneSet.has(p.phone)) continue;
    await tx.clientPhone.create({ data: { clientId: survivorId, phone: p.phone, label: p.label, isPrimary: false } });
    survivorPhoneSet.add(p.phone);
    addedPhones.push({ phone: p.phone, label: p.label });
  }

  const survivorEmailSet = new Set(survivorEmails.map((e) => e.email));
  const addedEmails: { email: string; label: string | null }[] = [];
  for (const e of sourceEmails) {
    if (survivorEmailSet.has(e.email)) continue;
    await tx.clientEmail.create({ data: { clientId: survivorId, email: e.email, label: e.label, isPrimary: false } });
    survivorEmailSet.add(e.email);
    addedEmails.push({ email: e.email, label: e.label });
  }

  return { addedPhones, addedEmails };
}

// Soft-merge: the source client survives (marked via mergedIntoId) rather
// than being deleted, so its history stays inspectable. Every FK the
// source held moves to the survivor; nothing about the survivor's own
// fields changes -- edit those separately via PATCH /clients/:id if needed.
// (Except its secondary contact aliases, which do gain the source's
// phone/email as new entries -- see carryOverContactAliases.)
router.post("/:id/merge", async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};
  const { sourceClientId } = body;

  if (!sourceClientId) {
    return res.status(400).json({ error: "sourceClientId is required" });
  }

  if (sourceClientId === id) {
    return res.status(400).json({ error: "A client cannot be merged with itself" });
  }

  const [survivor, source] = await Promise.all([
    prisma.client.findUnique({ where: { id } }),
    prisma.client.findUnique({ where: { id: sourceClientId } }),
  ]);

  if (!survivor || survivor.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (!source || source.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Source client not found" });
  }

  if (survivor.mergedIntoId) {
    return res.status(400).json({ error: "The survivor client has itself already been merged into another client" });
  }

  if (source.mergedIntoId) {
    return res.status(400).json({ error: "The source client has already been merged" });
  }

  const { repointCounts, conversationResult, aliasesAdded } = await prisma.$transaction(async (tx) => {
    const repointCounts = await repointClientRelations(tx, sourceClientId, id);
    const conversationResult = await mergeConversations(tx, sourceClientId, id);
    const aliasesAdded = await carryOverContactAliases(tx, sourceClientId, id);
    await tx.client.update({ where: { id: sourceClientId }, data: { mergedIntoId: id } });
    return { repointCounts, conversationResult, aliasesAdded };
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "merge",
    changes: {
      sourceClientId,
      sourceClientName: `${source.firstName} ${source.lastName}`.trim(),
      survivorId: id,
      repointed: repointCounts,
      conversation: conversationResult,
      aliasesAdded,
    },
  });

  const merged = await prisma.client.findUnique({ where: { id } });
  res.json(merged);
});

// Archive: soft, reversible hide -- same exclude-from-list-views treatment
// as a merge, but nothing is repointed/destroyed and it can be undone.
router.post("/:id/archive", async (req, res) => {
  const id = req.params.id as string;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }
  if (client.archivedAt) {
    return res.json(client);
  }

  const updated = await prisma.client.update({ where: { id }, data: { archivedAt: new Date() } });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "archive",
    changes: { archivedAt: updated.archivedAt },
  });

  res.json(updated);
});

router.post("/:id/unarchive", async (req, res) => {
  const id = req.params.id as string;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }
  if (!client.archivedAt) {
    return res.json(client);
  }

  const updated = await prisma.client.update({ where: { id }, data: { archivedAt: null } });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "unarchive",
    changes: { archivedAt: null },
  });

  res.json(updated);
});

// Shared between the delete-preview (so the confirmation UI can show what
// will be destroyed) and the audit snapshot written just before the actual
// DELETE below -- both need the exact same full picture of this client's
// history.
async function gatherClientDeletionSummary(clientId: string) {
  const [inquiries, appointments, waivers, consentForms, giftCards, depositForms, conversation, phones, emails] =
    await Promise.all([
      prisma.inquiry.count({ where: { clientId } }),
      prisma.appointment.count({ where: { clientId } }),
      prisma.liabilityWaiver.count({ where: { clientId } }),
      prisma.consentForm.count({ where: { clientId } }),
      prisma.giftCard.findMany({ where: { clientId }, select: { id: true, code: true, amountCents: true, status: true } }),
      prisma.depositForm.count({ where: { inquiry: { clientId } } }),
      prisma.conversation.findUnique({ where: { clientId }, select: { id: true } }),
      prisma.clientPhone.count({ where: { clientId } }),
      prisma.clientEmail.count({ where: { clientId } }),
    ]);

  const messages = conversation ? await prisma.message.count({ where: { conversationId: conversation.id } }) : 0;
  const activeGiftCardCents = giftCards
    .filter((card) => card.status === "ACTIVE")
    .reduce((sum, card) => sum + card.amountCents, 0);

  return {
    inquiries,
    appointments,
    waivers,
    consentForms,
    giftCards: giftCards.map((card) => ({ id: card.id, code: card.code, amountCents: card.amountCents, status: card.status })),
    activeGiftCardCents,
    depositForms,
    conversations: conversation ? 1 : 0,
    messages,
    phones,
    emails,
  };
}

// OWNER only, always available regardless of attached history -- the
// strong in-app confirmation (exact-match "DELETE" text input) is the
// safeguard, not a history-based restriction. Powers the confirmation
// modal's plain-language breakdown before the real DELETE is sent.
router.get("/:id/delete-preview", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  const mergedFromCount = await prisma.client.count({ where: { mergedIntoId: id } });
  const summary = await gatherClientDeletionSummary(id);

  res.json({ ...summary, blockedByMerge: mergedFromCount > 0 });
});

// True permanent delete -- OWNER only, no restriction based on attached
// history. Every model with a clientId (direct or via inquiry/appointment)
// is destroyed in one transaction, children before parents; the audit
// entry written right after is the only surviving trace (AuditLog has no
// FK to Client). Gift cards are NOT detached here the way inquiry-delete
// detaches them -- deleting the client destroys their money along with
// everything else, which is exactly what "permanent" means at this level.
router.delete("/:id", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const { confirm } = req.body ?? {};

  if (confirm !== "DELETE") {
    return res.status(400).json({ error: 'Type "DELETE" to confirm this action.' });
  }

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  const mergedFromCount = await prisma.client.count({ where: { mergedIntoId: id } });
  if (mergedFromCount > 0) {
    return res.status(400).json({
      error: `${mergedFromCount} other client record(s) were merged into this one and would be left dangling. Cannot delete.`,
    });
  }

  const summary = await gatherClientDeletionSummary(id);

  await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({ where: { clientId: id } });
    if (conversation) {
      await tx.prefillDraft.deleteMany({ where: { conversationId: conversation.id } });
      await tx.message.deleteMany({ where: { conversationId: conversation.id } });
      await tx.conversationRead.deleteMany({ where: { conversationId: conversation.id } });
      await tx.conversationTag.deleteMany({ where: { conversationId: conversation.id } });
      await tx.conversationParticipant.deleteMany({ where: { conversationId: conversation.id } });
      await tx.conversation.delete({ where: { id: conversation.id } });
    }

    await tx.liabilityWaiver.deleteMany({ where: { clientId: id } });
    await tx.consentForm.deleteMany({ where: { clientId: id } });
    await tx.clientPhone.deleteMany({ where: { clientId: id } });
    await tx.clientEmail.deleteMany({ where: { clientId: id } });
    // DepositForm before GiftCard: DepositForm.giftCardId optionally points
    // at a gift card, so it must go first or the gift card delete below
    // would be blocked by that reference.
    await tx.depositForm.deleteMany({ where: { inquiry: { clientId: id } } });
    await tx.giftCard.deleteMany({ where: { clientId: id } });
    // Inquiry.appointmentId is an optional back-reference to a specific
    // appointment -- null it before deleting appointments, or that FK
    // blocks the appointment delete below.
    await tx.inquiry.updateMany({ where: { clientId: id }, data: { appointmentId: null } });
    await tx.appointment.deleteMany({ where: { clientId: id } });
    await tx.inquiry.deleteMany({ where: { clientId: id } });
    await tx.client.delete({ where: { id } });
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "permanently_deleted",
    changes: { client: { firstName: client.firstName, lastName: client.lastName, email: client.email, phone: client.phone }, ...summary },
  });

  res.json({ success: true });
});

router.post("/:clientId/consent-forms", async (req, res) => {
  const clientId = req.params.clientId as string;

  const client = await prisma.client.findUnique({ where: { id: clientId } });

  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  const signingToken = crypto.randomBytes(32).toString("hex");
  const tokenExpiresAt = new Date(Date.now() + CONSENT_FORM_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  const consentForm = await prisma.consentForm.create({
    data: { clientId, signingToken, tokenExpiresAt },
  });

  res.status(201).json({ ...consentForm, signingUrl: await shortenUrl(`${PUBLIC_APP_URL}/sign/${signingToken}`) });
});

export default router;
