import type { MeResponse, StudioResponse } from '@ink-manager/shared-types';
import { createContext, use } from 'react';

/**
 * The profile and studio shapes now come from @ink-manager/shared-types
 * rather than being restated here -- both are the API's own response
 * shapes, and a second hand-maintained copy is exactly the thing that
 * drifts. Re-exported under the names the app already used so nothing
 * downstream had to change.
 */
export type Profile = MeResponse;
export type Studio = StudioResponse;

export interface Session {
  token: string;
  profile: Profile;
  /**
   * Null when the studio lookup failed but the session is otherwise
   * valid -- a missing studio name is a degraded display, not a reason
   * to refuse a login.
   */
  studio: Studio | null;
}

export type AuthStatus =
  /** Reading SecureStore and revalidating on launch. Nothing is known yet. */
  | 'restoring'
  | 'signedIn'
  | 'signedOut';

export interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Replaces the cached profile after a write that changed it.
   *
   * `PATCH /users/me` returns the updated user, so the alternative would
   * be re-fetching what the API just handed back. Without this, changing
   * a name or avatar would leave every header on the phone showing the
   * old one until the next launch.
   */
  applyProfile: (profile: Profile) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
