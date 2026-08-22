import type {
  ClientChannel,
  ConversationThreadHeader,
  Message,
  MessageDirection,
} from '@ink-manager/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Composer, type ComposerSendState } from '@/components/Composer';
import { channelLabel } from '@/components/ConversationRow';
import { MessageBubble } from '@/components/MessageBubble';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { ApiError } from '@/lib/api';
import { screenErrorMessage } from '@/lib/screenError';
import { fetchIntegrationStatus, fetchThread, markConversationRead, sendMessage } from '@/lib/conversations';
import { buildThreadRows, type DisplayMessage } from '@/lib/threadRows';
import { colors, hairline, space, type } from '@/theme';

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

  const doSend = useCallback(
    async (body: string, retryOf?: DisplayMessage) => {
      if (!token || !id) return;

      const tempId = retryOf?.id ?? `local:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const optimistic: DisplayMessage = {
        id: tempId,
        channel: isClientThread ? sendState.channel : 'IN_APP',
        direction: isClientThread ? sendState.direction : 'OUTBOUND',
        body,
        attachments: null,
        metadata: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        studioId: header?.id ?? '',
        conversationId: id,
        authorUserId: viewerUserId,
        author: session ? { id: viewerUserId, name: session.profile.name, email: session.profile.email } : null,
        replyToId: null,
        replyTo: null,
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
    [token, id, isClientThread, sendState, header, viewerUserId, session],
  );

  // Built by a pure helper (src/lib/threadRows.ts) rather than inline, so
  // the inverted-list day-separator and burst rules are verifiable without
  // rendering anything.
  const rows = useMemo(
    () => buildThreadRows({ messages, viewerUserId, isClientThread, isGroupThread }),
    [messages, viewerUserId, isClientThread, isGroupThread],
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
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Conversation" onBack={() => router.back()} right={<View style={styles.headerSpacer} />} />
        <ScreenLoading />
      </SafeAreaView>
    );
  }

  if (header === null) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Conversation" onBack={() => router.back()} right={<View style={styles.headerSpacer} />} />
        <View style={styles.centre}>
          <StateMessage
            eyebrow="Not loaded"
            tone="alert"
            title={error ?? 'Something went wrong.'}
            action={{ label: 'Try again', onPress: () => loadNewest('refresh') }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
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
        <FlatList
          inverted
          data={rows}
          keyExtractor={(row) => (row.kind === 'day' ? row.key : row.message.id)}
          renderItem={({ item }) =>
            item.kind === 'day' ? (
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
                onRetry={() => doSend(item.message.body, item.message)}
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

        <Composer
          isClientThread={isClientThread}
          sendState={sendState}
          onChangeSendState={setSendState}
          unavailableChannels={unavailableChannels}
          canSendLive={canSendLive}
          onSend={(body) => doSend(body)}
          sending={sending}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
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
});
