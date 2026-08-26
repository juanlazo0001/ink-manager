import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  actorLabel,
  fetchAuditTrail,
  formatAuditValue,
  humanizeAction,
  humanizeField,
  isFromTo,
  type AuditEntry,
} from '@/lib/audit';
import { dayHeading, stamp } from '@/lib/format';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * An entity's activity feed, as apps/web's `AuditTrail` renders one.
 *
 * Web's anatomy, extracted:
 *
 *   groups          by calendar day, newest first, `space-y-5`   -> 20
 *   day heading     `text-xs font-semibold uppercase tracking-wider text-fg-muted`
 *   entries         `space-y-3`                                  -> 12
 *   entry           `rounded-lg border border-border p-3 text-sm`
 *   entry top line  actor (medium, fg) + action (fg-secondary), timestamp right
 *   detail lines    `mt-2 space-y-1 text-xs text-fg-secondary`, "Field: from -> to"
 *
 * The API already returns newest-first, so walking the list once produces
 * the groups in the right order — web's own comment says the same.
 *
 * WHAT IS NOT PORTED: web shows two multi-select filters once an entity
 * has more than five entries, and it renders merge entries through a
 * separate sentence formatter. A gift card raises neither — merges are a
 * client-level action — so both are left out rather than transcribed
 * blind, and this note is the record of that.
 */
export function ActivityHistory({
  token,
  entityType,
  entityId,
}: {
  token: string;
  entityType: string;
  entityId: string;
}) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAuditTrail(token, entityType, entityId)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch(() => {
        if (!cancelled) setError('Activity history could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [token, entityType, entityId]);

  if (error) return <Text style={styles.empty}>{error}</Text>;
  if (entries === null) return <Text style={styles.empty}>Loading…</Text>;
  if (entries.length === 0) return <Text style={styles.empty}>No activity recorded yet.</Text>;

  const groups: { day: string; rows: AuditEntry[] }[] = [];
  for (const entry of entries) {
    const day = dayHeading(entry.createdAt);
    const current = groups[groups.length - 1];
    if (current?.day === day) current.rows.push(entry);
    else groups.push({ day, rows: [entry] });
  }

  return (
    <View style={styles.groups}>
      {groups.map((group) => (
        <View key={group.day} style={styles.group}>
          <Text style={styles.dayHeading}>{group.day.toUpperCase()}</Text>
          {group.rows.map((entry) => (
            <View key={entry.id} style={styles.entry}>
              <View style={styles.entryTop}>
                <Text style={styles.entryActor}>
                  {actorLabel(entry.actorUser)}{' '}
                  <Text style={styles.entryAction}>{humanizeAction(entry.action)}</Text>
                </Text>
                <Text style={styles.entryTime}>{stamp(entry.createdAt)}</Text>
              </View>

              {entry.changes && Object.keys(entry.changes).length > 0 ? (
                <View style={styles.changes}>
                  {Object.entries(entry.changes).map(([field, value]) => (
                    <Text key={field} style={styles.change}>
                      <Text style={styles.changeField}>{humanizeField(field)}: </Text>
                      {isFromTo(value)
                        ? `${formatAuditValue(value.from)} → ${formatAuditValue(value.to)}`
                        : formatAuditValue(value)}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { ...type.small, color: colors.fgMuted },

  groups: { gap: space.xl - space.xs },
  group: { gap: space.md },
  dayHeading: { ...type.meta, color: colors.fgMuted, letterSpacing: 1 },

  entry: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.sm,
  },
  entryTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  entryActor: { ...type.small, color: colors.fg, flexShrink: 1 },
  entryAction: { color: colors.fgSecondary },
  entryTime: { ...type.meta, color: colors.fgFaint },

  changes: { gap: 2 },
  change: { ...type.meta, color: colors.fgSecondary },
  changeField: { color: colors.fgMuted },
});
