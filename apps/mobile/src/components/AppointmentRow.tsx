import type { AppointmentListItem } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, Text, View } from 'react-native';

import {
  appointmentBadge,
  clientName,
  colorForArtistId,
  isDimmed,
  type AppointmentTone,
} from '@/lib/appointmentDisplay';
import { durationMinutes, formatDuration, studioTimeOfDay } from '@/lib/studioTime';
import { colors, hairline, radius, space, type } from '@/theme';

const TONE_COLORS: Record<AppointmentTone, string> = {
  accent: colors.accent,
  neutral: colors.fgMuted,
  // The only red on the Schedule tab, and only for a session that was
  // actually lost — never for "busy", "soon", or any other emphasis.
  alert: colors.danger,
};

export function AppointmentRow({
  appointment,
  timeZone,
}: {
  appointment: AppointmentListItem;
  timeZone: string;
}) {
  const badge = appointmentBadge(appointment);
  const dimmed = isDimmed(appointment);
  const artistColor = colorForArtistId(appointment.artist.id);
  const isConsultation = appointment.appointmentType === 'CONSULTATION';
  const minutes = durationMinutes(appointment.startTime, appointment.endTime);

  return (
    <View style={[styles.row, dimmed && styles.dimmed]}>
      <View style={styles.timeColumn}>
        <Text style={styles.startTime}>{studioTimeOfDay(appointment.startTime, timeZone)}</Text>
        <Text style={styles.duration}>{formatDuration(minutes)}</Text>
      </View>

      {/* Per-artist colour, same hash and palette as the web calendar, so
          the same artist reads the same on both. */}
      <View style={[styles.spine, { backgroundColor: artistColor }]} />

      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Text style={styles.client} numberOfLines={1}>
            {clientName(appointment)}
          </Text>
          {isConsultation ? (
            <View style={styles.consultation}>
              <Text style={styles.consultationLabel}>CONSULT</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.artist} numberOfLines={1}>
          {appointment.artist.name}
        </Text>

        {appointment.inquiry ? (
          <Text style={styles.project} numberOfLines={2}>
            {appointment.inquiry.label}
          </Text>
        ) : null}

        <View style={styles.metaLine}>
          <View style={styles.badge}>
            <View style={[styles.badgeDot, { backgroundColor: TONE_COLORS[badge.tone] }]} />
            <Text style={[styles.badgeLabel, { color: TONE_COLORS[badge.tone] }]}>{badge.label.toUpperCase()}</Text>
          </View>

          {appointment.depositPaid ? (
            <View style={styles.deposit}>
              <Feather name="check" size={11} color={colors.fgMuted} />
              <Text style={styles.depositLabel}>DEPOSIT</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  // Cancelled and no-show sessions stay listed — they are part of what
  // happened that day — but recede.
  dimmed: { opacity: 0.45 },

  timeColumn: { width: 52, alignItems: 'flex-end', gap: 2, paddingTop: 1 },
  startTime: { ...type.heading, fontSize: 16, lineHeight: 20, color: colors.fg },
  duration: { ...type.meta, color: colors.fgMuted },

  spine: { width: 3, borderRadius: radius.pill, marginVertical: 2 },

  body: { flex: 1, gap: 3 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  client: { ...type.heading, color: colors.fg, flexShrink: 1 },
  consultation: {
    borderWidth: hairline,
    borderColor: colors.accent,
    borderStyle: 'dashed',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
  },
  consultationLabel: { ...type.label, fontSize: 9, color: colors.accent },

  artist: { ...type.small, color: colors.fgSecondary },
  project: { ...type.small, color: colors.fgMuted },

  metaLine: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 3 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  badgeDot: { width: 6, height: 6, borderRadius: radius.pill },
  badgeLabel: { ...type.label },
  deposit: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  depositLabel: { ...type.label, color: colors.fgMuted },
});
