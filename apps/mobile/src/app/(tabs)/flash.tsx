import Feather from '@expo/vector-icons/Feather';
import { FlashPieceStatus, type FlashPiece } from '@ink-manager/shared-types';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { ScreenTitle, TitleAction } from '@/components/ScreenTitle';
import { PlusIcon } from '@/components/icons';
import { PhotoViewer } from '@/components/PhotoViewer';
import { MultiPillMenu } from '@/components/PillMenu';
import { TopBar } from '@/components/TopBar';
import { Chip, ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { artistLabel, fetchArtists, type ArtistOption } from '@/lib/artists';
import { fetchFlashPieces } from '@/lib/flash';
import {
  filterPieces,
  formatDuration,
  formatPrice,
  STATUS_FILTERS,
  STATUS_LABELS,
  STATUS_TONES,
  summarize,
} from '@/lib/flashDisplay';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, radius, space, tones, type } from '@/theme';

/**
 * The artist's flash gallery.
 *
 * A grid, because flash IS the image — a list row would show a thumbnail
 * the size of a stamp for work whose whole point is how it looks. Tapping
 * a card opens the piece; tapping the image alone opens it full screen.
 *
 * ─── THE TWO FILTERS ARE WEB'S, INCLUDING WHEN THEY APPEAR ──────────
 *
 * Web renders two `MultiSelectFilter`s — "All statuses" and "All artists"
 * — and both are genuinely multi-select (its own filter is
 * `selected.includes(...)` over a `string[]`). Mobile had a row of
 * toggle pills for status and no artist filter at all.
 *
 * The artist one is conditional on web and stays conditional here:
 * `canManageOthers && !isSoloStudio`. An ARTIST caller only ever sees
 * their own pieces — `GET /flash-pieces` narrows server-side, across
 * their home studio and any they guest at — so the control would have
 * exactly one option. Web's own comment adds the solo-studio case:
 * filtering never narrows anything when there is one person.
 */
