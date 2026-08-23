import { CLIENT_CHANNELS, type ClientChannel, type MessageDirection } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AttachmentTray } from '@/components/AttachmentTray';
import { channelLabel } from '@/components/ConversationRow';
import { Eyebrow } from '@/components/ui';
import { useAttachments } from '@/hooks/useAttachments';
import { captureImage, ensureCameraPermission, ensureLibraryPermission, pickImage } from '@/lib/upload';
import { channelColor, colors, hairline, radius, space, type } from '@/theme';

export interface ComposerSendState {
  channel: ClientChannel;
  direction: MessageDirection;
}

/**
 * The composer.
 *
 * On a STAFF/GROUP thread there is nothing to choose — the API forces
 * IN_APP/OUTBOUND and rejects anything else — so the channel control is
 * hidden entirely rather than shown disabled.
 *
 * On a CLIENT thread channel and direction are REQUIRED by the API, and
 * the choice has real consequences: an OUTBOUND SMS or EMAIL on a
 * connected integration is an actual message to an actual person. That is
 * why the strip above the input always states, in plain words, whether
 * this send will leave the building or only be written down.
 *
 * Attachments upload as soon as they are picked, not on send -- see
 * `useAttachments`. The API accepts `attachments` (Cloudinary URLs) on
 * `POST /conversations/:id/messages` and requires either a body or a
 * non-empty attachments array, so an image with no caption is a valid
 * send and the send control enables on either.
 */
