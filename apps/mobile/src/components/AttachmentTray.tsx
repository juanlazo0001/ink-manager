import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { PendingAttachment } from '@/hooks/useAttachments';
import { colors, hairline, radius, space, type } from '@/theme';

const THUMB = 64;

/**
 * The images staged in the composer, before send.
 *
 * Every state is visible on the thumbnail itself rather than in a
 * separate status line: a determinate progress bar while uploading, a red
 * edge and a retry affordance on failure. The person can remove any of
 * them at any point, including mid-upload -- which aborts that request
 * rather than letting it finish into nothing.
 */
export function AttachmentTray({
  items,
  onRetry,
  onRemove,
}: {
  items: PendingAttachment[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {items.map((item) => {
        const failed = item.status === 'failed';
        const uploading = item.status === 'uploading';
        return (
          <View key={item.id} style={styles.item}>
            <Pressable
              onPress={failed ? () => onRetry(item.id) : undefined}
              accessibilityRole={failed ? 'button' : 'image'}
              accessibilityLabel={
                failed
                  ? `Attachment failed to upload. ${item.error ?? ''} Tap to retry.`
                  : uploading
                    ? `Attachment uploading, ${Math.round(item.progress * 100)} percent`
                    : 'Attachment ready'
              }
              style={[styles.thumbWrap, failed && styles.thumbFailed]}
            >
              <Image source={{ uri: item.localUri }} style={styles.thumb} contentFit="cover" />

              {uploading ? (
                <View style={styles.veil}>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.max(4, item.progress * 100)}%` }]} />
                  </View>
                </View>
              ) : null}

              {failed ? (
                <View style={styles.veil}>
                  <Feather name="rotate-ccw" size={18} color={colors.danger} />
                </View>
              ) : null}
            </Pressable>

            <Pressable
              onPress={() => onRemove(item.id)}
              accessibilityRole="button"
              accessibilityLabel="Remove attachment"
              hitSlop={8}
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
            >
              <Feather name="x" size={12} color={colors.fg} />
            </Pressable>
          </View>
        );
      })}

      {items.some((i) => i.status === 'failed') ? (
        <View style={styles.hintWrap}>
          <Text style={styles.hint}>Tap a failed image to try again</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm },

  // Room at the top-right for the remove button to sit proud of the thumb.
  item: { paddingTop: 6, paddingRight: 6 },
  thumbWrap: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.input,
    overflow: 'hidden',
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  thumbFailed: { borderColor: colors.dangerStrong },
  thumb: { width: '100%', height: '100%' },

  veil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0c0a08bb',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  track: {
    width: '100%',
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent },

  remove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },

  hintWrap: { justifyContent: 'center', paddingLeft: space.xs },
  hint: { ...type.meta, color: colors.fgMuted, maxWidth: 130 },
  pressed: { opacity: 0.6 },
});
