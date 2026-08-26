import type { ConversationListItem } from '@ink-manager/shared-types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { ConversationRow, CONVERSATION_TEXT_INSET } from '@/components/ConversationRow';
import { FrequentStrip } from '@/components/FrequentStrip';
import { TopBar } from '@/components/TopBar';
import { ThreadListControls } from '@/components/ThreadListControls';
import { SkeletonList } from '@/components/Skeleton';
import { Appear } from '@/components/Appear';
import { StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { fetchConversations } from '@/lib/conversations';
import {
  applyControls,
  isSearchable,
  type ThreadFilter,
  type ThreadSort,
} from '@/lib/conversationListControls';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline } from '@/theme';

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

/**
 * How long typing has to stop before a search is sent. Long enough not to
 * fire a request per keystroke on a phone keyboard, short enough that the
 * list still feels like it is responding to what was typed.
 */
const SEARCH_DEBOUNCE_MS = 350;

export default function ConversationsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // `search` is what has been typed; `activeSearch` is what has actually
  // been sent. Keeping them apart is what makes the debounce visible --
  // the spinner belongs to the gap between the two.
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [filter, setFilter] = useState<ThreadFilter>('all');
  const [sort, setSort] = useState<ThreadSort>('recent');

  useEffect(() => {
    const term = isSearchable(search) ? search.trim() : '';
    if (term === activeSearch) return;
    const timer = setTimeout(() => setActiveSearch(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, activeSearch]);

  // Guards a slow response from a previous load overwriting a newer one,
  // and stops a poll landing after the screen unmounts.
  const requestRef = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'poll') => {
      if (!token) return;
      const seq = ++requestRef.current;
      if (mode === 'refresh') setRefreshing(true);

      try {
        const next = await fetchConversations(token, activeSearch ? { search: activeSearch } : {});
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
    [token, items, activeSearch],
  );

  useEffect(() => {
    load('initial');
    // Deliberately keyed on the token and the ACTIVE search only: `load`
    // changes identity whenever `items` does, and depending on it here
    // would refetch on every response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeSearch]);

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
  const visible = useMemo(() => applyControls(items ?? [], filter, sort), [items, filter, sort]);
  // Typed something worth searching, but the request for it hasn't landed.
  const searching = isSearchable(search) && search.trim() !== activeSearch;

  return (
    <ScreenShell edges={['top']}>
      <TopBar />

      <ThreadListControls
        search={search}
        onSearchChange={setSearch}
        searching={searching}
        filter={filter}
        onFilterChange={setFilter}
        sort={sort}
        onSortChange={setSort}
      />

      {items === null && error === null ? (
        <SkeletonList rows={7} />
      ) : (
        <FlatList
          data={visible}
          // The strip scrolls WITH the list rather than pinning above it:
          // it is a shortcut, not chrome, and a phone screen has no room
          // to spend five permanent rows on one. Search and the filter
          // pills stay pinned above, unchanged.
          ListHeaderComponent={
            // Hidden while a search or filter is narrowing the list --
            // "frequent" is about the whole inbox, and showing it beside
            // filtered results would suggest it had been filtered too.
            activeSearch || filter !== 'all' ? null : (
              <FrequentStrip
                items={items ?? []}
                onOpen={(id) => router.push({ pathname: '/conversation/[id]', params: { id } })}
              />
            )
          }
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <Appear index={index}>
            <ConversationRow
              item={item}
              viewerUserId={session?.profile.id}
              // Object form, not a template string: typed routes describe a
              // dynamic route by its literal `[id]` pathname plus params,
              // so an interpolated href is (correctly) rejected.
              onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: item.id } })}
            />
            </Appear>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={visible.length === 0 ? styles.emptyContainer : undefined}
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
            ) : activeSearch ? (
              <StateMessage
                eyebrow="No matches"
                title={`Nothing matching "${activeSearch}"`}
                body="Search looks at names and message text. Try fewer words."
                action={{ label: 'Clear search', onPress: () => setSearch('') }}
              />
            ) : filter !== 'all' ? (
              <StateMessage
                eyebrow="Nothing here"
                title={filter === 'unread' ? 'Nothing unread' : 'Nothing waiting on you'}
                body="Switch back to All to see every thread."
                action={{ label: 'Show all', onPress: () => setFilter('all') }}
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
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  /*
    SESSION AG sweep. Was `marginLeft: space.lg` — 16pt, the row's own
    padding — on a list whose every row leads with a 42pt avatar. So the
    rule started under the avatars and cut the column of faces in half,
    which is the one thing iOS's list divider never does: in Messages,
    the divider begins where the TEXT begins and the avatar sits in the
    gap before it. 16 + 42 + 12 = 70, imported rather than retyped so it
    cannot drift from the avatar it is measured against.

    `hairline` rather than the literal `1` it used to be, for the same
    reason every other list here uses the token.
  */
  separator: { height: hairline, backgroundColor: colors.borderSoft, marginLeft: CONVERSATION_TEXT_INSET },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
});
