import type { ConversationListItem, ConversationViewerState } from '@ink-manager/shared-types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { ConversationRow } from '@/components/ConversationRow';
import { ConversationSwipe } from '@/components/ConversationSwipe';
import { EmptySearchStart } from '@/components/EmptySearchStart';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { closeOpenSwipeRow, consumeTapIfRowOpen, openSwipeRow } from '@/lib/swipeRegistry';
import { TopBar } from '@/components/TopBar';
import { ThreadListControls } from '@/components/ThreadListControls';
import { SkeletonList } from '@/components/Skeleton';
import { Appear } from '@/components/Appear';
import { StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import {
  archiveConversation,
  fetchConversations,
  isMuted,
  setConversationMuted,
  setConversationViewerState,
} from '@/lib/conversations';
import { ApiError } from '@/lib/api';
import { publishChatUnread } from '@/lib/chatUnread';
import {
  applyControls,
  isSearchable,
  filterScope,
  type ThreadFilter,
  type ThreadSort,
} from '@/lib/conversationListControls';
import { screenErrorMessage } from '@/lib/screenError';
import { LIST_INSET, LIST_LABEL_INSET, LIST_SEPARATOR_INSET } from '@/theme/listMetrics';
import { colors, fonts, space, type } from '@/theme';

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

/** A section label or a thread — see `sections` for why they share a list. */
type ListRow =
  | { kind: 'label'; label: string }
  | { kind: 'item'; item: ConversationListItem };

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
        const next = await fetchConversations(token, {
          ...(activeSearch ? { search: activeSearch } : {}),
          ...(filterScope(filter) ? { type: filterScope(filter) } : {}),
        });
        if (seq !== requestRef.current) return;
        setItems(next);
        /*
         * §8 rev F: the CHAT fab's badge, published from the list's own
         * refresh path rather than fetched a second time. One source,
         * three consumers -- see lib/chatUnread.ts.
         *
         * Deliberately NOT published while a search is narrowing the
         * list: a badge that counts search results is not a badge.
         */
        if (!activeSearch) publishChatUnread(next);
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
    // Clients/Team are SERVER parameters, so changing the filter to one
    // of them has to refetch -- they are not local predicates over the
    // list already held.
  }, [token, activeSearch, filter]);

  /*
   * Refetch on focus (coming back from a thread, where sending a message
   * has almost certainly reordered the list) and poll while focused only.
   *
   * DEPENDS ON `load`, NOT `[token]`, and that is a real fix rather than
   * hygiene. `load` closes over the request's parameters; with `[token]`
   * the interval kept the FIRST closure forever, so every poll refetched
   * with the parameters that were current at mount and overwrote whatever
   * the list was actually showing.
   *
   * Caught by the scope control, where it is immediate and obvious:
   * picking Team fetched `?type=STAFF`, then the next poll fetched
   * `/conversations` with no type at all and put all 84 threads back.
   * But it was ALREADY the behaviour for `search` -- type a term, wait
   * for the poll, and the results were silently replaced by the full
   * list. That was live before this session; the filter only made it
   * visible.
   */
  useFocusEffect(
    useCallback(() => {
      load('poll');
      const timer = setInterval(() => load('poll'), LIST_POLL_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  useEffect(() => () => void ++requestRef.current, []);

  /*
   * A brief line under the controls, for the two things a swipe can say
   * that a re-rendered row cannot: the pin cap, and a failure.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3200);
  }, []);
  useEffect(() => () => void (noticeTimer.current && clearTimeout(noticeTimer.current)), []);

  /**
   * Apply the server's own answer to one row.
   *
   * The response carries the saved `viewerState`, so this writes what the
   * server stored rather than what was asked for -- which is the whole
   * reason there is no optimistic flip here. A pin that appears and then
   * silently vanishes when the cap rejects it is worse than a pin that
   * takes 200ms.
   */
  const applyViewerState = useCallback((id: string, viewerState: ConversationViewerState) => {
    setItems((current) =>
      current === null ? current : current.map((t) => (t.id === id ? { ...t, viewerState } : t)),
    );
  }, []);

  const togglePin = useCallback(
    async (item: ConversationListItem) => {
      if (!token) return;
      try {
        const { viewerState } = await setConversationViewerState(token, item.id, {
          isPinned: !item.viewerState.isPinned,
        });
        applyViewerState(item.id, viewerState);
      } catch (err) {
        // Matched on the CODE, never the message -- the API's own type
        // documentation is explicit about that, because prose changes.
        if (err instanceof ApiError && err.code === 'PIN_LIMIT') {
          say('Three pinned threads is the limit. Unpin one first.');
          return;
        }
        say(screenErrorMessage(err, 'that pin'));
      }
    },
    [token, applyViewerState, say],
  );

  const toggleMute = useCallback(
    async (item: ConversationListItem) => {
      if (!token) return;
      const muted = isMuted(item.viewerState);
      try {
        const { viewerState } = await setConversationMuted(token, item.id, !muted);
        applyViewerState(item.id, viewerState);
        // Worth saying out loud, because the row deliberately does NOT go
        // quiet: a mute suppresses the interruption, not the indicator, so
        // the unread dot keeps accruing and nothing else on screen changes.
        say(muted ? 'Unmuted.' : 'Muted. You still see new messages, you just are not pinged.');
      } catch (err) {
        say(screenErrorMessage(err, 'that mute'));
      }
    },
    [token, applyViewerState, say],
  );

  const archive = useCallback(
    async (item: ConversationListItem) => {
      if (!token) return;
      try {
        await archiveConversation(token, item.id);
        // Studio-wide: it leaves everyone's default list, so it leaves
        // this one immediately rather than waiting for the next poll.
        setItems((current) => (current === null ? current : current.filter((t) => t.id !== item.id)));
        say('Archived for the whole studio. Reversible from the archived filter.');
      } catch (err) {
        say(screenErrorMessage(err, 'that archive'));
      }
    },
    [token, say],
  );

  // §8: archive is staff-only for anything but an artist's own STAFF
  // thread, and the API answers 403 otherwise. Better to not draw the
  // button than to draw one that fails.
  const role = session?.profile.role;
  const canArchive = useCallback(
    (item: ConversationListItem) =>
      role === 'OWNER' ||
      role === 'FRONT_DESK' ||
      (item.type === 'STAFF' && item.staffUserId === session?.profile.id),
    [role, session?.profile.id],
  );

  const unread = items?.reduce((n, c) => n + (c.unreadCount > 0 ? 1 : 0), 0) ?? 0;
  /*
   * §8 rev G — the outside tap, background half.
   *
   * The ROW's press handler consumes taps that land on a row
   * (`consumeTapIfRowOpen`). This catches everything else inside the list:
   * a section label, the gap under a short list.
   *
   * A TAP gesture and not a touch-down handler, and the distinction is the
   * whole design. `onStartShouldSetResponderCapture` was tried first and
   * is wrong: it fires the instant a finger lands, so putting a finger on
   * an already-open row to drag it further would snap it shut under the
   * hand. `Gesture.Tap()` only recognises when the finger LIFTS having
   * barely moved, so a drag never triggers it and the pan keeps the touch.
   *
   * It writes the registry's shared value directly on the UI thread, so
   * no row re-renders to close — the render counter stays at 0.
   */
  /*
   * Who already has a thread, so §8 rev G's CTA never offers to "start"
   * a conversation that exists. Built from the FULL loaded list rather
   * than the filtered one — a thread hidden by the current search still
   * counts as existing.
   */
  const counterpartIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items ?? []) {
      if (item.clientId) ids.add(item.clientId);
      const counterpartId = (item.counterpart as { id?: string } | null)?.id;
      if (counterpartId) ids.add(counterpartId);
    }
    return ids;
  }, [items]);

  const outsideTap = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(8)
        .onEnd(() => {
          'worklet';
          if (openSwipeRow.value !== '') openSwipeRow.value = '';
        }),
    [],
  );

  const visible = useMemo(() => applyControls(items ?? [], filter, sort), [items, filter, sort]);

  /*
   * §8: PINNED first under its own label, then CONVERSATIONS.
   *
   * The labels are rows in the same list rather than SectionList
   * sections. A SectionList would give sticky headers, and a header that
   * sticks is a header that can end up saying PINNED over a run of
   * unpinned threads while you scroll -- which is worse than no label.
   *
   * Pin state comes from `viewerState.isPinned`, the server's per-user
   * record, so it survives a reinstall. There is no local stand-in: §8 is
   * explicit that a pin which vanishes is a broken promise.
   */
  const sections = useMemo<ListRow[]>(() => {
    const pinned = visible.filter((t) => t.viewerState.isPinned);
    const rest = visible.filter((t) => !t.viewerState.isPinned);
    const rows: ListRow[] = [];
    // The PINNED label only appears when something is pinned; an empty
    // section header is an instruction nobody asked for.
    if (pinned.length > 0) {
      rows.push({ kind: 'label', label: 'PINNED' });
      for (const item of pinned) rows.push({ kind: 'item', item });
    }
    if (rest.length > 0) {
      // With nothing pinned the list needs no heading at all -- it is
      // just the conversations, and saying so would be furniture.
      if (pinned.length > 0) rows.push({ kind: 'label', label: 'CONVERSATIONS' });
      for (const item of rest) rows.push({ kind: 'item', item });
    }
    return rows;
  }, [visible]);
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

      {notice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {items === null && error === null ? (
        <SkeletonList rows={7} />
      ) : (
        <GestureDetector gesture={outsideTap}>
        <FlatList
          data={sections}
          /*
            §8 ORDER: search -> controls -> PINNED -> CONVERSATIONS.

            The FREQUENT strip is gone. It was five faces of "recently
            active", which is what the list underneath it already showed,
            in the same order -- so the top of the screen said the same
            thing twice and the second saying cost a row of avatars.
            Pinned threads are this screen's quick access now, and unlike
            frequency they are a choice someone made.
          */
          /*
            §8 rev F: scrolling closes whatever is open. On the UI thread
            via the registry, so a scroll never re-renders a row to do it.
          */
          onScrollBeginDrag={closeOpenSwipeRow}
          keyExtractor={(row) => (row.kind === 'label' ? `label:${row.label}` : row.item.id)}
          renderItem={({ item: row, index }) =>
            row.kind === 'label' ? (
              <Text style={styles.sectionLabel}>{row.label}</Text>
            ) : (
              <Appear index={index}>
              <ConversationSwipe
                rowId={row.item.id}
                pinned={row.item.viewerState.isPinned}
                muted={isMuted(row.item.viewerState)}
                canArchive={canArchive(row.item)}
                onTogglePin={() => togglePin(row.item)}
                onToggleMute={() => toggleMute(row.item)}
                onArchive={() => archive(row.item)}
              >
                <ConversationRow
                  item={row.item}
                  viewerUserId={session?.profile.id}
                  // Object form, not a template string: typed routes describe a
                  // dynamic route by its literal `[id]` pathname plus params,
                  // so an interpolated href is (correctly) rejected.
                  onPress={() => {
                    // §8 rev G: a tap with a row open is spent closing it.
                    // This covers both halves of the ruling — tapping ANOTHER
                    // row never opens that thread, and tapping the open row's
                    // own front just closes it.
                    if (consumeTapIfRowOpen()) return;
                    router.push({ pathname: '/conversation/[id]', params: { id: row.item.id } });
                  }}
                />
              </ConversationSwipe>
              </Appear>
            )
          }
          /*
            No rule above a section label or below the last row of a
            section -- the label already separates them, and a hairline
            plus a label is two dividers doing one job.
          */
          ItemSeparatorComponent={({ leadingItem }: { leadingItem?: ListRow }) =>
            leadingItem?.kind === 'label' ? null : <View style={styles.separator} />
          }
          contentContainerStyle={sections.length === 0 ? styles.emptyContainer : undefined}
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
              /*
                §8 rev G. Branch (A): the find-or-create path is real, so a
                search that matches a PERSON without a thread offers to
                start one rather than dead-ending. See EmptySearchStart for
                which branch shipped and why, and for why an ARTIST sees
                the text-only version.
              */
              <EmptySearchStart
                token={token ?? ''}
                studioId={session?.profile.studioId ?? ''}
                role={session?.profile.role}
                query={activeSearch}
                existingCounterpartIds={counterpartIds}
                onOpened={(id) =>
                  router.push({ pathname: '/conversation/[id]', params: { id } })
                }
              />
            ) : filter !== 'all' ? (
              /* Named per filter, because "No conversations yet" while a
                 filter is hiding threads would be a lie about the rest. */
              <StateMessage
                eyebrow="Nothing here"
                title={
                  filter === 'unread'
                    ? 'Nothing unread'
                    : filter === 'needsAction'
                      ? 'Nothing waiting on you'
                      : filter === 'CLIENT'
                        ? 'No client threads'
                        : 'No team threads'
                }
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
        </GestureDetector>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  /* §8: inset 76 — where the text starts, so the rule divides the content
     rather than boxing the avatars. */
  separator: { height: 1, backgroundColor: colors.borderSoft, marginLeft: LIST_SEPARATOR_INSET },
  /* §8: Jura 10, .2em tracking, 22pt inset. */
  sectionLabel: {
    ...type.label,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.fgMuted,
    paddingHorizontal: LIST_LABEL_INSET,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },

  notice: {
    paddingHorizontal: LIST_INSET,
    paddingVertical: space.sm,
    backgroundColor: colors.surfaceRaised,
  },
  noticeText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.fgSecondary },
});
