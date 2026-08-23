import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { colors, hairline, radius } from '@/theme';

/**
 * A person's photo, with initials behind it.
 *
 * The fallback covers TWO cases, not one. A null `url` is the obvious one.
 * The other is a url that fails to load — a deleted Cloudinary asset, a
 * malformed data URL, no connectivity — and without handling it the
 * avatar renders an empty circle, which looks like a rendering bug rather
 * than a missing photo. Caught in preview: a 404ing avatar left one row's
 * circle blank while every other row showed a face.
 *
 * `key`ed reset on `url` matters: a recycled list row can be handed a new
 * url after a previous one failed, and without clearing the flag it would
 * show initials for a photo that is perfectly fine.
 */
export function Avatar({
  url,
  initials,
  size,
  ring,
  style,
  labelStyle,
}: {
  url: string | null | undefined;
  initials: string;
  size: number;
  /** Border colour. The gold ring is how both call sites mark unread. */
  ring?: string;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  const showImage = !!url && !failed;

  return (
    <View
      style={[
        styles.base,
        { width: size, height: size, borderRadius: radius.pill, borderColor: ring ?? colors.border },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: url }}
          style={styles.image}
          contentFit="cover"
          transition={140}
          onError={() => setFailed(true)}
          accessible={false}
        />
      ) : (
        <Text style={[styles.label, labelStyle]}>{initials}</Text>
      )}
    </View>
  );
}

/** Two letters at most — more will not fit a circle at any of these sizes. */
export function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    borderWidth: hairline,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  label: { color: colors.fgMuted },
});
