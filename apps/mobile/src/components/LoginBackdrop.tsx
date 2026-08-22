import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { login } from '@/theme';

const BACKGROUND = require('../../assets/login/background.jpg');

/**
 * The login photograph, its scrim, and the concentric rings — everything
 * behind the card.
 *
 * Ported from the web's AuthLayout, which stacks: the photo
 * (`object-fit: cover`), `.hero-shade` (two gradients), then `.rings`.
 * Order and z-order are preserved.
 *
 * What is deliberately NOT ported: the rings' motion. On web they carry a
 * spring rotate/scale keyed to the auth mode, plus two dots orbiting on
 * continuous CSS keyframes. Two reasons to leave them out rather than
 * approximate them. The mode change they respond to does not exist here
 * (this screen has one mode — the forgot-password flow opens in the
 * browser). And the repo's standing design rules single out animation
 * combined with `backdrop-filter` as having caused real on-device frame
 * drops that never showed up in desktop dev tools — animating a layer
 * directly behind a blurred card is exactly that combination. The rings
 * themselves are static geometry and port exactly, so the composition is
 * intact; only the movement is missing.
 */
export function LoginBackdrop() {
  const { width, height } = useWindowDimensions();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* A flat fill under the photo, so a slow load shows the right dark
          rather than white. expo-image's own placeholder covers the same
          gap; both are cheap and neither alone is guaranteed to paint
          first. */}
      <View style={styles.base} />

      <Image
        source={BACKGROUND}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={220}
        placeholderContentFit="cover"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      {/* .hero-shade, layer 1: the vertical ramp that does most of the
          work — dark at the top, opening up through the middle, then
          closing down hard at the bottom so the footer text sits on
          near-solid ground. */}
      <LinearGradient
        colors={login.scrimVertical.colors}
        locations={login.scrimVertical.locations}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* .hero-shade, layer 2: the horizontal vignette. Barely visible on
          a phone (the middle 40% is flat at 0.15) but it is what keeps
          the edges from reading brighter than the centre. */}
      <LinearGradient
        colors={login.scrimHorizontal.colors}
        locations={login.scrimHorizontal.locations}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />

      {/* .rings — centred at 50% / 47%, same as web. */}
      <View style={[styles.rings, { left: width / 2, top: height * 0.47 }]}>
        {/* Rendered at their literal CSS sizes, NOT scaled to the
            screen. Web does the same on a narrow viewport: the rings
            overflow it, and the wide arcs sweeping off both edges ARE the
            composition. Scaling them to fit turns them into three small
            circles sitting behind the card, which was the first thing a
            side-by-side against production showed up. */}
        {login.ring.map((ring) => {
          const size = ring.size;
          return (
            <View
              key={ring.size}
              style={[
                styles.ring,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderColor: ring.color,
                  marginLeft: -size / 2,
                  marginTop: -size / 2,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { ...StyleSheet.absoluteFillObject, backgroundColor: login.photoPlaceholder },
  rings: { position: 'absolute' },
  ring: { position: 'absolute', borderWidth: 1 },
});
