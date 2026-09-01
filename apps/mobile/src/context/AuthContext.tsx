import type { LoginRequest, LoginResponse } from '@ink-manager/shared-types';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { ApiError, apiFetch } from '@/lib/api';
import { clearStudioTimeZoneCache } from '@/hooks/useStudioTimeZone';
import { registerPushToken, unregisterPushToken } from '@/lib/push';
import { clearToken, getToken, saveToken } from '@/lib/tokenStorage';

import { AuthContext, type AuthStatus, type Profile, type Session, type Studio } from './auth';

/**
 * Turns a bare JWT into a full session.
 *
 * Note what this deliberately does NOT do: decode the JWT. apps/web reads
 * userId/studioId/role straight out of the token payload, which is fine
 * there but is exactly the pattern the repo's standing rules warn about
 * (a token's studio claims go stale). Asking the API instead means the
 * round trip doubles as a liveness check -- the API re-validates the
 * account on every authenticated request (deactivation, password change,
 * deletion), so a 401 here is the authoritative "this token is no longer
 * good", not a guess from an `exp` claim.
 */
async function loadSession(token: string): Promise<Session> {
  const profile = await apiFetch<Profile>('/users/me', { token });

  // Only the studio's display NAME comes from this second call, so a
  // failure is not fatal -- the name is the one thing on the placeholder
  // home screen that can be missing without the session being unusable.
  let studio: Studio | null = null;
  try {
    studio = await apiFetch<Studio>(`/studios/${profile.studioId}`, { token });
  } catch {
    studio = null;
  }

  return { token, profile, studio };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [session, setSession] = useState<Session | null>(null);
  /*
   * The Expo push token this session registered, kept so logout can
   * unregister exactly it. A ref rather than state: nothing renders from
   * it, and logout must read the current value rather than whatever the
   * last render closed over.
   */
  const pushToken = useRef<string | null>(null);

  /*
   * Registration is fire-and-forget on purpose, and it runs on BOTH
   * paths — a fresh login and a restored session.
   *
   * Restore matters as much as login: Expo rotates these tokens, and a
   * phone that is signed in for weeks would otherwise keep a stale row
   * forever. The route upserts on the token, so re-registering the same
   * one is a no-op write rather than a duplicate.
   *
   * It never blocks and never throws into the caller. Push is an extra;
   * a login that failed because a permission prompt was declined, or
   * because the device is a simulator, would be an absurd trade.
   */
  const attachPush = useCallback((token: string) => {
    void registerPushToken(token)
      .then((result) => {
        pushToken.current = result.token;
      })
      .catch(() => {
        /* Left unregistered. The next launch tries again. */
      });
  }, []);

  useEffect(() => {
    // Guards against a state update after the provider unmounts (fast
    // refresh during development is the realistic trigger).
    let active = true;

    async function restore() {
      const token = await getToken();

      if (!token) {
        if (active) setStatus('signedOut');
        return;
      }

      try {
        const restored = await loadSession(token);
        if (!active) return;
        setSession(restored);
        setStatus('signedIn');
        attachPush(token);
      } catch (err) {
        if (!active) return;

        // A 401 is the API saying this token is dead (expired, password
        // changed since it was issued, account deactivated) -- drop it, so
        // the next launch doesn't repeat a doomed request. Anything else
        // (offline, a 5xx, Railway's edge answering mid-deploy) says
        // nothing about the token's validity, so it is KEPT: the user
        // lands on the login screen this launch, but a working connection
        // later restores them without retyping a password.
        if (err instanceof ApiError && err.fromApi && err.status === 401) {
          await clearToken();
        }

        setStatus('signedOut');
      }
    }

    restore();

    return () => {
      active = false;
    };
  }, [attachPush]);

  const login = useCallback(async (email: string, password: string) => {
    // The API's only response on success is `{ token }` -- no user object
    // -- so the profile is fetched separately, the same way a restore does
    // it. Both paths therefore produce an identical Session.
    const payload: LoginRequest = { email, password };
    const { token } = await apiFetch<LoginResponse>('/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const loaded = await loadSession(token);

    // Persisted only AFTER the session loads cleanly. Storing a token that
    // can't actually be used would strand the next launch in a
    // restore-then-fail loop.
    await saveToken(token);

    setSession(loaded);
    setStatus('signedIn');
    attachPush(token);
  }, [attachPush]);

  const applyProfile = useCallback((profile: Profile) => {
    setSession((current) => (current ? { ...current, profile } : current));
  }, []);

  const logout = useCallback(async () => {
    /*
     * BEFORE the token is cleared — the DELETE is authenticated, and the
     * route scopes the delete to the caller's own user so an unauthorised
     * one could not remove this row at all.
     */
    const current = session?.token;
    if (current && pushToken.current) {
      await unregisterPushToken(current, pushToken.current);
      pushToken.current = null;
    }

    await clearToken();
    // Studio-scoped caches must not survive into the next session -- the
    // next person to sign in on this phone may well be at a different
    // studio, on a different clock.
    clearStudioTimeZoneCache();
    setSession(null);
    setStatus('signedOut');
  }, [session?.token]);

  return <AuthContext value={{ status, session, login, logout, applyProfile }}>{children}</AuthContext>;
}
