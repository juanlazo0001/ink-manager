import { CLIENT_CHANNELS, type ClientChannel, type MessageDirection } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { channelLabel } from '@/components/ConversationRow';
import { Eyebrow } from '@/components/ui';
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
}: {
  isClientThread: boolean;
  sendState: ComposerSendState;
  onChangeSendState: (next: ComposerSendState) => void;
  unavailableChannels: Set<string>;
  canSendLive: boolean;
  onSend: (body: string) => void;
  sending: boolean;
  disabled?: boolean;
}) {
  const [body, setBody] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const canSubmit = body.trim().length > 0 && !sending && !disabled;

  const wouldSendLive =
    isClientThread &&
    canSendLive &&
    sendState.direction === 'OUTBOUND' &&
    (sendState.channel === 'SMS' || sendState.channel === 'EMAIL') &&
    !unavailableChannels.has(sendState.channel);

  function submit() {
    if (!canSubmit) return;
    onSend(body.trim());
    setBody('');
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

      <View style={styles.inputRow}>
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
