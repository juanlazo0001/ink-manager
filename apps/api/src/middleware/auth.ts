import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import { VIEW_AS_HEADER, resolveViewAsTarget } from "../lib/viewAs";
import { prisma } from "../lib/prisma";

export interface AuthPayload {
  userId: string;
  studioId: string;
  role: Role;
  // jsonwebtoken adds this automatically (seconds since epoch) on every
  // token minted by jwt.sign -- not something this app ever sets itself,
  // but needed here to compare a token's own issue time against the
  // user's passwordChangedAt (see the live session-invalidation check in
  // requireAuth below). Optional only because a hand-constructed
  // AuthPayload elsewhere in the code (there isn't one today) wouldn't
  // have it.
  iat?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      // Set only while an X-View-As-User header is honored -- the real,
      // never-overridden identity from the JWT itself. Used by the
      // read-only gate below and by anything that needs to know who is
      // REALLY making the request (there's currently no such consumer,
      // but it's here so one never has to reach into the JWT again).
      realUser?: AuthPayload;
      // Solo artist architecture, Phase 3: set by
      // requirePermissionOrSoloArtist (lib/permissions.ts) only when the
      // request was allowed via the solo-studio bypass, not a real
      // permission grant -- lets the route handler add the extra "only
      // your own appointments" restriction that bypass specifically needs,
      // without the route re-deriving solo status itself.
      viaSoloArtistBypass?: boolean;
    }
  }
}

// View As (admin impersonation): a single resolution point. If the header
// is present and honored, req.user is overwritten with the TARGET's
// identity for the rest of this request -- every downstream consumer
// (requireRole, requirePermission/hasPermission, and every route handler
// that reads req.user!.userId/studioId/role directly) sees the
// impersonated user without any per-route changes. The real identity
// never changes in the JWT; it's only ever request-scoped context here,
// never persisted.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let realUser: AuthPayload;
  try {
    realUser = jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Live session-invalidation check (account-lifecycle work): a JWT's own
  // signature/expiry says nothing about whether the account behind it was
  // deactivated or had its password changed AFTER this specific token was
  // issued -- that can only be known by asking the database on every
  // request, so this is a real DB round-trip on every authenticated call,
  // not just a JWT decode. Two independent conditions, both immediate
  // (checked regardless of the token's own age):
  //   1. isActive/deactivatedAt -- deactivation takes effect on the very
  //      next request, not just future logins (a token minted seconds ago
  //      is rejected exactly the same as one minted a week ago).
  //   2. passwordChangedAt vs the token's own iat -- a password reset or
  //      self-service password change invalidates every session that
  //      existed before it, not just the device that made the change.
  // Same rejection shape (401 "Unauthorized") as an invalid/expired JWT
  // itself, deliberately -- this isn't a case that needs a different error
  // message to the caller (the frontend's response is identical either
  // way: bounce to /login), and not leaking WHY a token stopped working
  // avoids handing back a signal an attacker could use to distinguish
  // "expired" from "revoked."
  const liveUser = await prisma.user.findUnique({
    where: { id: realUser.userId },
    select: { isActive: true, deactivatedAt: true, passwordChangedAt: true },
  });

  if (!liveUser || !liveUser.isActive || liveUser.deactivatedAt) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (liveUser.passwordChangedAt && realUser.iat != null && realUser.iat * 1000 < liveUser.passwordChangedAt.getTime()) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.user = realUser;

  const targetUserId = req.headers[VIEW_AS_HEADER];
  if (typeof targetUserId === "string" && targetUserId.length > 0) {
    if (realUser.role !== Role.OWNER) {
      return res.status(403).json({ error: "Only the studio owner can view the portal as another user" });
    }

    const resolved = await resolveViewAsTarget(realUser.studioId, targetUserId);
    if ("error" in resolved) {
      return res.status(404).json({ error: resolved.error });
    }

    req.realUser = realUser;
    req.user = { userId: resolved.target.id, studioId: resolved.target.studioId, role: resolved.target.role };

    // Read-only enforcement lives here too -- the same chokepoint that
    // resolves the effective user is the only place guaranteed to run on
    // every protected route, so it's also the only place that can
    // guarantee this holds everywhere, not just wherever a route
    // remembers to check it. /view-as/* is exempt (activation/
    // deactivation are themselves POSTs) -- in practice the client never
    // sends this header on those calls (see routes/viewAs.ts), but the
    // exemption is here defensively regardless.
    const isViewAsRoute = req.originalUrl.startsWith("/view-as");
    if (req.method !== "GET" && !isViewAsRoute) {
      return res.status(403).json({ error: "Read-only while viewing as another user" });
    }
  }

  next();
}

// For routes that serve both an unauthenticated public flow and an
// authenticated staff flow from the same handler (e.g. POST /inquiries,
// submitted either by the public intake form or by front desk logging a
// walk-in/phone inquiry) -- populates req.user when a valid bearer token is
// present, but never rejects the request when one isn't. No View-As
// support here (that's a staff-only concept that doesn't apply to a route
// half of whose callers are anonymous).
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET) as AuthPayload;
    } catch {
      // Invalid/expired token on this route just means "treat as anonymous"
      // -- unlike requireAuth, there's no protected resource to guard here.
    }
  }

  next();
}

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}
