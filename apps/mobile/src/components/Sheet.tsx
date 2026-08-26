import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, hairline, radius, space } from '@/theme';
import { duration, easing } from '@/theme/motion';

/**
 * The bottom sheet, with the scrim and the panel as TWO INDEPENDENT
 * animations.
 *
 * ─── THE BUG THIS EXISTS TO FIX ─────────────────────────────────────
 *
 * Every sheet in this app was `<Modal animationType="slide">` wrapping a
 * full-screen backdrop that held the panel:
 *
 *     <Modal animationType="slide">          <- RN translates THIS
 *       <Pressable style={backdrop}>         <- the scrim, inside it
 *         <Pressable style={sheet}>          <- the panel
 *
 * RN's `slide` translates the modal's ENTIRE content view. The scrim is
 * part of that content, so the dark wash slid up from the bottom edge
 * with the panel instead of settling over the screen — the whole display
 * arriving as one moving block. Native does the opposite and does it as
 * two motions at once: the scrim FADES in where it already is, while the
 * panel SLIDES up from below.
 *
 * The fix is structural, not a tweak: the scrim has to stop being a
 * descendant of the thing that translates. So `animationType` is `none`,
 * RN animates nothing, and the two layers are siblings driven by two
 * separate shared values:
 *
 *     scrim   opacity   0 -> 1        duration.base (200ms), standard
 *     panel   translateY  h -> 0      duration.slow (300ms), out
 *
 * Reversed on dismiss, and deliberately not derived from one another —
 * `NavDrawer` (this repo's only correct sheet, and the model for this
 * one) computes its scrim opacity FROM its panel position, which couples
 * them into a single motion. That is right for a drawer the finger is
 * dragging, and wrong here: the brief asks for two independent
 * animations, and a 200ms fade under a 300ms slide is what native does.
 *
 * ─── WHY THE MODAL OUTLIVES `visible` ───────────────────────────────
 *
 * RN unmounts a `<Modal>` the instant `visible` goes false, which would
 * cut the dismissal off at frame zero and make every sheet vanish rather
 * than leave. So the panel drives its own mount: `visible` starts the
 * animation, and only when the animation LANDS does the Modal go away.
 * Lifted from `NavDrawer`, which had already learned this.
 *
 * ─── WHY THE HEIGHT IS MEASURED ─────────────────────────────────────
 *
 * The travel distance is the panel's own height, which is not known until
 * it lays out — these sheets size to their content and no two are the
 * same. Animating from a fixed large constant instead would put most of
 * the travel below the screen edge, so the visible part of the slide
 * would happen in the last third of the duration and read as a late pop.
 * So: measure on layout, and keep the panel invisible for the one frame
 * before that measurement exists.
 */
export function Sheet({
  visible,
  onClose,
  children,
  contentStyle,
  /** Announced to screen readers as the sheet's purpose. */
  accessibilityLabel = 'Close',
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const [mounted, setMounted] = useState(visible);
  const [height, setHeight] = useState(0);

  const scrim = useSharedValue(0);
  /** 1 = fully below the screen, 0 = open. Unitless so it survives a re-measure. */
  const slide = useSharedValue(1);

  useEffect(() => {
    if (visible) setMounted(true);

    scrim.value = withTiming(visible ? 1 : 0, {
      duration: duration.base,
      easing: easing.standard,
    });

    slide.value = withTiming(
      visible ? 0 : 1,
      {
        duration: duration.slow,
        // Entering decelerates into place; leaving takes the standard
        // curve, the same split `motion.ts` documents for `enter`.
        easing: visible ? easing.out : easing.standard,
      },
      (finished) => {
        if (finished && !visible) runOnJS(setMounted)(false);
      },
    );
  }, [visible, scrim, slide]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const panelStyle = useAnimatedStyle(() => ({
    // Before the first layout there is no travel distance to use, so the
    // panel is parked off-screen and hidden rather than flashing at 0.
    opacity: height === 0 ? 0 : 1,
    transform: [{ translateY: slide.value * (height || 0) }],
  }));

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Sibling of the panel, NOT its parent — the whole point. */}
        <Animated.View style={[styles.scrim, scrimStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
          />
        </Animated.View>

        <Animated.View
          style={[styles.sheet, panelStyle, contentStyle]}
          onLayout={(e) => {
            const next = Math.round(e.nativeEvent.layout.height);
            if (next > 0 && next !== height) setHeight(next);
          }}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  /* The same wash every sheet in this app already used, now as its own
     layer rather than as the panel's container. */
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000aa' },
  sheet: {
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderTopWidth: hairline,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
  },
});
