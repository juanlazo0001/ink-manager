import type { AppointmentDetail } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { DetailField, DetailSection, FieldDivider } from '@/components/DetailSection';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { useStudioTimeZone } from '@/hooks/useStudioTimeZone';
import { ApiError } from '@/lib/api';
import { appointmentBadge, colorForArtistId, isDimmed } from '@/lib/appointmentDisplay';
import { fetchAppointment } from '@/lib/appointments';
import {
  appointmentVisibility,
  formatCents,
  formatEstimatedHours,
  formatPlannedSession,
  formatPriceEstimate,
} from '@/lib/appointmentVisibility';
import { screenErrorMessage } from '@/lib/screenError';
import {
  durationMinutes,
  formatDateKey,
  formatDuration,
  relativeDayLabel,
  shortZoneLabel,
  studioTimeOfDay,
  civilDateKey,
  deviceTimeZone,
} from '@/lib/studioTime';
import { colors, hairline, radius, space, type } from '@/theme';

const TONE_COLORS = { accent: colors.accent, neutral: colors.fgMuted, alert: colors.danger } as const;

function detailErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.fromApi && err.status === 404) {
    // The route answers 404 both for "no such appointment" and for one at
    // a studio the caller has no membership at — deliberately
    // indistinguishable, so it can't be used to probe for records. The
    // copy has to cover both without guessing which.
    return 'This appointment is not available to you.';
  }
  return screenErrorMessage(err, 'this appointment');
}

