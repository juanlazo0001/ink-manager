import type {
  ClientChannel,
  ConversationThreadHeader,
  Message,
  MessageDirection,
} from '@ink-manager/shared-types';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useKeyboardHandler } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { motion, REDUCED_MS, S1, S2, S4, useReducedMotion } from '@/theme/chatMotion';
import { useChatDevToggles } from '@/lib/chatDevToggles';

import { ScreenShell } from '@/components/ScreenShell';
import { Composer, type ComposerSendState } from '@/components/Composer';
import { MessageActions } from '@/components/MessageActions';
import { MessageOverlay } from '@/components/MessageOverlay';
import { Tapback } from '@/components/Tapback';
import { FlyTarget } from '@/components/FlyTarget';
import { ScrollToBottomPill } from '@/components/ScrollToBottomPill';
import { TypingRow } from '@/components/TypingRow';
import { hapticAction, hapticFailed, hapticLift, primeFailureLatch } from '@/lib/chatHaptics';
import { deliveryState } from '@/lib/deliveryStatus';
import { SendFly, type Rect } from '@/components/SendFly';
import { rowScreenRect, type RowBox } from '@/lib/threadGeometry';
import { PhotoViewer, type ViewerImage } from '@/components/PhotoViewer';
import { channelLabel } from '@/components/ConversationRow';
import { MessageBubble, REVEAL_WIDTH, messageImages } from '@/components/MessageBubble';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ThreadHeader } from '@/components/ThreadHeader';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { ApiError } from '@/lib/api';
import { screenErrorMessage } from '@/lib/screenError';
import {
  clearReaction,
  editMessage,
  isMessageEdited,
  fetchIntegrationStatus,
  fetchThread,
  markConversationRead,
  sendMessage,
  setReaction,
  type ReactionEmoji,
} from '@/lib/conversations';
import { saveImageToLibrary } from '@/lib/saveImage';
import { isProviderFailure } from '@/lib/deliveryStatus';
import { buildThreadRows, isOwnSide, type DisplayMessage, type Row } from '@/lib/threadRows';
import { chat, colors, fonts, hairline, radius, space, type } from '@/theme';

/** See the note in the list screen: polling, not sockets, this session. */
const THREAD_POLL_MS = 30_000;

function threadErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.fromApi && err.status === 404) {
    // The API answers 404 for both "no such thread" and "not yours to
    // see" — deliberately, so it can't be used to probe for threads. The
    // copy has to cover both without guessing which. Guarded on fromApi
    // so Railway's edge 404 never lands here; that is a transient
    // failure, and screenErrorMessage says so.
    return 'This conversation is not available to you.';
  }
  return screenErrorMessage(err, 'this conversation');
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const viewerUserId = session?.profile.id ?? '';

  const [header, setHeader] = useState<ConversationThreadHeader | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  // Lifted out of the bubble so the viewer can page across every image in
  // the tapped message, the way web's lightbox does.
  const [lightbox, setLightbox] = useState<{ images: ViewerImage[]; index: number } | null>(null);
  // The message whose action sheet is open, plus the three modes those
  // actions can put the composer into.
  const [actionFor, setActionFor] = useState<DisplayMessage | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<DisplayMessage | null>(null);
  const [editing, setEditing] = useState<DisplayMessage | null>(null);
  const listRef = useRef<FlatList<Row>>(null);
  const insets = useSafeAreaInsets();
  const devToggles = useChatDevToggles();
  const flyReduced = useReducedMotion();
  // Same hook, read where the gesture is built: §10 requires the OS
  // setting to be live, not a value captured once at module load.
  const revealReduced = flyReduced;

  /*
   * §10 SEND-FLY. Three-step, because a bubble cannot be flown to a place
   * that has not been laid out yet:
   *
   *   1. on submit, measure the composer field  → `from`
   *   2. append the optimistic row as usual (silently — no animation)
   *   3. that row measures itself on layout      → `to`, and the clone flies
   *
   * `pendingFly` holds steps 1–2; `fly` is the live animation. The real
   * row is invisible while its clone is in the air, so the two never
   * both show.
   */
  const [pendingFly, setPendingFly] = useState<{ id: string; body: string; from: Rect } | null>(null);
  const [fly, setFly] = useState<{ id: string; body: string; from: Rect; to: Rect } | null>(null);
  const composerRef = useRef<View>(null);

  const measureComposer = useCallback(
    () =>
      new Promise<Rect | null>((resolve) => {
        const node = composerRef.current;
        if (!node) return resolve(null);
        node.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
      }),
    [],
  );

  const listBoxRef = useRef<View>(null);

  /*
   * §7 needs a long-pressed row's screen rect, and the row cannot be
   * asked for it -- see lib/threadGeometry.ts. These are the two inputs
   * that arithmetic needs, kept in refs because they change on every
   * scroll frame and nothing should re-render for them.
   */
  const rowBoxes = useRef(new Map<string, RowBox>());
  const scrollOffset = useRef(0);
  const [overlayRect, setOverlayRect] = useState<Rect | null>(null);
  /*
   * The clone is NOT part of the thread, so it must not slide with the
   * drag-to-reveal gesture. A separate value, permanently 0, rather than
   * making revealX optional on MessageBubble -- one caller wanting a
   * different behaviour is not a reason to make the prop nullable for
   * every other caller.
   */
  const cloneStill = useSharedValue(0);

  /** Resolve the pressed row to screen coordinates, or give up quietly. */
  const openOverlayFor = useCallback((message: DisplayMessage) => {
    const box = rowBoxes.current.get(message.id);
    const node = listBoxRef.current;
    if (!box || !node) return;
    node.measureInWindow((x, y, width, height) => {
      if (width === 0 && height === 0) return;
      hapticLift();
      setOverlayRect(rowScreenRect({ x, y, width, height }, box, scrollOffset.current));
      setCopiedId(null);
      setActionFor(message);
    });
  }, []);

  const closeOverlay = useCallback(() => {
    setActionFor(null);
    setOverlayRect(null);
  }, []);

  /*
   * The flight itself is driven from here, not from SendFly: the clone is
   * mounted for the animation's own duration, and an animation started by
   * a component that unmounts 380ms later is fragile by construction.
   * These two live for the whole conversation.
   */
  const flyProgress = useSharedValue(0);
  const flyFade = useSharedValue(1);

  /**
   * The optimistic row reports its SIZE; where it sits is derived from the
   * list's own window rect and the fact that an inverted list is
   * bottom-anchored. See FlyTarget's header for why the row is not asked
   * for its position directly -- through the inverted list's scaleY(-1)
   * that answer is the mirrored, pre-transform one.
   */
  const onFlyTargetMeasured = useCallback((id: string, size: { width: number; height: number }) => {
    const node = listBoxRef.current;
    if (!node) return;
    node.measureInWindow((listX, listY, listWidth, listHeight) => {
      if (listWidth === 0 && listHeight === 0) return;
      const to: Rect = {
        x: listX,
        // LIST_CONTENT_PAD is the contentContainer's own paddingVertical,
        // which an inverted list renders as the gap below the newest row.
        y: listY + listHeight - LIST_CONTENT_PAD - size.height,
        width: listWidth,
        height: size.height,
      };
      setPendingFly((p) => {
        if (!p || p.id !== id) return p;
        setFly({ ...p, to });
        return null;
      });
    });
  }, []);

  /*
   * Take-off, once the destination is known. §10: an S4 spring for the
   * travel, and the hand-off at ~70% -- the clone fades over the last
   * third while the real row fades up underneath it, so there is never a
   * frame with two bubbles or none, which is what a straight swap at the
   * end looks like on a slow frame.
   */
  useEffect(() => {
    if (!fly) return;
    flyProgress.value = 0;
    flyFade.value = 1;
    if (flyReduced) {
      // §10 reduced motion: no travel. The clone appears at the
      // destination and cross-fades, so the message still visibly
      // arrives -- it just does not fly there.
      flyProgress.value = 1;
      flyFade.value = withTiming(0, { duration: 150 });
    } else {
      flyProgress.value = motion(1, S4, false);
      flyFade.value = withDelay(250, withTiming(0, { duration: 130 }));
    }
    const done = setTimeout(() => setFly(null), flyReduced ? 160 : 380);
    return () => clearTimeout(done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fly, flyReduced]);

  /*
   * ITEM 2 — drag the thread left to read the clock.
   *
   * ONE shared value for the whole list rather than one per row: every
   * bubble slides by the same amount, so per-row state would be N copies
   * of one number and N subscriptions to update per frame.
   *
   * The gesture has to lose to the FlatList, not fight it. `activeOffsetX`
   * means it only claims the touch after a clear horizontal intent, and
   * `failOffsetY` hands it back the moment the finger goes vertical —
   * without that pair, a normal scroll would jiggle the thread sideways.
   *
   * Left only (`Math.min(0, …)`): there is nothing revealed on the right,
   * and a bubble that can be dragged away from its own edge feels broken.
   */
  const revealX = useSharedValue(0);

  /*
   * §4 — THE COMPOSER RIDES THE KEYBOARD, PER FRAME.
   *
   * `useKeyboardHandler` runs on the UI thread, so `keyboardHeight` is
   * current for the frame being drawn rather than one React commit behind.
   * That difference is the whole distinction between a bar glued to the
   * keyboard and a bar chasing it — and it is why this is a shared value
   * and not React state.
   *
   * `onMove` is what makes INTERACTIVE dismissal work: during a drag-down
   * the OS reports the keyboard's live position frame by frame, so the
   * same subscription that handles open/close also handles the finger.
   * Nothing extra is wired for it.
   */
  const keyboardHeight = useSharedValue(0);
  useKeyboardHandler(
    {
      onMove: (event) => {
        'worklet';
        keyboardHeight.value = event.height;
      },
      onEnd: (event) => {
        'worklet';
        keyboardHeight.value = event.height;
      },
    },
    [],
  );

  /*
   * Translate, not padding. A transform runs on the UI thread with no
   * relayout; animating `paddingBottom` per frame would re-measure an
   * inverted FlatList sixty times a second while the keyboard moves.
   *
   * The subtraction is the bottom safe area: with the keyboard CLOSED the
   * composer needs `insets.bottom` to clear the home indicator, and with
   * it OPEN the keyboard already covers that strip. So the static padding
   * stays and the travel is only the part the keyboard adds on top of it.
   * Clamped at 0 so a keyboard shorter than the inset never pushes the
   * bar downward.
   *
   * §5 bottom-anchoring falls out of this for free: the list is inverted,
   * so its newest message is pinned to the container's bottom edge and
   * simply travels with it. No scroll offset is touched, so there is no
   * jump and nothing to restore on close.
   */
  const ridesKeyboard = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboardHeight.value - insets.bottom) }],
  }));

  /*
   * §9: the context-chip row collapses on scroll-down and returns on
   * scroll-up. Driven by DIRECTION, not absolute offset — an absolute
   * threshold would leave the chips hidden forever once you were deep in
   * history, and the whole point is that they come back when you reach for
   * them. The list is inverted, so "scrolling down through history" is a
   * RISING contentOffset.
   */
  const chipCollapse = useSharedValue(0);
  const lastScrollY = useSharedValue(0);

  /*
   * §5 SCROLL-TO-BOTTOM PILL.
   *
   * The list is inverted, so contentOffset 0 IS the bottom and the 200pt
   * rule reads directly off the offset -- no content-height arithmetic,
   * nothing to keep in sync as the thread grows. That is the whole reason
   * rev E pinned the inverted list as implementation truth.
   *
   * `pillShown` is a shared value because this is decided on every frame
   * of a drag; through React state it would re-render the entire thread
   * sixty times a second while someone scrolls.
   *
   * `awayFromBottom` mirrors it as a ref for the JS side to read when a
   * message arrives -- a ref rather than state for the same reason.
   */
  const pillShown = useSharedValue(0);
  const awayFromBottom = useRef(false);
  const [unseenCount, setUnseenCount] = useState(0);
  /** Every message id this screen has ever been handed. */
  const seenIds = useRef(new Set<string>());
  /** Those that turned up AFTER the first load -- the ones that may pop. */
  const arrivedIds = useRef(new Set<string>());

  const onThreadScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      const y = event.nativeEvent.contentOffset.y;
      // Exact, every event -- the pill's dead-band below is a display
      // decision, and §7's geometry needs the real number.
      scrollOffset.current = y;
      const dy = y - lastScrollY.value;
      // A dead-band, so a thumb resting on the list does not flicker it.
      if (Math.abs(dy) > 6) {
        chipCollapse.value = withSpring(dy > 0 ? 1 : 0, S2);
        lastScrollY.value = y;
      }

      const away = y > PILL_THRESHOLD;
      if (away !== awayFromBottom.current) {
        awayFromBottom.current = away;
        pillShown.value = withSpring(away ? 1 : 0, S2);
        // Back at the bottom is the definition of having seen them.
        if (!away) setUnseenCount(0);
      }
    },
    [chipCollapse, lastScrollY, pillShown],
  );

  /** The pill's tap, and what every "go to newest" path should call. */
  const jumpToNewest = useCallback(() => {
    hapticAction();
    // Offset 0 on an inverted list is the newest message.
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    awayFromBottom.current = false;
    pillShown.value = withSpring(0, S2);
    setUnseenCount(0);
  }, [pillShown]);
  const revealPan = useMemo(
    () =>
      Gesture.Pan()
        /*
         * Activation offsets are AE's and stay AE's: horizontal intent has
         * to win before this moves at all (|dx| > |dy| in the first 10pt,
         * §2.3), and vertical scroll is never hijacked. Retuning them was
         * not asked for and every change here is one that has to be
         * re-earned against a thumb on a real phone.
         */
        .activeOffsetX([-14, 14])
        .failOffsetY([-12, 12])
        .onUpdate((event) => {
          /*
           * §2.3 RESISTANCE. The thread follows the finger at 0.55, so
           * REVEAL_WIDTH of travel costs ~153pt of drag. Without it the
           * gesture hits its stop almost immediately and the last two
           * thirds of the drag do nothing -- the hand keeps moving and the
           * screen has stopped, which reads as a bug rather than a limit.
           */
          revealX.value = Math.max(-REVEAL_WIDTH, Math.min(0, event.translationX * REVEAL_RESISTANCE));
        })
        .onEnd(() => {
          // Springs home the moment you let go — Messages never latches
          // this open, and a latched state would need a way to close it.
          // S2 (§10) is the settle preset every snap-back in this screen
          // uses; the hand-tuned numbers here predated the preset layer.
          revealX.value = motion(0, S2, revealReduced);
        }),
    [revealX, revealReduced],
  );
  const [unavailableChannels, setUnavailableChannels] = useState<Set<string>>(new Set());
  const [sendState, setSendState] = useState<ComposerSendState>({ channel: 'SMS', direction: 'OUTBOUND' });

  const isClientThread = header?.type === 'CLIENT';
  const isGroupThread = header?.type === 'GROUP';
  const canSendLive = header?.callerPermissions?.includes('conversations.sendLive') ?? false;
  // An archived thread is hidden from the list, not frozen — the API still
  // accepts messages and un-archives on the first one. So this is a label,
  // never a lock.
  const archived = !!header?.archivedAt;

  const requestRef = useRef(0);
  // Optimistic rows live here, keyed by their temporary id, so a poll
  // landing mid-send cannot wipe a message the user can still see.
  const pendingRef = useRef<Map<string, DisplayMessage>>(new Map());
  const channelDefaultedRef = useRef(false);

  const mergeServerMessages = useCallback((serverMessages: Message[], mode: 'replace' | 'prepend') => {
    const asDisplay: DisplayMessage[] = serverMessages.map((m) => ({ ...m, status: 'sent' }));

    /*
     * §5/§10: what is NEW here, and did it arrive while the reader was up
     * in history?
     *
     * `seenIds` is the memory that makes both questions answerable. On the
     * first load every message is "new" and none of it should pop or count
     * -- opening a thread is not twelve messages arriving -- so the first
     * pass only records. A prepend is history by definition and never
     * counts either.
     */
    if (mode === 'replace') {
      const first = seenIds.current.size === 0;
      const fresh = asDisplay.filter((m) => !seenIds.current.has(m.id));
      for (const m of asDisplay) seenIds.current.add(m.id);
      if (!first && fresh.length > 0) {
        for (const m of fresh) arrivedIds.current.add(m.id);
        const incoming = fresh.filter((m) => m.direction === 'INBOUND').length;
        if (incoming > 0 && awayFromBottom.current) setUnseenCount((n) => n + incoming);
      }
    } else {
      for (const m of asDisplay) seenIds.current.add(m.id);
    }

    setMessages((current) => {
      if (mode === 'prepend') return [...asDisplay, ...current];
      // A replace keeps any still-pending or failed local rows pinned to
      // the end — they have no server counterpart yet by definition.
      const localOnly = current.filter((m) => m.status !== 'sent' && pendingRef.current.has(m.id));
      return [...asDisplay, ...localOnly];
    });
  }, []);

  const loadNewest = useCallback(
    async (mode: 'initial' | 'refresh' | 'poll') => {
      if (!token || !id) return;
      const seq = ++requestRef.current;
      if (mode === 'refresh') setRefreshing(true);

      try {
        const data = await fetchThread(token, id);
        if (seq !== requestRef.current) return;
        setHeader(data.conversation);
        setNextCursor(data.nextCursor);
        mergeServerMessages(data.messages, 'replace');
        setError(null);

        // Mirrors the web composer: start from the channel the thread last
        // actually used (IN_APP is meaningless on a client thread, so it
        // maps to INSTAGRAM there), otherwise the SMS default. Done once
        // per thread so it never yanks the picker out from under someone
        // mid-poll.
        if (!channelDefaultedRef.current && data.conversation.type === 'CLIENT') {
          channelDefaultedRef.current = true;
          const last = data.messages[data.messages.length - 1];
          if (last) {
            setSendState((s) => ({
              ...s,
              channel: (last.channel === 'IN_APP' ? 'INSTAGRAM' : last.channel) as ClientChannel,
            }));
          }
        }
      } catch (err) {
        if (seq !== requestRef.current) return;
        if (mode === 'poll' && header !== null) return;
        setError(threadErrorMessage(err));
      } finally {
        if (seq === requestRef.current && mode === 'refresh') setRefreshing(false);
      }
    },
    [token, id, header, mergeServerMessages],
  );

  const loadOlder = useCallback(async () => {
    if (!token || !id || !nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await fetchThread(token, id, nextCursor);
      setNextCursor(data.nextCursor);
      mergeServerMessages(data.messages, 'prepend');
    } catch {
      // Failing to load older history leaves what is already on screen
      // intact; the user can pull again. Not worth an error banner over
      // the thread they are reading.
    } finally {
      setLoadingOlder(false);
    }
  }, [token, id, nextCursor, loadingOlder, mergeServerMessages]);

  useEffect(() => {
    loadNewest('initial');
    if (token && id) markConversationRead(token, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  useEffect(() => {
    const timer = setInterval(() => loadNewest('poll'), THREAD_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  useEffect(() => {
    if (!token || !isClientThread) return;
    fetchIntegrationStatus(token)
      .then((status) => {
        const off = new Set<string>();
        if (!status.sms) off.add('SMS');
        if (!status.email) off.add('EMAIL');
        if (!status.instagram) off.add('INSTAGRAM');
        if (!status.facebook) off.add('FACEBOOK');
        setUnavailableChannels(off);
        // Same fallback the web app uses: if the selected channel turns
        // out to have no live integration, drop to PHONE, which was never
        // an integration and is always selectable.
        setSendState((s) => (off.has(s.channel) ? { ...s, channel: 'PHONE' } : s));
      })
      .catch(() => {
        // Unknown status means "assume selectable" — the API is the real
        // gate and will reject anything it won't accept.
      });
  }, [token, isClientThread]);

  useEffect(() => () => void ++requestRef.current, []);

  /** ITEM 3 — quick-save, from the long-press sheet and the viewer. */
  const [saveNote, setSaveNote] = useState<string | null>(null);
  /** §2.4: tapping a failed message opens a sheet, never a silent resend. */
  const handleSaveImage = useCallback(async (url: string) => {
    const result = await saveImageToLibrary(url);
    setSaveNote(result.ok ? 'Saved to your photos' : result.message);
    setTimeout(() => setSaveNote(null), 2600);
  }, []);

  /**
   * §2.2: the delivery status line renders under the LAST outgoing
   * message only. Computed once per render off the same array the rows
   * come from, so it cannot disagree with them.
   */
  const lastOutgoingId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (isOwnSide(messages[i], viewerUserId, isClientThread)) return messages[i].id;
    }
    return null;
  }, [messages, viewerUserId, isClientThread]);

  const doSend = useCallback(
    async (body: string, attachments: string[] = [], retryOf?: DisplayMessage) => {
      if (!token || !id) return;
      // Captured before the optimistic row is built, and cleared straight
      // away so a slow send can't attach the quote to the NEXT message too.
      const replyToId = retryOf ? (retryOf.replyToId ?? undefined) : (replyTo?.id ?? undefined);
      setReplyTo(null);

      const tempId = retryOf?.id ?? `local:${Date.now()}:${Math.random().toString(36).slice(2)}`;

      /*
       * Measured BEFORE the optimistic row exists: once the list grows the
       * composer has already been pushed, and the fly would start from
       * where the field ended up rather than where the text was typed.
       * A retry never flies — nothing was just committed.
       */
      if (!retryOf && body.trim() && devToggles.sendFly) {
        const from = await measureComposer();
        if (from) setPendingFly({ id: tempId, body: body.trim(), from });
      }
      const optimistic: DisplayMessage = {
        id: tempId,
        channel: isClientThread ? sendState.channel : 'IN_APP',
        direction: isClientThread ? sendState.direction : 'OUTBOUND',
        body,
        // Already-uploaded Cloudinary URLs, so the optimistic bubble shows
        // the real images immediately rather than a placeholder.
        attachments: attachments.length > 0 ? attachments : null,
        metadata: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        studioId: header?.id ?? '',
        conversationId: id,
        authorUserId: viewerUserId,
        author: session ? { id: viewerUserId, name: session.profile.name, email: session.profile.email } : null,
        replyToId: replyToId ?? null,
        replyTo: replyToId ? (replyTo ?? retryOf?.replyTo ?? null) : null,
        reactions: [],
        status: 'pending',
      };

      pendingRef.current.set(tempId, optimistic);
      setMessages((current) => {
        const without = current.filter((m) => m.id !== tempId);
        return [...without, optimistic];
      });
      setSending(true);

      try {
        const created = await sendMessage(token, id, {
          body,
          ...(replyToId ? { replyToId } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(isClientThread ? { channel: sendState.channel, direction: sendState.direction } : {}),
        });
        pendingRef.current.delete(tempId);
        setMessages((current) => current.map((m) => (m.id === tempId ? { ...created, status: 'sent' } : m)));
      } catch {
        // A message that fails must stay visible and stay marked — never
        // disappear, and never look sent. The body is preserved on the row
        // itself so a retry needs no re-typing.
        const failed: DisplayMessage = { ...optimistic, status: 'failed' };
        pendingRef.current.set(tempId, failed);
        setMessages((current) => current.map((m) => (m.id === tempId ? failed : m)));
      } finally {
        setSending(false);
      }
    },
    [token, id, isClientThread, sendState, header, viewerUserId, session, replyTo],
  );

  /**
   * Replace one message in place, used by every action that returns the
   * updated message. Keyed by id rather than index because the list is
   * rebuilt from `messages` on every change.
   */
  const replaceMessage = useCallback((updated: Message) => {
    setMessages((current) =>
      current.map((m) => (m.id === updated.id ? { ...updated, status: 'sent' } : m)),
    );
  }, []);

  /**
   * Reactions are an upsert of ONE reaction per person per message, so
   * tapping the emoji already chosen clears it and tapping a different one
   * replaces it -- never stacks. Both cases return the updated message.
   */
  const handleReact = useCallback(
    async (message: DisplayMessage, emoji: ReactionEmoji) => {
      if (!token || !id) return;
      const mine = (message.reactions ?? []).find((r) => r.userId === viewerUserId);
      setActionFor(null);
      try {
        const updated =
          mine?.emoji === emoji
            ? await clearReaction(token, id, message.id)
            : await setReaction(token, id, message.id, emoji);
        replaceMessage(updated);
      } catch (err) {
        Alert.alert('Reaction', screenErrorMessage(err, "That reaction didn't save."));
      }
    },
    [token, id, viewerUserId, replaceMessage],
  );

  const handleCopy = useCallback(async (message: DisplayMessage) => {
    await Clipboard.setStringAsync(message.body);
    setCopiedId(message.id);
  }, []);

  const handleSubmitEdit = useCallback(
    async (message: DisplayMessage, body: string) => {
      if (!token || !id) return;
      setEditing(null);
      try {
        replaceMessage(await editMessage(token, id, message.id, body));
      } catch (err) {
        Alert.alert('Edit', screenErrorMessage(err, "That edit didn't save."));
      }
    },
    [token, id, replaceMessage],
  );

  // Built by a pure helper (src/lib/threadRows.ts) rather than inline, so
  // the inverted-list day-separator and burst rules are verifiable without
  // rendering anything.
  /*
   * §10: the FAILED haptic, and nothing else about failure, lives here.
   *
   * It fires on a TRANSITION into failure, once per message id ever --
   * see chatHaptics.ts for why that is the only defensible rule. The
   * first pass primes the latch instead of firing, so a thread opened on
   * a week-old failure is silent, and the poll re-delivering the same
   * failed row is silent for the same reason.
   */
  const failuresPrimed = useRef(false);
  useEffect(() => {
    const failedIds = messages
      .filter((m) => deliveryState(m) === 'FAILED')
      .map((m) => m.id);
    if (!failuresPrimed.current) {
      failuresPrimed.current = true;
      primeFailureLatch(failedIds);
      return;
    }
    for (const id of failedIds) hapticFailed(id);
  }, [messages]);

  const rows = useMemo(
    () => buildThreadRows({ messages, viewerUserId, isClientThread, isGroupThread }),
    [messages, viewerUserId, isClientThread, isGroupThread],
  );

  /** The pressed message's own row entry, so the clone copies its flags. */
  const overlayRow = useMemo(
    () =>
      actionFor
        ? (rows.find((r) => r.kind === 'message' && r.message.id === actionFor.id) as
            | Extract<Row, { kind: 'message' }>
            | undefined)
        : undefined,
    [rows, actionFor],
  );

  /**
   * Jump to a quoted message. The list is inverted, so its index in `rows`
   * is already the visual one; a message that has scrolled out of the
   * loaded window simply is not there, and nothing happens rather than
   * jumping somewhere wrong.
   */
  const scrollToMessage = useCallback(
    (messageId: string) => {
      const index = rows.findIndex((r) => r.kind === 'message' && r.message.id === messageId);
      if (index >= 0) listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    },
    [rows],
  );

  const title = header?.counterpart?.name ?? 'Conversation';
  /*
   * The channel the header names. A CLIENT thread's identity is whatever
   * it last spoke on; a STAFF/GROUP thread is always IN_APP by
   * construction (the API forces it).
   */
  const threadChannel = isClientThread
    ? (messages[messages.length - 1]?.channel ?? sendState.channel)
    : 'IN_APP';
  const subtitle = header
    ? [
        header.type === 'CLIENT' ? 'Client' : header.type === 'GROUP' ? 'Group' : 'Team',
        archived ? 'Archived' : null,
        header.primaryInquiry ? header.primaryInquiry.status.replace(/_/g, ' ').toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  if (header === null && error === null) {
    return (
      <ScreenShell edges={['top']}>
        <ScreenHeader title="Conversation" onBack={() => router.back()} right={<View style={styles.headerSpacer} />} />
        <ScreenLoading />
      </ScreenShell>
    );
  }

  if (header === null) {
    return (
      <ScreenShell edges={['top']}>
        <ScreenHeader title="Conversation" onBack={() => router.back()} right={<View style={styles.headerSpacer} />} />
        <View style={styles.centre}>
          <StateMessage
            eyebrow="Not loaded"
            tone="alert"
            title={error ?? 'Something went wrong.'}
            action={{ label: 'Try again', onPress: () => loadNewest('refresh') }}
          />
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell edges={['top']}>
      {/*
        §9. Replaces the generic ScreenHeader on this screen only: chat
        needs a translucent unit carrying identity, channel and the context
        chips, and the shared header has no concept of any of that.
      */}
      <ThreadHeader
        header={header}
        channel={threadChannel}
        collapse={chipCollapse}
        onBack={() => router.back()}
        onPressInquiry={(inquiryId) =>
          router.push({ pathname: '/staff-inquiry/[id]', params: { id: inquiryId } })
        }
      />

      {/*
        §4: no `KeyboardAvoidingView` anywhere in the chat stack. It
        animates on its own schedule rather than the keyboard's, and it
        cannot follow an interactive drag at all — which is the acceptance
        requirement for this part.
      */}
      <Animated.View style={[styles.flex, { paddingBottom: insets.bottom }, ridesKeyboard]}>
        {/*
          Measured for the send-fly's destination. It sits OUTSIDE the
          list's inverted transform, so its window rect is the honest one.
        */}
        <View ref={listBoxRef} collapsable={false} style={styles.flex}>
        <GestureDetector gesture={revealPan}>
        <FlatList
          ref={listRef}
          inverted
          data={rows}
          keyExtractor={(row) => (row.kind === 'separator' ? row.key : row.message.id)}
          /*
            §7 needs a row's position in CONTENT coordinates, and the
            obvious place to take it -- an onLayout on the row itself --
            gives the wrong box: `layout` is relative to the immediate
            parent, and FlatList wraps every row in a cell of its own, so
            every row reported y ~ 0. The clone then landed at the bottom
            of the list whatever was pressed (measured: 272.5pt low for a
            row four up).

            CellRendererComponent is the public hook for exactly this. The
            cell IS the content container's child, so its `layout.y` is
            the number the mapping in lib/threadGeometry.ts wants -- and
            being layout rather than a window position, the inverted
            list's transform does not touch it.
          */
          CellRendererComponent={({ item: cellItem, children, ...rest }) => (
            <View
              {...rest}
              onLayout={(event) => {
                if (cellItem.kind !== 'message') return;
                const { y, height } = event.nativeEvent.layout;
                rowBoxes.current.set(cellItem.message.id, { y, height });
              }}
            >
              {children}
            </View>
          )}
          renderItem={({ item }) =>
            item.kind === 'separator' ? (
              /*
                §2.2: a CENTRED separator — bold day word, regular time —
                every time more than an hour passes. AE drew a ruled
                day-change divider instead; the spec's is quieter and
                fires on time gaps, so a long morning and a long afternoon
                on one day are two blocks rather than one wall of bubbles.

                It stays put while the thread slides sideways: separators
                belong to the thread, not to any one bubble.
              */
              <View style={styles.separator}>
                <Text style={styles.separatorText}>
                  <Text style={styles.separatorDay}>{item.day}</Text>
                  <Text>{'  '}</Text>
                  <Text>{item.time}</Text>
                </Text>
              </View>
            ) : (
              <Animated.View
                /*
                  §10 S1 pop, and only for a message that ARRIVED -- never
                  for the twelve already on screen when the thread opened,
                  and never again when a poll re-delivers the same row.
                  Reduced motion drops it to a plain fade.
                */
                entering={
                  arrivedIds.current.has(item.message.id)
                    ? flyReduced
                      ? FadeIn.duration(REDUCED_MS)
                      : ZoomIn.springify().stiffness(S1.stiffness!).damping(S1.damping!)
                    : undefined
                }
              >
              <FlyTarget
                messageId={item.message.id}
                active={pendingFly?.id === item.message.id}
                hidden={fly?.id === item.message.id}
                onMeasured={onFlyTargetMeasured}
              >
              <MessageBubble
                message={item.message}
                own={item.own}
                showMeta={item.showMeta}
                showAuthor={item.showAuthor}
                grouped={item.grouped}
                lastInGroup={item.lastInGroup}
                attribution={item.attribution}
                isLastOutgoing={item.message.id === lastOutgoingId}
                revealX={revealX}
                // The failed-row affordance and the long-press open the
                // SAME surface now. Two sheets saying the same thing about
                // the same message is exactly the drift this series has
                // been undoing; §2.4's items live in one place.
                onRetry={() => openOverlayFor(item.message)}
                onOpenImage={(urls, index) =>
                  setLightbox({ images: urls.map((url) => ({ url })), index })
                }
                viewerUserId={viewerUserId}
                onScrollToMessage={scrollToMessage}
                onLongPress={
                  // A shared-inquiry card is not a bubble with a body
                  // worth quoting -- web excludes it the same way. A
                  // FAILED message DOES get the overlay now: §2.4 rev E
                  // gives it its own class-appropriate items, which is
                  // what generalising this sheet was for.
                  item.message.metadata?.kind ? undefined : () => openOverlayFor(item.message)
                }
              />
              </FlyTarget>
              </Animated.View>
            )
          }
          /*
            §6: a REAL list row, not an overlay -- it has to push the
            thread the way an arriving message does, or the message that
            follows it appears to jump. Inverted list, so the header
            renders at the bottom, below the newest message.

            Dormant: nothing in production sets this toggle, because the
            investigation found no typing signal anywhere to drive it
            with, and §6 forbids simulating one.
          */
          ListHeaderComponent={devToggles.typing ? <TypingRow reduced={flyReduced} /> : null}
          contentContainerStyle={[styles.listContent, rows.length === 0 && styles.listEmpty]}
          /*
            §4 INTERACTIVE DISMISSAL. This is a native ScrollView
            behaviour, and it is deliberately the only thing wired for it:
            dragging toward the keyboard drags the keyboard with the
            finger, the OS reports each position through the handler above,
            and the composer follows because it is already bound to that
            height. Releasing mid-way completes or cancels — the OS
            decides, exactly as it does in Messages.
          */
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onScroll={onThreadScroll}
          scrollEventThrottle={16}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingOlder ? (
              <View style={styles.olderSpinner}>
                <ActivityIndicator color={colors.accent} size="small" />
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadNewest('refresh')}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListEmptyComponent={
            <StateMessage
              eyebrow="Empty"
              title="Nothing said yet"
              body={
                isClientThread
                  ? 'Write the first message, or log one that already happened elsewhere.'
                  : 'Start the thread.'
              }
            />
          }
        />
        </GestureDetector>
        {/*
          Inside the LIST's box, not the outer container: `bottom` here
          means "just above the composer". Anchored to the container it
          sat behind the composer instead -- measured at y=752 with the
          composer occupying 725-800.

          That box is inside the keyboard-translated container, so the pill
          still rides up with everything else when the keyboard opens.
        */}
        <ScrollToBottomPill shown={pillShown} count={unseenCount} onPress={jumpToNewest} />
        </View>

        {saveNote ? (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastLabel}>{saveNote}</Text>
          </View>
        ) : null}

        <View ref={composerRef} collapsable={false}>
        <Composer
          isClientThread={isClientThread}
          sendState={sendState}
          onChangeSendState={setSendState}
          unavailableChannels={unavailableChannels}
          canSendLive={canSendLive}
          onSend={(body, attachments) =>
            editing ? handleSubmitEdit(editing, body) : doSend(body, attachments)
          }
          sending={sending}
          token={token}
          // The links belong to the client, so only a CLIENT thread has any.
          clientId={header?.clientId ?? null}
          replyPreview={
            replyTo
              ? {
                  author: replyTo.author?.name ?? replyTo.author?.email ?? 'Message',
                  body: replyTo.body,
                }
              : null
          }
          onCancelReply={() => setReplyTo(null)}
          editingMessageId={editing?.id ?? null}
          editingInitialBody={editing?.body ?? ''}
          onCancelEdit={() => setEditing(null)}
        />
        </View>
      </Animated.View>

      {/*
        §10: a sibling of the keyboard-translated container, in screen
        coordinates. Inside it, the clone would inherit the keyboard's
        translateY and fly to the wrong place whenever the keyboard was
        open — which is every send.
      */}
      {fly ? (
        <SendFly body={fly.body} from={fly.from} to={fly.to} progress={flyProgress} fade={flyFade} />
      ) : null}

      {/*
        §7. The overlay owns the scrim, the lifted clone and the dismissal;
        MessageActions is now just the panel that sits under it. That split
        is what let the FAILED cases join the same surface instead of
        needing a sheet of their own -- see §2.4 rev E below.
      */}
      {actionFor && overlayRect ? (
        <MessageOverlay
          rect={overlayRect}
          reduced={flyReduced}
          onDismiss={closeOverlay}
          /*
            §7 rev D: the tapback goes ABOVE the lifted bubble, aligned to
            the bubble's own side. It is the first thing under the thumb
            when the bubble comes up, which is what makes reacting a
            gesture rather than a menu choice.
          */
          above={
            <Tapback
              own={overlayRow?.own ?? false}
              mine={(actionFor.reactions ?? []).find((r) => r.userId === viewerUserId)?.emoji ?? null}
              reduced={flyReduced}
              onReact={(emoji) => handleReact(actionFor, emoji)}
            />
          }
          bubble={
            <MessageBubble
              message={actionFor}
              /*
                The clone is a COPY, so it is drawn with the row's own
                flags rather than invented ones. `grouped` in particular
                decides the leading margin, and a clone that disagreed
                about it sat 10pt off its own row -- measured, before this.
              */
              own={overlayRow?.own ?? false}
              showMeta={false}
              showAuthor={overlayRow?.showAuthor ?? false}
              grouped={overlayRow?.grouped ?? false}
              lastInGroup={overlayRow?.lastInGroup ?? true}
              attribution={null}
              // The clone is a portrait of ONE message, lifted out of the
              // thread -- the delivery line belongs to the row it came
              // from, which is still on screen underneath.
              isLastOutgoing={false}
              revealX={cloneStill}
              viewerUserId={viewerUserId}
            />
          }
          below={
      <MessageActions
        visible={!!actionFor}
        onClose={closeOverlay}
        failure={
          actionFor && deliveryState(actionFor) === 'FAILED'
            ? isProviderFailure(actionFor)
              ? {
                  kind: 'provider' as const,
                  // Accepted by us, refused by the carrier. There is
                  // nothing local to retry or discard -- the message is
                  // real and it is on the server.
                  explanation:
                    'The carrier could not deliver this. The number may be wrong, disconnected, or blocking texts.',
                }
              : {
                  kind: 'local' as const,
                  explanation: 'This never left the app, so the text is still here.',
                  onRetry: () => {
                    const target = actionFor;
                    closeOverlay();
                    doSend(target.body, target.attachments ?? [], target);
                  },
                  onDiscard: () => {
                    const target = actionFor;
                    closeOverlay();
                    pendingRef.current.delete(target.id);
                    setMessages((current) => current.filter((m) => m.id !== target.id));
                  },
                }
            : null
        }
        // Web's rule exactly: edits are STAFF/GROUP-only and author-only,
        // which is also what the API enforces.
        canEdit={!!actionFor && !isClientThread && actionFor.authorUserId === viewerUserId}
        canCopy={!!actionFor?.body}
        copied={!!actionFor && copiedId === actionFor.id}
        detail={
          actionFor
            ? {
                channel: channelLabel(actionFor.channel),
                sentAt: actionFor.createdAt,
                edited: isMessageEdited(actionFor),
              }
            : null
        }
        images={actionFor ? messageImages(actionFor) : []}
        onSaveImage={(url) => {
          closeOverlay();
          void handleSaveImage(url);
        }}
        onReply={() => {
          setReplyTo(actionFor);
          setEditing(null);
          closeOverlay();
        }}
        onCopy={() => actionFor && handleCopy(actionFor)}
        onEdit={() => {
          setEditing(actionFor);
          setReplyTo(null);
          closeOverlay();
        }}
      />
          }
        />
      ) : null}


      <PhotoViewer
        images={lightbox?.images ?? []}
        initialIndex={lightbox?.index ?? 0}
        visible={!!lightbox}
        onClose={() => setLightbox(null)}
        onSave={(url) => void handleSaveImage(url)}
      />
    </ScreenShell>
  );
}

/** §2.3: the thread follows the finger at this fraction of its travel. */
const REVEAL_RESISTANCE = 0.55;

/** §5: past this many points from the bottom, an arrival must not move the view. */
const PILL_THRESHOLD = 200;

/** Mirrors styles.listContent's paddingVertical -- see onFlyTargetMeasured. */
const LIST_CONTENT_PAD = space.md;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerSpacer: { width: 36 },
  centre: { flex: 1, justifyContent: 'center' },
  listContent: { paddingVertical: space.md },
  listEmpty: { flexGrow: 1, justifyContent: 'center', transform: [{ scaleY: -1 }] },
  /* §2.1: 16 of air around a separator, on both sides. */
  separator: { alignItems: 'center', paddingVertical: 16, paddingHorizontal: space.lg },
  /* §2.2: Jura 11, muted. */
  separatorText: { ...type.label, fontSize: 11, color: chat.textMuted, textAlign: 'center' },
  separatorDay: { fontFamily: fonts.labelBold },
  olderSpinner: { paddingVertical: space.lg, alignItems: 'center' },
  /* Sits above the composer, out of the way of the thumb. */
  toast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.sm,
    alignItems: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  toastLabel: { ...type.small, color: colors.fg },
});
