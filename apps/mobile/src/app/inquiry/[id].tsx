import type { ArtistInquiryDetail } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailField, DetailSection, FieldDivider } from '@/components/DetailSection';
import { InquiryRespondSheet, type RespondMode } from '@/components/InquiryRespondSheet';
import { PhotoStrip, PhotoViewer } from '@/components/PhotoViewer';
import { ScreenHeader } from '@/components/ScreenHeader';
import { InquiryStatusChip } from '@/components/StatusChip';
import { GoldButton, QuietButton, ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { ApiError } from '@/lib/api';
import { fetchArtistInquiry, respondToInquiry } from '@/lib/inquiries';
import {
  channelLabel,
  formatEstimateRange,
  inquiryClientName,
  isClosedStatus,
  statusLabel,
  statusTone,
} from '@/lib/inquiryDisplay';
import { formatHourRange, inquiryImages, inquiryVisibility } from '@/lib/inquiryVisibility';
import { screenErrorMessage } from '@/lib/screenError';
import { relativeStamp } from '@/lib/time';
import { colors, hairline, radius, space, tones, type } from '@/theme';

/**
 * The 403 this route can return is a KNOWN, documented state, not a
 * generic failure: the list is scoped by the caller's home studio while
 * this route checks the inquiry's own (PARITY-AUDIT.md, Finding B). Web
 * currently renders "Loading project…" forever when it happens. This
 * screen says what is true and offers the way back.
 */
function detailErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.fromApi && err.status === 403) {
    return "This project is at another studio, and that studio hasn't given you access to its inquiries.";
  }
  if (err instanceof ApiError && err.fromApi && err.status === 404) {
    return 'This project is not assigned to you, or no longer exists.';
  }
  return screenErrorMessage(err, 'this project');
}

