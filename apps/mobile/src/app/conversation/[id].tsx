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
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, withSpring } from 'react-native-reanimated';

import { ScreenShell } from '@/components/ScreenShell';
import { Composer, type ComposerSendState } from '@/components/Composer';
import { MessageActions } from '@/components/MessageActions';
import { PhotoViewer, type ViewerImage } from '@/components/PhotoViewer';
import { channelLabel } from '@/components/ConversationRow';
import { MessageBubble, REVEAL_WIDTH, messageImages } from '@/components/MessageBubble';
import { ScreenHeader } from '@/components/ScreenHeader';
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
import { buildThreadRows, type DisplayMessage, type Row } from '@/lib/threadRows';
import { colors, hairline, radius, space, type } from '@/theme';

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
  const revealPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-14, 14])
        .failOffsetY([-12, 12])
        .onUpdate((event) => {
          revealX.value = Math.max(-REVEAL_WIDTH, Math.min(0, event.translationX));
        })
        .onEnd(() => {
          // Springs home the moment you let go — Messages never latches
          // this open, and a latched state would need a way to close it.
          revealX.value = withSpring(0, { damping: 22, stiffness: 220, mass: 0.6 });
        }),
    [revealX],
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
  const handleSaveImage = useCallback(async (url: string) => {
    const result = await saveImageToLibrary(url);
    setSaveNote(result.ok ? 'Saved to your photos' : result.message);
    setTimeout(() => setSaveNote(null), 2600);
  }, []);

  const doSend = useCallback(
    async (body: string, attachments: string[] = [], retryOf?: DisplayMessage) => {
      if (!token || !id) return;
      // Captured before the optimistic row is built, and cleared straight
      // away so a slow send can't attach the quote to the NEXT message too.
      const replyToId = retryOf ? (retryOf.replyToId ?? undefined) : (replyTo?.id ?? undefined);
      setReplyTo(null);

      const tempId = retryOf?.id ?? `local:${Date.now()}:${Math.random().toString(36).slice(2)}`;
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
  const rows = useMemo(
    () => buildThreadRows({ messages, viewerUserId, isClientThread, isGroupThread }),
    [messages, viewerUserId, isClientThread, isGroupThread],
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
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        onBack={() => router.back()}
        right={<View style={styles.headerSpacer} />}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <GestureDetector gesture={revealPan}>
        <FlatList
          ref={listRef}
          inverted
          data={rows}
          keyExtractor={(row) => (row.kind === 'day' ? row.key : row.message.id)}
          renderItem={({ item }) =>
            item.kind === 'day' ? (
              /* Day chips stay put while the thread slides — Messages
                 shows these persistently, and they belong to the thread
                 rather than to any one bubble. */
              <View style={styles.daySeparator}>
                <View style={styles.dayRule} />
                <Text style={styles.dayLabel}>{item.label.toUpperCase()}</Text>
                <View style={styles.dayRule} />
              </View>
            ) : (
              <MessageBubble
                message={item.message}
                own={item.own}
                showMeta={item.showMeta}
                showAuthor={item.showAuthor}
                grouped={item.grouped}
                revealX={revealX}
                onRetry={() => doSend(item.message.body, item.message.attachments ?? [], item.message)}
                onOpenImage={(urls, index) =>
                  setLightbox({ images: urls.map((url) => ({ url })), index })
                }
                viewerUserId={viewerUserId}
                onScrollToMessage={scrollToMessage}
                onLongPress={
                  // A message that never reached the server has no id to
                  // act on, and a shared-inquiry card is not a bubble with
                  // a body worth quoting -- web excludes it the same way.
                  item.message.status === 'sent' && !item.message.metadata?.kind
                    ? () => {
                        setCopiedId(null);
                        setActionFor(item.message);
                      }
                    : undefined
                }
              />
            )
          }
          contentContainerStyle={[styles.listContent, rows.length === 0 && styles.listEmpty]}
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

        {saveNote ? (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastLabel}>{saveNote}</Text>
          </View>
        ) : null}

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
      </KeyboardAvoidingView>

      <MessageActions
        visible={!!actionFor}
        onClose={() => setActionFor(null)}
        myReaction={
          actionFor ? ((actionFor.reactions ?? []).find((r) => r.userId === viewerUserId)?.emoji ?? null) : null
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
          setActionFor(null);
          void handleSaveImage(url);
        }}
        onReact={(emoji) => actionFor && handleReact(actionFor, emoji)}
        onReply={() => {
          setReplyTo(actionFor);
          setEditing(null);
          setActionFor(null);
        }}
        onCopy={() => actionFor && handleCopy(actionFor)}
        onEdit={() => {
          setEditing(actionFor);
          setReplyTo(null);
          setActionFor(null);
        }}
      />

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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerSpacer: { width: 36 },
  centre: { flex: 1, justifyContent: 'center' },
  listContent: { paddingVertical: space.md },
  listEmpty: { flexGrow: 1, justifyContent: 'center', transform: [{ scaleY: -1 }] },
  daySeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  dayRule: { flex: 1, height: hairline, backgroundColor: colors.borderSoft },
  dayLabel: { ...type.label, color: colors.fgMuted },
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
