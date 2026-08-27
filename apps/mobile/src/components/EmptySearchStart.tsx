import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { Eyebrow } from '@/components/ui';
import { startConversation } from '@/lib/conversations';
import { clientName, fetchClients } from '@/lib/clients';
import { fetchTeamUsers } from '@/lib/team';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * §8 rev G — what an empty search offers.
 *
 * ─── WHICH BRANCH SHIPPED, AND WHY ──────────────────────────────────
 *
 * The spec gave three, in order of preference, under the no-inert rule:
 *
 *   (A) people-in-search-results → per-person START CHAT WITH {NAME},
 *       via the find-or-create path team DMs already use
 *   (B) a single CTA opening an existing compose flow
 *   (C) text only, and the gap escalates
 *
 * **(A) shipped**, because the path is real and already built:
 * `POST /conversations` (`apps/api/src/routes/conversations.ts:417`) is a
 * find-or-create taking one of `clientId` or `staffUserId`, and the
 * `staffUserId` arm is literally the one team DMs are made with
 * (`getOrCreateStaffConversation`). Nothing was invented; mobile simply
 * had never called it.
 *
 * (B) was not available — there is no compose screen on mobile to open.
 *
 * ─── WHY THE PEOPLE ARE FETCHED HERE AND NOT ON THE SCREEN ──────────
 *
 * On demand, when this component mounts, which only happens when a search
 * has already returned nothing. Putting it on the list screen would mean
 * every chat-tab visit paying for a roster and a client page it almost
 * never shows. The lists are small and already capped server-side
 * (`GET /clients` takes 100).
 *
 * ─── WHY AN ARTIST SEES NO BUTTONS ──────────────────────────────────
 *
 * Not an oversight, and not a silent failure either. The route refuses an
 * ARTIST both ways — 404 on `clientId`, 403 on any `staffUserId` but their
 * own — so offering the button would be offering a 403. The no-inert rule
 * says an affordance renders only if tapping it does something real
 * today, so for an ARTIST this falls back to the text-only state, which is
 * branch (C) applied per-role rather than per-app.
 */
export function EmptySearchStart({
  token,
  studioId,
  role,
  query,
  existingCounterpartIds,
  onOpened,
}: {
  token: string;
  studioId: string;
  role: string | undefined;
  query: string;
  /** Client and user ids that already have a thread — those are not offers. */
  existingCounterpartIds: ReadonlySet<string>;
  onOpened: (conversationId: string) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const canStart = role !== 'ARTIST';

  useEffect(() => {
    if (!canStart) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    const q = query.trim().toLowerCase();

    Promise.all([
      fetchTeamUsers(token, studioId).catch(() => []),
      fetchClients(token).catch(() => []),
    ])
      .then(([users, clients]) => {
        if (cancelled) return;
        const staff: Person[] = users
          .filter((u) => u.isActive && !u.pending)
          .map((u) => ({
            key: `u:${u.id}`,
            id: u.id,
            kind: 'staff' as const,
            name: u.name ?? u.email,
            avatarUrl: u.avatarUrl,
          }));
        const people: Person[] = clients.map((c) => ({
          key: `c:${c.id}`,
          id: c.id,
          kind: 'client' as const,
          name: clientName(c),
          avatarUrl: null,
        }));
        setPeople(
          [...staff, ...people]
            .filter((p) => p.name.toLowerCase().includes(q))
            .filter((p) => !existingCounterpartIds.has(p.id))
            .slice(0, 6),
        );
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });

    return () => {
      cancelled = true;
    };
  }, [token, studioId, query, canStart, existingCounterpartIds]);

  async function open(person: Person) {
    setBusyId(person.key);
    setFailed(null);
    try {
      const convo = await startConversation(
        token,
        person.kind === 'staff' ? { staffUserId: person.id } : { clientId: person.id },
      );
      onOpened(convo.id);
    } catch {
      // The row stays put and says so, rather than the screen changing
      // shape under a failed tap.
      setFailed(person.key);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.wrap}>
      {/* §8 rev G's own words, Jura caps, muted. */}
      <Eyebrow style={styles.eyebrow}>No conversations found</Eyebrow>
      <Text style={styles.body}>
        Nothing matching &ldquo;{query}&rdquo;. Search looks at names and message text.
      </Text>

      {people === null ? (
        <ActivityIndicator style={styles.spinner} size="small" color={colors.fgMuted} />
      ) : people.length === 0 ? null : (
        <View style={styles.offers}>
          {people.map((person) => (
            <Pressable
              key={person.key}
              onPress={busyId ? undefined : () => void open(person)}
              accessibilityRole="button"
              accessibilityLabel={`Start chat with ${person.name}`}
              accessibilityState={{ busy: busyId === person.key }}
              style={({ pressed }) => [styles.offer, pressed && styles.pressed]}
            >
              <Avatar
                url={person.avatarUrl}
                initials={initialsOf(person.name)}
                size={28}
                labelStyle={styles.avatarLabel}
              />
              <Text style={styles.offerLabel} numberOfLines={1}>
                START CHAT WITH {person.name.toUpperCase()}
              </Text>
              {busyId === person.key ? <ActivityIndicator size="small" color={colors.accentFg} /> : null}
            </Pressable>
          ))}
          {failed ? <Text style={styles.failed}>That didn&apos;t open. Try again.</Text> : null}
        </View>
      )}
    </View>
  );
}

interface Person {
  key: string;
  id: string;
  kind: 'staff' | 'client';
  name: string;
  avatarUrl: string | null;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, paddingVertical: space.xl, alignItems: 'center' },
  eyebrow: { marginBottom: space.sm },
  body: { ...type.small, color: colors.fgMuted, textAlign: 'center', marginBottom: space.lg },
  spinner: { marginTop: space.md },

  offers: { alignSelf: 'stretch', gap: space.sm },
  /*
   * The app's standard primary treatment — gold fill, ink label — and
   * explicitly NOT red: rev G narrowed the red exception back to the CHAT
   * fab, and a start-a-conversation button is the opposite of destructive.
   */
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 44,
  },
  avatarLabel: { ...type.label, fontSize: 11, color: colors.accentFg },
  offerLabel: { ...type.button, fontSize: 11, color: colors.accentFg, flex: 1 },
  pressed: { opacity: 0.75 },

  failed: {
    ...type.meta,
    color: colors.danger,
    textAlign: 'center',
    marginTop: space.xs,
    borderWidth: hairline,
    borderColor: 'transparent',
  },
});
