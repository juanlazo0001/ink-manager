import Feather from '@expo/vector-icons/Feather';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SegmentedControl } from '@/components/SegmentedControl';
import { SkeletonList } from '@/components/Skeleton';
import { PERMISSION_GROUPS } from '@/lib/permissionGroups';
import { screenErrorMessage } from '@/lib/screenError';
import {
  CONFIGURABLE_ROLES,
  ROLE_LABELS,
  enabledCount,
  fetchPermissions,
  type ConfigurableRole,
  type PermissionsResponse,
} from '@/lib/team';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The permission matrix, read-only — moved here from the Team screen's
 * third tab at the owner's direction, so it lives beside the studio's
 * other configuration rather than beside its roster.
 *
 * Self-contained on purpose: it fetches its own permissions rather than
 * taking them as a prop. Team no longer needs them at all once this
 * moves, and threading a fetch through Settings solely to hand it back
 * down would leave both screens knowing about a request only one of them
 * uses.
 *
 * Still read-only, as it was on Team. Changing the matrix is a portal
 * action, and the note at the bottom says so rather than leaving a person
 * hunting for a control that is not there.
 */
export function PermissionsMatrix({ token, studioId }: { token: string; studioId: string }) {
  const [permissions, setPermissions] = useState<PermissionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<ConfigurableRole>('FRONT_DESK');
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPermissions(await fetchPermissions(token, studioId));
    } catch (err) {
      setError(screenErrorMessage(err, 'permissions'));
    }
  }, [token, studioId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!permissions) return <SkeletonList rows={4} />;

  return (
    <View style={styles.root}>
      <View style={styles.ownerBanner}>
        <Feather name="shield" size={14} color={colors.accent} />
        <Text style={styles.ownerBannerText}>
          Owner always has full access, in every category below.
        </Text>
      </View>

      {/*
        Pulled back out to the card's edge. `SegmentedControl` carries its
        own `paddingHorizontal: space.lg` because it was written for a
        full-bleed screen; inside an EditorialCard (padding space.xl) that
        lands as a double inset, so the pills sat visibly right of the
        banner above them. `-space.lg` cancels exactly that padding and
        nothing more, so the pills line up with the banner rather than
        bleeding past it. The strip stays scrollable, which it needs to
        be: three role pills do not fit at 393pt.
      */}
      <View style={styles.roles}>
        <SegmentedControl
          segments={CONFIGURABLE_ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r] ?? r }))}
          value={role}
          onChange={(v) => setRole(v as ConfigurableRole)}
        />
      </View>

      {PERMISSION_GROUPS.map((group) => {
        const keys = group.keys.map((k) => k.key);
        const on = enabledCount(permissions.matrix, role, keys);
        const isOpen = openGroup === group.label;
        return (
          <View key={group.label} style={styles.group}>
            <Pressable
              onPress={() => setOpenGroup(isOpen ? null : group.label)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              style={({ pressed }) => [styles.groupHead, pressed && styles.pressed]}
            >
              <Feather name={isOpen ? 'chevron-down' : 'chevron-right'} size={15} color={colors.fgMuted} />
              <Text style={styles.groupLabel}>{group.label}</Text>
              <Text style={styles.groupCount}>
                {on}/{keys.length} enabled
              </Text>
            </Pressable>

            {isOpen
              ? group.keys.map((entry) => {
                  const allowed = permissions.matrix[role]?.[entry.key] ?? false;
                  return (
                    <View key={entry.key} style={styles.permRow}>
                      <Feather
                        name={allowed ? 'check' : 'x'}
                        size={14}
                        color={allowed ? colors.accent : colors.fgMuted}
                      />
                      <View style={styles.permText}>
                        <Text style={styles.permLabel}>{entry.label}</Text>
                        <Text style={styles.permDescription}>{entry.description}</Text>
                      </View>
                    </View>
                  );
                })
              : null}
          </View>
        );
      })}

      <View style={styles.note}>
        <Feather name="info" size={13} color={colors.fgMuted} />
        <Text style={styles.noteText}>
          Changing permissions is done in the portal. This shows them; it doesn&apos;t change them.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  roles: { marginHorizontal: -space.lg },
  error: { ...type.small, color: colors.danger },
  ownerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: hairline,
    borderColor: colors.accent,
    borderRadius: radius.input,
    backgroundColor: 'rgba(201, 154, 91, 0.08)',
    padding: space.md,
  },
  ownerBannerText: { ...type.small, color: colors.fg, flex: 1 },

  group: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
  groupLabel: { ...type.body, color: colors.fg, flex: 1 },
  groupCount: { ...type.meta, color: colors.fgMuted },
  pressed: { opacity: 0.7 },

  permRow: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    paddingHorizontal: space.md,
    paddingBottom: space.md,
  },
  permText: { flex: 1 },
  permLabel: { ...type.small, color: colors.fg },
  permDescription: { ...type.meta, color: colors.fgMuted, marginTop: 2 },

  note: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  noteText: { ...type.meta, color: colors.fgMuted, flex: 1 },
});
