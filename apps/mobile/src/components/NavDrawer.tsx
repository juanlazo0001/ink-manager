import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { Ornament } from '@/components/editorial';
import { useAuth } from '@/context/auth';
import { isActiveDestination, visibleDestinations } from '@/lib/navDestinations';
import { colors, hairline, radius, space, type } from '@/theme';
import { duration, easing } from '@/theme/motion';

const WIDTH = 288;
/** Web caps the logo at `max-h-28` (112px); 64 is the phone equivalent. */
const LOGO_SIZE = 64;

/**
 * The navigation drawer — every screen that is NOT a bottom tab.
 *
 * Split from the account menu by owner decision: that menu had grown to
 * carry four destinations plus identity, which is two jobs. Now the
 * hamburger owns going places and the avatar owns being someone, the way
 * Facebook splits them.
 *
 * The **studio name header moves here**, and that is web's hierarchy
 * rather than a new one: web puts the studio in the SIDEBAR header, above
 * the nav, and never in the top bar. The account menu only ever held it
 * because mobile had no sidebar to put it in.
 *
 * Slide-in uses the motion canon's own tokens (`--duration-base`, the
 * standard curve) rather than a bespoke timing, so the drawer moves like
 * everything else in the app.
 *
 * Dismiss three ways, because a drawer that only closes one way feels
 * stuck: tap the scrim, swipe it left, or press Back (the Modal's
 * `onRequestClose`).
 */
