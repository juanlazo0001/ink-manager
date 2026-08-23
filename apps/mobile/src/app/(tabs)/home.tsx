import type { DashboardResponse } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Eyebrow, ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { useStudioTimeZone } from '@/hooks/useStudioTimeZone';
import { fetchDashboard, presetRange, RANGE_PRESETS, type DateRange, type RangeDays } from '@/lib/dashboard';
import {
  firstName,
  formatHours,
  formatPercent,
  funnelIsEmpty,
  funnelRows,
  hasFinancials,
  sampleNote,
} from '@/lib/dashboardDisplay';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, radius, space, tones, type } from '@/theme';

/**
 * The Home tab: web's Dashboard, for an artist.
 *
 * Every number here is the caller's OWN work — the API scopes an ARTIST
 * down to their assigned inquiries and appointments automatically and
 * says so in `scope`, which this screen reads rather than assuming.
 *
 * The date range is computed in the STUDIO's timezone, not the phone's.
 * `GET /reports/dashboard` resolves the keys it is sent against the
 * studio's zone, so sending device-local keys would silently ask for a
 * different window than the one on the label. That is the same bug class
 * this repo has hit four times, and the API's own range parser had it
 * before it was fixed.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const { timeZone, ready } = useStudioTimeZone();

  const [days, setDays] = useState<RangeDays>(30);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Not memoised on `now`: the range is recomputed per render from the
  // studio's clock, which is what makes "last 30 days" still correct if
  // the app has been open across midnight.
  const range: DateRange | null = ready ? presetRange(days, timeZone) : null;
  const rangeKey = range ? `${range.start}:${range.end}` : null;

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!token || !rangeKey) return;
      const [start, end] = rangeKey.split(':');
      if (mode === 'refresh') setRefreshing(true);
      try {
        const next = await fetchDashboard(token, { start, end });
        setData(next);
        setError(null);
      } catch (err) {
        setError(screenErrorMessage(err, 'your dashboard'));
      } finally {
        setRefreshing(false);
      }
    },
    [token, rangeKey],
  );

  useFocusEffect(
    useCallback(() => {
      void load('initial');
    }, [load]),
  );

  const rows = useMemo(() => (data ? funnelRows(data) : []), [data]);
  const greeting = session ? firstName(session.profile.name, session.profile.email) : '';

  if (!ready || (!data && !error)) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Home" />
        <ScreenLoading />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title="Home" subtitle={session?.studio?.name ?? undefined} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={colors.accent} />
        }
      >
        <View style={styles.welcome}>
          <Eyebrow>{data?.scope === 'studio' ? 'The studio' : 'Your work'}</Eyebrow>
          <Text style={styles.welcomeText}>
            Welcome, <Text style={styles.welcomeName}>{greeting}</Text>
          </Text>
        </View>

        <View style={styles.rangeRow}>
          {RANGE_PRESETS.map((preset) => {
            const on = preset.days === days;
            return (
              <Pressable
                key={preset.days}
                onPress={() => setDays(preset.days)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [styles.range, on && styles.rangeOn, pressed && styles.pressed]}
              >
                <Text style={[styles.rangeLabel, on && styles.rangeLabelOn]}>{preset.label.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>
        {range ? (
          <Text style={styles.rangeNote}>
            {range.start} to {range.end} · {timeZone.replace(/_/g, ' ')}
          </Text>
        ) : null}

        {error ? (
          <StateMessage
            eyebrow="Not available"
            tone="alert"
            title="Your dashboard didn't load"
            body={error}
            action={{ label: 'Try again', onPress: () => void load('initial') }}
          />
        ) : data ? (
          <>
            {/* Not date-ranged, and said so out loud: it is a right-now
                count, and someone comparing it against the funnel above
                would otherwise assume the same window applies. */}
            <Pressable
              onPress={() => router.push('/inquiries')}
              accessibilityRole="button"
              style={({ pressed }) => [styles.needsCard, pressed && styles.pressed]}
            >
              <View style={styles.needsText}>
                <Eyebrow style={styles.accentEyebrow}>Needs scheduling</Eyebrow>
                <Text style={styles.bigNumber}>{data.needsSchedulingCount}</Text>
                <Text style={styles.hint}>
                  {data.needsSchedulingCount === 1 ? 'project has' : 'projects have'} a paid deposit and no appointment
                  yet. Right now — not the range above.
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.fgMuted} />
            </Pressable>

            <Section title="Your inquiry funnel">
              {funnelIsEmpty(data) ? (
                <Text style={styles.hint}>Nothing came in during this window.</Text>
              ) : (
                <View style={styles.funnel}>
                  {rows.map((row) => (
                    <View key={row.stage} style={styles.funnelRow}>
                      <View style={styles.funnelHead}>
                        <Text style={styles.funnelLabel}>{row.label}</Text>
                        <Text style={styles.funnelCount}>{row.count}</Text>
                        {row.conversion ? <Text style={styles.funnelPct}>{row.conversion}</Text> : null}
                      </View>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { width: `${Math.round(row.fill * 100)}%` }]} />
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Section>

            <Section title="Lost / cold rate">
              <View style={styles.statRow}>
                <Stat label="Rate" value={formatPercent(data.lostRate.lostColdRate) ?? '—'} tone="warning" />
                <Stat label="Lost" value={String(data.lostRate.lost)} />
                <Stat label="Cold" value={String(data.lostRate.cold)} />
                <Stat label="Confirmed" value={String(data.lostRate.converted)} tone="success" />
              </View>
              {data.lostRate.lostColdRate === null ? (
                <Text style={styles.hint}>No projects have resolved either way yet.</Text>
              ) : null}
            </Section>

            <Section title="Response time">
              <View style={styles.stack}>
                <View>
                  <Text style={styles.statLabel}>YOU SENT AN ESTIMATE</Text>
                  <Text style={styles.bigNumber}>{formatHours(data.responseTime.avgHoursToEstimateSent) ?? '—'}</Text>
                  <Text style={styles.hint}>
                    Average from the inquiry arriving. {sampleNote(data.responseTime.sampleSizeEstimateSent)}
                  </Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>THEY REPLIED</Text>
                  <Text style={styles.bigNumber}>{formatHours(data.responseTime.avgHoursToResponse) ?? '—'}</Text>
                  <Text style={styles.hint}>
                    Average from your estimate going out. {sampleNote(data.responseTime.sampleSizeResponse)}
                  </Text>
                </View>
              </View>
            </Section>

            <Section title="Appointments">
              <Text style={styles.bigNumber}>
                {data.artistUtilization.reduce((sum, a) => sum + a.appointmentCount, 0)}
              </Text>
              <Text style={styles.hint}>
                {data.scope === 'own' ? 'Yours in this window.' : "Across the studio in this window."}
              </Text>
              {/* A cross-artist comparison is only meaningful for a caller
                  who can see more than one artist. For an ARTIST the API
                  returns exactly their own row, so listing it would be a
                  table of one. */}
              {data.scope === 'studio' && data.artistUtilization.length > 1 ? (
                <View style={styles.utilList}>
                  {data.artistUtilization.map((artist) => (
                    <View key={artist.artistId} style={styles.utilRow}>
                      <Text style={styles.utilName} numberOfLines={1}>
                        {artist.name}
                      </Text>
                      <Text style={styles.utilCount}>{artist.appointmentCount}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Section>

            {/* Present only when the API actually sent them. It OMITS both
                objects without reports.viewFinancial (default false for
                ARTIST) rather than zeroing them, precisely so a client can
                hide the section instead of showing a misleading $0. */}
            {hasFinancials(data) ? (
              <Section title="Deposits">
                {data.depositConversion ? (
                  <View style={styles.statRow}>
                    <Stat label="Sent" value={String(data.depositConversion.sent)} />
                    <Stat label="Paid" value={String(data.depositConversion.paid)} tone="success" />
                    <Stat label="Rate" value={formatPercent(data.depositConversion.conversionRate) ?? '—'} />
                  </View>
                ) : null}
                {data.giftCardLiability ? (
                  <Text style={styles.hint}>
                    {data.giftCardLiability.activeCardCount} active gift card
                    {data.giftCardLiability.activeCardCount === 1 ? '' : 's'} · $
                    {(data.giftCardLiability.totalCents / 100).toFixed(2)} outstanding
                  </Text>
                ) : null}
              </Section>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Eyebrow>{title}</Eyebrow>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: keyof typeof tones }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.statValue, tone ? { color: tones[tone] } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: space.xxl },

  welcome: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.xs },
  welcomeText: { ...type.display, color: colors.fg },
  welcomeName: { color: colors.accent },

  rangeRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg },
  range: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  rangeOn: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },
  rangeLabel: { ...type.label, color: colors.fgMuted },
  rangeLabelOn: { color: colors.accent },
  rangeNote: { ...type.meta, color: colors.fgMuted, paddingHorizontal: space.lg, paddingTop: space.sm },

  needsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.lg,
    marginTop: space.xl,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.card,
  },
  needsText: { flex: 1, gap: space.xs },
  accentEyebrow: { color: colors.accent },

  section: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.xl },
  card: {
    backgroundColor: colors.surface,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.sm,
  },

  funnel: { gap: space.md },
  funnelRow: { gap: space.xs },
  funnelHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  funnelLabel: { ...type.small, color: colors.fgSecondary, flex: 1 },
  funnelCount: { ...type.body, color: colors.fg },
  funnelPct: { ...type.meta, color: colors.fgMuted, width: 46, textAlign: 'right' },
  barTrack: { height: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceInset, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: radius.pill, backgroundColor: colors.accent },

  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl },
  stat: { gap: 2 },
  statLabel: { ...type.label, color: colors.fgMuted },
  statValue: { ...type.heading, color: colors.fg },

  stack: { gap: space.lg },
  bigNumber: { ...type.display, color: colors.fg },
  hint: { ...type.meta, color: colors.fgMuted },

  utilList: { gap: space.xs, paddingTop: space.sm },
  utilRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  utilName: { ...type.small, color: colors.fgSecondary, flex: 1 },
  utilCount: { ...type.body, color: colors.fg },

  pressed: { opacity: 0.6 },
});
