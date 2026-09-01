import type { ArtistInquiryListItem, StaffInquiryListItem } from '@ink-manager/shared-types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { countLine, ScreenTitle, TitleAction } from '@/components/ScreenTitle';
import { PlusIcon } from '@/components/icons';
import { InquiryRow, type InquiryRowData } from '@/components/InquiryRow';
import { TopBar } from '@/components/TopBar';
import { UnderlineTabs } from '@/components/UnderlineTabs';
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
    updatedAt: inquiry.updatedAt,
    client: inquiry.client,
    artist: inquiry.assignedArtist
      ? {
          name: inquiry.assignedArtist.user.name ?? inquiry.assignedArtist.user.email,
          avatarUrl: inquiry.assignedArtist.user.avatarUrl,
        }
      : null,
    fromGuestStudio: inquiry.fromGuestStudio,
    /*
     * ITEM 1, and it was never a data problem.
     *
     * This line used to be a hard-coded `null` under a comment asserting
     * that "the staff list projection returns no images at all". That was
     * simply untrue: `INQUIRY_LIST_SELECT` has carried
     * `referenceImages: true` all along, and `StaffInquiryListItem`
     * declares `referenceImages: string[]`. The field arrived on every
     * response and was thrown away here.
     *
     * The effect was total for the people most likely to notice: an
     * OWNER or FRONT_DESK reads THIS projection, so every row they have
     * ever seen showed the placeholder — including the 62 of 100
     * inquiries on the dev database that do have real photos.
     */
    thumbnailUrl: inquiryThumbnail(inquiry),
    /* The chip on this row shows the derived PROJECT stage for a
       converted project, exactly as web's list does — these two are what
       it derives from. */
    projectCompletedAt: inquiry.projectCompletedAt,
    sessions: inquiry.sessions,
  };
}

function fromArtist(inquiry: ArtistInquiryListItem): InquiryRowData {
  return {
    id: inquiry.id,
    description: inquiry.description,
    status: inquiry.status,
    updatedAt: inquiry.updatedAt,
    client: inquiry.client,
    // Undefined, not null: every row here is theirs, so the artist slot
    // is omitted entirely rather than claiming UNASSIGNED.
    artist: undefined,
    fromGuestStudio: inquiry.fromGuestStudio,
    thumbnailUrl: inquiryThumbnail(inquiry),
    nextSessionAt: findNextSession(inquiry.sessions)?.startTime ?? null,
    projectCompletedAt: inquiry.projectCompletedAt,
    sessions: inquiry.sessions,
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

  /**
   * `POST /inquiries` checks this inline — there is no requirePermission
   * middleware on a dual-purpose route — and answers 403 without it. The
   * control is absent rather than present-and-refusing, same rule as
   * Clients' own Add button.
   */
  const canCreate = session?.profile.permissions.includes('inquiries.create') ?? false;

  const counts = useMemo(
    () => ({
      inquiries: items?.filter((i) => tabForStatus(i.status) === 'inquiries').length ?? 0,
      projects: items?.filter((i) => tabForStatus(i.status) === 'projects').length ?? 0,
    }),
    [items],
  );

  return (
    <ScreenShell edges={['top']}>
      <TopBar />

      {/*
        The house title pattern. Its count line is now the ONLY place these
        two numbers appear — see the note on the toggle below for why they
        left the segments.

        AB deferred the action here, on the grounds that web's
        `StaffInquiryForm` is 524 lines with two required image uploads.
        AC builds it: same fields, same rules, on the form layer this app
        already has. It is gated on `inquiries.create`, which is what the
        route itself checks inline.
      */}
      <ScreenTitle
        title="Pipeline"
        counts={
          items === null
            ? null
            : countLine([counts.inquiries, 'inquiry', 'inquiries'], [counts.projects, 'project'])
        }
        action={
          canCreate ? (
            <TitleAction Icon={PlusIcon} label="New inquiry" onPress={() => router.push('/inquiry-new')} />
          ) : null
        }
      />

      {/*
        ITEM 3 — THE BADGES ARE GONE, and this is the fifth report on this
        control rather than the fifth patch to it.
        ─────────────────────────────────────────────────────────────────
        The premise that Tasks uses a different anatomy is not true: Tasks
        renders this same `SegmentedControl`, which renders this same
        `Pill`. The one difference is that Tasks passes no counts. The
        badge was the entire delta, and the badge is what has been running
        off the edge.

        Measured, both variants, 320/375/390/430pt, two-digit counts, with
        Jura actually loaded — and crucially at 1.3x text, the largest
        scale `Pill`'s own `maxFontSizeMultiplier` still permits on a
        device:

                        1.0x            1.3x
          with badges   ends 288px      ends 327px   <- past a 320pt screen
          labels only   ends 231px      ends 265px

        That 327 is the bug. Every previous fix measured clean because
        react-native-web does not implement iOS Dynamic Type at all, so a
        browser check silently tests the one condition where the cause is
        absent. `flexShrink: 0` (added by two earlier fixes) means it does
        not ellipsis — it overflows into the scroll, which on a phone
        reads exactly as "PROJECTS is cut off".

        The counts did not need to be here at all: the line directly above
        already says "24 inquiries · 18 projects". The badges were a second
        copy of the same two numbers, 40px away, and they were the copy
        that could not fit.
      */}
      {/*
        Underline tabs, per design-refs/session-ar/tabs-target.png. Two
        things went with the pills: the counts (the sub-header directly
        above already says "24 inquiries · 18 projects" — they were a
        second copy of the same numbers) and the `.toUpperCase()`, since
        the target sets these in sentence case.
      */}
      <UnderlineTabs
        tabs={INQUIRY_TABS.map((v) => ({ key: v.key, label: v.label }))}
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
          ItemSeparatorComponent={() => <View style={styles.gap} />}
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
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  /* Cards need side padding the flush rows did not: the old row inset
     its own content by space.lg and bled to both edges. */
  listContent: {
    paddingTop: space.sm,
    paddingBottom: space.xxl,
    paddingHorizontal: space.lg,
  },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  /* A GAP, not a rule. A hairline between two rounded cards draws a line
     across their corners and reads as a mistake -- the separator existed
     to divide flush text rows, and the rows are cards now. The card's own
     border and the ground between them do the dividing. */
  gap: { height: space.md },
});
