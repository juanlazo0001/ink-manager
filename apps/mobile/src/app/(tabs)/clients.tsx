import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { countLine, ScreenTitle, TitleAction } from '@/components/ScreenTitle';
import { Appear } from '@/components/Appear';
import { Avatar, initialsOf } from '@/components/Avatar';
import { PillMenu } from '@/components/PillMenu';
import { TopBar } from '@/components/TopBar';
import { PlusIcon } from '@/components/icons';
import { SkeletonList } from '@/components/Skeleton';
import { StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import {
  clientName,
  CLIENT_FILTERS,
  fetchClients,
  filterClients,
  type ClientFilter,
  type ClientListItem,
} from '@/lib/clients';
import { screenErrorMessage } from '@/lib/screenError';
import { ApiError, isTransientApiFailure } from '@/lib/api';
import { colors, hairline, radius, space, type } from '@/theme';
import { formatPhone } from '@/lib/format';
import { fetchConversations } from '@/lib/conversations';
import { fetchAppointments } from '@/lib/appointments';
import {
  buildUpcomingByClient,
  clientIdentity,
  clientStatusChip,
  upcomingWindow,
} from '@/lib/clientListSignals';
import { StatusChip } from '@/components/StatusChip';
import { ArchiveConfirmSheet } from '@/components/ArchiveConfirmSheet';
import { ClientSwipe } from '@/components/ClientSwipe';
import { archiveClient, unarchiveClient } from '@/lib/clientWrites';
import type { AppointmentListItem } from '@ink-manager/shared-types';

/**
 * The client list.
 *
 * The owner parity audit called this the biggest single unlock, because
 * client DETAIL is where gift cards, deposit forms and waivers live —
 * none of them has a page of its own anywhere in the product.
 *
 * Search is client-side because `GET /clients` has no search parameter;
 * apps/web filters its loaded rows the same way. The archived toggle IS a
 * server parameter (`includeArchived`), so it refetches.
 */
/**
 * What a REFUSED WRITE says. Deliberately not `screenErrorMessage`.
 *
 * That helper takes a SUBJECT NOUN and builds load-failure sentences
 * around it ("Your role does not have access to {subject}."), so handing
 * it a finished sentence produced the doubled-up
 * "Your role does not have access to Could not archive Ana Ruiz.." that
 * the failure-path test put on screen. Same four cases, phrased for a
 * write:
 *
 *   transient  the request never landed — say so, and say nothing about
 *              permissions, per `screenErrorMessage`'s own rule 1.
 *   401        a dead session, same wording as everywhere else.
 *   from API   the server already wrote a human sentence for this
 *              ("You do not have permission to archive clients.") and it
 *              is better than anything invented here.
 *   otherwise  name the action that failed, so the toast is actionable.
 */
function writeFailureMessage(err: unknown, verb: 'archive' | 'unarchive', name: string): string {
  if (isTransientApiFailure(err)) return `Couldn't reach the studio. ${name} was not ${verb}d.`;
  if (err instanceof ApiError && err.status === 401) {
    return 'Your session has expired. Log out from the account screen, then sign in again.';
  }
  if (err instanceof ApiError && err.fromApi) return err.message;
  return `Could not ${verb} ${name}.`;
}

export default function ClientsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [rows, setRows] = useState<ClientListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /*
   * ITEM 6b. One request for the whole list rather than one per row:
   * `GET /conversations` already returns every thread this user can see,
   * each carrying its `clientId`, so a single fetch answers "does this
   * client have a thread" for every row on the screen.
   */
  const [threadsByClient, setThreadsByClient] = useState<Record<string, string>>({});
  /**
   * ITEM 5, from ONE bounded request rather than one per row. See
   * `lib/clientListSignals.ts` for what the API does and does not support
   * here — the short version is that "upcoming appointment" is reachable
   * and the other two signals are not.
   */
  const [upcoming, setUpcoming] = useState<Record<string, AppointmentListItem>>({});
  /*
   * SESSION AH. Was `const [showArchived, setShowArchived] = useState(false)`
   * behind a toggle pill; now one single-select filter, because the
   * control moved into `PillMenu`, which is single-select by design.
   *
   * `includeArchived` is derived rather than stored so there is still
   * exactly ONE source of truth for what the request asks for — the
   * filter — and no way for a boolean and a filter value to disagree.
   */
  const [filter, setFilter] = useState<ClientFilter>('all');
  const showArchived = filter === 'archived';
  const [refreshing, setRefreshing] = useState(false);

  /** The row whose `⋯` sheet is open, if any. */
  const [actionsFor, setActionsFor] = useState<ClientListItem | null>(null);
  /*
   * The row the sheet is DRAWING, which outlives the row it is OPEN for.
   *
   * Found by frame-sampling the dismissal rather than by reading the code:
   * rendering the sheet as `{actionsFor ? <Sheet/> : null}` unmounts it the
   * instant the selection clears, which destroys the exit animation at
   * frame zero — the exact failure `Sheet` documents and guards against
   * internally. Its `mounted`-outlives-`visible` logic cannot help if the
   * PARENT removes it first.
   *
   * So the sheet stays mounted and `visible` does the talking, and this
   * holds the last non-null row so the panel still has a name to draw
   * while it slides away.
   */
  const [actionsShown, setActionsShown] = useState<ClientListItem | null>(null);
  useEffect(() => {
    if (actionsFor) setActionsShown(actionsFor);
  }, [actionsFor]);
  const [archiving, setArchiving] = useState(false);
  /*
   * A FAILED ROW ACTION IS NOT A FAILED LIST.
   *
   * The first version of this called `setError`, and the failure-path test
   * showed what that does: `error` is the state the screen renders a
   * full-page `StateMessage` for, so a refused archive replaced the entire
   * client list with "The client list didn't load" — destroying the very
   * rows the revert had just put back. `error` means the LIST failed to
   * load; a rejected write is a different thing and needs a different
   * surface.
   *
   * So: the passive toast this app already uses for exactly this
   * (`conversation/[id].tsx`'s save note) — `pointerEvents="none"`, sits
   * over the list, says what happened, leaves the list alone.
   */
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3200);
    return () => clearTimeout(t);
  }, [note]);

  /**
   * Archive / unarchive from the list, OPTIMISTICALLY.
   *
   * `POST /clients/:id/archive` and `/unarchive` are the same pair the
   * client DETAIL header already calls (`lib/clientWrites.ts`), so this
   * adds no new write surface — it puts an existing one where the list
   * can reach it.
   *
   * OPTIMISTIC, WITH REVERT ON FAILURE, and no undo toast: the brief
   * allowed a toast "if the pattern exists", and it does not. The only
   * toast in this app is `conversation/[id].tsx`'s save note, which is
   * `pointerEvents="none"` — a passive message with nothing to tap. An
   * undo toast is an interactive, timed, queued surface, and inventing
   * one here would be a new pattern rather than a reused one. So the
   * safety net is the honest cheap one: the row leaves immediately, and
   * comes back exactly where it was if the server refuses.
   *
   * The row is removed rather than restyled because the default list
   * EXCLUDES archived clients — an archived row staying put would
   * disagree with what a refresh would show. Under the Archived filter
   * the opposite is true (that list includes both), so there the row
   * stays and only its state flips.
   */
  const toggleArchive = useCallback(
    async (client: ClientListItem) => {
      if (!token) return;
      const wasArchived = client.archivedAt !== null;
      const optimisticAt = wasArchived ? null : new Date().toISOString();
      const snapshot = rows;

      setArchiving(true);
      setRows((current) =>
        current === null
          ? current
          : showArchived
            ? current.map((c) => (c.id === client.id ? { ...c, archivedAt: optimisticAt } : c))
            : current.filter((c) => c.id !== client.id),
      );
      setActionsFor(null);

      try {
        const updated = wasArchived
          ? await unarchiveClient(token, client.id)
          : await archiveClient(token, client.id);
        // The server's own timestamp replaces the guess, so a later
        // render is not working from a value this screen invented.
        setRows((current) =>
          current === null
            ? current
            : current.map((c) => (c.id === client.id ? { ...c, archivedAt: updated.archivedAt } : c)),
        );
      } catch (err) {
        // Straight back to exactly the list that was on screen.
        setRows(snapshot);
        setNote(writeFailureMessage(err, wasArchived ? 'unarchive' : 'archive', clientName(client)));
      } finally {
        setArchiving(false);
      }
    },
    [token, rows, showArchived],
  );

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return;
      if (mode === 'refresh') setRefreshing(true);
      setError(null);
      try {
        setRows(await fetchClients(token, { includeArchived: showArchived }));
      } catch (err) {
        setError(screenErrorMessage(err, "The client list didn't load."));
      } finally {
        setRefreshing(false);
      }
    },
    [token, showArchived],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const now = new Date();
    const window = upcomingWindow(now);
    fetchAppointments(token, { start: window.start, end: window.end })
      .then((rows) => {
        if (!cancelled) setUpcoming(buildUpcomingByClient(rows, now));
      })
      .catch(() => {
        // A viewer without appointment visibility simply gets no chips —
        // never an error on a screen that is about clients.
      });

    fetchConversations(token)
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const row of rows) if (row.clientId) map[row.clientId] = row.id;
        setThreadsByClient(map);
      })
      .catch(() => {
        // A failed lookup only means the message buttons say there is no
        // thread yet — never a reason to break the list.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => filterClients(rows ?? [], search), [rows, search]);

  /**
   * `POST /clients` is gated `clients.edit`, so the control is absent
   * without it rather than present-and-refused. Web's own `canAddClient`
   * reads the same permission off the same profile.
   */
  const canAddClient = session?.profile.permissions.includes('clients.edit') ?? false;

  return (
    <ScreenShell edges={['top']}>
      {/*
        ITEM 2: the same top bar every tab screen wears — hamburger left,
        the [tasks][bell][avatar] cluster right. This screen had a pushed
        screen's back chevron, which is the chrome of somewhere you went
        INTO rather than a place in the app. You still arrive from the
        drawer, and the hamburger is how you go back to it.
      */}
      <TopBar />

      {/*
        ITEM 3c. The eyebrow is gone — REVERSING sessions X and Z, on the
        owner's call. "Everyone who's booked with you" is a standing
        caption that says the same thing on every visit; the count line
        underneath the title says something different every time, which is
        the job that space is better spent on.

        The archived figure only appears when the toggle is on, and that
        is not a display choice: `GET /clients` excludes archived rows
        unless `includeArchived` is set, so with the pill off this screen
        genuinely does not know how many there are. Counting the filtered
        rows rather than the fetched ones means the line always describes
        what is actually on screen while a search is running.
      */}
      <ScreenTitle
        title="Clients"
        counts={
          rows === null
            ? null
            : countLine(
                [visible.filter((c) => !c.archivedAt).length, 'client'],
                [visible.filter((c) => c.archivedAt).length, 'archived', 'archived'],
              )
        }
        action={
          canAddClient ? (
            <TitleAction Icon={PlusIcon} label="New client" onPress={() => router.push('/client-new')} />
          ) : null
        }
      />

      {/*
        SESSION AH: the filter sits ON the search row, not on a pill row
        below it. The search field takes what is left (`flex: 1`) and the
        button is the app's one 44pt icon-button size, so the row has a
        single height and the screen gives back the ~40pt the pill row
        was spending on one control.
      */}
      <View style={styles.controls}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, email or phone"
          placeholderTextColor={colors.fgMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search clients"
        />
        <PillMenu
          iconOnly
          label="Filter"
          icon="filter"
          value={filter}
          active={filter !== 'all'}
          onChange={setFilter}
          options={CLIENT_FILTERS}
        />
      </View>

      {rows === null && error === null ? (
        <SkeletonList rows={8} />
      ) : error ? (
        <StateMessage
          eyebrow="Not loaded"
          title="The client list didn't load"
          body={error}
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(c) => c.id}
          renderItem={({ item, index }) => (
            <Appear index={index}>
              <ClientSwipe
                archived={item.archivedAt !== null}
                hasThread={!!threadsByClient[item.id]}
                onMessage={() => {
                  const threadId = threadsByClient[item.id];
                  if (threadId) router.push({ pathname: '/conversation/[id]', params: { id: threadId } });
                }}
                onArchive={() => setActionsFor(item)}
              >
                <ClientRow
                  client={item}
                  onPress={() => router.push({ pathname: '/client/[id]', params: { id: item.id } })}
                  upcoming={upcoming[item.id]}
                />
              </ClientSwipe>
            </Appear>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={visible.length === 0 ? styles.emptyBox : styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            <StateMessage
              eyebrow={search ? 'No match' : 'Nobody yet'}
              title={search ? 'No client matches that' : 'No clients yet'}
              body={
                search
                  ? 'Try a different name, email or phone number.'
                  : 'Clients appear here once an inquiry comes in.'
              }
            />
          }
        />
      )}

      {note ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastLabel}>{note}</Text>
        </View>
      ) : null}

      {actionsShown ? (
        <ArchiveConfirmSheet
          visible={actionsFor !== null}
          name={clientName(actionsShown)}
          archived={actionsShown.archivedAt !== null}
          busy={archiving}
          onClose={() => setActionsFor(null)}
          onConfirm={() => void toggleArchive(actionsShown)}
        />
      ) : null}
    </ScreenShell>
  );
}

function ClientRow({
  client,
  onPress,
  upcoming,
}: {
  client: ClientListItem;
  onPress: () => void;
  /** Their soonest confirmed appointment, if they have one. */
  upcoming?: AppointmentListItem;
}) {
  const name = clientName(client);
  // ITEM 4: the best identity available, with NO channel glyph — see
  // `clientListSignals` for why no channel can be known.
  const secondary = clientIdentity(client, formatPhone) ?? 'No contact details';
  const chip = clientStatusChip(upcoming);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {/*
        SESSION AG, owner-directed: the avatar column is BACK, reversing
        session W's removal (`97d59d0`, "ITEM 6a: no avatar"). W's argument
        was that a client circle can only ever be initials restating the
        name beside it, and that argument is still factually true — see
        `url={null}` below. The ruling is that the column earns its place
        anyway, as ANATOMY: it is the leading inset that gives the row its
        iOS Contacts rhythm and gives the divider something to start after.

        `url={null}` is not a stub. `Client` has NO image column of any
        kind in `schema.prisma` (checked this session: only
        `instagramHandle`/`facebookProfileUrl`, both explicitly documented
        there as manual links with "no automatic profile/photo import"),
        and `GET /clients` is a bare `findMany` with no select, so there is
        no photo in the payload to pass. `Avatar` already renders a photo
        the moment one is handed to it, so the day a `Client.avatarUrl`
        exists this becomes a one-word change.
      */}
      <Avatar
        url={null}
        initials={initialsOf(name)}
        size={AVATAR_SIZE}
        labelStyle={styles.avatarLabel}
      />

      <View style={styles.rowText}>
        {/*
          ITEM 4: the chip sits with the NAME, on its baseline — it says
          something about this person, so it belongs beside them rather
          than out at the row's edge where it read as a second column.
          The name is the only shrinkable thing in the line, so it
          truncates and the chip never wraps.
        */}
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {client.archivedAt ? (
            <View style={styles.archived}>
              <Text style={styles.archivedLabel}>ARCHIVED</Text>
            </View>
          ) : chip ? (
            <StatusChip label={chip.label} tone={chip.tone} />
          ) : null}
        </View>
        <Text style={styles.secondary} numberOfLines={1}>
          {secondary}
        </Text>
      </View>
      {/*
        SESSION AJ, owner decision: the row's trailing button is GONE. Its
        two actions (Message, Archive) now live behind a left swipe, which
        is where iOS puts row actions on a list like this. The row's own
        tap still opens the client, so nothing lost a home — the row simply
        stopped spending 56pt of its width on a control that was one tap
        away from the same two things.

        The width goes straight back to the NAME, which AG's avatar column
        had taken 52pt from: 106 -> 162pt at 320.
      */}
    </Pressable>
  );
}

