import {
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import { Jura_500Medium, Jura_600SemiBold, Jura_700Bold } from '@expo-google-fonts/jura';
import { Outfit_300Light, Outfit_400Regular, Outfit_500Medium } from '@expo-google-fonts/outfit';
import { useFonts } from 'expo-font';

/**
 * The same three families the web app loads, in the same roles:
 *
 *   Fraunces  --font-display  headlines, numbers that matter
 *   Jura      --font-jura     eyebrows, pills, buttons — anything
 *                             letterspaced and uppercase
 *   Outfit    --font-sans     body copy, everything else
 *
 * React Native has no synthetic bolding worth relying on and no CSS-style
 * family+weight resolution: every weight is its own family name. So these
 * are referenced by their full face name (`Outfit_500Medium`), never as
 * `fontFamily: 'Outfit'` plus `fontWeight`, which silently renders the
 * regular weight on Android.
 */
export const fontsToLoad = {
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Jura_500Medium,
  Jura_600SemiBold,
  Jura_700Bold,
  Outfit_300Light,
  Outfit_400Regular,
  Outfit_500Medium,
};

/**
 * Web additionally loads Fraunces 400-italic and 500-italic. Deliberately
 * skipped: nothing in the app uses italic display type yet, and each face
 * is a real TTF shipped in the bundle. Adding them back is one import when
 * a screen actually needs one.
 */
export const fonts = {
  display: 'Fraunces_400Regular',
  displayMedium: 'Fraunces_500Medium',
  displaySemiBold: 'Fraunces_600SemiBold',
  label: 'Jura_500Medium',
  labelSemiBold: 'Jura_600SemiBold',
  labelBold: 'Jura_700Bold',
  bodyLight: 'Outfit_300Light',
  body: 'Outfit_400Regular',
  bodyMedium: 'Outfit_500Medium',
} as const;

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(fontsToLoad);
  // A font that fails to download is not a reason to hold the app hostage
  // behind a splash screen forever -- render with system fallbacks
  // instead. `loaded` stays false in that case, so without this the gate
  // below would never open.
  return loaded || error !== null;
}

/**
 * Type scale. `family` is baked into each entry rather than left to call
 * sites, because the family IS the role here — an "eyebrow" that isn't
 * Jura isn't an eyebrow.
 */
export const type = {
  /** Screen titles. */
  display: { fontFamily: fonts.displaySemiBold, fontSize: 28, lineHeight: 34 },
  /** Section headings, a conversation's counterpart name. */
  heading: { fontFamily: fonts.displayMedium, fontSize: 19, lineHeight: 24 },
  /** Uppercase letterspaced eyebrows and pills. */
  eyebrow: { fontFamily: fonts.labelSemiBold, fontSize: 11, lineHeight: 14, letterSpacing: 1.2 },
  /** Tab bar labels, small chips. */
  label: { fontFamily: fonts.labelSemiBold, fontSize: 10, lineHeight: 13, letterSpacing: 0.8 },
  /** Buttons. */
  button: { fontFamily: fonts.labelBold, fontSize: 14, lineHeight: 18, letterSpacing: 1 },
  /** Default body copy. */
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  /** Message bubbles — slightly larger for sustained reading. */
  message: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23 },
  /** Secondary copy, list previews. */
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  /** Timestamps and the quietest metadata. */
  meta: { fontFamily: fonts.bodyLight, fontSize: 12, lineHeight: 16 },
} as const;
