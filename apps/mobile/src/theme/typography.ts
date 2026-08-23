import {
  Fraunces_400Regular,
  Fraunces_400Regular_Italic,
  Fraunces_500Medium,
  Fraunces_500Medium_Italic,
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
  Fraunces_400Regular_Italic,
  Fraunces_500Medium,
  Fraunces_500Medium_Italic,
  Fraunces_600SemiBold,
  Jura_500Medium,
  Jura_600SemiBold,
  Jura_700Bold,
  Outfit_300Light,
  Outfit_400Regular,
  Outfit_500Medium,
};

/**
 * The two italic Fraunces faces WERE skipped, on the grounds that nothing
 * used italic display type. The design-parity pass needed both: the
 * dashboard's welcome name is `<span className="text-accent-hover italic">`
 * and the Lost/Cold empty state is `font-display text-[15px] italic`.
 * Loaded now, from the same already-installed package — no new dependency.
 */
export const fonts = {
  display: 'Fraunces_400Regular',
  displayItalic: 'Fraunces_400Regular_Italic',
  displayMedium: 'Fraunces_500Medium',
  displayMediumItalic: 'Fraunces_500Medium_Italic',
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
  /**
   * Uppercase letterspaced eyebrows and pills. Web's Eyebrow component is
   * `font-jura text-[11px] font-semibold tracking-[0.34em]`, and 0.34em at
   * 11px is 3.74px — mobile had been setting 1.2, which read as a
   * different, much tighter label. lineHeight is raised with it: at this
   * tracking the run is wide enough to wrap on a phone.
   */
  eyebrow: { fontFamily: fonts.labelSemiBold, fontSize: 11, lineHeight: 16, letterSpacing: 3.74 },
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

  /*
   * ---- Editorial Gold display treatments, ported from apps/web ----
   * Each entry names the web rule it comes from, so a change on either
   * side is traceable the same way the colour tokens already are.
   */

  /**
   * Dashboard's greeting. Web:
   * `font-display text-[clamp(32px,4vw,44px)] font-normal leading-[1.05]
   * tracking-[-0.015em]`. The clamp's floor (32px) is the phone value —
   * 4vw of a 414pt viewport is smaller than the floor, so a phone would
   * sit at the floor on web too.
   */
  welcome: { fontFamily: fonts.display, fontSize: 32, lineHeight: 34, letterSpacing: -0.48 },
  /**
   * The name inside it. Web: `<span className="text-accent-hover italic">`
   * — same size and family, italic, `--color-accent-hover`.
   */
  welcomeName: { fontFamily: fonts.displayItalic, fontSize: 32, lineHeight: 34, letterSpacing: -0.48 },

  /**
   * Card titles. Web's `.sc` at `text-[20px]`: Fraunces 500,
   * `font-variant: small-caps` + `text-transform: lowercase`,
   * `letter-spacing: 0.06em`.
   *
   * React Native has no `font-variant: small-caps` it can rely on (the
   * shipped Fraunces TTF carries no `smcp` table), so this renders as
   * uppercase Fraunces 500 one step down in size — the same uniform
   * run of capitals web produces, built the only way the platform allows.
   * Tracking is web's 0.06em resolved against the 17px size.
   */
  sectionHeader: { fontFamily: fonts.displayMedium, fontSize: 17, lineHeight: 22, letterSpacing: 1.02 },

  /**
   * The big figures. Web's `bigStatClass`:
   * `font-display text-5xl font-normal tracking-[-0.015em]` (xl, 48px)
   * and `text-4xl` (lg, 36px).
   */
  statNumeral: { fontFamily: fonts.display, fontSize: 48, lineHeight: 52, letterSpacing: -0.72 },
  statNumeralSmall: { fontFamily: fonts.display, fontSize: 36, lineHeight: 40, letterSpacing: -0.54 },

  /**
   * The cream chip's percentage. Web:
   * `bg-fg text-accent-fg font-display inline-block px-4 py-1 text-4xl italic`.
   */
  statChip: { fontFamily: fonts.displayItalic, fontSize: 36, lineHeight: 44 },

  /** Web's `font-display text-[15px] italic text-fg-secondary` empty state. */
  displayItalic: { fontFamily: fonts.displayItalic, fontSize: 15, lineHeight: 21 },
} as const;
