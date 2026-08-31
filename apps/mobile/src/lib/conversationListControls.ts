import type { ConversationListItem } from '@ink-manager/shared-types';

/**
 * The thread list's filter and sort, mirroring web's own.
 *
 * Search is deliberately NOT here: it is a server parameter
 * (`GET /conversations?search=`), because it also matches message
 * CONTENT, which this client has never fetched. Filtering titles locally
 * would look like search and quietly miss every thread whose match is in
 * the messages — worse than not offering it.
 */

/**
 * One list, both axes — OWNER DECISION, and it costs something worth
 * naming.
 *
 * The first version made scope its own segmented control precisely so the
 * two axes could compose: "unread" WITHIN "Clients". Folding them into a
 * single dropdown makes them mutually exclusive, so that combination is
 * no longer askable. That is the owner's call and it is the shape web's
 * own users are used to asking one question at a time.
 *
 * `all` therefore means no filter of either kind, which is why it reads
 * unambiguously at the top of one list.
 *
 * CLIENT and STAFF are SERVER parameters (`GET /conversations?type=`),
 * not local predicates, and that is load-bearing: the route maps `STAFF`
 * to `{ type: { in: [STAFF, GROUP] } }`, because a group thread is a
 * staff 1:1 that grew a third member via @mention and has no option of
 * its own. Filtering locally on `type === 'STAFF'` would look right and
 * silently drop every group.
 */
export type ThreadFilter = 'all' | 'unread' | 'needsAction' | 'CLIENT' | 'STAFF';

/** The two that go to the server rather than filtering in place. */
export const SCOPE_FILTERS = ['CLIENT', 'STAFF'] as const;

export function filterScope(filter: ThreadFilter): 'CLIENT' | 'STAFF' | undefined {
  return filter === 'CLIENT' || filter === 'STAFF' ? filter : undefined;
}

export type ThreadSort = 'recent' | 'oldest' | 'unread' | 'name';

export const THREAD_FILTERS: { key: ThreadFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'needsAction', label: 'Needs action' },
  { key: 'CLIENT', label: 'Clients' },
  /* Web's own label for the STAFF tab, and what the studio calls these
     people everywhere else in the app. */
  { key: 'STAFF', label: 'Team' },
];

export const THREAD_SORTS: { key: ThreadSort; label: string }[] = [
  { key: 'recent', label: 'Most recent' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'unread', label: 'Unread first' },
  { key: 'name', label: 'Name A–Z' },
];

/**
 * Web's `archived` quick filter is omitted. It is a separate server-side
 * bucket rather than a view of the same list — archived threads are not
 * in the default response at all — so offering it as a chip beside the
 * two that ARE client-side filters would imply it costs nothing and
 * behaves the same. Worth adding deliberately, with its own fetch.
 */

/**
 * "Something is waiting on the studio": an unread message, or a featured
 * inquiry parked in a stage where the studio, not the client, moves next.
 * The status list is web's own.
 */
const NEEDS_ACTION_STATUSES = ['NEW', 'BUDGET_NEGOTIATION'];

export function applyFilter(threads: ConversationListItem[], filter: ThreadFilter): ConversationListItem[] {
  /* CLIENT and STAFF are already applied by the server, which is the only
     place that knows STAFF also means GROUP. Re-filtering here would
     either duplicate that rule or contradict it. */
  if (filter === 'CLIENT' || filter === 'STAFF') return threads;
  switch (filter) {
    case 'unread':
      return threads.filter((t) => t.unreadCount > 0);
    case 'needsAction':
      return threads.filter(
        (t) =>
          t.unreadCount > 0 ||
          (t.primaryInquiry != null && NEEDS_ACTION_STATUSES.includes(t.primaryInquiry.status)),
      );
    default:
      return threads;
  }
}

/** `lastMessageAt` is null on a thread with no messages; it sorts oldest. */
function stamp(thread: ConversationListItem): number {
  return thread.lastMessageAt ? new Date(thread.lastMessageAt).getTime() : 0;
}

export function applySort(threads: ConversationListItem[], sort: ThreadSort): ConversationListItem[] {
  // Copied before sorting: the API's own ordering is what a caller gets
  // back from the fetch, and mutating it in place would leave the source
  // list permanently re-ordered by whatever was last selected.
  const out = [...threads];
  switch (sort) {
    case 'oldest':
      return out.sort((a, b) => stamp(a) - stamp(b));
    case 'unread':
      // Unread first, most recent within each group.
      return out.sort((a, b) => {
        const aUnread = a.unreadCount > 0;
        const bUnread = b.unreadCount > 0;
        if (aUnread !== bUnread) return aUnread ? -1 : 1;
        return stamp(b) - stamp(a);
      });
    case 'name':
      return out.sort((a, b) => (a.counterpart?.name ?? '').localeCompare(b.counterpart?.name ?? ''));
    case 'recent':
    default:
      return out.sort((a, b) => stamp(b) - stamp(a));
  }
}

export function applyControls(
  threads: ConversationListItem[],
  filter: ThreadFilter,
  sort: ThreadSort,
): ConversationListItem[] {
  return applySort(applyFilter(threads, filter), sort);
}

/**
 * The API ignores a search below two characters, so sending one would
 * quietly return the unfiltered list while the field looks active.
 */
export function isSearchable(term: string): boolean {
  return term.trim().length >= 2;
}
