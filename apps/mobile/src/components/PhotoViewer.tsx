import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ZoomablePhoto } from '@/components/ZoomablePhoto';
import { colors, hairline, radius, space, type } from '@/theme';

export interface ViewerImage {
  url: string;
  /** Shown under the photo — reference art vs a photo of the placement. */
  caption?: string;
}

/**
 * Full-screen photo viewer (§2.5).
 *
 * Paging stays a horizontal ScrollView; each page is a ZoomablePhoto,
 * which adds the two things §2.5 asks for and this did not have:
 * pinch-zoom, and swipe-down dismissal with progressive opacity.
 *
 * The old header called the missing zoom "a real limitation rather than
 * pretended away — an artist zooming into linework is a plausible want,
 * and this does not do it". It does now, and it did not cost a
 * dependency: Q13 ruled bespoke over `react-native-awesome-gallery`, and
 * what was actually needed was two gestures over an image that already
 * rendered, not a gallery framework.
 *
 * ─── ON THE OPENING TRANSITION ──────────────────────────────────────
 *
 * §2.5 says "fade to black", and that is what this does. It deliberately
 * does NOT grow the photo out of its bubble: a shared-element open would
 * mean computing the tapped image's screen rect, and the standing rule
 * for that (measure in-row, derive from the list rect) currently rests on
 * an iOS branch this session could not exercise. A transition the spec
 * did not ask for is not worth putting on top of geometry that has not
 * been checked on a device.
 */
export function PhotoViewer({
  images,
  initialIndex,
  visible,
  onClose,
  onSave,
}: {
  images: ViewerImage[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
  /**
   * Quick-save, on the picture actually on screen.
   *
   * The action lives here rather than on every image bubble on purpose:
   * a permanent button on each thumbnail is exactly the clutter this
   * session is removing, and by the time someone wants to keep a photo
   * they have opened it.
   */
  onSave?: (url: string) => void;
}) {
  const { width, height } = useWindowDimensions();
  /*
   * Insets read HERE, in the app's own tree, and applied as padding --
   * not via <SafeAreaView> inside the <Modal>.
   *
   * The chrome already sat inside a SafeAreaView, which is why this looked
   * handled. It is not: a RN <Modal> is a separate native root, and
   * react-native-safe-area-context does not resolve insets inside one
   * unless a SafeAreaProvider is mounted within the modal itself. So the
   * SafeAreaView measured zero and the close button and counter sat at
   * y = 0, under the status bar -- exactly what the device screenshot
   * shows. statusBarTranslucent on the Modal makes it worse on Android
   * by drawing beneath the bar as well.
   *
   * useSafeAreaInsets() is called in THIS component, which renders inside
   * the root provider, so it returns the real values regardless of what
   * the Modal does with context.
   */
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);

  /*
   * 0 = fully open, 1 = dragged all the way out. Owned here rather than
   * per-page because it drives the BACKDROP and the chrome, which the
   * pages do not own — and because it must reset when a new photo opens.
   */
  const dismiss = useSharedValue(0);
  const backdrop = useAnimatedStyle(() => ({ opacity: 1 - dismiss.value }));
  // The chrome goes first and faster: it is furniture, and it should not
  // still be sitting there over a photo that is halfway off the screen.
  const chrome = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - dismiss.value * 2) }));
  const scrollRef = useRef<ScrollView>(null);

  /*
   * Re-sync on every open, because this component does NOT unmount
   * between openings -- every call site renders it permanently and just
   * toggles `visible`. `useState(initialIndex)` therefore captured the
   * FIRST value only: opening the third image showed "1 / 3" while the
   * pager sat elsewhere. Latent in the flash gallery and inquiry screens
   * for as long as they have used this, and surfaced by chat, where a
   * message routinely carries several images.
   *
   * `scrollTo` as well as `contentOffset`: contentOffset positions a
   * freshly-mounted ScrollView on iOS, but react-native-web ignores it
   * (proven in the preview -- tapping image 2 of 3 opened image 1), and
   * the ScrollView does not remount when only `visible` changes.
   */
  useEffect(() => {
    if (!visible) return;
    // A viewer dragged shut leaves this at 1; without the reset the next
    // open would be invisible.
    dismiss.value = 0;
    setIndex(initialIndex);
    scrollRef.current?.scrollTo({ x: initialIndex * width, y: 0, animated: false });
  }, [visible, initialIndex, width]);

  if (images.length === 0) return null;
  const current = images[Math.min(index, images.length - 1)];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/*
        §2.5's progressive opacity: the black ground clears as the photo
        is dragged away, so a half-committed drag looks half-committed.
        `transparent` on the Modal is what lets it clear at all — an
        opaque modal root would stay black to the last frame.
      */}
      {/*
        A RN <Modal> is a separate native root, and gesture-handler
        requires a GestureHandlerRootView inside one or every
        GestureDetector below it is inert.

        Exactly the same class of trap as the insets note above, and for
        exactly the same reason: the app's root providers do not reach
        into a Modal. That note exists because the insets version of this
        bug DID ship once and reached a device screenshot.

        To be precise about what is and is not established: this is here
        on gesture-handler's documented requirement and that precedent,
        NOT on a test. A drag in the web harness does nothing either way
        -- gesture-handler is inert to synthetic input there -- so its
        silence proves nothing in either direction. Device gate.
      */}
      <GestureHandlerRootView style={styles.flex}>
      <Animated.View style={[styles.root, backdrop]}>
        <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <Animated.View style={[styles.bar, chrome]}>
            <Text style={styles.counter}>
              {images.length > 1 ? `${Math.min(index, images.length - 1) + 1} / ${images.length}` : ' '}
            </Text>
            {onSave ? (
              <Pressable
                onPress={() => onSave(current.url)}
                accessibilityRole="button"
                accessibilityLabel="Save photo to your library"
                hitSlop={12}
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              >
                <Feather name="download" size={20} color={colors.fg} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close photo"
              hitSlop={12}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Feather name="x" size={22} color={colors.fg} />
            </Pressable>
          </Animated.View>

          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: initialIndex * width, y: 0 }}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
            style={styles.flex}
          >
            {images.map((image) => (
              <ZoomablePhoto
                key={image.url}
                url={image.url}
                width={width}
                height={height * 0.7}
                dismissProgress={dismiss}
                onDismiss={onClose}
              />
            ))}
          </ScrollView>

          <Text style={styles.caption}>{current.caption ?? ' '}</Text>
        </View>
      </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** The tappable thumbnail strip used on the detail screen. */
export function PhotoStrip({
  images,
  onPress,
}: {
  images: ViewerImage[];
  onPress: (index: number) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {images.map((image, i) => (
        <Pressable
          key={image.url}
          onPress={() => onPress(i)}
          accessibilityRole="imagebutton"
          accessibilityLabel={image.caption ?? 'Photo'}
          style={({ pressed }) => [styles.thumb, pressed && styles.pressed]}
        >
          <Image source={{ uri: image.url }} style={styles.thumbImage} contentFit="cover" transition={150} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  safe: { flex: 1 },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md },
  counter: { ...type.label, color: colors.fgMuted, flex: 1 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  caption: { ...type.meta, color: colors.fgMuted, textAlign: 'center', paddingVertical: space.lg },

  strip: { paddingHorizontal: space.lg, gap: space.sm },
  thumb: {
    width: 104,
    height: 104,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  thumbImage: { width: '100%', height: '100%' },
});