export default function InquiryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const permissions = useMemo(() => session?.profile.permissions ?? [], [session?.profile.permissions]);

  const [inquiry, setInquiry] = useState<ArtistInquiryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [respondMode, setRespondMode] = useState<RespondMode | null>(null);
  const [responding, setResponding] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!token || !id) return;
      const seq = ++requestRef.current;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const next = await fetchArtistInquiry(token, id);
        if (seq !== requestRef.current) return;
        setInquiry(next);
        setError(null);
      } catch (err) {
        if (seq !== requestRef.current) return;
        setError(detailErrorMessage(err));
      } finally {
        if (seq === requestRef.current && mode === 'refresh') setRefreshing(false);
      }
    },
    [token, id],
  );

  useEffect(() => {
    load('initial');
  }, [load]);
  useEffect(() => () => void ++requestRef.current, []);

  const visibility = useMemo(() => inquiryVisibility({ permissions, inquiry }), [permissions, inquiry]);
  const images = useMemo(
    () =>
      inquiry
        ? inquiryImages(inquiry).map((i) => ({
            url: i.url,
            caption: i.kind === 'reference' ? 'Reference' : 'Placement photo',
          }))
        : [],
    [inquiry],
  );

  const onDecline = useCallback(
    async (note: string) => {
      if (!token || !id || !inquiry) return;
      setResponding(true);
      setRespondError(null);
      try {
        // Declining does NOT close the inquiry -- the API sets it back to
        // NEW and clears assignedArtistId. So it stops being this
        // artist's project entirely rather than becoming a closed one,
        // and there is nothing left on this screen to show. Confirmed
        // against the route, not assumed: an earlier version of this
        // optimistically set CLOSED_LOST, which would have been a lie.
        await respondToInquiry(token, id, { decision: 'DECLINE', declineNote: note });
        setRespondMode(null);
        // The list refetches on focus, so it comes back without this row.
        router.back();
      } catch (err) {
        // Nothing to revert -- the optimistic step here is navigation,
        // and it only happens after the call succeeds. Staying put with a
        // readable error beats a screen that moved and then bounced back.
        setRespondError(screenErrorMessage(err, 'this project'));
      } finally {
        setResponding(false);
      }
    },
    [token, id, router],
  );

  if (!inquiry) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Project" onBack={() => router.back()} right={<View style={styles.headerSpacer} />} />
        {error ? (
          <View style={styles.centre}>
            <StateMessage
              eyebrow="Not available"
              tone="alert"
              title={error}
              body="Nothing is wrong with your account — this is about where the project lives."
              action={{ label: 'Back to inquiries', onPress: () => router.back() }}
            />
          </View>
        ) : (
          <ScreenLoading />
        )}
      </SafeAreaView>
    );
  }

  const dimmed = isClosedStatus(inquiry.status);
  const estimate = visibility.canSeePricing
    ? formatEstimateRange(inquiry.priceEstimateLow ?? null, inquiry.priceEstimateHigh ?? null)
    : null;
  const timeEstimate = visibility.canSeePricing
    ? formatHourRange(inquiry.timeEstimateHoursMin, inquiry.timeEstimateHoursMax)
    : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader
        title={inquiryClientName(inquiry.client)}
        subtitle={`${channelLabel(inquiry.channel)} · ${relativeStamp(inquiry.createdAt)}`}
        onBack={() => router.back()}
        right={<View style={styles.headerSpacer} />}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load('refresh')}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        {inquiry.fromGuestStudio ? (
          <View style={styles.guestBanner}>
            <Feather name="map-pin" size={13} color={colors.accent} />
            <Text style={styles.guestLabel}>At {inquiry.fromGuestStudio.name} — you are a guest here</Text>
          </View>
        ) : null}

        <View style={[styles.hero, dimmed && styles.dimmed]}>
          <InquiryStatusChip status={inquiry.status} />
          <Text style={styles.description}>{inquiry.description}</Text>
        </View>

        {images.length > 0 ? (
          <View style={styles.photos}>
            <Text style={styles.photosTitle}>
              {images.length === 1 ? 'PHOTO' : `PHOTOS (${images.length})`}
            </Text>
            <PhotoStrip images={images} onPress={setViewerIndex} />
          </View>
        ) : null}

        <DetailSection title="The work" accent>
          <DetailField label="Placement" value={inquiry.placement} />
          <FieldDivider />
          <DetailField label="Size" value={inquiry.estimatedSize} />
          <FieldDivider />
          <DetailField label="Colour or black & grey" value={inquiry.colorOrBlackGrey} />
          <FieldDivider />
          <DetailField label="Timing wanted" value={inquiry.desiredTiming} />
          <FieldDivider />
          <DetailField
            label="Tattooed before"
            value={inquiry.hasBeenTattooedBefore == null ? null : inquiry.hasBeenTattooedBefore ? 'Yes' : 'No'}
          />
        </DetailSection>

        {/* Pricing is a whole section the studio can switch off. Saying so
            beats rendering dashes, which would read as "no estimate". */}
        <DetailSection title="Estimate">
          {visibility.canSeePricing ? (
            <>
              <DetailField label="Client budget" value={inquiry.budget ?? null} />
              <FieldDivider />
              <DetailField label="Estimate" value={estimate} />
              <FieldDivider />
              <DetailField label="Time" value={timeEstimate} />
              {inquiry.service ? (
                <>
                  <FieldDivider />
                  <DetailField label="Service" value={`${inquiry.service.name} · ${inquiry.service.pricingModel}`} />
                </>
              ) : null}
            </>
          ) : (
            <DetailField label="Hidden" value="Your studio doesn't show pricing detail to artists." multiline />
          )}
        </DetailSection>

        {inquiry.plannedSessions.length > 0 ? (
          <DetailSection title="Session plan">
            {inquiry.plannedSessions.map((planned, i) => (
              <View key={planned.id}>
                {i > 0 ? <FieldDivider /> : null}
                <DetailField
                  label={`Session ${planned.sessionNumber}`}
                  value={
                    [
                      formatHourRange(planned.estimatedHoursMin, planned.estimatedHoursMax),
                      visibility.canSeePricing
                        ? formatEstimateRange(planned.estimatedPriceLow, planned.estimatedPriceHigh)
                        : null,
                      planned.depositForm?.paidAt ? 'deposit paid' : planned.depositForm?.signedAt ? 'deposit signed' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || null
                  }
                />
              </View>
            ))}
          </DetailSection>
        ) : null}

        {inquiry.sessions.length > 0 ? (
          <DetailSection title={inquiry.sessions.length === 1 ? 'Booked session' : 'Booked sessions'}>
            {inquiry.sessions.map((s, i) => (
              <View key={s.id}>
                {i > 0 ? <FieldDivider /> : null}
                <DetailField
                  label={new Date(s.startTime).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  value={[statusLabel(s.status), s.checkedOutAt ? 'checked out' : null].filter(Boolean).join(' · ')}
                />
              </View>
            ))}
          </DetailSection>
        ) : null}

        {visibility.canSeeNotes && inquiry.notes && inquiry.notes.length > 0 ? (
          <DetailSection title="Notes from the studio">
            {inquiry.notes.map((note, i) => (
              <View key={note.id}>
                {i > 0 ? <FieldDivider /> : null}
                <DetailField
                  label={note.author?.name ?? note.author?.email ?? 'Studio'}
                  // Deliberately stripped rather than rendered: the API
                  // sends HTML, and mobile has no sanitiser. Plain text is
                  // the honest, safe reading of it.
                  value={note.bodyHtml.replace(/<[^>]*>/g, '').trim() || null}
                  multiline
                />
              </View>
            ))}
          </DetailSection>
        ) : null}

        {/* The deep flows. Named, so an artist knows they exist and where
            they live, rather than silently absent. */}
        <View style={styles.portalNote}>
          <Feather name="external-link" size={13} color={colors.fgMuted} />
          <Text style={styles.portalText}>
            Scheduling, deposits and the full estimate builder live in the portal — this screen shows them, it
            doesn&apos;t change them.
          </Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Opened {relativeStamp(inquiry.createdAt)} · updated {relativeStamp(inquiry.updatedAt)}</Text>
        </View>
      </ScrollView>

      {/* The artist's own decision. Present only while the project is
          genuinely awaiting them and they hold the permission. */}
      {visibility.canRespond ? (
        <View style={styles.actions}>
          <QuietButton label="Decline" onPress={() => setRespondMode('decline')} style={styles.declineButton} />
          <GoldButton label="Approve" onPress={() => setRespondMode('approve')} style={styles.approveButton} />
        </View>
      ) : null}

      <InquiryRespondSheet
        mode={respondMode}
        onClose={() => {
          setRespondMode(null);
          setRespondError(null);
        }}
        onDecline={onDecline}
        submitting={responding}
        error={respondError}
        approveSendsToClient={visibility.approveSendsToClient}
        clientName={inquiryClientName(inquiry.client)}
      />

      <PhotoViewer
        images={images}
        initialIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  headerSpacer: { width: 36 },
  centre: { flex: 1, justifyContent: 'center' },
  content: { paddingBottom: space.xxxl },

  guestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.card,
  },
  guestLabel: { ...type.small, color: colors.accent, flex: 1 },

  hero: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.md },
  dimmed: { opacity: 0.55 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: hairline,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  statusDot: { width: 5, height: 5, borderRadius: radius.pill },
  statusLabel: { ...type.label, fontSize: 9 },
  description: { ...type.display, fontSize: 22, lineHeight: 28, color: colors.fg },

  photos: { gap: space.sm, paddingTop: space.xl },
  photosTitle: { ...type.eyebrow, color: colors.fgMuted, paddingHorizontal: space.lg },

  portalNote: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    marginHorizontal: space.lg,
    marginTop: space.xl,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderWidth: hairline,
    borderColor: colors.borderSoft,
    borderRadius: radius.card,
  },
  portalText: { ...type.small, color: colors.fgMuted, flex: 1 },

  footer: { paddingHorizontal: space.lg, paddingTop: space.xl },
  footerText: { ...type.meta, color: colors.fgMuted },

  actions: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceInset,
  },
  declineButton: { flex: 1 },
  approveButton: { flex: 1 },
});
