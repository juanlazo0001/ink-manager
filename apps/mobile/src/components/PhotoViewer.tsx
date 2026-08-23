import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  const [index, setIndex] = useState(initialIndex);

  if (images.length === 0) return null;
  const current = images[Math.min(index, images.length - 1)];

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
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
        </SafeAreaView>
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
