import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { Appear } from '@/components/Appear';
import { Avatar, initialsOf } from '@/components/Avatar';
import { Pill, PillRow } from '@/components/Pill';
import { TopBar } from '@/components/TopBar';
import { CardIconButton } from '@/components/CardIconButton';
import { Eyebrow } from '@/components/editorial';
import { MessageIcon } from '@/components/icons';
import { SkeletonList } from '@/components/Skeleton';
import { StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { clientName, fetchClients, filterClients, type ClientListItem } from '@/lib/clients';
import { screenErrorMessage } from '@/lib/screenError';
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
  const [showArchived, setShowArchived] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
        ITEM 6c: web's Clients page leads with an eyebrow over a display
        serif title — `<Eyebrow>Everyone who's booked with your studio.</Eyebrow>`
        above an `h1` in `font-display`. The nav row no longer repeats the
        word, the same way the client detail's does not (session U).
      */}
      <View style={styles.pageHead}>
        <Eyebrow>Everyone who&apos;s booked with you.</Eyebrow>
        {/* ITEM 3: Home's "Welcome, Juan" token exactly — `type.welcome`. */}
        <Text style={styles.pageTitle}>Clients</Text>
      </View>

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
      </View>
      <PillRow>
        <Pill
          label="Archived"
          selected={showArchived}
          onPress={() => setShowArchived((v) => !v)}
          accessibilityLabel={showArchived ? 'Hide archived clients' : 'Show archived clients'}
        />
      </PillRow>

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
              <ClientRow
                client={item}
                onPress={() => router.push({ pathname: '/client/[id]', params: { id: item.id } })}
                threadId={threadsByClient[item.id]}
                upcoming={upcoming[item.id]}
                onMessage={(threadId) =>
                  router.push({ pathname: '/conversation/[id]', params: { id: threadId } })
                }
              />
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
    </ScreenShell>
  );
}

function ClientRow({
  client,
  onPress,
  threadId,
  onMessage,
  upcoming,
}: {
  client: ClientListItem;
  onPress: () => void;
  /** This client's existing thread, if they have one. */
  threadId?: string;
  onMessage: (threadId: string) => void;
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
      {/* ITEM 6a: no avatar. These are never photographs — the client
          record has no image field at all, so every circle on this screen
          was a pair of initials restating the name beside it. */}
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
      {/* ITEM 6b: opens this client's thread. Navigation when one exists;
          see the screen's own note for why it stops there when one does
          not. */}
      <CardIconButton
        Icon={MessageIcon}
        label={`Message ${name}`}
        onPress={threadId ? () => onMessage(threadId) : undefined}
        unavailableNote={`${name} has no chat thread yet. Starting one is done in the portal.`}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /* Web: an eyebrow, then `font-display` at clamp(28,3.4vw,38). */
  pageHead: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.xs },
  /* ITEM 3: the same token Home's "Welcome, Juan" uses, not a lookalike. */
  pageTitle: { ...type.welcome, color: colors.fg },

  controls: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  search: {
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

  listContent: { paddingVertical: space.sm },
  emptyBox: { flexGrow: 1, justifyContent: 'center' },
  separator: { height: hairline, backgroundColor: colors.borderSoft, marginLeft: space.lg + 40 + space.md },

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
  avatarLabel: { ...type.label, fontSize: 13, color: colors.fgMuted },
  name: { ...type.heading, color: colors.fg, flexShrink: 1 },
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
