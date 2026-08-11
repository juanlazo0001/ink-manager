import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Channel, FlashPieceStatus, InquiryStatus, Role } from "../../generated/prisma/enums";
import { requireAuth } from "../middleware/auth";
import { hasPermission, requirePermission } from "../lib/permissions";
import { diffObjects, logAudit } from "../lib/audit";
import { emitInvalidation } from "../lib/realtime/registry";
import { normalizePhone } from "../lib/phone";
import { syncPrimaryEmail, syncPrimaryPhone } from "../lib/clientContacts";
import { generateUniqueReferralCode } from "../lib/referrals";
import { DEFAULT_THEME_PRESET } from "../lib/themePresets";
import { studioHasActiveMembership, activeStudioIdsForCaller, effectiveRoleAt, hasProfileDelegationAt } from "../lib/artistAccess";
import { withLocale } from "../lib/contentTranslation";
import { isSupportedLocale, parseAcceptLanguage } from "../lib/locale";
import { API_PUBLIC_URL } from "../lib/publicUrl";

const router = Router();

const FLASH_PIECE_INCLUDE = {
  artist: { select: { id: true, user: { select: { name: true, email: true, avatarUrl: true } } } },
  translations: true,
} as const;

// Multi-language public forms, Part 6: reshapes the flat FlashPieceTranslation
// rows FLASH_PIECE_INCLUDE fetches into { es: { title, description } } --
// same by-locale object shape the staff editor sends back on save.
function reshapeFlashPieceTranslations<T extends { translations: { locale: string; title: string | null; description: string | null }[] }>(
  piece: T,
) {
  const { translations, ...rest } = piece;
  return { ...rest, translations: Object.fromEntries(translations.map((t) => [t.locale, { title: t.title, description: t.description }])) };
}

// Multi-language public forms, Part 6: identical shape/reasoning to
// customPolicies.ts's own parseCustomPolicyTranslations -- see that
// comment. Only `title`/`description` are translatable here
// (FlashPieceTranslation's own two columns).
function parseFlashPieceTranslations(
  translations: unknown,
): { ok: true; value: { locale: string; data: Record<string, unknown> }[] } | { ok: false; error: string } {
  if (typeof translations !== "object" || translations === null || Array.isArray(translations)) {
    return { ok: false, error: "translations must be an object keyed by locale" };
  }
  const result: { locale: string; data: Record<string, unknown> }[] = [];
  for (const [locale, fields] of Object.entries(translations as Record<string, unknown>)) {
    if (!isSupportedLocale(locale) || locale === "en") {
      return { ok: false, error: `translations key "${locale}" is not a supported non-English locale` };
    }
    if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
      return { ok: false, error: `translations.${locale} must be an object` };
    }
    const data: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      if (field !== "title" && field !== "description") {
        return { ok: false, error: `translations.${locale}.${field} is not a translatable field` };
      }
      if (value !== null && typeof value !== "string") {
        return { ok: false, error: `translations.${locale}.${field} must be a string or null` };
      }
      data[field] = value;
    }
    result.push({ locale, data });
  }
  return { ok: true, value: result };
}

