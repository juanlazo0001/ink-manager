import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Eyebrow } from '@/components/ui';
import { artistLabel, fetchArtists, type ArtistOption } from '@/lib/artists';
import { fetchConversationContext } from '@/lib/conversations';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Add from Portfolio — the mobile counterpart of web's composer picker.
 *
 * ─── WHAT IT IS BACKED BY, SINCE THE NAME MISLEADS ──────────────────
 *
 * `Artist.portfolioImages` — a plain `String[]` of Cloudinary URLs on the
 * artist record. NOT flash pieces: `FlashPiece` is a separate model with
 * prices and availability, and web's picker never touches it. Read from
 * apps/web's own implementation before building this
 * (`ConversationsPanel.tsx:2170-2174` picks the artist and fetches
 * `/artists/:id` for `portfolioImages`; `:3822` inserts the chosen URL).
 *
 * ─── ONE REQUEST, NOT ONE PER ARTIST ────────────────────────────────
 *
 * `GET /artists` already selects `portfolioImages` for every artist
 * (`routes/artists.ts`'s `artistListSelect`), so the All view is a single
 * call and the assigned-artist view is a filter over the same payload.
 * Web fetches `/artists/:id` because it only ever shows one artist.
 *
 * ─── WHERE THE ASSIGNED ARTIST COMES FROM, AND WHO CAN ASK ──────────
 *
 * `GET /conversations/:id/context` → `inquiries[].assignedArtist`, the
 * same source web reads. That route is `requireRole(OWNER, FRONT_DESK)`
 * (`routes/conversations.ts:1522`), so an ARTIST cannot call it: for them
 * the fetch is skipped entirely and the picker opens on All. Not a
 * degradation to apologise for — an artist browsing a roster of
 * portfolios is the same screen everyone else gets, minus a default.
 *
 * ─── WHERE THIS DIVERGES FROM WEB, ON PURPOSE ───────────────────────
 *
 * Web shows the assigned artist's portfolio and NOTHING otherwise — no
 * artist assigned means a dead end reading "assign one to pull from their
 * portfolio". The owner's spec for mobile is that All artists, sectioned
 * by name, is the fallback rather than the message, so the control is
 * never a dead end. Same source, same send; different default.
 *
 * ─── CONTENT ONLY, NOT A SHEET (session 17) ─────────────────────────
 *
 * This used to wrap itself in its own `<Sheet>`, which meant opening it
 * dismissed the attach menu's modal and presented a second one in the
 * same tick — the iOS presentation race. It is now the composer's single
 * sheet host's *contents*, so reaching it moves nothing: no dismissal, no
 * presentation, no race. It renders its own CANCEL because the host has
 * no chrome of its own.
 */
export function PortfolioContent({
  token,
  conversationId,
  canReadContext,
  onPick,
  onCancel,
}: {
  token: string | null;
  conversationId: string;
  /** OWNER/FRONT_DESK only — see the note on `/context` above. */
  canReadContext: boolean;
  onPick: (url: string) => void;
  onCancel: () => void;
}) {
  const [artists, setArtists] = useState<ArtistOption[] | null>(null);
  const [assignedId, setAssignedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setFailed(false);

    /*
     * The context call is allowed to fail without taking the picker with
     * it — a missing default is a smaller loss than no grid at all, and
     * an ARTIST's 403 is an expected outcome rather than an error.
     */
    Promise.all([
      fetchArtists(token),
      canReadContext
        ? fetchConversationContext(token, conversationId).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([roster, context]) => {
        if (cancelled) return;
        setArtists(roster);
        const featured = pickFeaturedInquiry(context?.inquiries ?? []);
        setAssignedId(featured?.assignedArtist?.id ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setArtists([]);
        setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token, conversationId, canReadContext]);

  const withPieces = (artists ?? []).filter((a) => (a.portfolioImages?.length ?? 0) > 0);
  const assigned = assignedId ? withPieces.find((a) => a.id === assignedId) ?? null : null;

  /*
   * The assigned artist's own view is offered only when they HAVE
   * pieces. An assigned artist with an empty portfolio lands on All with
   * a line saying why, rather than on a grid with nothing in it.
   */
  const assignedOnly = !showAll && assigned !== null;
  const sections = assignedOnly ? [assigned] : withPieces;
  const emptyAssigned = !showAll && assignedId !== null && assigned === null;

  return (
    <>
      <View style={styles.head}>
        <Eyebrow>Add from Portfolio</Eyebrow>
        {assigned || emptyAssigned ? (
          <Pressable
            onPress={() => setShowAll((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={assignedOnly ? 'Show all artists' : 'Show the assigned artist only'}
            style={({ pressed }) => [styles.filter, pressed && styles.pressed]}
          >
            <Text style={styles.filterLabel}>{assignedOnly ? 'ALL ARTISTS' : 'ASSIGNED'}</Text>
          </Pressable>
        ) : null}
      </View>

      {emptyAssigned ? (
        <Text style={styles.note}>
          The assigned artist has no portfolio pieces yet — showing everyone.
        </Text>
      ) : null}

      {artists === null ? (
        <ActivityIndicator style={styles.spinner} size="small" color={colors.fgMuted} />
      ) : failed ? (
        <Text style={styles.note}>Could not load portfolios. Close and try again.</Text>
      ) : sections.length === 0 ? (
        <Text style={styles.note}>No portfolio pieces in this studio yet.</Text>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
          {sections.map((artist) => (
            <View key={artist.id} style={styles.section}>
              {/* The name heads every section in All; in the single-artist
                  view it still says whose work this is. */}
              <Text style={styles.sectionName}>{artistLabel(artist).toUpperCase()}</Text>
              <View style={styles.grid}>
                {(artist.portfolioImages ?? []).map((url) => (
                  <Pressable
                    key={url}
                    onPress={() => onPick(url)}
                    accessibilityRole="button"
                    accessibilityLabel={`Attach portfolio piece by ${artistLabel(artist)}`}
                    style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
                  >
                    <Image source={{ uri: url }} style={styles.image} resizeMode="cover" />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Pressable onPress={onCancel} style={styles.done}>
        <Text style={styles.doneLabel}>CANCEL</Text>
      </Pressable>
    </>
  );
}

/**
 * The same "one inquiry to feature" pick the API makes for the thread
 * header and web makes for its context panel: the most recent still-open
 * one, else the most recent overall. `/context` returns them createdAt
 * desc, so this reads in that order.
 */
function pickFeaturedInquiry<T extends { status: string }>(inquiries: T[]): T | null {
  if (inquiries.length === 0) return null;
  const closed = ['CLOSED_LOST', 'COLD_LEAD'];
  return inquiries.find((i) => !closed.includes(i.status)) ?? inquiries[0];
}

const CELL_GAP = space.xs;

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  filter: { paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: hairline, borderColor: colors.accent },
  filterLabel: { ...type.label, fontSize: 9, color: colors.accent },

  note: { ...type.meta, color: colors.fgMuted, marginBottom: space.sm },
  spinner: { marginVertical: space.lg },

  /* Capped rather than free: the sheet sizes to its content, and an
     uncapped grid would grow past the screen on a full roster. */
  scroll: { maxHeight: 420 },
  scrollBody: { paddingBottom: space.sm },

  section: { marginBottom: space.md },
  sectionName: { ...type.label, fontSize: 9, color: colors.fgMuted, marginBottom: space.xs },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: CELL_GAP },
  cell: { width: '31.5%', aspectRatio: 1, borderRadius: radius.input, overflow: 'hidden', borderWidth: hairline, borderColor: colors.border },
  image: { width: '100%', height: '100%' },

  done: { marginTop: space.md, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.accent },
  pressed: { opacity: 0.6 },
});