export default function FlashGalleryScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const { width } = useWindowDimensions();

  const [pieces, setPieces] = useState<FlashPiece[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [statuses, setStatuses] = useState<FlashPieceStatus[]>([]);
  const [artistIds, setArtistIds] = useState<string[]>([]);
  const [artists, setArtists] = useState<ArtistOption[]>([]);

  /*
   * Web's own gate, field for field: `flashGallery.manage` AND not an
   * ARTIST. Keying off the role here rather than `profile.artist` is
   * deliberate and matches web — a solo OWNER who also tattoos still sees
   * the whole studio's pieces, so the question is "whose pieces does this
   * list contain", not "does this person tattoo".
   */
  const canManageOthers =
    (session?.profile.permissions.includes('flashGallery.manage') ?? false) &&
    session?.profile.role !== 'ARTIST';
  const showArtistFilter = canManageOthers && !session?.profile.isSoloStudio;
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!token) return;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const data = await fetchFlashPieces(token);
        setPieces(data);
        setError(null);
      } catch (err) {
        setError(screenErrorMessage(err, 'your flash gallery'));
      } finally {
        setRefreshing(false);
      }
    },
    [token],
  );

  // Refetched on focus rather than once on mount: coming back from the
  // editor must show the piece that was just created or retired, and a
  // stale grid is the most obvious possible bug on this screen.
  useFocusEffect(
    useCallback(() => {
      void load('initial');
    }, [load]),
  );

  useEffect(() => {
    if (!token || !showArtistFilter) return;
    let cancelled = false;
    fetchArtists(token)
      .then((rows) => {
        if (!cancelled) setArtists(rows);
      })
      .catch(() => {
        // The filter simply has nothing to offer — never a reason to
        // break a gallery that loaded fine. Web swallows it the same way.
      });
    return () => {
      cancelled = true;
    };
  }, [token, showArtistFilter]);

  const visible = useMemo(
    () => filterPieces(pieces ?? [], statuses, artistIds),
    [pieces, statuses, artistIds],
  );

  // Two columns at every phone width. The gutter is subtracted first so
  // the tiles are square and the grid has no orphan pixel column.
  const tile = Math.floor((width - space.lg * 2 - space.sm) / 2);

  function toggleStatus(status: FlashPieceStatus) {
    setStatuses((current) =>
      current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    );
  }

  if (!pieces && !error) {
    return (
      <ScreenShell edges={['top']}>
        <TopBar />
        <ScreenLoading />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell edges={['top']}>
      {/*
        ITEM 5: the standard tab anatomy — hamburger and the top-right
        cluster, the photo ground behind, the tab bar below. Flash became
        a tab in session W and kept a pushed screen's back chevron; it is
        a place in the app, not somewhere you went into.

        The "new piece" control moves into the page head with the title,
        since the top bar's right side belongs to the shared cluster now.
      */}
      <TopBar />

      {/*
        ITEM 3a. This screen invented the pattern — serif title, a live
        summary line, one action at the right — and the owner made it the
        house shape. It is the shared component now, rendering the same
        thing it did before.
      */}
      <ScreenTitle
        title="Flash"
        counts={pieces ? summarize(pieces) : null}
        action={
          <TitleAction
            Icon={PlusIcon}
            label="New flash"
            onPress={() => router.push('/flash-piece')}
          />
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={colors.accent} />
        }
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          style={styles.filterStrip}
        >
          <MultiPillMenu
            placeholder="All statuses"
            options={STATUS_FILTERS.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
            selected={statuses}
            onChange={setStatuses}
          />
          {showArtistFilter ? (
            <MultiPillMenu
              placeholder="All artists"
              options={artists.map((artist) => ({ value: artist.id, label: artistLabel(artist) }))}
              selected={artistIds}
              onChange={setArtistIds}
            />
          ) : null}
        </ScrollView>

        {error ? (
          <StateMessage
            eyebrow="Not available"
            tone="alert"
            title="Your gallery didn't load"
            body={error}
            action={{ label: 'Try again', onPress: () => void load('initial') }}
          />
        ) : visible.length === 0 ? (
          <StateMessage
            eyebrow={statuses.length > 0 ? 'Nothing matches' : 'Empty gallery'}
            title={statuses.length > 0 ? 'No pieces in those states' : 'No flash pieces yet'}
            body={
              statuses.length > 0
                ? 'Clear the filter to see everything in your gallery.'
                : 'Add a piece and it appears on your public flash page straight away.'
            }
            action={
              statuses.length > 0
                ? { label: 'Clear filter', onPress: () => setStatuses([]) }
                : { label: 'Add a piece', onPress: () => router.push('/flash-piece') }
            }
          />
        ) : (
          <View style={styles.grid}>
            {visible.map((piece, index) => (
              <View key={piece.id} style={[styles.card, { width: tile }]}>
                {/* The image and the card body are separate targets, not
                    nested pressables: tapping the art means "show me the
                    art", tapping the text means "let me change this". */}
                <Pressable
                  onPress={() => setViewerIndex(index)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`View ${piece.title}`}
                  style={({ pressed }) => [pressed && styles.pressed]}
                >
                  <Image
                    source={{ uri: piece.imageUrl }}
                    style={[styles.image, { width: tile, height: tile }]}
                    contentFit="cover"
                    transition={140}
                  />
                  {piece.isOneOfOne ? (
                    <View style={styles.oneOfOne}>
                      <Feather name="star" size={9} color={colors.bg} />
                      <Text style={styles.oneOfOneLabel}>ONE OF ONE</Text>
                    </View>
                  ) : null}
                </Pressable>

                <Pressable
                  onPress={() => router.push({ pathname: '/flash-piece', params: { id: piece.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${piece.title}`}
                  style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
                >
                  <Text style={styles.title} numberOfLines={1}>
                    {piece.title}
                  </Text>
                  <Text style={styles.meta}>
                    {formatPrice(piece.priceCents)} · {formatDuration(piece.estimatedDurationMinutes)}
                  </Text>
                  <Chip
                    label={STATUS_LABELS[piece.status]}
                    color={tones[STATUS_TONES[piece.status]]}
                    style={styles.statusChip}
                  />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <PhotoViewer
        images={visible.map((piece) => ({ url: piece.imageUrl, caption: piece.title }))}
        initialIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({

  content: { paddingBottom: space.xxxl },


  filterStrip: { flexGrow: 0 },
  filters: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.lg },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg },
  card: {
    borderWidth: hairline,
    borderColor: colors.cardBorder,
    borderRadius: radius.card,
    backgroundColor: colors.cardGlass,
    overflow: 'hidden',
  },
  image: { backgroundColor: colors.surfaceInset },
  oneOfOne: {
    position: 'absolute',
    left: space.sm,
    top: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.fg,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  oneOfOneLabel: { ...type.label, fontSize: 8, color: colors.bg },

  cardBody: { padding: space.md, gap: space.xs },
  title: { ...type.body, fontSize: 14, color: colors.fg },
  meta: { ...type.meta, color: colors.fgSecondary },
  statusChip: { marginTop: 2 },

  pressed: { opacity: 0.6 },
});
