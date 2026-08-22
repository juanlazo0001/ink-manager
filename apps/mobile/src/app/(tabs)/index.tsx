import type { ConversationListItem } from '@ink-manager/shared-types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConversationRow } from '@/components/ConversationRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { fetchConversations } from '@/lib/conversations';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, space } from '@/theme';

/**
 * Refresh strategy, decided in this session's investigation: poll, not
 * sockets.
 *
 * The API does push over Socket.IO, but the event it emits is a generic
 * `invalidate` carrying React Query cache KEYS — it is not a "new message"
 * event and carries no payload. Consuming it here would mean adopting the
 * web app's query-key vocabulary in a client that has no React Query at
 * all, to gain something a 30s poll already covers. Deferred to its own
 * session; see REPORT.md.
 */
const LIST_POLL_MS = 30_000;

export default function ConversationsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Guards a slow response from a previous load overwriting a newer one,
  // and stops a poll landing after the screen unmounts.
  const requestRef = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'poll') => {
      if (!token) return;
      const seq = ++requestRef.current;
      if (mode === 'refresh') setRefreshing(true);

      try {
        const next = await fetchConversations(token);
        if (seq !== requestRef.current) return;
        setItems(next);
        setError(null);
      } catch (err) {
        if (seq !== requestRef.current) return;
        // A failed background poll must not blow away a list that is
        // already on screen and still perfectly readable -- only surface
        // the error when there is nothing to show.
        if (mode === 'poll' && items !== null) return;
        setError(screenErrorMessage(err, 'messages'));
      } finally {
        if (seq === requestRef.current && mode === 'refresh') setRefreshing(false);
      }
    },
    [token, items],
  );

  useEffect(() => {
    load('initial');
    // Deliberately once on mount: `load` changes identity whenever `items`
    // does, and depending on it here would refetch on every response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Refetch on focus (coming back from a thread, where sending a message
  // has almost certainly reordered the list) and poll while focused only.
  useFocusEffect(
    useCallback(() => {
      load('poll');
      const timer = setInterval(() => load('poll'), LIST_POLL_MS);
      return () => clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]),
  );

  useEffect(() => () => void ++requestRef.current, []);

  const unread = items?.reduce((n, c) => n + (c.unreadCount > 0 ? 1 : 0), 0) ?? 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader
        title="Messages"
        subtitle={
          items === null ? undefined : unread > 0 ? `${unread} thread${unread === 1 ? '' : 's'} unread` : 'All caught up'
        }
      />

      {items === null && error === null ? (
        <ScreenLoading />
      ) : (
        <FlatList
          data={items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ConversationRow
              item={item}
              // Object form, not a template string: typed routes describe a
              // dynamic route by its literal `[id]` pathname plus params,
              // so an interpolated href is (correctly) rejected.
              onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: item.id } })}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={(items ?? []).length === 0 ? styles.emptyContainer : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListEmptyComponent={
            error ? (
              <StateMessage
                eyebrow="Not loaded"
                tone="alert"
                title={error}
                body="Nothing has been lost — this is only what this device could fetch."
                action={{ label: 'Try again', onPress: () => load('refresh') }}
              />
            ) : (
              <StateMessage
                eyebrow="Quiet"
                title="No conversations yet"
                body="Threads appear here as soon as someone writes in, or as soon as the front desk logs one."
              />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  separator: { height: 1, backgroundColor: colors.borderSoft, marginLeft: space.lg },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
});