export function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { session } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  /*
   * Insets read HERE, in the app's own tree, and applied as padding — not
   * via <SafeAreaView> inside the Modal.
   *
   * This is the SAME failure the gallery viewer hit in session H, and the
   * drawer reintroduced it: a RN <Modal> is a separate native root, and
   * react-native-safe-area-context does not resolve insets inside one
   * unless a provider is mounted within the modal itself. The
   * SafeAreaView measured zero, so the studio name rendered under the
   * status bar and collided with the clock — which is exactly what the
   * owner's device screenshot shows.
   */
  const insets = useSafeAreaInsets();

  const destinations = visibleDestinations(session?.profile);
  const studioName = session?.studio?.name ?? 'Studio unavailable';
  const logoUrl = session?.studio?.logoUrl ?? null;

  // -WIDTH is off-screen left; 0 is open. Driven rather than toggled so
  // the swipe can hand a real position back to the animation.
  const x = useSharedValue(-WIDTH);

  /*
   * The Modal has to outlive `open`, or the close is never seen: RN
   * unmounts a Modal the instant `visible` goes false, which would cut
   * the slide-out off at frame zero and make dismissing feel like a
   * disappearance. So the panel drives its own mount — `open` starts the
   * animation, and only when the animation lands does the Modal go away.
   */
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    x.value = withTiming(
      open ? 0 : -WIDTH,
      { duration: duration.base, easing: easing.standard },
      (finished) => {
        if (finished && !open) runOnJS(setMounted)(false);
      },
    );
  }, [open, x]);

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  // The scrim fades with the panel instead of appearing at full strength
  // the instant the drawer starts moving.
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: (x.value + WIDTH) / WIDTH,
  }));

  const swipe = Gesture.Pan()
    .onUpdate((e) => {
      // Only leftward travel moves it; dragging right does nothing rather
      // than stretching the panel past its open position.
      x.value = Math.min(0, e.translationX);
    })
    .onEnd((e) => {
      // Past a third of the way, or thrown fast enough, it closes —
      // otherwise it settles back open.
      const shouldClose = e.translationX < -WIDTH / 3 || e.velocityX < -600;
      if (shouldClose) {
        x.value = withTiming(-WIDTH, { duration: duration.fast, easing: easing.standard }, () => {
          runOnJS(onClose)();
        });
      } else {
        x.value = withTiming(0, { duration: duration.fast, easing: easing.standard });
      }
    });

  function go(href: string) {
    onClose();
    router.push(href as never);
  }

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, scrimStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
          />
        </Animated.View>

        <GestureDetector gesture={swipe}>
          <Animated.View style={[styles.panel, { width: WIDTH }, panelStyle]}>
            <View style={[styles.panelInner, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
              {/* Web's sidebar header. It leads with the studio's own
                  logo (Sidebar.tsx renders `studio.logoUrl` at
                  `max-h-28 w-full object-contain`, with the name only as
                  alt text), so this does the same and falls back to the
                  name when a studio has none.
                  Web's fallback is the Ink Manager wordmark; here it is
                  the studio's name, per the owner's instruction — logged
                  as a deliberate divergence.
                  Logos are stored as base64 data URIs, exactly like
                  avatars, so this goes through Avatar's scheme-aware
                  renderer rather than expo-image, which cannot load a
                  `data:` URI on iOS (session H2's root cause). */}
              <View style={styles.header}>
                {logoUrl ? (
                  <Avatar
                    url={logoUrl}
                    initials={studioName}
                    size={LOGO_SIZE}
                    style={styles.logo}
                    labelStyle={styles.logoFallbackLabel}
                  />
                ) : null}
                <Text style={styles.studio} numberOfLines={2}>
                  {studioName}
                </Text>
                <Text style={styles.person} numberOfLines={1}>
                  {session?.profile.name ?? session?.profile.email}
                </Text>
              </View>

              <Ornament style={styles.ornament} />

              <ScrollView contentContainerStyle={styles.items}>
                {destinations.map((d) => {
                  const active = isActiveDestination(pathname, d);
                  return (
                    <Pressable
                      key={d.id}
                      onPress={() => go(d.href)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={({ pressed }) => [
                        styles.item,
                        active && styles.itemActive,
                        pressed && styles.pressed,
                      ]}
                    >
                      {/* The active marker is a gold rule on the leading
                          edge, the same device the web sidebar uses for
                          the current route. */}
                      <View style={[styles.marker, active && styles.markerActive]} />
                      <d.Icon size={19} color={active ? colors.accent : colors.fgMuted} />
                      <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>
                        {d.label}
                      </Text>
                    </Pressable>
                  );
                })}

                {destinations.length === 0 ? (
                  <Text style={styles.empty}>
                    Everything you can reach is on the tab bar below.
                  </Text>
                ) : null}
              </ScrollView>
            </View>
          </Animated.View>
        </GestureDetector>

        {/* Keeps the panel from being dragged wider than the screen on a
            small device. */}
        <View pointerEvents="none" style={{ width: Math.max(0, screenWidth - WIDTH) }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.6)' },

  panel: {
    height: '100%',
    // Opaque, like every other panel in the app: a translucent drawer
    // over a scrolling list is unreadable.
    backgroundColor: colors.cardGlassOpaque,
    borderRightWidth: hairline,
    borderRightColor: colors.border,
  },
  panelInner: { flex: 1 },

  header: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md },
  logo: { borderRadius: radius.input, borderWidth: 0, marginBottom: space.sm },
  logoFallbackLabel: { ...type.meta, color: colors.fgMuted },
  studio: { ...type.heading, color: colors.fg },
  person: { ...type.meta, color: colors.fgMuted, marginTop: 4 },
  ornament: { marginBottom: space.sm },

  items: { paddingHorizontal: space.sm, paddingBottom: space.lg },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingRight: space.md,
    paddingVertical: space.md,
    borderRadius: radius.input,
  },
  itemActive: { backgroundColor: 'rgba(201, 154, 91, 0.08)' },

  marker: {
    width: 2,
    alignSelf: 'stretch',
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
    marginRight: space.xs,
  },
  markerActive: { backgroundColor: colors.accent },

  itemLabel: { ...type.body, color: colors.fgSecondary, flex: 1 },
  itemLabelActive: { color: colors.fg },

  empty: { ...type.small, color: colors.fgMuted, padding: space.md },
  pressed: { opacity: 0.6 },
});
