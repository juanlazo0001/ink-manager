import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/context/auth';
import { pushRoute, type PushData } from '@/lib/push';

/**
 * Tapping a push opens the thing it is about.
 *
 * ─── THE TWO ENTRY POINTS, AND WHY BOTH ARE NEEDED ──────────────────
 *
 * A tapped notification reaches an app in one of two ways, and handling
 * only one of them is the classic half-built version of this:
 *
 *   · the app was ALREADY RUNNING (foreground or background) — the tap
 *     arrives as a `notificationResponseReceived` event
 *   · the app was NOT RUNNING and the tap LAUNCHED it — there is no
 *     event, because nothing was listening when it happened. The response
 *     is waiting in `getLastNotificationResponseAsync()`
 *
 * The cold-launch case is the one that gets missed, and it is the one a
 * person actually does: the phone is locked, a message arrives, they tap
 * it. Both are handled here.
 *
 * ─── WHY IT WAITS FOR THE SESSION ───────────────────────────────────
 *
 * Every destination is behind `<Stack.Protected guard={signedIn}>`, so a
 * route pushed while `status` is still `restoring` targets a screen that
 * is not registered yet and is silently dropped. A cold launch from a
 * push is exactly that race — the tap is known before the SecureStore
 * read finishes. So the pending response is held and replayed once the
 * session exists.
 *
 * ─── NOT VERIFIABLE WITHOUT A DEV BUILD ─────────────────────────────
 *
 * Expo Go cannot receive a remote push, so neither path can be exercised
 * end to end here. The routing decision itself is pure and tested
 * (`push.test.ts`); what is untested is the delivery of the event that
 * carries it.
 *
 * ─── AND IT IS OFF ON WEB, WHICH IS NOT A DETAIL ────────────────────
 *
 * `getLastNotificationResponseAsync` is not implemented on web and
 * THROWS — "not available on web, are you sure you've linked all the
 * native dependencies properly?" — which took down the whole screen in
 * the preview harness the moment this hook first mounted. Caught by that
 * harness, which is the thing it is for.
 *
 * Every future session renders mobile screens on web to verify them, so
 * a native-only module that throws on import-and-call would have broken
 * all of them, not just this one. Hence the platform guard rather than a
 * try/catch: there is nothing to attempt on web.
 */
export function usePushRouting(): void {
  const router = useRouter();
  const { status, session } = useAuth();
  const role = session?.profile.role;

  /** A tap that arrived before the session was ready. Replayed below. */
  const pending = useRef<PushData | null>(null);
  /** Cold-launch responses are consumed once; a re-run must not re-navigate. */
  const handledColdLaunch = useRef(false);

  const signedIn = status === 'signedIn';

  /* Native only — see the header. Notifications do not exist on web and
     the module throws rather than no-opping. */
  const supported = Platform.OS !== 'web';

  useEffect(() => {
    if (!supported) return;

    const go = (data: PushData | null | undefined) => {
      if (!data) return;
      if (!signedIn) {
        pending.current = data;
        return;
      }
      const route = pushRoute(data, role);
      /* No destination is not an error: a push may exist purely to say
         something happened. Opening the app IS the outcome. */
      if (route) router.push(route as never);
    };

    // 1. The app was already alive.
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      go(response.notification.request.content.data as PushData);
    });

    // 2. The tap launched it.
    if (!handledColdLaunch.current) {
      handledColdLaunch.current = true;
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) go(response.notification.request.content.data as PushData);
      });
    }

    return () => subscription.remove();
  }, [router, role, signedIn, supported]);

  // The replay. Runs when the session arrives, not before.
  useEffect(() => {
    if (!supported || !signedIn || !pending.current) return;
    const data = pending.current;
    pending.current = null;
    const route = pushRoute(data, role);
    if (route) router.push(route as never);
  }, [signedIn, role, router, supported]);
}
