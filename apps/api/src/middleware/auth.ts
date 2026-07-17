import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import { VIEW_AS_HEADER, resolveViewAsTarget } from "../lib/viewAs";

export interface AuthPayload {
  userId: string;
  studioId: string;
  role: Role;
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

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}
