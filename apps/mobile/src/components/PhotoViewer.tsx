import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, hairline, radius, space, type } from '@/theme';

export interface ViewerImage {
  url: string;
  /** Shown under the photo — reference art vs a photo of the placement. */
  caption?: string;
}

/**
 * Full-screen photo viewer.
 *
 * Deliberately a horizontal paging ScrollView rather than a gesture
 * library: swipe-between and tap-to-close cover what a reference photo
 * actually needs, and pinch-zoom would mean a new dependency and the
 * gesture-handler wiring that goes with it. Noted as a real limitation
 * rather than pretended away — an artist zooming into linework is a
 * plausible want, and this does not do it.
 */
export function PhotoViewer({
  images,
  initialIndex,
  visible,
  onClose,
}: {
  images: ViewerImage[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
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
    setIndex(initialIndex);
    scrollRef.current?.scrollTo({ x: initialIndex * width, y: 0, animated: false });
  }, [visible, initialIndex, width]);

  if (images.length === 0) return null;
  const current = images[Math.min(index, images.length - 1)];

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.bar}>
            <Text style={styles.counter}>
              {images.length > 1 ? `${Math.min(index, images.length - 1) + 1} / ${images.length}` : ' '}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close photo"
              hitSlop={12}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Feather name="x" size={22} color={colors.fg} />
            </Pressable>
          </View>

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
              <View key={image.url} style={[styles.page, { width, height: height * 0.7 }]}>
                <Image source={{ uri: image.url }} style={styles.image} contentFit="contain" transition={150} />
              </View>
            ))}
          </ScrollView>

          <Text style={styles.caption}>{current.caption ?? ' '}</Text>
        </View>
      </View>
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
  page: { alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
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