export default function AppointmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const { timeZone, ready: timeZoneReady } = useStudioTimeZone();

  const [appointment, setAppointment] = useState<AppointmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!token || !id) return;
      const seq = ++requestRef.current;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const next = await fetchAppointment(token, id);
        if (seq !== requestRef.current) return;
        setAppointment(next);
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

  const visibility = useMemo(
    () =>
      appointmentVisibility({
        role: session?.profile.role ?? '',
        permissions: session?.profile.permissions ?? [],
        appointment,
      }),
    [session?.profile.role, session?.profile.permissions, appointment],
  );

  if (!appointment) {
    return (
      <ScreenShell edges={['top']}>
        <ScreenHeader title="Appointment" onBack={() => router.back()} right={<View style={styles.headerSpacer} />} />
        {error ? (
          <View style={styles.centre}>
            <StateMessage
              eyebrow="Not loaded"
              tone="alert"
              title={error}
              action={{ label: 'Try again', onPress: () => load('refresh') }}
            />
          </View>
        ) : (
          <ScreenLoading />
        )}
      </ScreenShell>
    );
  }

  const badge = appointmentBadge(appointment);
  const dimmed = isDimmed(appointment);
  const clientLabel = appointment.client
    ? `${appointment.client.firstName} ${appointment.client.lastName}`.trim()
    : 'No client';
  const artistName = appointment.artist.user.name ?? appointment.artist.user.email;
  const minutes = durationMinutes(appointment.startTime, appointment.endTime);
  const dateKey = timeZoneReady ? civilDateKey(new Date(appointment.startTime), timeZone) : null;
  const showZone = timeZoneReady && timeZone !== deviceTimeZone();
  const estimate = appointment.inquiry
    ? formatPriceEstimate(appointment.inquiry.priceEstimateLow, appointment.inquiry.priceEstimateHigh)
    : null;

  return (
    <ScreenShell edges={['top']}>
      <ScreenHeader
        title={clientLabel}
        subtitle={artistName}
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
        {/* A record at a studio the caller only guests at. Said plainly and
            up front, because it changes what any future action here can do
            — every one of them is rejected server-side. */}
        {appointment.fromGuestStudio ? (
          <View style={styles.guestBanner}>
            <Feather name="map-pin" size={13} color={colors.accent} />
            <Text style={styles.guestLabel}>
              At {appointment.fromGuestStudio.name} — you are a guest here
            </Text>
          </View>
        ) : null}

        <View style={[styles.hero, dimmed && styles.dimmed]}>
          <View style={styles.heroTop}>
            <View style={[styles.spine, { backgroundColor: colorForArtistId(appointment.artist.id) }]} />
            <View style={styles.heroText}>
              <Text style={styles.heroDay}>
                {dateKey ? relativeDayLabel(dateKey, timeZone) : ' '}
              </Text>
              <Text style={styles.heroTime}>
                {timeZoneReady
                  ? `${studioTimeOfDay(appointment.startTime, timeZone)} – ${studioTimeOfDay(appointment.endTime, timeZone)}`
                  : ' '}
              </Text>
              <Text style={styles.heroMeta}>
                {dateKey ? formatDateKey(dateKey, { weekday: 'long', day: 'numeric', month: 'long' }) : ''}
                {'  ·  '}
                {formatDuration(minutes)}
                {showZone ? `  ·  ${shortZoneLabel(timeZone)}` : ''}
              </Text>
            </View>
          </View>

          <View style={styles.heroBadges}>
            <View style={styles.badge}>
              <View style={[styles.badgeDot, { backgroundColor: TONE_COLORS[badge.tone] }]} />
              <Text style={[styles.badgeLabel, { color: TONE_COLORS[badge.tone] }]}>{badge.label.toUpperCase()}</Text>
            </View>
            {appointment.appointmentType === 'CONSULTATION' ? (
              <View style={styles.consultation}>
                <Text style={styles.consultationLabel}>CONSULTATION</Text>
              </View>
            ) : null}
            {appointment.depositPaid ? (
              <View style={styles.badge}>
                <Feather name="check" size={11} color={colors.fgMuted} />
                <Text style={[styles.badgeLabel, { color: colors.fgMuted }]}>DEPOSIT PAID</Text>
              </View>
            ) : null}
          </View>
        </View>

        {appointment.plannedSession ? (
          <DetailSection title="Session plan">
            <DetailField label="Which session" value={formatPlannedSession(appointment.plannedSession)} />
            {formatEstimatedHours(
              appointment.plannedSession.estimatedHoursMin,
              appointment.plannedSession.estimatedHoursMax,
            ) ? (
              <>
                <FieldDivider />
                <DetailField
                  label="Estimate"
                  value={formatEstimatedHours(
                    appointment.plannedSession.estimatedHoursMin,
                    appointment.plannedSession.estimatedHoursMax,
                  )}
                />
              </>
            ) : null}
          </DetailSection>
        ) : null}

        {appointment.inquiry ? (
          <DetailSection title="The work" accent>
            <DetailField label="Description" value={appointment.inquiry.description} multiline />
            <FieldDivider />
            <DetailField label="Placement" value={appointment.inquiry.placement} />
            <FieldDivider />
            <DetailField label="Colour or black & grey" value={appointment.inquiry.colorOrBlackGrey} />
            <FieldDivider />
            <DetailField label="Estimate" value={estimate} />
          </DetailSection>
        ) : null}

        {appointment.notes ? (
          <DetailSection title="Booking note">
            <DetailField label="Note" value={appointment.notes} multiline />
          </DetailSection>
        ) : null}

        {appointment.liabilityWaiver ? (
          <DetailSection title="Waiver">
            <DetailField label="Status" value={appointment.liabilityWaiver.status} />
            {appointment.liabilityWaiver.signedAt ? (
              <>
                <FieldDivider />
                <DetailField
                  label="Signed"
                  value={
                    timeZoneReady
                      ? `${formatDateKey(civilDateKey(new Date(appointment.liabilityWaiver.signedAt), timeZone))} · ${studioTimeOfDay(appointment.liabilityWaiver.signedAt, timeZone)}`
                      : null
                  }
                />
              </>
            ) : null}
          </DetailSection>
        ) : null}

        {/* Financial detail. Behind `appointments.checkout`, which an
            ARTIST does not have by default — see appointmentVisibility.ts. */}
        {visibility.canSeeFinancials && appointment.checkedOutAt ? (
          <DetailSection title="Checkout">
            <DetailField
              label="Final cost"
              value={appointment.finalCostCents != null ? formatCents(appointment.finalCostCents) : null}
            />
            {appointment.tipCents != null ? (
              <>
                <FieldDivider />
                <DetailField label="Tip" value={formatCents(appointment.tipCents)} />
              </>
            ) : null}
            <FieldDivider />
            <DetailField
              label="Checked out"
              value={
                timeZoneReady
                  ? `${formatDateKey(civilDateKey(new Date(appointment.checkedOutAt), timeZone))} · ${studioTimeOfDay(appointment.checkedOutAt, timeZone)}${
                      appointment.checkedOutBy
                        ? ` by ${appointment.checkedOutBy.name ?? appointment.checkedOutBy.email}`
                        : ''
                    }`
                  : null
              }
            />
            {appointment.closeoutNotes ? (
              <>
                <FieldDivider />
                <DetailField label="Closeout notes" value={appointment.closeoutNotes} multiline />
              </>
            ) : null}
          </DetailSection>
        ) : null}

        {/* Gift card amounts are their own permission on web, separate
            from the checkout gate above, for the same financial-detail
            reason. Hidden entirely rather than shown without figures. */}
        {visibility.canSeeGiftCards && appointment.giftCards.length > 0 ? (
          <DetailSection title={appointment.giftCards.length === 1 ? 'Gift card' : 'Gift cards'}>
            {appointment.giftCards.map((card, i) => (
              <View key={card.id}>
                {i > 0 ? <FieldDivider /> : null}
                <DetailField
                  label={card.code}
                  value={
                    card.status === 'EXEMPT'
                      ? `Deposit exemption${card.exemptionReason ? ` — ${card.exemptionReason}` : ''}`
                      : `${formatCents(card.amountCents)} · ${card.status}`
                  }
                />
              </View>
            ))}
          </DetailSection>
        ) : null}

        {appointment.photos.length > 0 ? (
          <View style={styles.photosSection}>
            <Text style={styles.photosTitle}>
              {appointment.photos.length === 1 ? 'PHOTO' : `PHOTOS (${appointment.photos.length})`}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photosRow}>
              {appointment.photos.map((photo) => (
                <Pressable
                  key={photo.id}
                  onPress={() => Linking.openURL(photo.url)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Open photo"
                  style={({ pressed }) => [styles.photo, pressed && styles.pressed]}
                >
                  <Image source={{ uri: photo.url }} style={styles.photoImage} resizeMode="cover" />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.footerText}>{appointment.studio.name}</Text>
          <Text style={styles.footerText}>
            Booked {timeZoneReady ? formatDateKey(civilDateKey(new Date(appointment.createdAt), timeZone)) : ''}
          </Text>
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
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
  heroTop: { flexDirection: 'row', gap: space.md },
  spine: { width: 3, borderRadius: radius.pill },
  heroText: { flex: 1, gap: 2 },
  heroDay: { ...type.eyebrow, color: colors.accent },
  heroTime: { ...type.display, fontSize: 30, lineHeight: 36, color: colors.fg },
  heroMeta: { ...type.meta, color: colors.fgMuted },
  heroBadges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.md },
  badge: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  badgeDot: { width: 6, height: 6, borderRadius: radius.pill },
  badgeLabel: { ...type.label },
  consultation: {
    borderWidth: hairline,
    borderColor: colors.accent,
    borderStyle: 'dashed',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
  },
  consultationLabel: { ...type.label, fontSize: 9, color: colors.accent },

  photosSection: { gap: space.sm, paddingTop: space.xl },
  photosTitle: { ...type.eyebrow, color: colors.fgMuted, paddingHorizontal: space.lg },
  photosRow: { paddingHorizontal: space.lg, gap: space.sm },
  photo: {
    width: 108,
    height: 108,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.cardGlass,
  },
  photoImage: { width: '100%', height: '100%' },
  pressed: { opacity: 0.7 },

  footer: { paddingHorizontal: space.lg, paddingTop: space.xxl, gap: 2 },
  footerText: { ...type.meta, color: colors.fgMuted },
});
