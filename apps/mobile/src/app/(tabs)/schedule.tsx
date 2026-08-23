import type { AppointmentListItem } from '@ink-manager/shared-types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppointmentRow } from '@/components/AppointmentRow';
import { DayStrip } from '@/components/DayStrip';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useStudioTimeZone } from '@/hooks/useStudioTimeZone';
import { useAuth } from '@/context/auth';
import { appointmentsOnStudioDay, groupByStudioDay } from '@/lib/appointmentDisplay';
import { fetchAppointments } from '@/lib/appointments';
import { screenErrorMessage } from '@/lib/screenError';
import {
  civilDateKey,
  deviceTimeZone,
  formatDateKey,
  relativeDayLabel,
  shiftDateKey,
  shortZoneLabel,
  studioDayRange,
  todayKey as studioTodayKey,
} from '@/lib/studioTime';
import { colors, hairline, radius, space, type } from '@/theme';

/** Same cadence as the Conversations screens — see that decision in REPORT.md. */
const POLL_MS = 30_000;

/**
 * How far the Upcoming mode looks ahead. Bounded deliberately: the API
 * caps a ranged query at 500 results and has no pagination, so an
 * open-ended "everything from now on" would silently truncate at an
 * arbitrary point rather than at a date anyone chose.
 */
const UPCOMING_DAYS = 30;

type Mode = 'day' | 'upcoming';

