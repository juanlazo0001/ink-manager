import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { apiFetch } from '@/lib/api';
import { pushRoute, type PushData } from '@/lib/pushRouting';

/**
 * Push notifications, the mobile half.
 *
 * ─── THE GAP THIS CLOSES ────────────────────────────────────────────
 *
 * `apps/api/src/routes/pushTokens.ts` has existed for some time, mounted
 * at `/push-tokens`, and `lib/notifications.ts` on the server already
 * sends through Expo whenever it creates a `Notification` row. Nothing in
 * `apps/mobile` had ever referenced any of it — so the backend half has
 * been shipping alone, registering no devices and pushing to nobody.
 *
 * ─── WHAT CANNOT BE VERIFIED HERE, STATED UP FRONT ──────────────────
 *
 * **Remote push cannot be received in Expo Go.** Since SDK 53 the Expo Go
 * client no longer carries push credentials, so `getExpoPushTokenAsync`
 * either throws or returns a token nothing will deliver to. This module
 * is written to be correct and is unit-tested for its pure parts, but
 * live receipt requires an EAS development build — that is queued as its
 * own session and no claim is made here that a push has been received.
 *
 * `isPushCapable()` exists so the app degrades honestly rather than
 * failing: in Expo Go it declines to ask for permission at all, instead
 * of prompting for something that cannot work.
 */

/** The Expo project id, which `getExpoPushTokenAsync` requires on SDK 49+. */
const PROJECT_ID =
  Constants.expoConfig?.extra?.eas?.projectId ??
  (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId ??
  null;

/**
 * Whether this build can actually receive a remote push.
 *
 * Three things have to hold, and each fails differently:
 *
 *   · a real device — the simulator has no APNs registration at all
 *   · not Expo Go — see the header; `appOwnership === 'expo'` is the tell
 *   · a project id — the token request needs one and there is no default
 */
export function isPushCapable(): { ok: boolean; reason: string | null } {
  if (!Device.isDevice) return { ok: false, reason: 'Push needs a physical device.' };
  if (Constants.appOwnership === 'expo') {
    return { ok: false, reason: 'Expo Go cannot receive push. A development build is needed.' };
  }
  if (!PROJECT_ID) return { ok: false, reason: 'No EAS project id is configured.' };
  return { ok: true, reason: null };
}

export interface RegisterResult {
  registered: boolean;
  /** Null when nothing was registered. Never logged — it identifies a device. */
  token: string | null;
  reason: string | null;
}

/**
 * Ask for permission, get the Expo token, and register it with the API.
 *
 * ─── WHEN THIS IS CALLED, AND WHY NOT SOONER ────────────────────────
 *
 * AFTER LOGIN, never on first launch. A permission prompt on a cold start
 * arrives before the person has seen what the app is, and iOS gives an
 * app exactly one chance to ask — a decline is permanent short of a trip
 * to Settings. Asking once they are signed in means the prompt lands
 * against a screen that has already explained itself.
 *
 * Existing permission is not re-requested: `getPermissionsAsync` first,
 * and `requestPermissionsAsync` only when the status is still
 * undetermined. A caller that asks every launch would re-prompt nobody
 * (iOS silently denies) but would also never notice the difference
 * between "not yet asked" and "asked and declined".
 */
export async function registerPushToken(authToken: string): Promise<RegisterResult> {
  const capable = isPushCapable();
  if (!capable.ok) return { registered: false, token: null, reason: capable.reason };

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status === 'undetermined') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') {
    return { registered: false, token: null, reason: 'Notification permission was not granted.' };
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID! });

  await apiFetch<unknown>('/push-tokens', {
    method: 'POST',
    token: authToken,
    body: JSON.stringify({
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      deviceName: Device.deviceName ?? null,
    }),
  });

  return { registered: true, token, reason: null };
}

/**
 * Unregister on logout.
 *
 * Best-effort by design: the route deletes by `(token, userId)` together,
 * so a failure here leaves a row that can only ever be pushed to by the
 * account that just signed out — and the next person to sign in on this
 * hardware re-registers the same token, which the route UPSERTS onto
 * their user. The stale row is therefore self-healing, and a logout that
 * refuses to complete because a DELETE failed would be much worse.
 */
export async function unregisterPushToken(authToken: string, pushToken: string): Promise<void> {
  try {
    await apiFetch<null>(`/push-tokens/${encodeURIComponent(pushToken)}`, {
      method: 'DELETE',
      token: authToken,
    });
  } catch {
    /* See above. */
  }
}

/** `PATCH /push-tokens/preferences` — the per-user switch. Push only. */
export function setPushEnabled(authToken: string, pushEnabled: boolean): Promise<{ pushEnabled: boolean }> {
  return apiFetch<{ pushEnabled: boolean }>('/push-tokens/preferences', {
    method: 'PATCH',
    token: authToken,
    body: JSON.stringify({ pushEnabled }),
  });
}

/**
 * How a push behaves while the app is OPEN.
 *
 * Banners stay on, deliberately. The alternative — suppressing the
 * system banner in favour of an in-app toast — means a message that
 * arrives while you are on a different screen shows nothing at all
 * unless every screen grows a listener. The badge is left to the server's
 * own count rather than incremented here, so it cannot drift from it.
 */
export const foregroundBehaviour: Notifications.NotificationBehavior = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: false,
  shouldSetBadge: false,
};

/*
 * Re-exported so callers have one import for "push", while the routing
 * decision stays in a module the test runner can load. See pushRouting.ts.
 */
export { pushRoute, type PushData };
