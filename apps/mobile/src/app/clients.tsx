import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Appear } from '@/components/Appear';
import { Avatar, initialsOf } from '@/components/Avatar';
import { Pill, PillRow } from '@/components/Pill';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SkeletonList } from '@/components/Skeleton';
import { StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { clientName, fetchClients, filterClients, type ClientListItem } from '@/lib/clients';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, radius, space, type } from '@/theme';

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
    void load();
  }, [load]);

  const visible = useMemo(() => filterClients(rows ?? [], search), [rows, search]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title="Clients" onBack={() => router.back()} />

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
    </SafeAreaView>
  );
}

function ClientRow({ client, onPress }: { client: ClientListItem; onPress: () => void }) {
  const name = clientName(client);
  const secondary = client.email ?? client.phone ?? 'No contact details';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Avatar url={null} initials={initialsOf(name)} size={40} labelStyle={styles.avatarLabel} />
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.secondary} numberOfLines={1}>
          {secondary}
        </Text>
      </View>
      {client.archivedAt ? (
        <View style={styles.archived}>
          <Text style={styles.archivedLabel}>ARCHIVED</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
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
  rowText: { flex: 1 },
  avatarLabel: { ...type.label, fontSize: 13, color: colors.fgMuted },
  name: { ...type.heading, color: colors.fg },
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