export default function ScheduleScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const { timeZone, ready: timeZoneReady, usingFallback } = useStudioTimeZone();

  const [mode, setMode] = useState<Mode>('day');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<AppointmentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const requestRef = useRef(0);

  // The studio's today, not the device's. Recomputed on every render
  // rather than stored, so an app left open across midnight (in the
  // STUDIO's zone) corrects itself.
  const today = timeZoneReady ? studioTodayKey(timeZone) : null;
  const activeKey = selectedKey ?? today;

  // One fetch covers both modes: the union of the window each needs,
  // which for a selected day inside the upcoming window is just the
  // upcoming window. Avoids refetching every time the mode toggles.
  const range = useMemo(() => {
    if (!today || !activeKey) return null;
    const earliestKey = activeKey < today ? activeKey : today;
    const upcomingEndKey = shiftDateKey(today, UPCOMING_DAYS);
    const latestKey = activeKey > upcomingEndKey ? activeKey : upcomingEndKey;
    return {
      start: studioDayRange(earliestKey, timeZone).start,
      end: studioDayRange(latestKey, timeZone).end,
    };
  }, [today, activeKey, timeZone]);

  const load = useCallback(
    async (fetchMode: 'initial' | 'refresh' | 'poll') => {
      if (!token || !range) return;
      const seq = ++requestRef.current;
      if (fetchMode === 'refresh') setRefreshing(true);

      try {
        const next = await fetchAppointments(token, { start: range.start, end: range.end });
        if (seq !== requestRef.current) return;
        setAppointments(next);
        setError(null);
      } catch (err) {
        if (seq !== requestRef.current) return;
        // A failed background poll must not clear a schedule that is
        // already on screen and still perfectly readable.
        if (fetchMode === 'poll' && appointments !== null) return;
        setError(screenErrorMessage(err, 'the schedule'));
      } finally {
        if (seq === requestRef.current && fetchMode === 'refresh') setRefreshing(false);
      }
    },
    [token, range, appointments],
  );

  const rangeKey = range ? `${range.start.toISOString()}|${range.end.toISOString()}` : null;

  useEffect(() => {
    load('initial');
    // Keyed on the range, not on `load` (whose identity changes with every
    // response) — a new window is the only reason to refetch here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, rangeKey]);

  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => load('poll'), POLL_MS);
      return () => clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, rangeKey]),
  );

  useEffect(() => () => void ++requestRef.current, []);

  const markedKeys = useMemo(() => {
    if (!appointments) return new Set<string>();
    return new Set(appointments.map((a) => civilDateKey(new Date(a.startTime), timeZone)));
  }, [appointments, timeZone]);

  const sections = useMemo(() => {
    if (!appointments || !activeKey || !today) return [];
    if (mode === 'day') {
      const forDay = appointmentsOnStudioDay(appointments, activeKey, timeZone);
      return forDay.length > 0 ? [{ dateKey: activeKey, data: forDay }] : [];
    }
    // Upcoming: from the studio's today onward, grouped by studio day.
    const fromToday = appointments.filter(
      (a) => civilDateKey(new Date(a.startTime), timeZone) >= today,
    );
    return groupByStudioDay(fromToday, timeZone).map((g) => ({ dateKey: g.dateKey, data: g.appointments }));
  }, [appointments, activeKey, today, mode, timeZone]);

  const showZone = timeZoneReady && timeZone !== deviceTimeZone();
  const subtitle = usingFallback
    ? `Studio timezone unavailable — showing ${shortZoneLabel(timeZone)}`
    : showZone
      ? `Times in ${shortZoneLabel(timeZone)}`
      : undefined;

  // Nothing renders until the studio's timezone is known: showing dates on
  // the device's clock and then silently correcting them is worse than a
  // brief spinner.
  if (!timeZoneReady || !today || !activeKey) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Schedule" />
        <ScreenLoading />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title="Schedule" subtitle={subtitle} />

      <View style={styles.controls}>
        <View style={styles.modes}>
          {(['day', 'upcoming'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === m }}
              style={({ pressed }) => [styles.mode, mode === m && styles.modeActive, pressed && styles.pressed]}
            >
              <Text style={[styles.modeLabel, mode === m && styles.modeLabelActive]}>
                {m === 'day' ? 'DAY' : 'UPCOMING'}
              </Text>
            </Pressable>
          ))}
        </View>

        {activeKey !== today ? (
          <Pressable
            onPress={() => setSelectedKey(today)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.todayButton, pressed && styles.pressed]}
          >
            <Text style={styles.todayLabel}>TODAY</Text>
          </Pressable>
        ) : null}
      </View>

      {mode === 'day' ? (
        <DayStrip todayKey={today} selectedKey={activeKey} onSelect={setSelectedKey} markedKeys={markedKeys} />
      ) : null}

      {appointments === null && error === null ? (
        <ScreenLoading />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AppointmentRow
              appointment={item}
              timeZone={timeZone}
              // Object form, not an interpolated string: typed routes
              // describe a dynamic route by its literal `[id]` pathname.
              onPress={() => router.push({ pathname: '/appointment/[id]', params: { id: item.id } })}
            />
          )}
          renderSectionHeader={({ section }) =>
            // The Day mode already names the day above the list, so a
            // section header there would just repeat it.
            mode === 'upcoming' ? (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>{relativeDayLabel(section.dateKey, timeZone).toUpperCase()}</Text>
                <View style={styles.sectionRule} />
                <Text style={styles.sectionDate}>{formatDateKey(section.dateKey, { day: 'numeric', month: 'short' })}</Text>
              </View>
            ) : null
          }
          ListHeaderComponent={
            mode === 'day' ? (
              <View style={styles.dayHeading}>
                <Text style={styles.dayHeadingLabel}>{relativeDayLabel(activeKey, timeZone)}</Text>
                <Text style={styles.dayHeadingDate}>
                  {formatDateKey(activeKey, { weekday: 'long', day: 'numeric', month: 'long' })}
                </Text>
              </View>
            ) : null
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.listContent}
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
            ) : mode === 'day' ? (
              <StateMessage
                eyebrow={relativeDayLabel(activeKey, timeZone)}
                title="Nothing booked"
                body={`No sessions on ${formatDateKey(activeKey, { weekday: 'long', day: 'numeric', month: 'long' })}.`}
              />
            ) : (
              <StateMessage
                eyebrow="Clear"
                title="Nothing coming up"
                body={`No sessions booked in the next ${UPCOMING_DAYS} days.`}
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

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  modes: { flexDirection: 'row', gap: space.xs },
  mode: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  modeActive: { borderColor: colors.accent, backgroundColor: colors.surface },
  modeLabel: { ...type.label, color: colors.fgMuted },
  modeLabelActive: { color: colors.accent },
  todayButton: { paddingHorizontal: space.sm, paddingVertical: space.sm },
  todayLabel: { ...type.label, color: colors.accent },
  pressed: { opacity: 0.6 },

  dayHeading: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, gap: 2 },
  dayHeadingLabel: { ...type.display, fontSize: 22, lineHeight: 27, color: colors.fg },
  dayHeadingDate: { ...type.meta, color: colors.fgMuted },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  sectionLabel: { ...type.eyebrow, color: colors.accent },
  sectionRule: { flex: 1, height: hairline, backgroundColor: colors.borderSoft },
  sectionDate: { ...type.meta, color: colors.fgMuted },

  listContent: { paddingBottom: space.xxl },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  separator: { height: hairline, backgroundColor: colors.borderSoft, marginLeft: space.lg + 52 + space.md },
});
