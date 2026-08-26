import { Image, type ImageLoadEventData } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { chat, radius } from '@/theme';

/**
 * §2.5's image bubble: radius 18, no padding, max height 280.
 *
 * ─── WHY THE ASPECT RATIO IS KEPT ───────────────────────────────────
 *
 * This shipped as a fixed 220x220 square with `contentFit: cover`, which
 * means every photo was CROPPED to a square before anyone saw it. In this
 * app that is not a cosmetic loss: the images in these threads are
 * reference photos and healed-work shots, and a tall arm piece or a wide
 * back piece is exactly the composition a square throws away. You would
 * have to open the viewer to find out what you were sent.
 *
 * So the tile takes the image's own proportions, bounded by §2.5's 280
 * ceiling and a width that keeps it inside the bubble's own measure.
 *
 * ─── THE ONE-TIME RESIZE ────────────────────────────────────────────
 *
 * Natural dimensions are not known until the image loads, so it starts at
 * a 4:3 box and settles to the real shape on `onLoad`. Every chat app
 * does this and the alternative is worse: holding a blank space until the
 * bytes arrive, or shipping a dimensions column the API does not have.
 *
 * ─── ABOUT BLURHASH ─────────────────────────────────────────────────
 *
 * §2.5 offers "blurhash/skeleton". There is no blurhash: nothing in the
 * pipeline computes one -- attachments are Cloudinary URLs on the message
 * row, with no derived-image metadata alongside them. Inventing a
 * placeholder hash client-side would mean decoding the full image first,
 * which is the thing being waited on. So this is the skeleton half of
 * that "or": a recessed ground in the app's own inset colour, held under
 * the image and revealed by nothing more than the image not being there
 * yet. It never flashes white, which is the failure mode a placeholder is
 * really there to prevent.
 */
export function ImageBubble({
  url,
  /** Bare = the image IS the bubble, so it carries the bubble's radius. */
  bare,
  maxWidth,
}: {
  url: string;
  bare: boolean;
  maxWidth: number;
}) {
  // 4:3 until the real shape is known — see the header.
  const [ratio, setRatio] = useState(4 / 3);

  const onLoad = (event: ImageLoadEventData) => {
    const { width, height } = event.source ?? {};
    if (!width || !height) return;
    setRatio(width / height);
  };

  // Width first, then clamp the height: a very tall image gets narrower
  // rather than taller, which is what keeps a portrait photo from
  // swallowing the whole thread.
  const height = Math.min(MAX_HEIGHT, maxWidth / ratio);
  const width = Math.min(maxWidth, height * ratio);

  return (
    <View style={[styles.frame, bare && styles.bare, { width, height }]}>
      <Image
        source={{ uri: url }}
        style={styles.image}
        // `contain` inside a box that already matches the aspect ratio is
        // a no-op for a correctly-measured image, and the honest choice
        // for the frame or two before it is measured -- `cover` would
        // crop during exactly the moment the ratio is still a guess.
        contentFit="contain"
        transition={140}
        onLoad={onLoad}
      />
    </View>
  );
}

/** §2.5. */
const MAX_HEIGHT = 280;

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.input,
    overflow: 'hidden',
    // The skeleton — see the header on why it is not a blurhash.
    backgroundColor: chat.surfaceInset,
  },
  /* §2.5: radius 18, and no padding anywhere near it. */
  bare: { borderRadius: radius.bubble },
  image: { width: '100%', height: '100%' },
});
