import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { channelLabel } from '@/components/ConversationRow';
import type { DisplayMessage } from '@/lib/threadRows';
import { channelColor, colors, hairline, radius, space, type } from '@/theme';
import { timeOfDay } from '@/lib/time';

/**
 * Is this attachment something we can show inline?
 *
 * Chat attachments go through Cloudinary's `image/upload` endpoint (the
 * same `/uploads/signature` apps/web's composer uses), so outbound ones
 * are always images. Inbound attachments arrive from whatever the client
 * sent over SMS/Email and are not guaranteed to be, so anything that
 * doesn't look like an image keeps the plain paperclip note rather than
 * rendering a broken frame.
 */
function isImageUrl(url: string): boolean {
  return /\.(jpe?g|png|gif|webp|avif|heic|bmp)(\?|$)/i.test(url) || /\/image\/upload\//.test(url);
}

export function MessageBubble({
  message,
  own,
  showMeta,
  showAuthor,
  onRetry,
  onOpenImage,
}: {
  message: DisplayMessage;
  own: boolean;
  /** False when this bubble continues a burst — the meta row is drawn once per burst. */
  showMeta: boolean;
  /** GROUP threads only: whose message this is, when it isn't the viewer's. */
  showAuthor: boolean;
  onRetry?: () => void;
  /** Opens the full-screen viewer on the tapped image. */
  onOpenImage?: (urls: string[], index: number) => void;
}) {
  const failed = message.status === 'failed';
  const pending = message.status === 'pending';
  const authorName = message.author?.name ?? message.author?.email ?? null;

  const attachments = message.attachments ?? [];
  const images = attachments.filter(isImageUrl);
  const others = attachments.filter((url) => !isImageUrl(url));

  return (
    <View style={[styles.wrap, own ? styles.wrapOwn : styles.wrapTheirs]}>
      {showAuthor && !own && authorName ? <Text style={styles.author}>{authorName}</Text> : null}

      <View
        style={[
          styles.bubble,
          own ? styles.bubbleOwn : styles.bubbleTheirs,
          pending && styles.bubblePending,
          // A failed send gets a red edge — the one place red belongs on
          // this screen, because something genuinely did not happen.
          failed && styles.bubbleFailed,
        ]}
      >
        {message.body ? (
          <Text style={[styles.body, own ? styles.bodyOwn : styles.bodyTheirs]}>{message.body}</Text>
        ) : null}

        {images.length > 0 ? (
          <View style={[styles.images, message.body ? styles.imagesAfterText : null]}>
            {images.map((url, index) => (
              <Pressable
                key={url}
                onPress={() => onOpenImage?.(images, index)}
                accessibilityRole="button"
                accessibilityLabel={`Attached image ${index + 1} of ${images.length}. Opens full screen.`}
                style={({ pressed }) => [
                  styles.imageWrap,
                  // One image gets the full bubble width; several tile.
                  images.length === 1 ? styles.imageSolo : styles.imageTiled,
                  pressed && styles.pressed,
                ]}
              >
                <Image source={{ uri: url }} style={styles.image} contentFit="cover" transition={140} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {others.length > 0 ? (
          <View style={styles.attachmentNote}>
            <Feather name="paperclip" size={12} color={own ? colors.accentFg : colors.fgMuted} />
            <Text style={[styles.attachmentLabel, own ? styles.bodyOwn : styles.bodyTheirs]}>
              {others.length} attachment{others.length === 1 ? '' : 's'}
            </Text>
          </View>
        ) : null}
      </View>

      {failed ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={({ pressed }) => [styles.failedRow, pressed && styles.pressed]}
        >
          <Feather name="alert-circle" size={12} color={colors.danger} />
          <Text style={styles.failedLabel}>Not sent — tap to retry</Text>
        </Pressable>
      ) : showMeta ? (
        <View style={[styles.meta, own ? styles.metaOwn : styles.metaTheirs]}>
          {pending ? (
            <Text style={styles.metaText}>Sending…</Text>
          ) : (
            <>
              <View style={[styles.channelDot, { backgroundColor: channelColor(message.channel) }]} />
              <Text style={styles.metaText}>{channelLabel(message.channel)}</Text>
              <Text style={styles.metaDivider}>·</Text>
              <Text style={styles.metaText}>{timeOfDay(message.createdAt)}</Text>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, marginTop: space.xs, maxWidth: '100%' },
  wrapOwn: { alignItems: 'flex-end' },
  wrapTheirs: { alignItems: 'flex-start' },

  author: { ...type.label, color: colors.fgMuted, marginBottom: space.xs, marginLeft: space.sm },

  bubble: {
    maxWidth: '84%',
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    borderRadius: radius.bubble,
    borderWidth: hairline,
  },
  bubbleOwn: { backgroundColor: colors.accent, borderColor: colors.accent },
  bubbleTheirs: { backgroundColor: colors.surface, borderColor: colors.border },
  bubblePending: { opacity: 0.55 },
  bubbleFailed: { borderColor: colors.dangerStrong },

  body: { ...type.message },
  bodyOwn: { color: colors.accentFg },
  bodyTheirs: { color: colors.fg },

  images: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  imagesAfterText: { marginTop: space.sm },
  imageWrap: { borderRadius: radius.input, overflow: 'hidden', backgroundColor: colors.surfaceInset },
  imageSolo: { width: 220, height: 220 },
  imageTiled: { width: 104, height: 104 },
  image: { width: '100%', height: '100%' },

  attachmentNote: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  attachmentLabel: { ...type.small },

  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs, paddingHorizontal: space.xs },
  metaOwn: { justifyContent: 'flex-end' },
  metaTheirs: { justifyContent: 'flex-start' },
  metaText: { ...type.meta, color: colors.fgMuted },
  metaDivider: { ...type.meta, color: colors.fgMuted },
  channelDot: { width: 5, height: 5, borderRadius: radius.pill },

  failedRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  failedLabel: { ...type.meta, color: colors.danger },
  pressed: { opacity: 0.6 },
});
