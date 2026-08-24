import type { ArtistInquiryListItem, StaffInquiryListItem } from '@ink-manager/shared-types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InquiryRow, type InquiryRowData } from '@/components/InquiryRow';
import { TopBar } from '@/components/TopBar';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SkeletonList } from '@/components/Skeleton';
import { Appear } from '@/components/Appear';
import { StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { fetchArtistInquiries, fetchStaffInquiries, usesArtistInquiryRoutes } from '@/lib/inquiries';
import {
  findNextSession,
  INQUIRY_TABS,
  inquiryThumbnail,
  tabForStatus,
  type InquiryTab,
} from '@/lib/inquiryTabs';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, space } from '@/theme';

const POLL_MS = 30_000;

/**
 * Inquiries vs Projects — web's own toggle, replacing the Open/Closed
 * split mobile had invented.
 *
 * The buckets, the labels and the ordering all come from
 * `apps/web/src/pages/Inquiries.tsx`; see `lib/inquiryTabs.ts` for the
 * mapping and why DEPOSIT_PENDING sits on Inquiries while ON_HOLD sits on
 * Projects.
 *
 * Still not a per-status filter, for the reason the old comment gave: the
 * staff route accepts repeated `status` params and the artist route
 * accepts none, so a status filter would work for one role and silently
 * do nothing for the other. This split is derived from data both routes
 * already return, so it behaves identically for everyone — which is also
 * how web does it, one `?scope=all` fetch filtered client-side.
 */

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
    // The staff list projection returns no images at all, so there is
    // nothing to show here and the row falls back to its placeholder.
    thumbnailUrl: null,
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
    // Undefined, not null: every row here is theirs, so the artist line
    // is omitted entirely rather than claiming UNASSIGNED.
    artistName: undefined,
    fromGuestStudio: inquiry.fromGuestStudio,
    thumbnailUrl: inquiryThumbnail(inquiry),
    nextSessionAt: findNextSession(inquiry.sessions)?.startTime ?? null,
  };
}

export default function InquiriesScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const role = session?.profile.role ?? '';
  const isArtist = usesArtistInquiryRoutes(role);

  const [view, setView] = useState<InquiryTab>('inquiries');
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
    const rows = items.filter((i) => tabForStatus(i.status) === view);
    if (view !== 'projects') return rows;
    // Web's Projects order: soonest upcoming session first, undated last
    // but still visible. Applied here rather than in `rowsForTab` because
    // this screen has already mapped both projections onto InquiryRowData.
    return rows.slice().sort((a, b) => {
      if (!a.nextSessionAt && !b.nextSessionAt) return 0;
      if (!a.nextSessionAt) return 1;
      if (!b.nextSessionAt) return -1;
      return new Date(a.nextSessionAt).getTime() - new Date(b.nextSessionAt).getTime();
    });
  }, [items, view]);

  const counts = useMemo(
    () => ({
      inquiries: items?.filter((i) => tabForStatus(i.status) === 'inquiries').length ?? 0,
      projects: items?.filter((i) => tabForStatus(i.status) === 'projects').length ?? 0,
    }),
    [items],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <TopBar />

      <SegmentedControl
        segments={INQUIRY_TABS.map((v) => ({ key: v.key, label: v.label.toUpperCase(), count: counts[v.key] }))}
        value={view}
        onChange={setView}
      />

      {items === null && error === null ? (
        <SkeletonList rows={6} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <Appear index={index}>
            <InquiryRow
              inquiry={item}
              // Two detail screens, because there are two payloads:
              // ARTIST reads GET /inquiries/assigned-to-me/:id, OWNER and
              // FRONT_DESK read GET /inquiries/:id, and they are different
              // shapes rather than one being a subset of the other. Owner
              // rows used to be inert for want of the second screen --
              // session J's diagnosis -- not because the API refused them.
              onPress={
                isArtist
                  ? () => router.push({ pathname: '/inquiry/[id]', params: { id: item.id } })
                  : () => router.push({ pathname: '/staff-inquiry/[id]', params: { id: item.id } })
              }
            />
            </Appear>
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
            ) : view === 'projects' ? (
              <StateMessage
                eyebrow="Nothing booked"
                title="No projects yet"
                body={
                  isArtist
                    ? 'An inquiry becomes a project once its deposit is paid and it is being scheduled.'
                    : 'Inquiries move here once their deposit is paid and scheduling begins.'
                }
              />
            ) : (
              <StateMessage
                eyebrow="Clear"
                title="No inquiries"
                body={
                  isArtist
                    ? 'Work assigned to you will appear here.'
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
