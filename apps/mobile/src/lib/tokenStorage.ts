import * as SecureStore from 'expo-secure-store';

/**
 * A JWT is a bearer credential with a 7-day life (see the API's
 * `jwt.sign(..., { expiresIn: "7d" })`), so it goes in the Keychain /
 * Android Keystore via expo-secure-store rather than AsyncStorage --
 * the mobile equivalent of the decision apps/web can't make, since a
 * browser only has localStorage.
 */
const TOKEN_KEY = 'ink-manager-token';

/**
 * Every call is wrapped: SecureStore throws (rather than returning null)
 * when the underlying keystore is unavailable, and a failure to read a
 * stored token must degrade to "not logged in", never to a crash on
 * launch. A failure to WRITE is deliberately NOT swallowed -- silently
 * not persisting a token would look like a successful login that
 * mysteriously forgets itself on the next launch.
 */
export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Logging out must always succeed from the user's point of view --
    // the in-memory session is dropped by the caller regardless.
  }
}
