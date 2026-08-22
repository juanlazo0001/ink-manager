import { createContext, use } from 'react';

/**
 * The subset of GET /users/me this session needs. The real response is
 * much larger (permissions, artist profile, wizard eligibility) -- typed
 * narrowly on purpose, so a later session widening it has to do so
 * deliberately rather than inheriting a stale copy of the web app's
 * UserProfile interface.
 */
export interface Profile {
  id: string;
  email: string;
  name: string | null;
  role: string;
  studioId: string;
}

/** The subset of GET /studios/:studioId this session needs. */
export interface Studio {
  id: string;
  name: string;
}

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
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
