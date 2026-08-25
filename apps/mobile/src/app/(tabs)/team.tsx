import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenShell, SCREEN_TOP_INSET } from '@/components/ScreenShell';
import { Appear } from '@/components/Appear';
import { Avatar, initialsOf } from '@/components/Avatar';
import { TopBar } from '@/components/TopBar';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SkeletonList } from '@/components/Skeleton';
import { Eyebrow, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { PERMISSION_GROUPS } from '@/lib/permissionGroups';
import { screenErrorMessage } from '@/lib/screenError';
import {
  CONFIGURABLE_ROLES,
  ROLE_LABELS,
  enabledCount,
  fetchPermissions,
  fetchTeamUsers,
  type ConfigurableRole,
  type PermissionsResponse,
  type TeamUser,
} from '@/lib/team';
import { colors, hairline, radius, space, type } from '@/theme';

type Tab = 'staff' | 'artists' | 'permissions';

/**
 * Team — staff, artists, and the permission matrix.
 *
 * **READ-ONLY, and for the matrix that is a contract decision rather than
 * a scope one.** Web can invite, add, edit, delete, deactivate, "view as"
 * another user, and toggle any of 52 permission keys across three roles.
 * Toggling a permission is a security control; this run's contract says
 * security gets no unattended creativity, so mobile shows the matrix
 * truthfully and changes nothing. The write is a single
 * `PATCH /studios/:id/permissions` with the full flattened matrix, which
 * is documented in the session report for whoever builds it against web
 * side by side.
 *
 * The one thing the matrix MUST communicate, and does, is that OWNER is
 * not in it: the API short-circuits every permission check for that role,
 * so an owner row would be a lie. Web states it in a banner; so does this.
 */
export default function TeamScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const studioId = session?.profile.studioId ?? null;

  const [tab, setTab] = useState<Tab>('staff');
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [permissions, setPermissions] = useState<PermissionsResponse | null>(null);
  const [role, setRole] = useState<ConfigurableRole>('FRONT_DESK');
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !studioId) return;
    setError(null);
    try {
      const [u, p] = await Promise.all([
        fetchTeamUsers(token, studioId),
        fetchPermissions(token, studioId),
      ]);
      setUsers(u);
      setPermissions(p);
    } catch (err) {
      setError(screenErrorMessage(err, "The team didn't load."));
    }
  }, [token, studioId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Web splits the roster the same way: staff are the non-artist roles.
  const staff = (users ?? []).filter((u) => u.role !== 'ARTIST');
  const artists = (users ?? []).filter((u) => u.role === 'ARTIST');

  return (
    <ScreenShell edges={['top']}>
      {/*
        ITEM 5: the Clients anatomy — tab chrome (hamburger + cluster, the
        tab bar below, the shared photo behind), then web's own eyebrow
        and a serif title. Web's Team page leads with "The Roster"
        (`pages/Team.tsx`), so that is the copy rather than an invented
        line.
      */}
      <TopBar />

      <View style={styles.pageHead}>
        <Eyebrow>The Roster</Eyebrow>
        <Text style={styles.pageTitle}>Team</Text>
      </View>

      <SegmentedControl
        segments={[
          { key: 'staff', label: 'Staff', count: staff.length },
          { key: 'artists', label: 'Artists', count: artists.length },
          { key: 'permissions', label: 'Permissions' },
        ]}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
      />

      {error ? (
        <StateMessage
          eyebrow="Not loaded"
          title="The team didn't load"
          body={error}
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      ) : users === null ? (
        <SkeletonList rows={6} />
      ) : tab === 'permissions' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.ownerBanner}>
            <Feather name="shield" size={14} color={colors.accent} />
            <Text style={styles.ownerBannerText}>
              Owner always has full access, in every category below.
            </Text>
          </View>

          <SegmentedControl
            segments={CONFIGURABLE_ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r] ?? r }))}
            value={role}
            onChange={(v) => setRole(v as ConfigurableRole)}
          />

          {PERMISSION_GROUPS.map((group) => {
            const keys = group.keys.map((k) => k.key);
            const on = permissions ? enabledCount(permissions.matrix, role, keys) : 0;
            const isOpen = openGroup === group.label;
            return (
              <View key={group.label} style={styles.group}>
                <Pressable
                  onPress={() => setOpenGroup(isOpen ? null : group.label)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  style={({ pressed }) => [styles.groupHead, pressed && styles.pressed]}
                >
                  <Feather
                    name={isOpen ? 'chevron-down' : 'chevron-right'}
                    size={15}
                    color={colors.fgMuted}
                  />
                  <Text style={styles.groupLabel}>{group.label}</Text>
                  <Text style={styles.groupCount}>
                    {on}/{keys.length} enabled
                  </Text>
                </Pressable>

                {isOpen
                  ? group.keys.map((entry) => {
                      const allowed = permissions?.matrix[role]?.[entry.key] ?? false;
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
              Changing permissions is done in the portal. This screen shows them; it doesn&apos;t
              change them.
            </Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* ITEM 4: gone — the selected segment already names the list, and
              repeating it underneath said the same thing twice. */}
          <View style={styles.roster}>
            {(tab === 'staff' ? staff : artists).map((u, i) => (
              <Appear key={u.id} index={i}>
                <MemberRow user={u} />
              </Appear>
            ))}
            {(tab === 'staff' ? staff : artists).length === 0 ? (
              <Text style={styles.empty}>Nobody here yet.</Text>
            ) : null}
          </View>

          <View style={styles.note}>
            <Feather name="info" size={13} color={colors.fgMuted} />
            <Text style={styles.noteText}>
              Inviting, editing and removing people is done in the portal.
            </Text>
          </View>
        </ScrollView>
      )}
    </ScreenShell>
  );
}

function MemberRow({ user }: { user: TeamUser }) {
  const name = user.name ?? user.email;
  return (
    <View style={styles.member}>
      <Avatar url={user.avatarUrl} initials={initialsOf(name)} size={38} labelStyle={styles.avatarLabel} />
      <View style={styles.memberText}>
        <Text style={styles.memberName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.memberMeta} numberOfLines={1}>
          {ROLE_LABELS[user.role] ?? user.role} · {user.email}
        </Text>
      </View>
      {user.pending ? (
        <Badge label="INVITED" />
      ) : !user.isActive ? (
        <Badge label="INACTIVE" />
      ) : null}
    </View>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  /* Same head as Clients: eyebrow, then Home's own "Welcome," token. */
  /* ITEM 2: the same air Home puts above its eyebrow. */
  pageHead: {
    paddingHorizontal: space.lg,
    paddingTop: SCREEN_TOP_INSET,
    paddingBottom: space.md,
    gap: space.xs,
  },
  pageTitle: { ...type.welcome, color: colors.fg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },

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

  roster: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
  },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  memberText: { flex: 1 },
  avatarLabel: { ...type.label, fontSize: 12, color: colors.fgMuted },
  memberName: { ...type.body, color: colors.fg },
  memberMeta: { ...type.meta, color: colors.fgMuted, marginTop: 2 },

  badge: {
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  badgeLabel: { ...type.meta, color: colors.fgMuted, fontSize: 9 },

  empty: { ...type.small, color: colors.fgMuted, paddingVertical: space.md },
  note: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  noteText: { ...type.small, color: colors.fgMuted, flex: 1 },
  pressed: { opacity: 0.6 },
});