/**
 * The leading inset zone, in one place.
 *
 * 40pt is the iOS Contacts list size, and it is also the number the
 * divider was already computing against (`space.lg + 40 + space.md`)
 * before session W removed the avatar it referred to. Declared once so
 * the avatar and the divider can never drift apart again — which is
 * exactly what happened last time one of them moved without the other.
 */
const AVATAR_SIZE = 40;

const styles = StyleSheet.create({
  /* Web: an eyebrow, then `font-display` at clamp(28,3.4vw,38). */
  /* ITEM 2: the same air Home puts above its eyebrow. */
  /* ITEM 3: the same token Home's "Welcome, Juan" uses, not a lookalike. */

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  search: {
    /* Session AH: the field yields to the filter button beside it. */
    flex: 1,
    minHeight: 44,
    backgroundColor: colors.inputBg,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    color: colors.fg,
    ...type.body,
    fontSize: 16,
    paddingHorizontal: space.md,
  },

  /* The same toast `conversation/[id].tsx` uses, same metrics. */
  toast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
    alignItems: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  toastLabel: { ...type.small, color: colors.fg },

  listContent: { paddingVertical: space.sm },
  emptyBox: { flexGrow: 1, justifyContent: 'center' },
  /*
    iOS's own rule, and the reason the avatar had to come back before this
    line could be called correct: THE DIVIDER'S INSET IS THE TEXT'S INSET,
    and the zone it skips is occupied by the avatar. 16 (row padding) + 40
    (avatar) + 12 (gap) = 68, which is exactly where the name starts.

    This value was ALREADY 68 before this session — written as
    `space.lg + 40 + space.md` when the row still had an avatar, and left
    behind untouched when session W removed it. So for the whole time the
    avatar was gone, the divider was indenting past nothing. Restoring the
    avatar is what makes the existing indent true rather than arbitrary,
    which is why this line is unchanged in VALUE and only rewritten to
    stop hard-coding the 40 the avatar is drawn at.
  */
  separator: {
    height: hairline,
    backgroundColor: colors.borderSoft,
    marginLeft: space.lg + AVATAR_SIZE + space.md,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  // Name and its chip share a baseline; only the name can shrink.
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowText: { flex: 1 },
  /* Live again as of AG. Orphaned but never deleted while W's removal stood. */
  avatarLabel: { ...type.label, fontSize: 13, color: colors.fgMuted },
  /* Session AF: the body face, not the display face. See `type.rowName`
     for the web citation and the measurement that picked 18. */
  name: { ...type.rowName, color: colors.fg, flexShrink: 1 },
  secondary: { ...type.meta, color: colors.fgMuted, marginTop: 2 },

  archived: {
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  archivedLabel: { ...type.meta, color: colors.fgMuted, fontSize: 9 },
  pressed: { opacity: 0.6 },
});