// Public: a studio's available flash pieces -- either one artist's (the
// original two-segment /flash/:studioSlug/:artistId shape) or, when
// artistId is omitted, every artist's at that studio (the studio-wide
// gallery view). Repeatable pieces (isOneOfOne: false) always show while
// AVAILABLE; a one-of-one piece disappears the instant someone requests it
// (status moves to PENDING_APPROVAL, see POST /:id/request below) and
// never reappears once RETIRED or BOOKED -- this query is naturally
// correct for all of that just by filtering on AVAILABLE, no separate
// isOneOfOne branching needed. FlashPiece.studioId is its own field
// (independent of the artist's home studio), so the studio-wide query
// below correctly picks up guest artists' pieces uploaded at this studio
// too, not just home-artist ones.
router.get("/public", async (req, res) => {
  const studioSlug = req.query.studioSlug;
  const artistId = req.query.artistId;

  if (typeof studioSlug !== "string" || !studioSlug) {
    return res.status(400).json({ error: "studioSlug is required" });
  }
  if (artistId !== undefined && (typeof artistId !== "string" || !artistId)) {
    return res.status(400).json({ error: "artistId, if provided, must be a non-empty string" });
  }

  const studio = await prisma.studio.findUnique({
    where: { slug: studioSlug },
    include: { settings: { select: { themePreset: true } } },
  });
  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  let artist: { id: string; user: { name: string | null; avatarUrl: string | null } } | null = null;
  if (artistId) {
    const found = await prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } });
    // Artist mobility bug fix: a guest artist's public gallery page at their
    // GUEST studio was 404ing (their user.studioId is only ever their HOME).
    const artistBelongsToStudio =
      found != null && (found.user.studioId === studio.id || (await studioHasActiveMembership(studio.id, found.id)));
    if (!artistBelongsToStudio) {
      return res.status(404).json({ error: "Artist not found" });
    }
    artist = found;
  }

  // Language becomes customer-specific: this is the purely-anonymous
  // browse page (before any contact-lookup step) -- DETECT-ONLY from
  // Accept-Language, no query override, no Client, no persistence.
  const locale = parseAcceptLanguage(req.headers["accept-language"]);

  // Artist-filtered view only ("Currently at {studio}" + tappable address
  // in the header) -- same "single-location fallback, never guess wrong
  // for a multi-location studio" rule artistPublicProfile.ts's own
  // studioSummary() uses; null for a multi-location studio (no address
  // line rendered) or the studio-wide view (never fetched).
  let studioAddress: string | null = null;
  if (artist) {
    const locations = await prisma.location.findMany({ where: { studioId: studio.id }, select: { address: true } });
    studioAddress = locations.length === 1 ? (locations[0]!.address ?? null) : null;
  }

  const pieces = await prisma.flashPiece.findMany({
    where: { studioId: studio.id, ...(artist ? { artistId: artist.id } : {}), status: FlashPieceStatus.AVAILABLE },
    select: {
      id: true,
      imageUrl: true,
      title: true,
      description: true,
      priceCents: true,
      estimatedDurationMinutes: true,
      isOneOfOne: true,
      translations: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const localizedPieces = pieces.map((piece) => {
    const translation = piece.translations.find((t) => t.locale === locale);
    const { translations, ...rest } = withLocale(piece, translation, ["title", "description"]);
    return rest;
  });

  // publicAssets' own studio-logo/studio-icon-logo routes proxy the
  // actual stored data: URL (see that file's own comment) -- never send
  // Studio.logoUrl/iconLogo directly, same "existence, not identity, is
  // public here" convention as every other public-page image URL in this
  // codebase. Icon mark preferred (small header lockup) with the full
  // wordmark as fallback.
  const studioLogoUrl = studio.iconLogo
    ? `${API_PUBLIC_URL}/public-assets/studio-icon-logo/${studio.slug}`
    : studio.logoUrl
      ? `${API_PUBLIC_URL}/public-assets/studio-logo/${studio.slug}`
      : null;
  // Same proxy convention as studioLogoUrl above -- publicAssets' own new
  // flash-artist-avatar route (deliberately NOT the artist-profile-page's
  // publishedAt-gated artist-avatar route; this artist may never have
  // published that separate page).
  const artistAvatarUrl = artist?.user.avatarUrl ? `${API_PUBLIC_URL}/public-assets/flash-artist-avatar/${artist.id}` : null;

  res.json({
    resolvedLocale: locale,
    studioName: studio.name,
    studioSlug: studio.slug,
    studioLogoUrl,
    studioAddress,
    themePreset: studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
    artistId: artist?.id ?? null,
    artistName: artist?.user.name ?? null,
    artistAvatarUrl,
    pieces: localizedPieces,
  });
});

// Public: the lightweight submission form's own client lookup -- reuses
// the exact same email-then-phone matching POST /inquiries' general
// intake already does (see that route's own existingClient logic), just
// exposed as its own two-step-UX-friendly endpoint so the form can show
// "Welcome back" and skip fields already on file BEFORE the customer
// fills out the rest, rather than silently deduping only at submission
// time the way the general intake form does.
router.get("/lookup-public", async (req, res) => {
  const studioSlug = req.query.studioSlug;
  const phone = req.query.phone;
  const email = req.query.email;

  if (typeof studioSlug !== "string" || !studioSlug) {
    return res.status(400).json({ error: "studioSlug is required" });
  }
  if ((typeof email !== "string" || !email) && (typeof phone !== "string" || !phone)) {
    return res.status(400).json({ error: "phone or email is required" });
  }

  const studio = await prisma.studio.findUnique({ where: { slug: studioSlug } });
  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  const client =
    typeof email === "string" && email
      ? await prisma.client.findFirst({ where: { studioId: studio.id, email } })
      : await prisma.client.findFirst({ where: { studioId: studio.id, phone: normalizePhone(phone as string) } });

  if (!client) {
    return res.json({ found: false });
  }

  res.json({
    found: true,
    firstName: client.firstName,
    lastName: client.lastName,
    email: client.email,
    phone: client.phone,
  });
});

// Public: the lightweight submission itself -- NOT routed through the
// general POST /inquiries (that route's configurable-intake-form-field
// machinery doesn't apply here; flash's form is fixed and much shorter by
// design). Creates a real Inquiry so the request gets the same pipeline/
// dashboard visibility as any other, with artist/price/duration already
// fixed from the piece -- no assignment or estimate step.
router.post("/:id/request", async (req, res) => {
  const id = req.params.id as string;
  const { placementDescription, placementPhotoUrl, firstName, lastName, email, phone, preferredLocale } = req.body ?? {};

  if (
    typeof placementDescription !== "string" ||
    !placementDescription.trim() ||
    typeof placementPhotoUrl !== "string" ||
    !placementPhotoUrl ||
    typeof firstName !== "string" ||
    !firstName.trim() ||
    typeof lastName !== "string" ||
    !lastName.trim() ||
    ((typeof email !== "string" || !email.trim()) && (typeof phone !== "string" || !phone.trim()))
  ) {
    return res.status(400).json({ error: "Missing required field(s)" });
  }

  const piece = await prisma.flashPiece.findUnique({ where: { id } });
  if (!piece || piece.status !== FlashPieceStatus.AVAILABLE) {
    return res.status(409).json({ error: "This piece is no longer available -- please pick another." });
  }

  const studioId = piece.studioId;

  // Atomic claim, one-of-one only: the conditional WHERE makes this a
  // genuine race winner-take-all -- if two people request the same piece
  // within milliseconds of each other, only the first update actually
  // matches a row (count 1); the second's WHERE no longer matches (the
  // status already moved), so it correctly loses rather than both
  // silently succeeding. A repeatable piece never leaves AVAILABLE here.
  if (piece.isOneOfOne) {
    const claimed = await prisma.flashPiece.updateMany({
      where: { id, status: FlashPieceStatus.AVAILABLE },
      data: { status: FlashPieceStatus.PENDING_APPROVAL },
    });
    if (claimed.count === 0) {
      return res.status(409).json({ error: "This piece was just requested by someone else -- please pick another." });
    }
  }

  const normalizedPhone = typeof phone === "string" && phone.trim() ? normalizePhone(phone) : null;
  const trimmedEmail = typeof email === "string" && email.trim() ? email.trim() : null;

  const existingClient = trimmedEmail
    ? await prisma.client.findFirst({ where: { studioId, email: trimmedEmail } })
    : normalizedPhone
      ? await prisma.client.findFirst({ where: { studioId, phone: normalizedPhone } })
      : null;

  // Multi-language public forms, fix pass: no Client exists yet at
  // picker-toggle time on the gallery page (see LanguagePicker's own
  // comment) -- this request is the one moment it CAN persist the
  // client's choice, right as their Client record is actually created.
  const clientPreferredLocale = isSupportedLocale(preferredLocale) ? preferredLocale : null;

  let client;
  if (existingClient) {
    client = clientPreferredLocale
      ? await prisma.client.update({ where: { id: existingClient.id }, data: { preferredLocale: clientPreferredLocale } })
      : existingClient;
  } else {
    const referralCode = await generateUniqueReferralCode();
    client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          studioId,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: trimmedEmail,
          phone: normalizedPhone,
          referralCode,
          preferredLocale: clientPreferredLocale,
        },
      });
      await syncPrimaryPhone(tx, created.id, created.phone);
      await syncPrimaryEmail(tx, created.id, created.email);
      return created;
    });
  }

  // Same "Tattoo" fallback resolveServiceForIntakeForm uses, minus the
  // intake-form lookup step this flow has no form context for at all.
  const service = await prisma.service.findFirst({ where: { studioId, slug: "tattoo" } });
  if (!service) {
    if (piece.isOneOfOne) {
      await prisma.flashPiece.update({ where: { id }, data: { status: FlashPieceStatus.AVAILABLE } });
    }
    return res.status(500).json({ error: "This studio has no service configured -- contact support" });
  }

  const priceDollars = piece.priceCents / 100;
  const durationHours = piece.estimatedDurationMinutes / 60;

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId,
      clientId: client.id,
      serviceId: service.id,
      channel: Channel.FLASH_GALLERY,
      description: `Flash: ${piece.title}`,
      // Not asked on this lightweight form -- the flash piece's own photo
      // already shows exactly what this is, unlike a custom-design inquiry
      // where these fields carry real information.
      colorOrBlackGrey: "See flash design",
      estimatedSize: "See flash design",
      placement: placementDescription.trim(),
      // Not collected by this form at all -- judgment call, flagged in
      // REPORT.md rather than silently assumed either way.
      hasBeenTattooedBefore: false,
      placementImages: [placementPhotoUrl],
      status: InquiryStatus.FLASH_PENDING_APPROVAL,
      priceEstimateLow: priceDollars,
      priceEstimateHigh: priceDollars,
      timeEstimateHoursMin: durationHours,
      timeEstimateHoursMax: durationHours,
      assignedArtistId: piece.artistId,
      assignedAt: new Date(),
      flashPieceId: piece.id,
    },
  });

  await logAudit({
    studioId,
    actorUserId: null,
    entityType: "Inquiry",
    entityId: inquiry.id,
    action: "flash_request_submitted",
    changes: { flashPieceId: piece.id, clientId: client.id },
  });

  emitInvalidation({ type: "inquiry.created", studioId });
  emitInvalidation({ type: "flash.changed", studioId });

  res.status(201).json({ success: true });
});

