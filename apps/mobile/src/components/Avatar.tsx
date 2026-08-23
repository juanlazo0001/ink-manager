import { Image as ExpoImage } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  Image as RNImage,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, hairline, radius } from '@/theme';

/**
 * Is this a base64 `data:` URI rather than something fetchable?
 *
 * This distinction is load-bearing, not cosmetic -- see the renderer
 * choice in `Avatar` below.
 */
function isDataUri(url: string): boolean {
  return url.startsWith('data:');
}

/**
 * A person's photo, with initials behind it.
 *
 * TWO renderers, chosen by URL scheme. This looks redundant and is not:
 *
 * `User.avatarUrl` is NOT a link -- the API stores the image inline as a
 * base64 `data:` URI on the row (apps/api/src/lib/images.ts:
 * "base64 data URLs stored directly on the row rather than adding file
 * storage infra for small profile/branding images", enforced on write by
 * `validateImageDataUrl`, which rejects anything not starting `data:image/`).
 * Verified against dev: every stored avatar is a data URI, and
 * `GET /conversations?type=STAFF` returns one 12,047 characters long.
 *
 * expo-image CANNOT load those on iOS. It hands the source to SDWebImage,
 * whose only registered loaders are Blurhash, Thumbhash and
 * PhotoLibraryAsset (expo-image/ios/ImageModule.swift `registerLoaders`);
 * everything else falls through to the NSURLSession downloader, which
 * does not implement the `data:` scheme. The load fails, `onError` fires,
 * and the circle silently falls back to initials -- which is exactly the
 * staff-avatar bug reported at the device gate, and why apps/web shows
 * the same person's photo from the same payload: a browser's <img>
 * decodes `data:` natively.
 *
 * React Native's own Image does handle it: RCTDataRequestHandler's
 * `canHandleRequest` matches the `data` scheme explicitly
 * (react-native/Libraries/Network/RCTDataRequestHandler.mm).
 *
 * So: data URIs go to RN's Image, and real http(s) URLs stay on
 * expo-image, which is worth keeping for its caching and transition on
 * the sources it can actually fetch.
 *
 * The fallback covers TWO cases. A null `url` is the obvious one. The
 * other is a url that fails to load -- without handling it the avatar
 * renders an empty circle, which reads as a rendering bug rather than a
 * missing photo. Resetting on `url` change matters because a recycled
 * list row can be handed a good url after a previous one failed.
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
  /** Border colour. The gold ring is how the chat surfaces mark unread. */
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
        isDataUri(url) ? (
          <RNImage
            source={{ uri: url }}
            style={styles.image}
            resizeMode="cover"
            onError={() => setFailed(true)}
            accessible={false}
          />
        ) : (
          <ExpoImage
            source={{ uri: url }}
            style={styles.image}
            contentFit="cover"
            transition={140}
            onError={() => setFailed(true)}
            accessible={false}
          />
        )
      ) : (
        <Text style={[styles.label, labelStyle]} numberOfLines={1}>
          {initials}
        </Text>
      )}
    </View>
  );
}

/**
 * Web's rule, verbatim: the first letter of each of the FIRST TWO words
 * (apps/web/src/components/ConversationsPanel.tsx `initials`).
 *
 * Mobile previously took the first and LAST word, which is why the studio
 * thread "Black Hive Ink and Arts" read "BA" on the phone and "BH" in the
 * browser. A single-word name yields a single letter here, as it does on
 * web -- deliberately not padded to two.
 *
 * The `?` guard is the one addition: web renders an empty circle for an
 * empty name. Unreachable in practice (callers default to "Unknown"), but
 * a blank circle is the very failure this component exists to avoid.
 */
export function initialsOf(name: string): string {
  const letters = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return letters || '?';
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
