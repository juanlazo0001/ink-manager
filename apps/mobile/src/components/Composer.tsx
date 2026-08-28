import { CLIENT_CHANNELS, type ClientChannel } from '@ink-manager/shared-types';
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
import { PortfolioContent } from '@/components/PortfolioPicker';
import { resetAttachTrace, traceAttach, type AttachSurface } from '@/lib/attachTrace';
import { fetchMessageTemplates, type MessageTemplate } from '@/lib/conversations';
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
/**
 * Vertical padding, derived rather than chosen: `(36 − 23) / 2`, the
 * space left over once one line of `type.message` sits inside the resting
 * height. Fractional on purpose — rounding to 6 or 7 would put the line
 * half a point off centre, and a text field is the one place that shows.
 */
const COMPOSER_LINE_PAD = (COMPOSER_MIN_HEIGHT - type.message.lineHeight) / 2;

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
  conversationId,
  canReadContext,
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
  /** The thread, for the portfolio picker's assigned-artist default. */
  conversationId?: string;
  /** OWNER/FRONT_DESK: `/conversations/:id/context` refuses anyone else. */
  canReadContext?: boolean;
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
  /*
   * ─── THE ONE PLACE THE DRAFT IS WRITTEN, AND WHY THAT MATTERS ───
   *
   * `bodyRef` mirrors the draft for `onContentSize`, which cannot read
   * `body` (see its own note: the size event fires before React commits).
   * The ref used to be written only on the paths a KEYSTROKE takes —
   * `onChangeBody`, the edit seed, and the post-send clear — while
   * `insertTemplate` and `insertLink` wrote the draft through here and
   * left the ref stale.
   *
   * That was not a cosmetic lag. `onContentSize` pins the height to the
   * minimum when the ref looks empty, and `onContentSizeChange` fires
   * only when the content size CHANGES — so inserting a template into an
   * empty field fired the one event carrying the new height, had it
   * thrown away, and then never fired again. The field stayed at 36
   * around three lines of text until something else altered the wrap.
   * Typing did not reliably fix it: a keystroke that does not add a line
   * changes no size and sends no event.
   *
   * So the write lives here, where every source already passes —
   * keystroke, template, link, paste, edit-seed, send-clear. No caller
   * needs to remember, and there are no per-source special cases to keep
   * in step.
   */
  const setBody = (next: string | ((current: string) => string)) => {
    setBodyState((current) => {
      const value = (typeof next === 'function' ? next(current ?? '') : next) ?? '';
      /*
       * A ref write inside a state updater, which React may invoke twice
       * in StrictMode. Safe because it is IDEMPOTENT: the same `current`
       * yields the same `value`, so a second invocation writes the same
       * string. It sits here rather than outside because the functional
       * form's result is only knowable with `current` in hand, and
       * computing it twice — once for the ref, once for the state — is
       * the version that could actually disagree.
       */
      bodyRef.current = value;
      return value;
    });
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  /*
   * ─── ONE HOST, SWAPPING CONTENT (session 17) ──────────────────────
   *
   * This was five independent booleans driving five `<Sheet>`s, and
   * every menu item did `setSourceOpen(false)` and `setSomethingElse(true)`
   * IN THE SAME TICK. `Sheet` deliberately keeps its Modal mounted for
   * `duration.slow` after `visible` goes false (so a dismissal can be
   * seen rather than cut off at frame zero), so for ~300ms after every
   * tap there were TWO RN `<Modal>`s alive: one dismissing, one
   * presenting.
   *
   * On iOS that is the presentation deadlock — presenting while a
   * dismissal is in flight silently wedges the queue, the app renders
   * normally and stops accepting touches. On react-native-web those are
   * two divs and nothing races, which is exactly why three
   * preview-verified fixes never touched it.
   *
   * The fix is structural, and the app already contained its own proof:
   * `MessageOverlay` — the long-press system, stable on device — is ALSO
   * an RN Modal, but it presents ONE and swaps its contents (tapback
   * row, lifted clone, action sheet) inside it. It never dismisses a
   * modal to present another. That is the difference, not Modal-vs-not.
   *
   * So: one `<Sheet>`, and `attachView` names what is inside it.
   * Switching between in-app surfaces is now a content swap with no
   * dismount/present cycle at all — there is no second modal to race.
   */
  const [attachView, setAttachView] = useState<AttachSurface | null>(null);
  const [links, setLinks] = useState<ShareableLinks | null>(null);
  /*
   * The ONE thing that still needs a true dismissal first: the native
   * picker is a real iOS modal, so it cannot be presented over a sheet
   * that is still going away. It is staged here and launched from the
   * host's `onDismissed` — the completion signal — never from the tap.
   */
  const pendingLaunch = useRef<'library' | 'camera' | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
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
    // `setBody` keeps `bodyRef` in step — see its note.
    setBody(editingMessageId ? (editingInitialBody ?? '') : '');
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
    (sendState.channel === 'SMS' || sendState.channel === 'EMAIL') &&
    !unavailableChannels.has(sendState.channel);

  function onChangeBody(next: string) {
    setBody(next);
  }

  function submit() {
    if (!canSubmit) return;
    // §10: impactLight on send. Fired before the state changes so the tick
    // lands with the tap, not after the round trip.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSend(body.trim(), editing ? [] : attachments.uploadedUrls);
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
  /*
   * Closes the sequence for whichever in-app surface is now up. It runs
   * after the render that mounted it, which for a content swap IS the
   * moment it is on screen and touchable — there is no presentation
   * animation to wait on, because nothing was presented.
   *
   * A freeze would therefore show `present-called` with no `presented`
   * following it, and the surface's name says which one stalled.
   */
  useEffect(() => {
    if (!attachView) return;
    traceAttach('presented', attachView);
    traceAttach('interaction-ready', attachView);
  }, [attachView]);

  /** A content swap: no dismissal, so nothing to race. */
  function showAttachView(next: AttachSurface) {
    traceAttach('item-selected', next);
    traceAttach('present-called', next, 'content swap, host stays mounted');
    setAttachView(next);
  }

  function closeAttach() {
    if (attachView) traceAttach('dismiss-start', attachView);
    setAttachView(null);
  }

  /*
   * Fired by the host when the Modal is REALLY gone. Anything that
   * presents a native surface waits for this.
   */
  function onAttachDismissed() {
    traceAttach('dismissed', 'menu');
    const launch = pendingLaunch.current;
    pendingLaunch.current = null;
    if (launch === 'library') void runLibrary();
    else if (launch === 'camera') void runCamera();
    else resetAttachTrace();
  }

  async function openLinks() {
    showAttachView('links');
    if (links || !token || !clientId) return;
    try {
      setLinks(await fetchShareableLinks(token, clientId));
    } catch {
      // The sheet stays open and shows its empty state; a failed link
      // lookup is not worth an alert over an optional convenience.
    }
  }

  /*
   * Same on-demand shape as `openLinks` above, and for the same reason:
   * the studio settings row is not worth fetching on every thread open
   * when the menu is what needs it. Cached for the composer's life.
   */
  async function openTemplates() {
    showAttachView('templates');
    if (templates || !token) return;
    try {
      setTemplates(await fetchMessageTemplates(token));
    } catch {
      // The sheet shows its empty line rather than an alert, matching
      // how the links sheet treats a failed lookup.
      setTemplates([]);
    }
  }

  /*
   * Web appends the body with a newline and performs NO variable
   * substitution (`ConversationsPanel.tsx:3644`). There are no
   * placeholder semantics in the store to mirror, so inventing any here
   * would be inventing product.
   */
  function insertTemplate(template: MessageTemplate) {
    setBody((current) => (current ? `${current}\n${template.body}` : template.body));
    closeAttach();
  }

  function insertLink(url: string | null | undefined) {
    // A row with no url is rendered disabled, so this should not fire —
    // but it stays a no-op rather than a crash if it ever does.
    if (!url) return;
    setBody((current) => appendLink(current, url));
    closeAttach();
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
  /*
   * Stage, then close. The launch happens in `onAttachDismissed`.
   * Session 09 fixed the sheet being left MOUNTED after this race; this
   * removes the race itself, so the two fixes are complementary rather
   * than one superseding the other.
   */
  function addFromLibrary() {
    traceAttach('item-selected', 'library');
    pendingLaunch.current = 'library';
    closeAttach();
  }

  function addFromCamera() {
    traceAttach('item-selected', 'camera');
    pendingLaunch.current = 'camera';
    closeAttach();
  }

  async function runLibrary() {
    traceAttach('present-called', 'library', 'native picker, after dismissal');
    try {
      if (!(await ensureLibraryPermission())) {
        Alert.alert('Photos access needed', 'Allow photo access in Settings to attach an image.');
        return;
      }
      const image = await pickImage();
      traceAttach('presented', 'library', image ? 'image chosen' : 'cancelled');
      if (image) attachments.add(image);
    } catch (err) {
      Alert.alert('Could not open your photos', pickerErrorMessage(err));
    } finally {
      traceAttach('interaction-ready', 'library');
      resetAttachTrace();
    }
  }

  async function runCamera() {
    traceAttach('present-called', 'camera', 'native camera, after dismissal');
    try {
      if (!(await ensureCameraPermission())) {
        Alert.alert('Camera access needed', 'Allow camera access in Settings to take a photo.');
        return;
      }
      const image = await captureImage();
      traceAttach('presented', 'camera', image ? 'image captured' : 'cancelled');
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
            {wouldSendLive
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
            onPress={() => {
              traceAttach('item-selected', 'menu', 'plus tapped');
              traceAttach('present-called', 'menu');
              setAttachView('menu');
            }}
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

      {/*
        ─── THE ONE HOST ────────────────────────────────────────────────
        One `<Sheet>` for the whole attach flow. `attachView` names its
        contents; moving between them is a content swap, so no dismissal
        is ever in flight while something else presents. See the note on
        `attachView` above for why that is the fix rather than a tidy-up.
      */}
      <Sheet
        visible={attachView !== null}
        onClose={closeAttach}
        onDismissed={onAttachDismissed}
        accessibilityLabel="Close the attach menu"
      >
        {attachView === 'links' ? (
          <>
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

            <Pressable onPress={closeAttach} style={styles.done}>
              <Text style={styles.doneLabel}>CANCEL</Text>
            </Pressable>
          </>
        ) : attachView === 'templates' ? (
          <>
            <Eyebrow style={styles.sheetEyebrow}>Insert template</Eyebrow>

            {templates === null ? (
              <Text style={styles.sheetNote}>Loading…</Text>
            ) : templates.length === 0 ? (
              /* Web's own copy, which names where they are configured
                 rather than leaving a blank menu. */
              <Text style={styles.sheetNote}>No templates configured (Settings → Policies &amp; Defaults).</Text>
            ) : (
              templates.map((template) => (
                <Pressable
                  key={template.id}
                  onPress={() => insertTemplate(template)}
                  accessibilityRole="button"
                  accessibilityLabel={`Insert template ${template.name}`}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                >
                  <Feather name="file-text" size={16} color={colors.fgSecondary} />
                  <Text style={styles.optionLabel} numberOfLines={1}>
                    {template.name}
                  </Text>
                </Pressable>
              ))
            )}

            <Pressable onPress={closeAttach} style={styles.done}>
              <Text style={styles.doneLabel}>CANCEL</Text>
            </Pressable>
          </>
        ) : attachView === 'portfolio' && conversationId ? (
          <PortfolioContent
            token={token}
            conversationId={conversationId}
            canReadContext={!!canReadContext}
            onPick={(url) => {
              attachments.addRemote(url);
              closeAttach();
            }}
            onCancel={closeAttach}
          />
        ) : (
          <>
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
                CLIENT threads only, because the links belong to a client.
                Web's own label is "Attach link" — adopted here so the two
                clients name the same control the same way. */}
            {clientId ? (
              <Pressable onPress={openLinks} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
                <Feather name="link" size={16} color={colors.fgSecondary} />
                <Text style={styles.optionLabel}>Attach link</Text>
              </Pressable>
            ) : null}

            {clientId ? (
              <Pressable onPress={openTemplates} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
                <Feather name="file-text" size={16} color={colors.fgSecondary} />
                <Text style={styles.optionLabel}>Insert template</Text>
              </Pressable>
            ) : null}

            {clientId && conversationId ? (
              <Pressable
                onPress={() => showAttachView('portfolio')}
                style={({ pressed }) => [styles.option, pressed && styles.pressed]}
              >
                <Feather name="grid" size={16} color={colors.fgSecondary} />
                <Text style={styles.optionLabel}>Add from Portfolio</Text>
              </Pressable>
            ) : null}

            <Pressable onPress={closeAttach} style={styles.done}>
              <Text style={styles.doneLabel}>CANCEL</Text>
            </Pressable>
          </>
        )}
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

            {/*
              §3 rev G: the DIRECTION control ("We are writing" / "Logging
              what they said") is REMOVED. It was a testing artifact -- it
              let anyone write a message into the thread attributed to the
              CLIENT, which is a record-keeping decision, not a composer
              setting, and one no real workflow had asked for.

              The API's `direction` parameter stays and still accepts
              INBOUND; this client just always sends OUTBOUND now. A
              deliberate manual-logging design can pick it up later --
              spec §3 rev G is the note to read first.
            */}

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
    /*
     * ─── THE DESCENDER CLIP, AND WHY IT WAS INVISIBLE ───────────
     *
     * This read `...type.body, fontSize: 16`. `type.body` is Outfit
     * **15/21** — so the spread brought a line box measured for 15px type,
     * the next line raised the glyphs to 16px, and nothing raised the box
     * with them. 21pt of line for 16pt Outfit clips the descenders: the
     * placeholder rendered as "Messag̶e̶", and every g/j/p/q/y the user
     * typed lost its tail too.
     *
     * `type.message` is the design system's own Outfit-16 pairing —
     * **16/23**, the size the bubbles use. Spreading it instead of
     * patching `type.body` fixes the box by construction rather than by
     * a second override that could drift again, and it is the apt token:
     * this field is about to become a message (see the radius note).
     */
    ...type.message,
    paddingHorizontal: space.md,
    /*
     * (36 − 23) / 2 = 6.5, which centres one 23pt line inside the spec's
     * 36pt resting height with nothing clipped at either end. It was
     * 10 + 10, which only fitted because the line box was two points
     * too short.
     */
    paddingTop: COMPOSER_LINE_PAD,
    paddingBottom: COMPOSER_LINE_PAD,
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
