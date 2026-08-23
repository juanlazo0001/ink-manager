import type { ArtistInquiryListItem, StaffInquiryListItem } from '@ink-manager/shared-types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InquiryRow, type InquiryRowData } from '@/components/InquiryRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { fetchArtistInquiries, fetchStaffInquiries, usesArtistInquiryRoutes } from '@/lib/inquiries';
import { isClosedStatus } from '@/lib/inquiryDisplay';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, space } from '@/theme';

const POLL_MS = 30_000;

/**
 * Open vs closed, not a status filter.
 *
 * Deliberately NOT a per-status filter set: the staff route accepts
 * repeated `status` params, but the artist route does not accept any, so
 * a status filter would work for one role and silently do nothing for the
 * other. Splitting on open/closed is derivable from data both routes
 * return, so it behaves identically for everyone.
 */
type InquiryView = 'open' | 'closed';

const VIEWS = [
  { key: 'open' as const, label: 'OPEN' },
  { key: 'closed' as const, label: 'CLOSED' },
];

/** Both projections mapped onto the row's own shared shape. */
function fromStaff(inquiry: StaffInquiryListItem): InquiryRowData {
  return {
    id: inquiry.id,
    description: inquiry.description,
    status: inquiry.status,
    channel: inquiry.channel,
    updatedAt: inquiry.updatedAt,
    priceEstimateLow: inquiry.priceEstimateLow,
    priceEstimateHigh: inquiry.priceEstimateHigh,
    client: inquiry.client,
    artistName: inquiry.assignedArtist
      ? (inquiry.assignedArtist.user.name ?? inquiry.assignedArtist.user.email)
      : null,
    fromGuestStudio: inquiry.fromGuestStudio,
  };
}

function fromArtist(inquiry: ArtistInquiryListItem): InquiryRowData {
  return {
    id: inquiry.id,
    description: inquiry.description,
    status: inquiry.status,
    channel: inquiry.channel,
    updatedAt: inquiry.updatedAt,
    // May already have been stripped server-side by the studio's
    // `pricingDetail` visibility toggle — null here means "not shown to
    // you", which renders as absent rather than as zero.
    priceEstimateLow: inquiry.priceEstimateLow,
    priceEstimateHigh: inquiry.priceEstimateHigh,
    client: inquiry.client,
    artistName: null, // Every row is their own; naming them on each row is noise.
    fromGuestStudio: inquiry.fromGuestStudio,
  };
}

export default function InquiriesScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const role = session?.profile.role ?? '';
  const isArtist = usesArtistInquiryRoutes(role);

  const [view, setView] = useState<InquiryView>('open');
  const [items, setItems] = useState<InquiryRowData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'poll') => {
      if (!token) return;
      const seq = ++requestRef.current;
      if (mode === 'refresh') setRefreshing(true);
      try {
        // The route family is chosen by role, not filtered by it — an
        // artist calling the staff route gets a 403, not a short list.
        const next = isArtist
          ? (await fetchArtistInquiries(token)).map(fromArtist)
          : (await fetchStaffInquiries(token)).map(fromStaff);
        if (seq !== requestRef.current) return;
        setItems(next);
        setError(null);
      } catch (err) {
        if (seq !== requestRef.current) return;
        if (mode === 'poll' && items !== null) return;
        setError(screenErrorMessage(err, 'inquiries'));
      } finally {
        if (seq === requestRef.current && mode === 'refresh') setRefreshing(false);
      }
    },
    [token, isArtist, items],
  );

  useEffect(() => {
    load('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isArtist]);

  useFocusEffect(
    useCallback(() => {
      load('poll');
      const timer = setInterval(() => load('poll'), POLL_MS);
      return () => clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, isArtist]),
  );

  useEffect(() => () => void ++requestRef.current, []);

  const visible = useMemo(() => {
    if (!items) return [];
    return items.filter((i) => (view === 'closed' ? isClosedStatus(i.status) : !isClosedStatus(i.status)));
  }, [items, view]);

  const counts = useMemo(
    () => ({
      open: items?.filter((i) => !isClosedStatus(i.status)).length ?? 0,
      closed: items?.filter((i) => isClosedStatus(i.status)).length ?? 0,
    }),
    [items],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader
        title="Inquiries"
        subtitle={isArtist ? 'Assigned to you' : undefined}
      />

      <SegmentedControl
        segments={VIEWS.map((v) => ({ ...v, count: counts[v.key] }))}
        value={view}
        onChange={setView}
      />

      {items === null && error === null ? (
        <ScreenLoading />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <InquiryRow
              inquiry={item}
              // Artists only: the detail screen is built on the artist
              // route family, and the staff one is a different response
              // shape with no mobile screen yet -- a staff row would open
              // something that cannot load.
              onPress={
                isArtist
                  ? () => router.push({ pathname: '/inquiry/[id]', params: { id: item.id } })
                  : undefined
              }
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={visible.length === 0 ? styles.emptyContainer : styles.listContent}
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
            ) : view === 'closed' ? (
              <StateMessage eyebrow="Nothing closed" title="No closed inquiries" body="Lost and cold leads collect here." />
            ) : (
              <StateMessage
                eyebrow="Clear"
                title="No open inquiries"
                body={
                  isArtist
                    ? 'Projects assigned to you will appear here.'
                    : 'New inquiries appear here as they come in.'
                }
              />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  listContent: { paddingTop: space.sm, paddingBottom: space.xxl },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  separator: { height: hairline, backgroundColor: colors.borderSoft, marginLeft: space.lg },
});
