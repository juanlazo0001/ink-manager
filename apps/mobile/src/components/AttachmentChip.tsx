import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { DocumentIcon, TrashIcon } from '@/components/icons';
import type { NoteAttachment } from '@/lib/inquiryNotes';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * One note attachment.
 *
 * ─── WHY THIS BRANCHES ON MIME TYPE ─────────────────────────────────
 *
 * A note attachment is the only upload in this app that is NOT
 * guaranteed to be an image. `Message.attachments` is a bare array of
 * URLs and renders as an image unconditionally, which is safe there
 * because chat only ever uploads images. Notes go through Cloudinary's
 * `auto/upload` and can be a PDF, so rendering one as an image would
 * show a broken box with no way to tell what the file even was.
 *
 * apps/web's `AttachmentChip` draws exactly this line — thumbnail when
 * `mimeType.startsWith('image/')`, generic document icon otherwise — and
 * this mirrors it rather than inventing a second convention.
 *
 * The filename is always shown, for both branches. For a document it is
 * the ONLY thing identifying the file; for an image it is still what the
 * person named it, and a thumbnail 28pt wide identifies very little.
 */
export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: NoteAttachment;
  /** Omitted on a posted note, where the chip is a link and not an editor. */
  onRemove?: () => void;
}) {
  /*
   * ONE DELIBERATE IMPROVEMENT ON WEB. Web renders an `<img>` whose src
   * is the attachment URL and has no error path, so a URL that fails to
   * load leaves an empty box with nothing identifying the file. Falling
   * back to the document icon means a chip always shows SOMETHING beside
   * its filename. Recorded rather than silent, because the standing
   * instruction is to match web.
   */
  const [thumbFailed, setThumbFailed] = useState(false);
  const isImage = attachment.mimeType.startsWith('image/') && !thumbFailed;

  /*
   * Opening leaves the app, so failure has to be said out loud rather
   * than swallowed: a tap that silently does nothing reads as a frozen
   * screen. `canOpenURL` is checked because a Cloudinary raw URL for an
   * unusual type can have no handler on the device at all.
   */
  const open = async () => {
    try {
      const can = await Linking.canOpenURL(attachment.url);
      if (!can) {
        Alert.alert('Cannot open this file', 'No app on this device can open this file type.');
        return;
      }
      await Linking.openURL(attachment.url);
    } catch {
      Alert.alert('Cannot open this file', 'Something went wrong opening it. Try again.');
    }
  };

  return (
    <View style={styles.chip}>
      <Pressable
        onPress={() => void open()}
        accessibilityRole="link"
        accessibilityLabel={`Open ${attachment.filename}`}
        style={styles.main}
      >
        {isImage ? (
          <Image
            source={{ uri: attachment.url }}
            style={styles.thumb}
            contentFit="cover"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <View style={styles.thumb}>
            <DocumentIcon size={14} color={colors.fgMuted} />
          </View>
        )}
        {/* One line, ellipsised at the END: a filename's leading
            characters are what identify it, and the extension is
            already implied by the icon beside it. */}
        <Text style={styles.name} numberOfLines={1}>
          {attachment.filename}
        </Text>
      </Pressable>

      {onRemove ? (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${attachment.filename}`}
          hitSlop={8}
          style={styles.remove}
        >
          <TrashIcon size={14} color={colors.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: space.xs,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.input,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surfaceInset,
  },
  main: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 },
  thumb: {
    width: 22,
    height: 22,
    borderRadius: 4,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...type.small, color: colors.fg, flexShrink: 1 },
  remove: { paddingLeft: space.xs },
});
