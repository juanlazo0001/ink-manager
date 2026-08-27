import { CLIENT_CHANNELS, type ClientChannel, type MessageDirection } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  ZoomIn,
} from 'react-native-reanimated';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Sheet } from '@/components/Sheet';

import { AttachmentTray } from '@/components/AttachmentTray';
import { channelLabel } from '@/components/ConversationRow';
import { Eyebrow } from '@/components/ui';
import { useAttachments } from '@/hooks/useAttachments';
import {
  appendLink,
  fetchShareableLinks,
  insertableLinks,
  type ShareableLinks,
} from '@/lib/shareableLinks';
import {
  captureImage,
  ensureCameraPermission,
  ensureLibraryPermission,
  pickerErrorMessage,
  pickImage,
} from '@/lib/upload';
import { chat, channelColor, colors, hairline, radius, space, type } from '@/theme';
import { motion, S3, useReducedMotion } from '@/theme/chatMotion';

/** §3: the field's resting height and its five-line ceiling. */
const COMPOSER_MIN_HEIGHT = 36;
const COMPOSER_MAX_HEIGHT = 120;

/*
 * `TextInput` is not animatable on its own; this is the standard
 * Reanimated wrapper, created once at module scope so it is not a new
 * component type on every render — which would remount the field and
 * drop the keyboard mid-sentence.
 */
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** §3: the send button scales in on the first character, on S3. */
const sendEntering = ZoomIn.springify().stiffness(S3.stiffness!).damping(S3.damping!);

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
  clientId,
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
  /** CLIENT threads only — whose links the insert menu offers. */
  clientId?: string | null;
}) {
  const [bodyState, setBodyState] = useState('');
  /*
   * Every write to the draft goes through this, and it can only ever
   * store a string. A link row with no url used to set the draft to null,
   * and the next render died on `body.trim()` — the crash the owner hit.
   * The url is guarded at its source too; this is the backstop, because
   * `body` is read by three different expressions on every render.
   */
  const body = bodyState ?? '';
  const setBody = (next: string | ((current: string) => string)) => {
    setBodyState((current) => {
      const value = typeof next === 'function' ? next(current ?? '') : next;
      return value ?? '';
    });
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [links, setLinks] = useState<ShareableLinks | null>(null);
  const attachments = useAttachments(token);

  /*
   * §3 GROWTH. The field is min 36 and grows with its content to five
   * lines (~120) before scrolling internally, and the growth ANIMATES
   * with S3 rather than jumping a line at a time.
   *
   * Measured from `onContentSizeChange` — the only number RN offers that
   * knows how tall the text actually is. Clamped both ends here rather
   * than by `maxHeight` alone, because the animated height has to be a
   * real number for the spring to land on.
   */
  const inputHeight = useSharedValue(COMPOSER_MIN_HEIGHT);
  /** The text as of THIS event — see `onContentSize`. */
  const bodyRef = useRef('');
  const reduced = useReducedMotion();
  const inputStyle = useAnimatedStyle(() => ({ height: inputHeight.value }));

  /*
   * THE EMPTY CASE IS AUTHORITATIVE, and that is a fix rather than a
   * flourish.
   *
   * `onContentSizeChange` reports the content's height — but once the box
   * is clamped at 120 the reported value converges on the BOX, not on the
   * text. So after a send cleared the field, the collapse in `submit()`
   * was immediately overridden by a stale report of ~118 and the composer
   * stayed five lines tall around an empty input. Seen in the preview at
   * 117.98px where 36 was expected.
   *
   * The body is the thing we actually know: no text means minimum height,
   * whatever the box says about itself. Everything else still measures.
   */
  /*
   * A REF, not the `body` state, and the difference is a real bug I
   * shipped for one iteration: `onContentSizeChange` fires in the same
   * native event as `onChangeText`, BEFORE React commits, so reading
   * `body` here gets the PREVIOUS value. Checking it meant a field that
   * had just received its first long paragraph was measured as "still
   * empty" and pinned to 36 forever. The ref is written synchronously in
   * `onChangeBody` below, so it is always the text the user just typed.
   */
  function onContentSize(height: number) {
    const next = bodyRef.current.length === 0
      ? COMPOSER_MIN_HEIGHT
      : Math.min(Math.max(height, COMPOSER_MIN_HEIGHT), COMPOSER_MAX_HEIGHT);
    if (Math.abs(next - inputHeight.value) < 0.5) return;
    inputHeight.value = motion(next, S3, reduced);
  }

  const editing = !!editingMessageId;

  // Entering edit mode loads the existing text so it can be amended
  // rather than retyped. Keyed on the id, so switching directly from one
  // message to another reloads rather than keeping the first one's text.
  useEffect(() => {
    const seeded = editingMessageId ? (editingInitialBody ?? '') : '';
    bodyRef.current = seeded;
    setBody(seeded);
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

  function onChangeBody(next: string) {
    bodyRef.current = next;
    setBody(next);
  }

  function submit() {
    if (!canSubmit) return;
    // §10: impactLight on send. Fired before the state changes so the tick
    // lands with the tap, not after the round trip.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSend(body.trim(), editing ? [] : attachments.uploadedUrls);
    bodyRef.current = '';
    setBody('');
    attachments.clear();
    // §3: the field collapses on the same spring it grew with.
    inputHeight.value = motion(COMPOSER_MIN_HEIGHT, S3, reduced);
  }

  /*
   * Links are fetched on demand rather than with the thread: most sends
   * are plain messages, and this is a per-client round trip that would
   * otherwise happen every time anyone opened a conversation.
   */
  async function openLinks() {
    setSourceOpen(false);
    setLinksOpen(true);
    if (links || !token || !clientId) return;
    try {
      setLinks(await fetchShareableLinks(token, clientId));
    } catch {
      // The sheet stays open and shows its empty state; a failed link
      // lookup is not worth an alert over an optional convenience.
    }
  }

  function insertLink(url: string | null | undefined) {
    // A row with no url is rendered disabled, so this should not fire —
    // but it stays a no-op rather than a crash if it ever does.
    if (!url) return;
    setBody((current) => appendLink(current, url));
    setLinksOpen(false);
  }

  /*
   * ─── WHY THESE ARE WRAPPED (session 07, task G) ────────────────────
   *
   * Both of these called into expo-image-picker with NO try/catch, in an
   * async `onPress`. A native error from the permission call or the
   * picker itself therefore became an UNHANDLED PROMISE REJECTION, which
   * in React Native is a redbox -- indistinguishable, from the outside,
   * from "the app crashed when I picked a photo".
   *
   * The asymmetry gave it away: the avatar picker in `ImageFields.tsx`
   * wraps the identical call, and the avatar path was never reported as
   * crashing. This is the chat path catching up.
   *
   * The catch does not swallow: it surfaces the native message, so if
   * something underneath is genuinely wrong the next report carries its
   * text instead of a stack trace nobody can read.
   */
  async function addFromLibrary() {
    setSourceOpen(false);
    try {
      if (!(await ensureLibraryPermission())) {
        Alert.alert('Photos access needed', 'Allow photo access in Settings to attach an image.');
        return;
      }
      const image = await pickImage();
      if (image) attachments.add(image);
    } catch (err) {
      Alert.alert('Could not open your photos', pickerErrorMessage(err));
    }
  }

  async function addFromCamera() {
    setSourceOpen(false);
    try {
      if (!(await ensureCameraPermission())) {
        Alert.alert('Camera access needed', 'Allow camera access in Settings to take a photo.');
        return;
      }
      const image = await captureImage();
      if (image) attachments.add(image);
    } catch (err) {
      Alert.alert('Could not open the camera', pickerErrorMessage(err));
    }
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
        {/*
          §3: a PLUS, 28pt, cream — not the 20pt paperclip AE shipped.
          Kept, not rebuilt: it already opens a real attachment sheet
          (Photo library / Take photo) backed by expo-image-picker and the
          upload hook, so this is a restyle. The "no inert affordances"
          rule bites only where nothing is wired, and here something is.
        */}
        {editing ? null : (
          <Pressable
            onPress={() => setSourceOpen(true)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Attach an image"
            hitSlop={8}
            style={({ pressed }) => [styles.attach, pressed && styles.pressed]}
          >
            <Feather name="plus" size={28} color={disabled ? chat.textMuted : chat.textPrimary} />
          </Pressable>
        )}

        <AnimatedTextInput
          style={[styles.input, inputStyle]}
          value={body}
          onChangeText={onChangeBody}
          onContentSizeChange={(e) => onContentSize(e.nativeEvent.contentSize.height)}
          placeholder={disabled ? 'Read only' : 'Message'}
          placeholderTextColor={chat.textMuted}
          multiline
          editable={!disabled}
          // Past five lines the field stops growing and scrolls its own
          // content, which is the half of §3 that keeps the keyboard and
          // the thread from being squeezed off screen.
          scrollEnabled
          accessibilityLabel="Message"
        />

        {/*
          §3: the send button is ABSENT until there is something to send,
          and is never rendered in a disabled treatment. It scales in with
          S3 on the first character.

          `disabled` still guards the press — a tap during an in-flight
          upload must not fire — but that is behaviour, not appearance:
          nothing greys out, because a greyed button invites a tap that
          cannot work.
        */}
        {hasContent ? (
          <Animated.View entering={sendEntering} style={styles.sendWrap}>
            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Send"
              style={({ pressed }) => [styles.send, pressed && styles.sendPressed]}
            >
              <Feather name="arrow-up" size={18} color={chat.bubbleOwnText} />
            </Pressable>
          </Animated.View>
        ) : null}
      </View>

      <Sheet visible={sourceOpen} onClose={() => setSourceOpen(false)}>
            <Eyebrow style={styles.sheetEyebrow}>Attach</Eyebrow>

            <Pressable onPress={addFromLibrary} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
              <Feather name="image" size={16} color={colors.fgSecondary} />
              <Text style={styles.optionLabel}>Photo library</Text>
            </Pressable>

            <Pressable onPress={addFromCamera} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
              <Feather name="camera" size={16} color={colors.fgSecondary} />
              <Text style={styles.optionLabel}>Take photo</Text>
            </Pressable>

            {/* Web's composer can drop a shareable link into the draft.
                CLIENT threads only, because the links belong to a client. */}
            {clientId ? (
              <Pressable onPress={openLinks} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
                <Feather name="link" size={16} color={colors.fgSecondary} />
                <Text style={styles.optionLabel}>Insert a link</Text>
              </Pressable>
            ) : null}

            <Pressable onPress={() => setSourceOpen(false)} style={styles.done}>
              <Text style={styles.doneLabel}>CANCEL</Text>
            </Pressable>
      </Sheet>

      <Sheet visible={linksOpen} onClose={() => setLinksOpen(false)}>
            <Eyebrow style={styles.sheetEyebrow}>Insert a link</Eyebrow>

            {/* Web's first entry mints a PrefillDraft token, which is a
                write, so it is shown and disabled rather than omitted. */}
            <View style={[styles.option, styles.optionDisabledRow]}>
              <Feather name="user-plus" size={16} color={colors.fgMuted} />
              <Text style={styles.optionOff}>Prefilled intake link</Text>
              <Text style={styles.optionNote}>portal only</Text>
            </View>

            {insertableLinks(links).map((link) => (
              <Pressable
                key={`${link.label}-${link.url ?? 'none'}`}
                disabled={!link.url}
                onPress={() => insertLink(link.url)}
                accessibilityState={{ disabled: !link.url }}
                style={({ pressed }) => [
                  styles.option,
                  !link.url && styles.optionDisabledRow,
                  pressed && link.url && styles.pressed,
                ]}
              >
                <Feather name="link" size={16} color={link.url ? colors.fgSecondary : colors.fgMuted} />
                <Text style={link.url ? styles.optionLabel : styles.optionOff}>{link.label}</Text>
                {link.hint ? <Text style={styles.optionNote}>{link.hint}</Text> : null}
                {!link.url ? <Text style={styles.optionNote}>not ready</Text> : null}
              </Pressable>
            ))}

            {insertableLinks(links).length === 0 ? (
              <Text style={styles.sheetNote}>No shareable links for this client yet.</Text>
            ) : null}

            <Pressable onPress={() => setLinksOpen(false)} style={styles.done}>
              <Text style={styles.doneLabel}>CANCEL</Text>
            </Pressable>
      </Sheet>

      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)}>
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
      </Sheet>
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
  /*
   * "Sends for real over SMS" — kept, because it is now literally true and
   * it is the last thing between a draft and a client's phone. Styled
   * QUIETLY on purpose: it is a standing fact about the current mode, not
   * a warning to be re-read on every keystroke. The channel dot beside it
   * already carries the colour.
   */
  stripLabel: { ...type.meta, color: colors.fgMuted, flex: 1 },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  dotOff: { opacity: 0.3 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.xs,
    paddingBottom: space.sm,
  },
  input: {
    flex: 1,
    /*
     * §3: fill `chat.surface`, which is DARKER than the raised bar around
     * it — the field is a well cut into the bar, not a panel sitting on
     * it. Height is animated (S3) rather than min/max-clamped, so the
     * bounds live in the handler; `maxHeight` stays as a backstop for the
     * first frame before any measurement has happened.
     */
    maxHeight: COMPOSER_MAX_HEIGHT,
    backgroundColor: chat.surface,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    /* §3: radius 18 — the same curve as a bubble, which is what the
       field is about to become. */
    borderRadius: radius.bubble,
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
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  /* Holds the button's slot steady while it scales in. */
  sendWrap: { marginBottom: 3 },
  send: {
    /*
     * §3: 30pt red circle, white arrow. Was a 40pt gold circle.
     *
     * The red is now PINNED here rather than borrowed from
     * `chat.bubbleOwnBg`. It was the same token, on the argument that the
     * button matched the bubble it produced -- and when rev G reverted
     * the bubbles to gold, that inheritance would have quietly taken the
     * send button with them. The owner's reversal keeps this red: at
     * 30pt it is punctuation-scale brand, the same reading as the CHAT
     * fab, which is the one place CLAUDE.md still sanctions a red fill.
     */
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendPressed: { opacity: 0.8 },

  sheetEyebrow: { marginTop: space.md, marginBottom: space.xs },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md - 2 },
  optionLabel: { ...type.body, color: colors.fgSecondary, flex: 1 },
  optionLabelActive: { color: colors.fg },
  optionOff: { ...type.body, color: colors.fgMuted, flex: 1 },
  optionDisabledRow: { opacity: 0.6 },
  optionNote: { ...type.meta, color: colors.fgMuted },
  sheetNote: { ...type.small, color: colors.fgMuted, marginTop: space.md },
  done: { marginTop: space.lg, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.accent },
  pressed: { opacity: 0.6 },
});
