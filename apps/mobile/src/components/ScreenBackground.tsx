import { Image } from 'expo-image';
import { Image as RNImage, StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

/**
 * The app's atmospheric background: a pre-blurred photo, a flat dark wash
 * over it, and a fine grain overlay. Ported from apps/web's own stack,
 * which renders the same three layers behind every authenticated page
 * (TopBar.tsx renders the first two; `body::after` in index.css draws the
 * third).
 *
 * Layer order, back to front — photo, wash, grain, then content — is
 * web's own, and each value below is taken from its rule rather than
 * matched by eye:
 *
 *   .app-bg-photo   position: fixed; inset: 0; object-fit: cover
 *   .app-bg-wash    background: rgba(12, 10, 8, 0.45)
 *   body::after     opacity: 0.045, a 140x140 fractalNoise tile
 *
 * The photo is the SAME asset file web ships (`app-bg-blurred-amber.jpg`,
 * 640x397, 5.9 kB), copied rather than re-exported: it is already blurred
 * and already phone-sized, because web pre-blurs it for exactly the reason
 * this repo's own rules give for avoiding runtime blur — a live filter
 * recomputes on every scroll and repaint. Nothing here blurs at runtime.
 *
 * The wash is deliberately FLAT, not a vignette. Web's own comment is
 * explicit about the difference: Login's directional hero-shade is shaped
 * around a single centred card, while this layer has no focal point, so a
 * uniform scrim is what guarantees legibility wherever the abstract photo
 * happens to sit. Mobile's login screen keeps its own vignette and is
 * untouched.
 *
 * ONE value differs from web, and it is measured rather than judged: the
 * wash is 0.55 here against web's 0.45. Web can afford the lighter scrim
 * because its pages sit on an opaque `bg-bg` and the photo only ever shows
 * in the margins — no body text is ever over it. A phone has no margins,
 * so mobile's text sits directly on this layer. Sampled against the
 * BRIGHTEST pixel of the composited photo+wash at 414pt:
 *
 *            0.45 (web)   0.55 (here)   web's opaque ground
 *   fg          11.65         12.70            16.68
 *   fgMuted      4.44          4.85             6.37
 *   accent       5.38          5.88             7.72
 *
 * `fgMuted` at 0.45 is 4.44:1 — under the 4.5:1 text floor in the worst
 * case, which is a real regression against web rather than a stylistic
 * choice. 0.55 is the smallest round step that clears it with headroom,
 * and the photo is still plainly a photo (brightest pixel rgb(44,38,32)
 * against rgb(49,45,38)).
 */
export function ScreenBackground() {
  return (
    <View style={styles.root} pointerEvents="none">
      <Image
        source={require('../../assets/images/app-bg-blurred-amber.jpg')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        // A dark placeholder, so a slow decode shows the app's own ground
        // rather than a white flash behind everything.
        placeholderContentFit="cover"
        transition={220}
        cachePolicy="memory-disk"
        accessible={false}
      />
      <View style={styles.wash} />
      {/* expo-image has no tiling mode, and RN cannot render web's SVG
          data-URI at all, so the same texture is baked to a PNG and tiled
          with the core Image's `repeat`. */}
      <RNImage
        source={require('../../assets/images/grain-tile.png')}
        style={styles.grain}
        resizeMode="repeat"
        accessible={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Behind everything, and never a touch target.
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg },
  /** .app-bg-wash — a real scrim cast over the photo, not a placeholder. */
  wash: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(12, 10, 8, 0.55)' },
  /** body::after — 4.5%, above the wash, below content. */
  grain: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%', opacity: 0.045 },
});