export function Composer({
  isClientThread,
  sendState,
  onChangeSendState,
  /** Channels with no live provider connected. PHONE/OTHER are never integrations. */
  unavailableChannels,
  /** False when the caller lacks `conversations.sendLive` — every send is log-only. */
  canSendLive,
  onSend,
  sending,
  disabled,
  token,
  replyPreview,
  onCancelReply,
  editingMessageId,
  editingInitialBody,
  onCancelEdit,
}: {
  isClientThread: boolean;
  sendState: ComposerSendState;
  onChangeSendState: (next: ComposerSendState) => void;
  unavailableChannels: Set<string>;
  canSendLive: boolean;
  onSend: (body: string, attachments: string[]) => void;
  sending: boolean;
  disabled?: boolean;
  /** Bearer token for fetching per-upload Cloudinary signatures. */
  token: string | null;
  /** The message being quoted, if any. */
  replyPreview?: { author: string; body: string } | null;
  onCancelReply?: () => void;
  /** Non-null puts the composer in edit mode. */
  editingMessageId?: string | null;
  editingInitialBody?: string;
  onCancelEdit?: () => void;
}) {
  const [body, setBody] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const attachments = useAttachments(token);

  const editing = !!editingMessageId;

  // Entering edit mode loads the existing text so it can be amended
  // rather than retyped. Keyed on the id, so switching directly from one
  // message to another reloads rather than keeping the first one's text.
  useEffect(() => {
    if (editingMessageId) setBody(editingInitialBody ?? '');
    else setBody('');
  }, [editingMessageId, editingInitialBody]);

  // Either a caption or a finished image is enough to send, mirroring the
  // API's own rule. Still uploading blocks send: the URL does not exist
  // yet, so there would be nothing to reference.
  // An edit must keep a body -- the API rejects an empty one, and there is
  // no way to attach to an existing message.
  const hasContent = editing
    ? body.trim().length > 0
    : body.trim().length > 0 || attachments.uploadedUrls.length > 0;
  const canSubmit = hasContent && !sending && !disabled && !attachments.busy;

  const wouldSendLive =
    isClientThread &&
    canSendLive &&
    sendState.direction === 'OUTBOUND' &&
    (sendState.channel === 'SMS' || sendState.channel === 'EMAIL') &&
    !unavailableChannels.has(sendState.channel);

  function submit() {
    if (!canSubmit) return;
    onSend(body.trim(), editing ? [] : attachments.uploadedUrls);
    setBody('');
    attachments.clear();
  }

  async function addFromLibrary() {
    setSourceOpen(false);
    if (!(await ensureLibraryPermission())) {
      Alert.alert('Photos access needed', 'Allow photo access in Settings to attach an image.');
      return;
    }
    const image = await pickImage();
    if (image) attachments.add(image);
  }

  async function addFromCamera() {
    setSourceOpen(false);
    if (!(await ensureCameraPermission())) {
      Alert.alert('Camera access needed', 'Allow camera access in Settings to take a photo.');
      return;
    }
    const image = await captureImage();
    if (image) attachments.add(image);
  }

  return (
    <View style={styles.wrap}>
      {isClientThread ? (
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Change how this sends"
          style={({ pressed }) => [styles.strip, pressed && styles.pressed]}
        >
          <View style={[styles.dot, { backgroundColor: channelColor(sendState.channel) }]} />
          <Text style={styles.stripLabel}>
            {sendState.direction === 'INBOUND'
              ? `Logging what they said on ${channelLabel(sendState.channel)}`
              : wouldSendLive
                ? `Sends for real over ${channelLabel(sendState.channel)}`
                : `Logged to the thread as ${channelLabel(sendState.channel)}`}
          </Text>
          <Feather name="chevron-up" size={14} color={colors.fgMuted} />
        </Pressable>
      ) : null}

      {editing ? (
        <View style={styles.banner}>
          <Feather name="edit-2" size={13} color={colors.accent} />
          <Text style={styles.bannerLabel} numberOfLines={1}>
            Editing message
          </Text>
          <Pressable onPress={onCancelEdit} accessibilityRole="button" accessibilityLabel="Cancel edit" hitSlop={8}>
            <Feather name="x" size={15} color={colors.fgMuted} />
          </Pressable>
        </View>
      ) : replyPreview ? (
        <View style={styles.banner}>
          <Feather name="corner-up-left" size={13} color={colors.accent} />
          <View style={styles.bannerText}>
            <Text style={styles.bannerAuthor} numberOfLines={1}>
              {replyPreview.author}
            </Text>
            <Text style={styles.bannerLabel} numberOfLines={1}>
              {replyPreview.body || 'Image'}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} accessibilityRole="button" accessibilityLabel="Cancel reply" hitSlop={8}>
            <Feather name="x" size={15} color={colors.fgMuted} />
          </Pressable>
        </View>
      ) : null}

      {editing ? null : (
        <AttachmentTray items={attachments.items} onRetry={attachments.retry} onRemove={attachments.remove} />
      )}

      <View style={styles.inputRow}>
        {editing ? null : (
          <Pressable
            onPress={() => setSourceOpen(true)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Attach an image"
            style={({ pressed }) => [styles.attach, pressed && styles.pressed]}
          >
            <Feather name="paperclip" size={20} color={disabled ? colors.fgMuted : colors.fgSecondary} />
          </Pressable>
        )}
        <TextInput
          style={styles.input}
          value={body}
          onChangeText={setBody}
          placeholder={disabled ? 'Read only' : 'Write a message'}
          placeholderTextColor={colors.fgMuted}
          multiline
          editable={!disabled}
          accessibilityLabel="Message"
        />
        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={({ pressed }) => [
            styles.send,
            !canSubmit && styles.sendDisabled,
            pressed && canSubmit && styles.sendPressed,
          ]}
        >
          <Feather name="arrow-up" size={20} color={canSubmit ? colors.accentFg : colors.fgMuted} />
        </Pressable>
      </View>

      <Modal visible={sourceOpen} transparent animationType="slide" onRequestClose={() => setSourceOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSourceOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Eyebrow style={styles.sheetEyebrow}>Attach</Eyebrow>

            <Pressable onPress={addFromLibrary} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
              <Feather name="image" size={16} color={colors.fgSecondary} />
              <Text style={styles.optionLabel}>Photo library</Text>
            </Pressable>

            <Pressable onPress={addFromCamera} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
              <Feather name="camera" size={16} color={colors.fgSecondary} />
              <Text style={styles.optionLabel}>Take photo</Text>
            </Pressable>

            <Pressable onPress={() => setSourceOpen(false)} style={styles.done}>
              <Text style={styles.doneLabel}>CANCEL</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Eyebrow style={styles.sheetEyebrow}>Channel</Eyebrow>
            {CLIENT_CHANNELS.map((channel) => {
              const off = unavailableChannels.has(channel);
              const active = sendState.channel === channel;
              return (
                <Pressable
                  key={channel}
                  disabled={off}
                  onPress={() => onChangeSendState({ ...sendState, channel })}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                >
                  <View style={[styles.dot, { backgroundColor: channelColor(channel) }, off && styles.dotOff]} />
                  <Text style={[styles.optionLabel, active && styles.optionLabelActive, off && styles.optionOff]}>
                    {channelLabel(channel)}
                  </Text>
                  {off ? <Text style={styles.optionNote}>not connected</Text> : null}
                  {active ? <Feather name="check" size={16} color={colors.accent} /> : null}
                </Pressable>
              );
            })}

            <Eyebrow style={styles.sheetEyebrow}>Direction</Eyebrow>
            {(['OUTBOUND', 'INBOUND'] as const).map((direction) => (
              <Pressable
                key={direction}
                onPress={() => onChangeSendState({ ...sendState, direction })}
                style={({ pressed }) => [styles.option, pressed && styles.pressed]}
              >
                <Text
                  style={[styles.optionLabel, sendState.direction === direction && styles.optionLabelActive]}
                >
                  {direction === 'OUTBOUND' ? 'We are writing' : 'Logging what they said'}
                </Text>
                {sendState.direction === direction ? <Feather name="check" size={16} color={colors.accent} /> : null}
              </Pressable>
            ))}

            {!canSendLive ? (
              <Text style={styles.sheetNote}>
                Your role can log messages here, but not send them out. Everything written is saved to the thread only.
              </Text>
            ) : null}

            <Pressable onPress={() => setPickerOpen(false)} style={styles.done}>
              <Text style={styles.doneLabel}>DONE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: hairline, borderTopColor: colors.border, backgroundColor: colors.surfaceInset },

  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
  stripLabel: { ...type.meta, color: colors.fgMuted, flex: 1 },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  dotOff: { opacity: 0.3 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    backgroundColor: colors.inputBg,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    color: colors.fg,
    ...type.body,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingTop: space.sm + 2,
    paddingBottom: space.sm + 2,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  bannerText: { flex: 1 },
  bannerAuthor: { ...type.meta, color: colors.accent },
  bannerLabel: { ...type.meta, color: colors.fgMuted, flex: 1 },

  attach: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accentButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { backgroundColor: colors.surface },
  sendPressed: { backgroundColor: colors.accentHover },

  backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderTopWidth: hairline,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
    gap: space.xs,
  },
  sheetEyebrow: { color: colors.accent, marginTop: space.md, marginBottom: space.xs },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md - 2 },
  optionLabel: { ...type.body, color: colors.fgSecondary, flex: 1 },
  optionLabelActive: { color: colors.fg },
  optionOff: { color: colors.fgMuted },
  optionNote: { ...type.meta, color: colors.fgMuted },
  sheetNote: { ...type.small, color: colors.fgMuted, marginTop: space.md },
  done: { marginTop: space.lg, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.accent },
  pressed: { opacity: 0.6 },
});
