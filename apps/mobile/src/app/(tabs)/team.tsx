import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { Appear } from '@/components/Appear';
import { ArtistCard } from '@/components/ArtistCard';
import { Avatar, initialsOf } from '@/components/Avatar';
import { TopBar } from '@/components/TopBar';
import { countLine, ScreenTitle, TitleAction } from '@/components/ScreenTitle';
import { InfoIcon, PlusIcon } from '@/components/icons';
import { InviteTeamMemberSheet } from '@/components/InviteTeamMemberSheet';
import { SkeletonList } from '@/components/Skeleton';
import { UnderlineTabs } from '@/components/UnderlineTabs';
import { StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { fetchArtists, type ArtistOption } from '@/lib/artists';
import { screenErrorMessage } from '@/lib/screenError';
import { ROLE_LABELS, fetchTeamUsers, inviteTeamMember, type TeamUser } from '@/lib/team';
import { colors, hairline, radius, space, type } from '@/theme';

type Tab = 'staff' | 'artists';

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
  /*
   * The ARTIST profile, which `GET /users` does not carry — bio,
   * specialties, handles, portfolio and the studio membership all live
   * on `Artist`, and only `GET /artists` returns them. The roster needs
   * both: users for staff, artists for artists.
   */
  const [artistProfiles, setArtistProfiles] = useState<ArtistOption[] | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  /*
   * OWNER only, which is web's own gate on this control
   * (`isOwner && activeTab === 'staff'`).
   *
   * The ROUTE's gate is `requirePermission("team.manage")`, which is
   * broader — so this is the stricter of the two, deliberately. Showing
   * the button to a FRONT_DESK who happens to hold `team.manage` would
   * give this app a capability web does not, and the Team screen is
   * OWNER-only in practice anyway: `GET /studios/:id/users`, which this
   * screen cannot render without, 403s for FRONT_DESK (measured).
   */
  const canInvite = session?.profile.role === 'OWNER';

  async function onInvite(input: { email: string; name: string; phone: string; role: string }) {
    if (!token || !studioId) return;
    setInviting(true);
    setInviteError(null);
    try {
      await inviteTeamMember(token, studioId, input);
      setInviteOpen(false);
      /* Re-read rather than splice the row in: an invite creates a PENDING
         user the roster renders with an INVITED badge, and the server is
         the only thing that knows its id and shape. */
      await load();
    } catch (err) {
      setInviteError(screenErrorMessage(err, 'that invite'));
    } finally {
      setInviting(false);
    }
  }
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !studioId) return;
    setError(null);
    try {
      const [u, a] = await Promise.all([fetchTeamUsers(token, studioId), fetchArtists(token)]);
      setUsers(u);
      setArtistProfiles(a);
    } catch (err) {
      setError(screenErrorMessage(err, "The team didn't load."));
    }
  }, [token, studioId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Web splits the roster the same way: staff are the non-artist roles.
  const staff = (users ?? []).filter((u) => u.role !== 'ARTIST');

  /*
   * Studio vs Guest, from the CURRENT StudioMembership and nothing else —
   * web's own split, and its own warning: `Artist.isGuest` is a legacy
   * availability-window flag, not a membership, and deriving guest status
   * from it showed two real artists a stale "Guest (ended)" badge while
   * their actual membership was HOME.
   */
  const profiles = artistProfiles ?? [];
  const studioArtists = profiles.filter((a) => a.memberships?.[0]?.type !== 'GUEST');
  const guestArtists = profiles.filter((a) => a.memberships?.[0]?.type === 'GUEST');

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

      {/*
        NO WRAPPER. `pageHead` used to hold the eyebrow and the title, and
        it carried `paddingTop: SCREEN_TOP_INSET` of its own. When BA
        replaced that pair with `ScreenTitle` -- which applies the SAME
        inset internally, as it does on Clients and Pipeline -- the
        wrapper stayed and the inset was applied twice. That is the whole
        of why this title sat lower than every other one. Web's Team
        header has no extra offset either.
      */}
      <ScreenTitle
        title="Team"
        counts={countLine([staff.length, 'person', 'people'], [profiles.length, 'artist'])}
        action={
          canInvite ? (
            <TitleAction Icon={PlusIcon} label="Invite team member" onPress={() => setInviteOpen(true)} />
          ) : null
        }
      />

      {/*
        Underline tabs, matching Pipeline. The segmented control this
        replaces is still the right shape for a short in-card choice (the
        role picker inside the permission matrix still uses it) -- it was
        the wrong shape for a PAGE's primary navigation, which is what
        these two are.
      */}
      <UnderlineTabs
        tabs={[
          { key: 'staff', label: 'Staff' },
          { key: 'artists', label: 'Artists' },
        ]}
        value={tab}
        onChange={setTab}
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
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* ITEM 4: gone — the selected segment already names the list, and
              repeating it underneath said the same thing twice. */}
          {tab === 'staff' ? (
            <View style={styles.roster}>
              {staff.map((u, i) => (
                <Appear key={u.id} index={i}>
                  <MemberRow user={u} />
                </Appear>
              ))}
              {staff.length === 0 ? <Text style={styles.empty}>Nobody here yet.</Text> : null}
            </View>
          ) : (
            /* Web groups the artist roster under two headings and drops a
               heading entirely when its group is empty. Same here — a
               "Guest Artists" label over nothing reads as a fault. */
            <View style={styles.artistGroups}>
              {[
                { label: 'Studio Artists', items: studioArtists },
                { label: 'Guest Artists', items: guestArtists },
              ]
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <View key={group.label} style={styles.artistGroup}>
                    <Text style={styles.groupHeading}>{group.label}</Text>
                    {group.items.map((a, i) => (
                      <Appear key={a.id} index={i}>
                        <ArtistCard
                          artist={a}
                          onPress={() => router.push({ pathname: '/artist/[id]', params: { id: a.id } })}
                        />
                      </Appear>
                    ))}
                  </View>
                ))}
              {profiles.length === 0 ? <Text style={styles.empty}>No artists yet.</Text> : null}
            </View>
          )}

          {/*
            THE SENTENCE HAD TO CHANGE. It read "Inviting, editing and
            removing people is done in the portal", which stopped being
            true the moment the Invite action above shipped — the screen
            would have been telling the reader that the button they can
            see does not exist. Editing and removing still are portal
            work, so those two stay named and inviting comes out.
          */}
          <View style={styles.note}>
            <InfoIcon size={13} color={colors.fgMuted} />
            <Text style={styles.noteText}>
              Editing and removing people is done in the portal.
            </Text>
          </View>
        </ScrollView>
      )}

      <InviteTeamMemberSheet
        visible={inviteOpen}
        busy={inviting}
        error={inviteError}
        onClose={() => setInviteOpen(false)}
        onSubmit={(input) => void onInvite(input)}
      />
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
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },




  artistGroups: { gap: space.xl },
  artistGroup: { gap: space.md },
  groupHeading: { ...type.label, color: colors.fgMuted },
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
