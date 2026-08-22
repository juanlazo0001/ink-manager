import { useEffect, useState } from 'react';

import { useAuth } from '@/context/auth';
import { fetchStudioSettings } from '@/lib/appointments';
import { deviceTimeZone, resolveStudioTimeZone } from '@/lib/studioTime';

/**
 * The studio's IANA timezone, fetched once per app run.
 *
 * A studio's timezone changes about never, and every scheduling screen
 * needs it before it can ask a sensible question, so it is cached at
 * module scope rather than refetched per screen or threaded through the
 * session. Deliberately NOT folded into `AuthContext`: that would add a
 * third request to the launch path, in front of the splash screen, for
 * something only the Schedule tab needs.
 */
let cachedTimeZone: string | null = null;
let inFlight: Promise<string> | null = null;

/** Lets a signed-out user's cached value not leak into the next session. */
export function clearStudioTimeZoneCache(): void {
  cachedTimeZone = null;
  inFlight = null;
}

async function loadTimeZone(token: string): Promise<string> {
  const settings = await fetchStudioSettings(token);
  return resolveStudioTimeZone(settings.timezone);
}

export interface StudioTimeZoneState {
  timeZone: string;
  /**
   * False until the real value has arrived. Screens should not render
   * dates while this is true: the fallback is the DEVICE's zone, which is
   * exactly the wrong answer to show and then silently correct.
   */
  ready: boolean;
  /**
   * True when the lookup failed and the device zone is standing in. Worth
   * surfacing — a schedule quietly on the wrong clock is worse than one
   * that says so.
   */
  usingFallback: boolean;
}

export function useStudioTimeZone(): StudioTimeZoneState {
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [state, setState] = useState<StudioTimeZoneState>(() =>
    cachedTimeZone
      ? { timeZone: cachedTimeZone, ready: true, usingFallback: false }
      : { timeZone: deviceTimeZone(), ready: false, usingFallback: false },
  );

  useEffect(() => {
    if (!token || cachedTimeZone) return;
    let active = true;

    inFlight ??= loadTimeZone(token);
    inFlight
      .then((tz) => {
        cachedTimeZone = tz;
        if (active) setState({ timeZone: tz, ready: true, usingFallback: false });
      })
      .catch(() => {
        // The device's zone is a poor substitute for a studio's, but a
        // Schedule tab that renders on the wrong clock and says so beats
        // one that refuses to render at all.
        inFlight = null;
        if (active) setState({ timeZone: deviceTimeZone(), ready: true, usingFallback: true });
      });

    return () => {
      active = false;
    };
  }, [token]);

  return state;
}