router.use(requireAuth);

// Same "-own" narrowing preferredSchedule/artistSchedules.manage already
// established: requirePermission confirms the actor has flashGallery.manage
// at all, this resolves whether an ARTIST actor is restricted to their own
// pieces. OWNER/FRONT_DESK are never restricted.
async function resolveOwnArtistId(userId: string): Promise<string | null> {
  const artist = await prisma.artist.findUnique({ where: { userId }, select: { id: true } });
  return artist?.id ?? null;
}

// Permission-context fix inventory: intentionally left home-scoped -- a
// multi-studio LIST for an ARTIST caller (activeStudioIdsForCaller, HOME +
// every active GUEST in one query), no single record to check a matrix
// against. Same reasoning as appointments.ts's/inquiries.ts's own list
// routes.
router.get("/", requirePermission("flashGallery.manage"), async (req, res) => {
  const studioId = req.user!.studioId;
  let artistId = typeof req.query.artistId === "string" ? req.query.artistId : undefined;
  // Artist mobility bug fix: an ARTIST's own list spans every studio they
  // CURRENTLY belong to (HOME + active GUESTs), not just home -- but still
  // scoped to ACTIVE memberships, not dropped entirely, so a piece living
  // under a studio this artist has since left/been removed from stops
  // appearing on their own list going forward (same "ended relationship,
  // not just a different one" reasoning as appointments.ts's GET / list).
  let artistStudioIds: string[] | null = null;

  if (req.user!.role === Role.ARTIST) {
    const ownArtistId = await resolveOwnArtistId(req.user!.userId);
    artistId = ownArtistId ?? "__none__";
    artistStudioIds = await activeStudioIdsForCaller(req.user!);
  }

  const pieces = await prisma.flashPiece.findMany({
    where: {
      ...(artistStudioIds ? { studioId: { in: artistStudioIds } } : { studioId }),
      ...(artistId ? { artistId } : {}),
    },
    include: FLASH_PIECE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  res.json(pieces.map(reshapeFlashPieceTranslations));
});

// Permission-context fix inventory: intentionally left home-scoped -- no
// pre-existing record to check a matrix against (studioId below IS
// req.user!.studioId by construction; a piece always gets created at the
// caller's OWN current studio, never a guest one, so there's nothing to
// resolve independently of home here).
router.post("/", requirePermission("flashGallery.manage"), async (req, res) => {
  const studioId = req.user!.studioId;
  const { imageUrl, title, description, priceCents, estimatedDurationMinutes, isOneOfOne } = req.body ?? {};

  // ARTIST never needs to pass artistId at all -- an ARTIST creating a
  // piece can only ever mean "for myself," so it's resolved here rather
  // than requiring the frontend to know/send its own id. OWNER/FRONT_DESK
  // must pass one explicitly (there's no "self" to default to).
  let artistId: string | undefined = req.body?.artistId;
  if (req.user!.role === Role.ARTIST) {
    artistId = (await resolveOwnArtistId(req.user!.userId)) ?? undefined;
    if (!artistId) {
      return res.status(400).json({ error: "No artist profile found for your account" });
    }
  }

  const missing = ["imageUrl", "title", "priceCents", "estimatedDurationMinutes"].filter(
    (field) => req.body?.[field] === undefined || req.body?.[field] === null || req.body?.[field] === "",
  );
  if (!artistId) missing.unshift("artistId");
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  if (typeof priceCents !== "number" || priceCents <= 0) {
    return res.status(400).json({ error: "priceCents must be a positive number" });
  }
  if (typeof estimatedDurationMinutes !== "number" || estimatedDurationMinutes <= 0) {
    return res.status(400).json({ error: "estimatedDurationMinutes must be a positive number" });
  }
  if (isOneOfOne !== undefined && typeof isOneOfOne !== "boolean") {
    return res.status(400).json({ error: "isOneOfOne must be a boolean" });
  }

  const artist = await prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } });
  // Artist mobility bug fix: a studio can also create a flash piece for its
  // own active GUEST artists, not just HOME ones -- same
  // studioHasActiveMembership pattern as every other artistId-ownership
  // check in the codebase (see lib/artistAccess.ts). Without this, staff at
  // a guest studio couldn't create a flash piece on behalf of their own
  // currently-guesting artist at all.
  const artistBelongsToStudio =
    artist != null && (artist.user.studioId === studioId || (await studioHasActiveMembership(studioId, artist.id)));
  if (!artistBelongsToStudio) {
    return res.status(400).json({ error: "artistId must belong to your studio" });
  }

  // Belt-and-suspenders: artistId was either resolved to the actor's own
  // id above (ARTIST role) or supplied by staff -- this only re-confirms
  // the resolved/supplied id is genuinely theirs, in case resolveOwnArtistId
  // and the fetched artist ever disagree.
  if (req.user!.role === Role.ARTIST && artist.userId !== req.user!.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  let parsedTranslations: { locale: string; data: Record<string, unknown> }[] = [];
  if (req.body?.translations !== undefined) {
    const parsed = parseFlashPieceTranslations(req.body.translations);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }
    parsedTranslations = parsed.value;
  }

  const piece = await prisma.flashPiece.create({
    data: {
      studioId,
      artistId: artistId!,
      imageUrl,
      title,
      description: description || null,
      priceCents,
      estimatedDurationMinutes,
      isOneOfOne: isOneOfOne ?? false,
    },
    include: FLASH_PIECE_INCLUDE,
  });

  for (const { locale, data: translationData } of parsedTranslations) {
    await prisma.flashPieceTranslation.create({
      data: { flashPieceId: piece.id, studioId, locale, ...translationData },
    });
  }

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "FlashPiece",
    entityId: piece.id,
    action: "create",
    changes: { artistId, title, priceCents, estimatedDurationMinutes, isOneOfOne: piece.isOneOfOne },
  });

  emitInvalidation({ type: "flash.changed", studioId });

  // Not reshaped like the list GET below -- `piece` was fetched before the
  // translation rows above were written, so it would show a stale empty
  // `translations`. The editor already has the values it just submitted;
  // it doesn't need them echoed back (same convention as
  // customPolicies.ts/services.ts's own create/update responses).
  res.status(201).json(piece);
});

