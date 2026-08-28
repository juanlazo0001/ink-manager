import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { startConversation } from '@/lib/conversations';
import { parseSearchPrefill } from '@/lib/searchPrefill';
import { clientName, searchClients } from '@/lib/clients';
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
 * every chat-tab visit paying for a roster and a client lookup it almost
 * never shows.
 *
 * ─── THE CLIENT HALF IS A SERVER SEARCH NOW (§8 rev H) ──────────────
 *
 * It used to be `fetchClients()` — `GET /clients`, which has NO search
 * parameter and `take: 100` — filtered here by `name.includes(q)`. Three
 * things were wrong with that, and they only matter now that a CREATE
 * button hangs off the result:
 *
 *   1. It could not match a phone number or an email at all.
 *   2. It saw only the hundred most-recently-created clients, so a
 *      studio past a hundred could be told a client does not exist
 *      purely because they are old.
 *   3. Both failures are SILENT and look identical to a true miss.
 *
 * A wrong "nobody" used to mean a slightly unhelpful empty state. It now
 * means a duplicate client record, so the query has to be the real one:
 * `/clients/merge-search`, which matches name, email and phone
 * server-side across the whole studio. See `searchClients`.
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
  /*
   * FAIL CLOSED. `people: []` is reached both by "the search ran and
   * matched nobody" and by "the search threw", and only the first may
   * ever offer to create a client. So the searched-cleanly state is
   * tracked separately rather than inferred from an empty array.
   */
  const [searchOk, setSearchOk] = useState(false);

  const router = useRouter();
  const canStart = role !== 'ARTIST';

  /*
   * §8 rev H step 3. Three conditions, all required, and each one is
   * load-bearing:
   *
   *   searchOk        the people query RAN. A thrown search is "unknown".
   *   people.length   it matched nobody. Not "nobody in the newest 100".
   *   canStart        an ARTIST cannot create the conversation afterwards
   *                   (the route 404s them), so offering the whole flow
   *                   would be offering a dead end — the no-inert rule.
   *
   * A two-character minimum is implicit: `searchClients` does not call
   * the route below that, so `searchOk` never becomes true for a
   * one-character query and the row cannot appear on a stray keystroke.
   */
  const prefill = parseSearchPrefill(query);
  const canCreate = canStart && searchOk && people !== null && people.length === 0;

  useEffect(() => {
    if (!canStart) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    const raw = query.trim();
    const q = raw.toLowerCase();
    setSearchOk(false);

    /*
     * The two halves are asked differently ON PURPOSE. Clients are
     * searched by the server, across the whole studio, on name + email +
     * phone. Staff are a small roster this screen already loads whole, so
     * they are matched here — on name AND email, since the ruling's
     * people layer is matched by both and a staff member's "name" can be
     * null (the row falls back to their email).
     *
     * `Promise.all` with a per-half `catch` would hide a failed client
     * search as an empty one, which is the exact confusion that must not
     * reach the CREATE row — so the client search is NOT caught here. It
     * rejects into the `.catch` below, which leaves `searchOk` false.
     */
    Promise.all([fetchTeamUsers(token, studioId).catch(() => []), searchClients(token, raw)])
      .then(([users, clients]) => {
        if (cancelled) return;
        const staff: Person[] = users
          .filter((u) => u.isActive && !u.pending)
          .filter((u) => `${u.name ?? ''} ${u.email}`.toLowerCase().includes(q))
          .map((u) => ({
            key: `u:${u.id}`,
            id: u.id,
            kind: 'staff' as const,
            name: u.name ?? u.email,
            avatarUrl: u.avatarUrl,
          }));
        /* No client-side filter: the server already matched these. */
        const matched: Person[] = clients.map((c) => ({
          key: `c:${c.id}`,
          id: c.id,
          kind: 'client' as const,
          name: clientName(c),
          avatarUrl: null,
        }));
        setPeople([...staff, ...matched].filter((p) => !existingCounterpartIds.has(p.id)).slice(0, 6));
        setSearchOk(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Rows AND the create offer both stay away: this is "we do not
        // know", and it must not read as "nobody".
        setPeople([]);
        setSearchOk(false);
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
      {/*
        §8 rev G asks for `NO CONVERSATIONS FOUND` in **Jura caps, muted**,
        and that is all it asks for — so this is a plain Text, not the
        `Eyebrow` component it started as.
 
        `Eyebrow` is Jura caps muted for the LABEL, which is why it looked
        right, but it also brackets the label with `+` ticks in
        `danger-strong`. Two reasons that is wrong here, neither of them
        "ornaments were retired" — they were not, and `Eyebrow` documents
        the ticks as the sanctioned decorative use of that token:
 
          1. REV G NARROWED RED. This session's own headline ruling pulled
             the red exception back to the CHAT fab alone. Putting two red
             glyphs on a dead-end screen, in the release that narrowed red,
             is the one place it should not appear.
          2. AN EYEBROW LABELS A SECTION. It says "a thing follows". This
             is the absence of things. Borrowing section furniture for an
             empty state gives the emptiness a header, which reads as a
             heading with nothing under it rather than as "nothing here".
 
        The CTA below still carries every bit of colour this screen needs.
      */}
      <Text style={styles.title}>NO CONVERSATIONS FOUND</Text>
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
              {/*
                No avatar. It was tried and removed on sight: `Avatar`
                draws on `colors.surface`, so inside a gold pill it reads
                as a dark blob, and its ink initials vanish against that
                dark ground. The label already names the person — the
                circle was repeating it illegibly.
              */}
              <Feather name="edit" size={14} color={colors.accentFg} />
              <Text style={styles.offerLabel} numberOfLines={1}>
                START CHAT WITH {person.name.toUpperCase()}
              </Text>
              {busyId === person.key ? <ActivityIndicator size="small" color={colors.accentFg} /> : null}
            </Pressable>
          ))}
          {failed ? <Text style={styles.failed}>That didn&apos;t open. Try again.</Text> : null}
        </View>
      )}

      {canCreate ? (
        <View style={styles.offers}>
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/client-new',
                params: {
                  firstName: prefill.firstName,
                  lastName: prefill.lastName,
                  email: prefill.email,
                  phone: prefill.phone,
                  /* The intent. `client-new` lands in the thread instead
                     of the client record when this is set. */
                  startChat: '1',
                },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`Create client ${query.trim()}`}
            style={({ pressed }) => [styles.offer, pressed && styles.pressed]}
          >
            <Feather name="user-plus" size={14} color={colors.accentFg} />
            <Text style={styles.offerLabel} numberOfLines={1}>
              CREATE CLIENT &ldquo;{query.trim()}&rdquo;
            </Text>
          </Pressable>
        </View>
      ) : null}
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
  /* `type.eyebrow`'s own numbers — Jura 600, 11px, 3.74px tracking — so
     this is the same type the eyebrow set, without the tick glyphs. */
  title: { ...type.eyebrow, color: colors.fgMuted, textAlign: 'center', marginBottom: space.sm },
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
