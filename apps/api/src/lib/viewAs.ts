import { prisma } from "./prisma";
import { Role } from "../../generated/prisma/enums";

export const VIEW_AS_HEADER = "x-view-as-user";

export interface ViewAsTarget {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  studioId: string;
}

// Shared by the request-time header resolution (middleware/auth.ts) and the
// activation-audit route (routes/viewAs.ts) so the two never drift on what
// counts as a valid target: must exist, must be in the same studio as the
// real (authenticated) user, and must be a staff role -- CUSTOMER never
// gets a portal session in this app, so it's never a valid View As target
// either.
export async function resolveViewAsTarget(
  realUserStudioId: string,
  targetUserId: string,
): Promise<{ error: string } | { target: ViewAsTarget }> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });

  if (!target || target.studioId !== realUserStudioId) {
    return { error: "User not found" };
  }

  if (target.role === Role.CUSTOMER) {
    return { error: "Cannot view as a customer" };
  }

  return {
    target: {
      id: target.id,
      name: target.name,
      email: target.email,
      role: target.role,
      studioId: target.studioId,
    },
  };
}
