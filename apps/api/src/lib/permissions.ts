import type { NextFunction, Request, Response } from "express";
import { prisma } from "./prisma";
import { Role } from "../../generated/prisma/enums";
import type { RolePermission } from "../../generated/prisma/client";
import { isSoloStudioArtist } from "./soloStudio";

// One key per capability that used to be a hardcoded requireRole check (or,
// as of this expansion, a capability that was previously bundled into a
// too-broad key like clients.manage/appointments.manage, or hardcoded with
// no matrix entry at all). Kept in sync with apps/web/src/lib/permissions.ts
// for display labels/grouping.
//
// clients.manage and appointments.manage are RETIRED as of this expansion
// (split into the granular keys below) -- deliberately removed from this
// array rather than left in, so hasPermission/buildPermissionMatrix/the
// Settings UI all stop referencing them. Any existing RolePermission row
// with permissionKey "clients.manage" or "appointments.manage" is left
// untouched in the database (never deleted, never read again) -- see
// REPORT.md's "Granular permissions expansion" entry for the one-time
// override-propagation that ran before this array changed, copying each
// studio's existing clients.manage/appointments.manage override onto every
// one of that key's successor keys so no studio's customization silently
// reset to a different default.
//
// studio.manage is ALSO retired (same "deliberately removed, not just
// defaulted off" treatment) -- editing the studio's own name/logo/website
// is OWNER-only now (routes/studios.ts's PATCH /:studioId), hardcoded via
// requireRole, never a configurable grant. A real studio had this toggled
// on for ARTIST via the matrix, letting any artist rename the business.
export const PERMISSION_KEYS = [
  // Unchanged from before this expansion.
  "locations.manage",
  "artists.manage",
  "artists.view",
  "appointments.create",
  "appointments.view",

  // Inquiries & Projects
  "inquiries.view",
  "inquiries.create",
  "inquiries.edit",
  "inquiries.assignArtist",
  "inquiries.enterEstimate",
  "inquiries.sendEstimate",
  "inquiries.artistSendEstimate",
  "inquiries.markLost",
  "inquiries.notes.manage",
  "inquiries.shareWithArtist",

  // Clients (successors to the retired clients.manage)
  "clients.view",
  "clients.edit",
  "clients.merge",
  "clients.archive",
  "clients.import",

  // Appointments & Calendar (successors to the retired appointments.manage,
  // plus two actions that were hardcoded requireRole(OWNER, FRONT_DESK)
  // with no matrix entry at all before now)
  "appointments.reschedule",
  "appointments.checkout",
  "appointments.photos.manage",

  // Gift Cards & Deposits
  "giftCards.view",
  "giftCards.issue",
  "giftCards.void",
  "depositTiers.manage",
  "deposits.markPaidManual",

  // Waivers -- health answers/ID images stay off this matrix permanently
  // (the safety floor); these three govern workflow actions only.
  "waivers.viewStatus",
  "waivers.verify",
  "waivers.generate",

  // Conversations
  "conversations.viewClientThreads",
  "conversations.sendLive",
  "conversations.manageTemplates",
  "conversations.viewStaffThreads",

  // Tasks
  "tasks.viewQueue",
  "tasks.assignToOthers",
  "tasks.manageOwn",

  // Team & Locations (locations.manage already existed, listed above)
  "team.manage",
  "artistSchedules.manage",
  // 6a Epic: create/edit/cancel a guest's residency stints at this studio
  // -- grouped alongside artistSchedules.manage (same "scheduling-adjacent
  // staff capability" family), never the artist's own accept/decline
  // (inalienable, no permission key governs it -- see
  // routes/residencies.ts).
  "residencies.manage",

  // Settings
  "settings.managePolicies",
  "settings.manageDefaults",
  "settings.manageTheme",
  "audit.view",
  "settings.manageReferral",
  // Phase 5: gates the artist field-visibility toggles (Pricing &
  // financial detail / Internal notes) the same way every other settings
  // domain has its own key -- see studioSettings.ts's
  // presentSettingsPermissionGroups.
  "settings.manageArtistVisibility",

  // Reports
  "reports.viewDashboard",
  "reports.viewFinancial",

  // Kanban/Views -- see the two keys' own comments below: no backend route
  // exists yet for either action, so these are matrix-only placeholders
  // with nothing to gate today (documented transparently in REPORT.md,
  // not silently pretended-implemented).
  "kanban.reorder",
  "bulkActions.use",

  // Flash gallery: an artist always manages their OWN pieces (inline
  // "-own" narrowing in the route itself, unconditional, not gated by
  // this key at all). This key still governs OWNER/FRONT_DESK creating a
  // NEW piece for another artist and the studio-facing lifecycle action
  // (retire). Flash governance split (REPORT.md, approved -- previously
  // flagged and deliberately deferred in "Permission-context fix Part
  // 4"): it no longer governs staff EDITING an existing piece's own
  // content (image/title/price/duration/isOneOfOne) on another artist's
  // behalf -- that's gated by the artist's own per-membership
  // profile-delegation toggle instead (StudioMembership.
  // allowsStudioProfileEdits, see lib/artistAccess.ts's
  // hasProfileDelegationAt), same category bio/portfolio/rates are
  // already in.
  "flashGallery.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// The three roles a permission matrix can actually configure. OWNER always
// has every permission and is never a row here — see requirePermission.
export const CONFIGURABLE_ROLES = [Role.FRONT_DESK, Role.ARTIST, Role.CUSTOMER] as const;

// Reproduces exactly what each requireRole(...)/hardcoded check allowed
// before this expansion, so no studio's behavior changes until an OWNER
// edits the matrix -- EXCEPT for two keys called out below where the
// actual current route gate didn't match this task's assumed default;
// those are corrected to match reality, not the assumption, per this
// session's own instruction ("correct the default if reality differs").
export const DEFAULT_ROLE_PERMISSIONS: Record<(typeof CONFIGURABLE_ROLES)[number], Set<PermissionKey>> = {
  [Role.FRONT_DESK]: new Set<PermissionKey>([
    "artists.view",
    "appointments.create",
    "appointments.view",

    "inquiries.view",
    "inquiries.create",
    "inquiries.edit",
    "inquiries.assignArtist",
    "inquiries.enterEstimate",
    "inquiries.sendEstimate",
    "inquiries.markLost",
    "inquiries.notes.manage",
    "inquiries.shareWithArtist",

    "clients.view",
    "clients.edit",
    "clients.merge",
    "clients.archive",
    // clients.import: FALSE for FRONT_DESK -- clientImport.ts's whole
    // router was already gated requirePermission("clients.manage"), which
    // FRONT_DESK did have by default, so this is a genuine (deliberate,
    // task-specified) default change: FRONT_DESK loses default bulk-import
    // access on this expansion, matching this task's explicit table.

    "appointments.reschedule",
    "appointments.checkout",
    "appointments.photos.manage",

    "giftCards.view",
    "giftCards.issue",
    // giftCards.void: FALSE -- was already hardcoded requireRole(OWNER)
    // only, FRONT_DESK never had it.
    // depositTiers.manage: FALSE -- was already requireRole(OWNER) only
    // (part of the combined studio-settings PATCH).
    "deposits.markPaidManual",

    "waivers.viewStatus",
    "waivers.verify",
    "waivers.generate",

    "conversations.viewClientThreads",
    "conversations.sendLive",
    // conversations.manageTemplates: FALSE -- was requireRole(OWNER) only.
    "conversations.viewStaffThreads",

    "tasks.viewQueue",
    "tasks.assignToOthers",
    "tasks.manageOwn",

    // team.manage: FALSE -- was requireRole(OWNER) only.
    "artistSchedules.manage",
    // 6a Epic: default TRUE for FRONT_DESK, same as artistSchedules.manage
    // right above -- a genuinely new capability (there was no residency
    // concept before this epic), defaulted to match the scheduling-adjacent
    // capability it's grouped with rather than defaulting closed.
    "residencies.manage",

    // settings.managePolicies/manageDefaults/manageTheme/manageReferral:
    // all FALSE -- the combined studio-settings PATCH was requireRole(OWNER)
    // only for every field it accepts. settings.manageArtistVisibility
    // (Phase 5, new) follows the same default -- OWNER-only until an
    // OWNER explicitly grants it, same as every other settings.* key.
    "audit.view",

    // reports.viewDashboard: see below -- corrected default.
    "reports.viewDashboard",
    "reports.viewFinancial",

    "kanban.reorder",
    "bulkActions.use",
    "flashGallery.manage",
  ]),
  [Role.ARTIST]: new Set<PermissionKey>([
    "artists.view",
    "appointments.view",

    // inquiries.view: CORRECTED default (see note below) -- ARTIST already
    // has this today via the separate, always-on GET /assigned-to-me
    // route (requireRole(ARTIST) hardcoded, scoped to assignedArtistId ===
    // their own artist id). The task's own table already called this
    // "AR✓-own", matching reality -- no discrepancy here, just documenting
    // why it's true.
    "inquiries.view",
    // inquiries.enterEstimate: same reasoning -- ARTIST already enters
    // their own estimate via PATCH /:id/respond (requireRole(ARTIST),
    // scoped to inquiry.assignedArtistId === their own artist id). That
    // scoping stays in effect regardless of this toggle (per this task's
    // own "-own" convention) -- toggling this off blocks an artist from
    // responding to their own assigned inquiries; toggling it on for
    // someone who already has it is a no-op. The separate staff-only
    // POST /:id/revise-estimate (revising an ALREADY-CONVERTED project)
    // stays scoped to the artist's own assigned project too, so this
    // single key can't be used to reach a different artist's project.
    "inquiries.enterEstimate",

    // inquiries.artistSendEstimate: judgment call, default TRUE. An artist
    // who can already enter their own estimate (above) triggering the same
    // real send -- link minted, SMS sent, logged in Conversations -- that
    // staff's own Generate & Send Estimate produces is a small step past
    // that, not a new capability class; today's approve flow already moves
    // the inquiry to AWAITING_CLIENT_RESPONSE, it just never actually
    // contacted the client while doing so, which is the more surprising
    // half of the old behavior. A studio that wants front desk to review
    // every artist-priced estimate before it reaches a client can flip this
    // off -- the artist still fully prepares and saves the estimate either
    // way (PATCH /inquiries/:id/respond, routes/inquiries.ts), submission
    // just creates a front-desk task instead of sending directly.
    "inquiries.artistSendEstimate",

    "artistSchedules.manage",

    // waivers.viewStatus: ARTIST gets a NEW, narrow GET /:id/status route
    // (added as part of this expansion) returning ONLY {id, status,
    // signedAt, verifiedAt} -- never healthAnswers/idImageUrl/signature
    // data, which stay behind the untouched floor-item router gate on the
    // full GET /:id. Scoped to waivers for the artist's own appointments.
    "waivers.viewStatus",

    "conversations.viewStaffThreads",

    "tasks.manageOwn",

    // reports.viewDashboard: CORRECTED default -- this task's own table
    // assumed FD✓/AR✗, but the actual current route
    // (GET /reports/dashboard) is requireRole(OWNER, FRONT_DESK, ARTIST) --
    // ARTIST already sees the dashboard today. Kept TRUE to match current
    // reality (this expansion's own overriding rule: "seed
    // DEFAULT_ROLE_PERMISSIONS so behavior is IDENTICAL to today").
    "reports.viewDashboard",
    // reports.viewFinancial: kept FALSE, exactly as this task's table
    // specifies -- this IS a deliberate, task-directed tightening (not a
    // default-preservation), since ARTIST currently sees the dashboard's
    // real dollar figures (depositConversion/giftCardLiability) too, with
    // zero separation from the rest of the dashboard. Splitting those
    // figures behind their own key and defaulting artists OFF is this
    // task's explicit, deliberate design, called out in REPORT.md as a
    // real behavior change on deploy, not a same-as-today default.

    "flashGallery.manage",
  ]),
  [Role.CUSTOMER]: new Set<PermissionKey>(["artists.view"]),
};

// All permission keys a given role currently has in a studio — used to
// tell the frontend what to show/hide, as opposed to hasPermission's
// single-key check used to gate individual routes.
export async function getEffectivePermissions(studioId: string, role: Role): Promise<PermissionKey[]> {
  if (role === Role.OWNER) return [...PERMISSION_KEYS];

  const defaults = DEFAULT_ROLE_PERMISSIONS[role as (typeof CONFIGURABLE_ROLES)[number]];
  if (!defaults) return [];

  const overrides = await prisma.rolePermission.findMany({ where: { studioId, role } });
  const overrideMap = new Map(overrides.map((o: RolePermission) => [o.permissionKey, o.allowed]));

  return PERMISSION_KEYS.filter((key) => overrideMap.get(key) ?? defaults.has(key));
}

export async function hasPermission(studioId: string, role: Role, key: PermissionKey): Promise<boolean> {
  if (role === Role.OWNER) return true;

  const override = await prisma.rolePermission.findUnique({
    where: { studioId_role_permissionKey: { studioId, role, permissionKey: key } },
  });

  if (override) return override.allowed;

  const defaults = DEFAULT_ROLE_PERMISSIONS[role as (typeof CONFIGURABLE_ROLES)[number]];
  return defaults ? defaults.has(key) : false;
}

// Express middleware factory, dropped in wherever a route used to say
// requireRole(...) for one of the capabilities above.
export function requirePermission(key: PermissionKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const allowed = await hasPermission(req.user.studioId, req.user.role, key);

    if (!allowed) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}

// Solo artist architecture, Phase 3: appointments.create/appointments.
// reschedule stay OWNER/FRONT_DESK-only by DEFAULT (DEFAULT_ROLE_PERMISSIONS
// itself is untouched -- an explicit RolePermission override, if a studio
// ever sets one, still wins either way, identical precedence to every
// other key), but a solo studio's own artist gets an ADDITIONAL, narrow
// allow-path on top: no other OWNER/FRONT_DESK exists to gate their
// bookings, so the rule protecting nothing left to protect for them
// specifically. Deliberately NOT folded into hasPermission/
// getEffectivePermissions -- both stay reusable, role-level computations
// with no per-user concept, so Settings -> Permissions (which reads
// getEffectivePermissions) keeps showing ARTIST's TRUE role-level default
// for a solo studio too, not a solo-specific value that would misleadingly
// look staff-granted. This wrapper is used only at the exact route gates
// that need the bypass; every multi-person studio's artists see identical
// behavior to before this phase, since isSoloStudioArtist is false for them.
export function requirePermissionOrSoloArtist(key: PermissionKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const allowed = await hasPermission(req.user.studioId, req.user.role, key);
    if (allowed) {
      return next();
    }

    if (req.user.role === Role.ARTIST && (await isSoloStudioArtist(req.user.studioId, req.user.userId))) {
      req.viaSoloArtistBypass = true;
      return next();
    }

    return res.status(403).json({ error: "Forbidden" });
  };
}

// An artist manages their own profile (rates, scheduling buffer, services
// offered, bio/specialties/portfolio/social links -- everything on
// PATCH /artists/:id except the studio-only guest-artist classification,
// stripped separately by the route itself using req.viaSelfArtistBypass)
// regardless of whether their studio has granted them artists.manage --
// that permission is about managing OTHER artists, and withholding it was
// never meant to also block someone from managing themselves. Same shape
// as requirePermissionOrSoloArtist above: permission first, self-bypass
// second, both real allow-paths rather than one masquerading as the other.
export function requirePermissionOrSelfArtist(key: PermissionKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const allowed = await hasPermission(req.user.studioId, req.user.role, key);
    if (allowed) {
      return next();
    }

    const artistId = req.params.id as string | undefined;
    const artist = artistId ? await prisma.artist.findUnique({ where: { id: artistId }, select: { userId: true } }) : null;
    if (artist && artist.userId === req.user.userId) {
      req.viaSelfArtistBypass = true;
      return next();
    }

    return res.status(403).json({ error: "Forbidden" });
  };
}
