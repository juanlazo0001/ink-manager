import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { hairline, login as loginTokens, radius, space } from '@/theme';

/**
 * The frosted panel behind login and signup — web's `.login-panel-surface`.
 *
 * ─── WHY THIS IS A REAL BLUR NOW ────────────────────────────────────
 *
 * It was a flat translucent fill, on a recorded decision that the blur
 * was not worth reproducing: the surface is `#100f0ed6`, 84% opaque, so
 * "very little of the photograph reads through it on web either".
 *
 * The magnitude was right and the conclusion was wrong, and it is
 * measurable. Sampling a glyph-free strip of web's login card with
 * `backdrop-filter` toggled off:
 *
 *     mean brightness   23.08  ->  23.09    unchanged
 *     local stdev        4.91  ->   3.38    31% less texture
 *
 * The blur does not lighten the panel at all — it smooths what is behind
 * it. That 31% is the difference between making out the shapes of the
 * studio photograph through the glass and reading it as a soft wash,
 * which is the whole of the frosted look.
 *
 * ─── THREE LAYERS, IN THIS ORDER, AND THE ORDER IS THE POINT ────────
 *
 *     1. BlurView          blurs the photograph behind the card
 *     2. cardGlass fill    84% opaque, painted OVER the blur
 *     3. the content
 *
 * The first attempt put `backgroundColor: cardGlass` on the BlurView
 * itself. That does not work and the harness showed it immediately:
 * `expo-blur` supplies its OWN background from `tint`/`intensity`
 * (`rgba(25,25,25,0.19)` on web) and it replaces the style's, so the card
 * came out at ~19% opacity instead of 84% — the photograph read straight
 * through it and the text contrast the login screen was tuned for was
 * gone.
 *
 * Keeping the fill as its own layer is also what makes this a faithful
 * mirror rather than a lighter reinterpretation: the blur contributes the
 * same ~16% of the pixel it does on web, no more.
 *
 * ─── WHY IT IS SAFE HERE, GIVEN THE STANDING WARNING ────────────────
 *
 * CLAUDE.md says never to combine `backdrop-filter` with ANIMATION
 * without testing on a real phone, because that pairing has caused real
 * on-device jank. The pairing is the hazard, not the blur: these two
 * cards are static — they do not animate, translate or fade — so the
 * expensive case does not arise.
 *
 * It is also not a CSS filter on iOS. `expo-blur` renders a native
 * `UIVisualEffectView`, which the compositor handles, and it is already a
 * dependency at SDK 54's own bundled version (`~15.0.8`), so Expo Go
 * carries it with no new native module.
 *
 * The device gate is still what proves it: the numbers above come from
 * the web harness, where `BlurView` degrades to `backdrop-filter`.
 */

/**
 * Chosen by MEASUREMENT on the harness, not by formula — `intensity` is a
 * 1-100 interpolation across iOS's own fixed blur materials, so there is
 * no principled conversion from web's `--blur-card: 16px`.
 *
 * Matched on the texture the blur is there to remove. Local stdev of a
 * glyph-free strip of card surface:
 *
 *     web, blur off      4.91      the unblurred photograph
 *     web, blur on       3.38      <- the target
 *     iOS, intensity 40  2.38      over-blurred
 *     iOS, intensity 20  3.22      <- this
 *
 * The mean brightness of the two cards differs by about 5 levels at ANY
 * intensity, so that offset is not the blur: the two cards sit at
 * different heights on the screen and therefore over different parts of
 * the same photograph. Not chased, because matching it would mean tuning
 * a fill token to a sampling artifact.
 *
 * All of which is the WEB rendering of `BlurView`, where it degrades to
 * `backdrop-filter`. iOS runs a native `UIVisualEffectView` with entirely
 * different internals, so this number is a starting point the device gate
 * confirms or corrects — it is the one knob to turn if the frosting reads
 * too strong or too weak on the phone.
 */
const BLUR_INTENSITY = 20;

export function AuthCardSurface({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.card, style]}>
      {/*
        Android's blur is a different and heavier implementation, and this
        app is iPhone-targeted (CLAUDE.md pins Expo Go for the owner's
        device). Skipping it there leaves the flat fill, which is exactly
        what this screen shipped with before — an honest fallback rather
        than a blur nobody has measured on that platform.
      */}
      {Platform.OS !== 'android' ? (
        <BlurView intensity={BLUR_INTENSITY} tint="dark" style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, styles.fill]} pointerEvents="none" />
      {/*
        The content needs its own stacking level. Both layers above are
        absolutely positioned, and a positioned sibling paints above
        static in-flow content -- so without this the fill covered the
        text inputs entirely while leaving the wordmark and the gradient
        button (which carry their own positioning) visible. A card with
        no visible email or password field, caught in the harness.
      */}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    // max-w-sm on web.
    maxWidth: 384,
    borderWidth: hairline,
    borderColor: loginTokens.cardBorder,
    borderRadius: radius.card,
    padding: space.xxl,
    /* Both backdrop layers are absolutely filled; without this the blur
       and the fill square off the rounded corners. */
    overflow: 'hidden',
  },
  fill: { backgroundColor: loginTokens.cardGlass },
  content: { zIndex: 1 },
});
