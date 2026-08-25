import type { DashboardResponse } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  EditorialCard,
  Eyebrow,
  SectionHeader,
  FunnelBar,
  FunnelBarList,
  RedRule,
  StatChip,
} from '@/components/editorial';
import { ScreenShell } from '@/components/ScreenShell';
import { TopBar } from '@/components/TopBar';
import { Pill, PillRow } from '@/components/Pill';
import { SkeletonCards } from '@/components/Skeleton';
import { StateMessage } from '@/components/ui';
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
  // Web scales its bars to the largest stage, not to `received`, and this
  // mirrors `HorizontalBarList`'s own `Math.max(...values, 1)`.
  const funnelMax = useMemo(() => Math.max(...rows.map((r) => r.count), 1), [rows]);
  const rangeCaption = range ? `${range.start} – ${range.end}` : undefined;
  const greeting = session ? firstName(session.profile.name, session.profile.email) : '';

  if (!ready || (!data && !error)) {
    return (
      <ScreenShell edges={['top']}>
        <TopBar />
        <SkeletonCards count={4} />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell edges={['top']}>
      <TopBar />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={colors.accent} />
        }
      >
        <View style={styles.welcome}>
          {/* Web's own subtitle copy, verbatim. */}
          <Eyebrow>
            {data?.scope === 'studio' ? "Here's how the studio is doing." : "Here's how your work is going."}
          </Eyebrow>
          <Text style={styles.welcomeText}>
            Welcome, <Text style={styles.welcomeName}>{greeting}</Text>
          </Text>
        </View>

        <PillRow style={styles.rangeRow}>
          {RANGE_PRESETS.map((preset) => (
            <Pill
              key={preset.days}
              label={preset.label}
              selected={preset.days === days}
              onPress={() => setDays(preset.days)}
            />
          ))}
        </PillRow>

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
                {/* Web's own caption, verbatim, in the eyebrow slot -- with
                    the title as a .sc heading beneath it, the same
                    arrangement every other card on the page uses. */}
                <Eyebrow>Right now, not affected by the date range above</Eyebrow>
                <SectionHeader style={styles.needsTitle}>Needs Scheduling</SectionHeader>
                <Text style={styles.needsNumber}>{data.needsSchedulingCount}</Text>
                <Text style={styles.hint}>
                  {data.needsSchedulingCount === 1 ? 'project has' : 'projects have'} a paid deposit and no appointment
                  yet. Right now — not the range above.
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.fgMuted} />
            </Pressable>

            <EditorialCard
              title={data.scope === 'own' ? 'Your Inquiry Funnel' : 'Inquiry Funnel'}
              caption={rangeCaption}
              style={styles.card}
            >
              <Text style={styles.cardHint}>Conversion is shown as % of Received still in this stage today</Text>
              {funnelIsEmpty(data) ? (
                <Text style={styles.hint}>Nothing came in during this window.</Text>
              ) : (
                <FunnelBarList>
                  {rows.map((row) => (
                    <FunnelBar
                      key={row.stage}
                      label={row.label}
                      value={row.count}
                      max={funnelMax}
                      // Web composes exactly this: `${count} (${pct})`,
                      // with an em dash where the rate is null.
                      valueLabel={`${row.count} (${row.conversion ?? '—'})`}
                    />
                  ))}
                </FunnelBarList>
              )}
            </EditorialCard>

            {/* Rebuilt to web's own layout. The four-column version this
                replaces was invented here -- web has a short red rule, then
                either the cream chip or a designed empty state, then the
                caption, then three dots. Green appears only as one of those
                dots (--color-success, web's `bg-success` on "N Confirmed"),
                never as a figure. */}
            <EditorialCard title="Lost / Cold Rate" caption={rangeCaption} style={styles.card}>
              <RedRule style={styles.redRule} />
              {data.lostRate.lostColdRate === null ? (
                <View style={styles.emptyRow}>
                  <Text style={styles.emptyDash}>—</Text>
                  <Text style={styles.emptyText}>No outcomes yet in this range.</Text>
                </View>
              ) : (
                <>
                  <StatChip>{formatPercent(data.lostRate.lostColdRate)}</StatChip>
                  <Text style={styles.cardCaption}>
                    of {data.scope === 'own' ? 'your inquiries' : 'inquiries'} that reached a terminal outcome ended
                    lost or cold, rest converted
                  </Text>
                </>
              )}
              <View style={styles.dots}>
                <Dot color={colors.danger} label={`${data.lostRate.lost} Closed Lost`} />
                <Dot color={colors.warning} label={`${data.lostRate.cold} Cold Lead`} />
                <Dot color={colors.success} label={`${data.lostRate.converted} Confirmed`} />
              </View>
            </EditorialCard>

            <EditorialCard title="Response Time" caption={rangeCaption} style={styles.card}>
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
            </EditorialCard>

            <EditorialCard
              title={data.scope === 'own' ? 'My Appointments' : 'Artist Utilization'}
              caption={rangeCaption}
              style={styles.card}
            >
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
                  {/* Bars, not a bare list: web draws one per artist,
                      scaled to the busiest, so the comparison is visible
                      at a glance rather than read off numbers. Same
                      FunnelBar the funnel above uses -- identical
                      treatment, and it animates to width on range change. */}
                  <FunnelBarList>
                    {data.artistUtilization.map((artist) => (
                      <FunnelBar
                        key={artist.artistId}
                        label={artist.name}
                        valueLabel={String(artist.appointmentCount)}
                        value={artist.appointmentCount}
                        max={Math.max(...data.artistUtilization.map((a) => a.appointmentCount), 1)}
                      />
                    ))}
                  </FunnelBarList>
                </View>
              ) : null}
            </EditorialCard>

            {/* Present only when the API actually sent them. It OMITS both
                objects without reports.viewFinancial (default false for
                ARTIST) rather than zeroing them, precisely so a client can
                hide the section instead of showing a misleading $0. */}
            {/* Two cards on web, and the same two here -- both captioned
                "not affected by the date range above", because neither is
                date-ranged (a deposit form is sent once; liability is a
                right-now snapshot). The headline figure is the CONVERSION
                RATE, not a count, and nothing here is tinted green: a
                figure carries its meaning in the number. */}
            {hasFinancials(data) ? (
              <>
                {data.depositConversion ? (
                  <EditorialCard
                    title="Deposit Conversion"
                    caption="All-time, not affected by the date range above"
                    style={styles.card}
                  >
                    <Text style={styles.bigNumber}>
                      {formatPercent(data.depositConversion.conversionRate) ?? '—'}
                    </Text>
                    <Text style={styles.cardCaption}>
                      {data.depositConversion.paid} of {data.depositConversion.sent} deposit forms sent have been paid
                    </Text>
                    <Text style={styles.cardCaption}>
                      Avg time to payment: {formatHours(data.depositConversion.avgHoursToPayment) ?? '—'}
                    </Text>
                  </EditorialCard>
                ) : null}
                {data.giftCardLiability ? (
                  <EditorialCard
                    title="Outstanding Gift Card Liability"
                    caption="Right now, not affected by the date range above"
                    style={styles.card}
                  >
                    <Text style={styles.bigNumber}>
                      ${(data.giftCardLiability.totalCents / 100).toFixed(2)}
                    </Text>
                    <Text style={styles.cardCaption}>
                      across {data.giftCardLiability.activeCardCount} active, unredeemed gift card
                      {data.giftCardLiability.activeCardCount === 1 ? '' : 's'}
                    </Text>
                  </EditorialCard>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

/**
 * One of the three outcome counts under Lost / Cold Rate. Web:
 * `<span className="flex items-center gap-1.5">
 *    <span className="h-2 w-2 rounded-full bg-danger" /> {n} Closed Lost
 *  </span>`
 *
 * This is the ONLY place green appears on the dashboard, and it appears as
 * an 8px dot -- `--color-success`, web's own token. It is never a figure.
 */
function Dot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.dotRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.dotLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl },

  welcome: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.xs },
  // Web's dashboard title is `mt-1` under its eyebrow — 4px, not 12.
  welcomeText: { ...type.welcome, color: colors.fg, marginTop: space.xs },
  welcomeName: { ...type.welcomeName, color: colors.accentHover },

  rangeRow: { paddingTop: space.lg },
  rangeNote: { ...type.meta, color: colors.fgMuted, paddingHorizontal: space.lg, paddingTop: space.sm },

  needsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.lg,
    marginTop: space.xl,
    padding: space.lg,
    backgroundColor: colors.cardGlass,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.card,
  },
  needsText: { flex: 1, gap: space.xs },
  needsTitle: { marginTop: space.sm },
  accentEyebrow: { color: colors.accent },

  card: { marginHorizontal: space.lg, marginTop: space.lg },
  cardHint: { ...type.meta, color: colors.fgMuted, marginBottom: space.md },
  cardCaption: { ...type.small, color: colors.fgMuted, marginTop: space.md },
  redRule: { marginBottom: space.md },

  /* Web's designed empty state: a light red em dash beside an italic serif
     line, instead of the bare "—" formatPct would fall back to. */
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  emptyDash: { fontSize: 30, lineHeight: 32, color: colors.dangerStrong },
  emptyText: { ...type.displayItalic, color: colors.fgSecondary },

  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: space.lg },
  dotRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  dotLabel: { ...type.small, color: colors.fg },

  stack: { gap: space.lg },
  statLabel: { ...type.label, color: colors.fgMuted },
  bigNumber: { ...type.statNumeralSmall, color: colors.fg },
  hint: { ...type.meta, color: colors.fgMuted },
  needsNumber: { ...type.statNumeral, color: colors.fg },

  utilList: { gap: space.xs, paddingTop: space.sm },
  utilRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  utilName: { ...type.small, color: colors.fgSecondary, flex: 1 },
  utilCount: { ...type.body, color: colors.fg },

  pressed: { opacity: 0.6 },
});
