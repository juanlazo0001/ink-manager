import { notificationRoute, type NotificationItem } from '@/lib/notifications';

/**
 * Where a tapped push should land — the PURE half of push handling.
 *
 * ─── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────
 *
 * `lib/push.ts` imports `react-native`, `expo-notifications`,
 * `expo-device` and `expo-constants` — none of which the test runner can
 * transform (React Native's own `index.js` is Flow-typed and esbuild
 * rejects it outright). Routing depends on none of them: it is a
 * function of the payload and the viewer's role.
 *
 * So the decision lives here, where it can be tested, and the device I/O
 * stays in `push.ts`. `push.ts` re-exports these, so callers still have
 * one import.
 */

/**
 * The `data` block the server attaches to every push.
 *
 * `apps/api/src/lib/notifications.ts` builds it as
 * `{ type, entityType, entityId, ...payload }` — the same three fields
 * the in-app feed's rows carry, which is what lets one routing function
 * serve both surfaces.
 */
export interface PushData {
  type?: string;
  entityType?: string;
  entityId?: string;
  [key: string]: unknown;
}

/**
 * Deliberately delegates to `notificationRoute`, the feed's own resolver,
 * rather than restating the mapping. Two copies of "an Inquiry opens the
 * staff screen unless you are an ARTIST" is exactly how the two surfaces
 * would drift — and that rule is not cosmetic: sending an artist to the
 * staff route is a guaranteed 403.
 *
 * Returns null when the payload names nothing routable, so the caller can
 * open the app without navigating rather than guessing a destination the
 * push was not about.
 */
export function pushRoute(
  data: PushData | null | undefined,
  role: string | undefined,
): { pathname: string; params?: Record<string, string> } | null {
  if (!data?.entityType || !data.entityId) return null;
  const item = {
    entityType: String(data.entityType),
    entityId: String(data.entityId),
  } as NotificationItem;
  return notificationRoute(item, role);
}
