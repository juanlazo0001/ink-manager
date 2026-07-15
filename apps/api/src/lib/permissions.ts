import type { NextFunction, Request, Response } from "express";
import { prisma } from "./prisma";
import { Role } from "../../generated/prisma/enums";

// One key per capability that used to be a hardcoded requireRole check.
// Kept in sync with apps/web/src/lib/permissions.ts for display labels.
export const PERMISSION_KEYS = [
  "studio.manage",
  "locations.manage",
  "artists.manage",
  "artists.view",
  "clients.manage",
  "appointments.create",
  "appointments.view",
  "appointments.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// The three roles a permission matrix can actually configure. OWNER always
// has every permission and is never a row here — see requirePermission.
export const CONFIGURABLE_ROLES = [Role.FRONT_DESK, Role.ARTIST, Role.CUSTOMER] as const;

// Reproduces exactly what each requireRole(...) check allowed before this
// system existed, so no studio's behavior changes until an OWNER edits the
// matrix.
export const DEFAULT_ROLE_PERMISSIONS: Record<(typeof CONFIGURABLE_ROLES)[number], Set<PermissionKey>> = {
  [Role.FRONT_DESK]: new Set<PermissionKey>([
    "artists.view",
    "clients.manage",
    "appointments.create",
    "appointments.view",
    "appointments.manage",
  ]),
  [Role.ARTIST]: new Set<PermissionKey>(["artists.view", "appointments.view"]),
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
  const overrideMap = new Map(overrides.map((o) => [o.permissionKey, o.allowed]));

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
