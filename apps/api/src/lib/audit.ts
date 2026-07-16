import { prisma } from "./prisma";
import type { Prisma } from "../../generated/prisma/client";

interface LogAuditParams {
  studioId: string;
  // Null means a public/unauthenticated or system action, not a missing user.
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  // Accepts anything JSON-serializable (e.g. diffObjects' output, which may
  // contain Date values) -- round-tripped through JSON below to land on a
  // plain value Prisma's Json column will accept.
  changes?: Record<string, unknown> | null;
}

// Fire-and-forget-safe: a logging failure must never fail the request that
// triggered it, so errors are swallowed here (and reported to the console)
// rather than propagated to the caller.
export async function logAudit(params: LogAuditParams): Promise<void> {
  try {
    const changes: Prisma.InputJsonValue | undefined = params.changes
      ? (JSON.parse(JSON.stringify(params.changes)) as Prisma.InputJsonValue)
      : undefined;

    await prisma.auditLog.create({
      data: {
        studioId: params.studioId,
        actorUserId: params.actorUserId,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        changes,
      },
    });
  } catch (err) {
    console.error("Failed to write audit log", { entityType: params.entityType, entityId: params.entityId, err });
  }
}

const SENSITIVE_KEY_PATTERN = /password|token|signature/i;

// Produces { field: { from, to } } for fields present in `after` that
// actually changed from `before`, skipping sensitive fields entirely.
export function diffObjects<T extends Record<string, unknown>>(
  before: T,
  after: Partial<Record<keyof T, unknown>>,
  fieldsToTrack?: (keyof T)[],
): Record<string, { from: unknown; to: unknown }> {
  const keys = fieldsToTrack ?? (Object.keys(after) as (keyof T)[]);
  const diff: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of keys) {
    const keyStr = String(key);
    if (SENSITIVE_KEY_PATTERN.test(keyStr)) continue;

    const afterValue = after[key];
    if (afterValue === undefined) continue;

    const beforeValue = before[key];
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;

    diff[keyStr] = { from: beforeValue, to: afterValue };
  }

  return diff;
}