router.patch("/:id", async (req, res) => {
  const id = req.params.id as string;

  const existing = await prisma.flashPiece.findUnique({ where: { id }, include: { artist: true } });
  const role = existing ? await effectiveRoleAt(req.user!, existing.studioId) : null;
  if (!existing || !role) {
    return res.status(404).json({ error: "Flash piece not found" });
  }
  const studioId = existing.studioId;
  const isSelf = existing.artist.userId === req.user!.userId;

  // Flash governance split (approved -- REPORT.md: "Permission-context fix
  // Part 4" flagged this exact swap and deliberately deferred it; this is
  // that decision made). A flash piece's CONTENT (image, title, price,
  // duration, isOneOfOne -- everything this route can write) is the
  // artist's own portable content, same category bio/portfolio/rates are
  // already in: editing YOUR OWN piece is still never gated by anything
  // (unchanged). Staff editing content on another artist's behalf is now
  // gated by that artist's OWN per-membership profile-delegation toggle
  // (StudioMembership.allowsStudioProfileEdits) at THIS piece's own
  // studio -- the exact same "record's studio, not the caller's home"
  // rule effectiveRoleAt already applies, evaluated via
  // hasProfileDelegationAt -- NOT flashGallery.manage anymore. That
  // matrix key still fully governs everything else this file does
  // (creating new pieces, and the studio-facing lifecycle action below --
  // retire/gallery visibility); only this one route's staff-on-behalf-of
  // branch changed. An ARTIST can still never touch a DIFFERENT artist's
  // piece at all (unchanged) -- checked against `role`, the caller's
  // EFFECTIVE role AT this piece's own studio, same solo-guest-fix
  // reasoning as before: a solo OWNER guesting here is exactly as much
  // "just an ARTIST" as any other guest.
  if (!isSelf) {
    if (role === Role.ARTIST) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!(await hasProfileDelegationAt(existing.artistId, studioId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const { imageUrl, title, description, priceCents, estimatedDurationMinutes, isOneOfOne } = req.body ?? {};

  if (priceCents !== undefined && (typeof priceCents !== "number" || priceCents <= 0)) {
    return res.status(400).json({ error: "priceCents must be a positive number" });
  }
  if (
    estimatedDurationMinutes !== undefined &&
    (typeof estimatedDurationMinutes !== "number" || estimatedDurationMinutes <= 0)
  ) {
    return res.status(400).json({ error: "estimatedDurationMinutes must be a positive number" });
  }
  if (isOneOfOne !== undefined && typeof isOneOfOne !== "boolean") {
    return res.status(400).json({ error: "isOneOfOne must be a boolean" });
  }

  let parsedTranslations: { locale: string; data: Record<string, unknown> }[] = [];
  if (req.body?.translations !== undefined) {
    const parsed = parseFlashPieceTranslations(req.body.translations);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }
    parsedTranslations = parsed.value;
  }

  const data = {
    ...(imageUrl !== undefined ? { imageUrl } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description: description || null } : {}),
    ...(priceCents !== undefined ? { priceCents } : {}),
    ...(estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes } : {}),
    ...(isOneOfOne !== undefined ? { isOneOfOne } : {}),
  };

  const updated = await prisma.flashPiece.update({ where: { id }, data, include: FLASH_PIECE_INCLUDE });

  for (const { locale, data: translationData } of parsedTranslations) {
    await prisma.flashPieceTranslation.upsert({
      where: { flashPieceId_locale: { flashPieceId: id, locale } },
      create: { flashPieceId: id, studioId, locale, ...translationData },
      update: translationData,
    });
  }

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "FlashPiece",
    entityId: id,
    action: "update",
    changes: diffObjects(existing, data, ["imageUrl", "title", "description", "priceCents", "estimatedDurationMinutes", "isOneOfOne"]),
  });

  emitInvalidation({ type: "flash.changed", studioId });

  res.json(updated);
});

// Retire: a manual, one-way staff/artist action -- reachable from AVAILABLE
// only (a piece already PENDING_APPROVAL or BOOKED needs the in-flight
// request resolved first, not pulled out from under it; an already-RETIRED
// piece has nothing left to do here). Distinct dedicated route (rather than
// folding into PATCH's generic field update) for the same reason
// mark-lost/reopen get their own routes elsewhere -- a clear, audited,
// singular action rather than a raw status field write.
router.post("/:id/retire", async (req, res) => {
  const id = req.params.id as string;

  const existing = await prisma.flashPiece.findUnique({ where: { id }, include: { artist: true } });
  const role = existing ? await effectiveRoleAt(req.user!, existing.studioId) : null;
  if (!existing || !role) {
    return res.status(404).json({ error: "Flash piece not found" });
  }
  const studioId = existing.studioId;
  const isSelf = existing.artist.userId === req.user!.userId;

  // Carve-out: same "governed by the artist" reasoning as PATCH /:id above
  // -- retiring your OWN piece is never gated by any studio's permission
  // matrix. An ARTIST still can never touch a DIFFERENT artist's piece;
  // staff retiring on another artist's behalf stays gated by
  // flashGallery.manage, evaluated at the piece's own studio. Solo-guest
  // fix: `role` is the caller's EFFECTIVE role at this studio, same
  // reasoning as PATCH /:id above.
  if (!isSelf) {
    if (role === Role.ARTIST) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!(await hasPermission(studioId, role, "flashGallery.manage"))) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  if (existing.status !== FlashPieceStatus.AVAILABLE) {
    return res.status(400).json({ error: `Can't retire a piece that's currently ${existing.status}` });
  }

  const updated = await prisma.flashPiece.update({
    where: { id },
    data: { status: FlashPieceStatus.RETIRED },
    include: FLASH_PIECE_INCLUDE,
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "FlashPiece",
    entityId: id,
    action: "retire",
    changes: { status: { from: existing.status, to: FlashPieceStatus.RETIRED } },
  });

  emitInvalidation({ type: "flash.changed", studioId });

  res.json(updated);
});

export default router;
