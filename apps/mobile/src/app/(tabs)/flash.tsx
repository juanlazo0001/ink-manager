import Feather from '@expo/vector-icons/Feather';
import { FlashPieceStatus, type FlashPiece } from '@ink-manager/shared-types';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { PhotoViewer } from '@/components/PhotoViewer';
import { Pill } from '@/components/Pill';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Chip, ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
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
 * The list is not filtered client-side by artist: `GET /flash-pieces`
 * already narrows an ARTIST caller to their own pieces, across their home
 * studio and any studio they currently guest at. Web's artist filter
 * exists for staff, who see everyone's; it would always have exactly one
 * option here.
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

  const visible = useMemo(() => filterPieces(pieces ?? [], statuses), [pieces, statuses]);

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
        <ScreenHeader title="Flash" onBack={() => router.back()} right={<View />} />
        <ScreenLoading />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell edges={['top']}>
      <ScreenHeader
        title="Flash"
        subtitle={pieces ? summarize(pieces) : undefined}
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={() => router.push('/flash-piece')}
            accessibilityRole="button"
            accessibilityLabel="New flash piece"
            hitSlop={8}
            style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
          >
            <Feather name="plus" size={16} color={colors.accentFg} />
            <Text style={styles.newLabel}>NEW</Text>
          </Pressable>
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
          {STATUS_FILTERS.map((status) => (
            <Pill
              key={status}
              label={STATUS_LABELS[status]}
              selected={statuses.includes(status)}
              onPress={() => toggleStatus(status)}
              leading={<View style={[styles.filterDot, { backgroundColor: tones[STATUS_TONES[status]] }]} />}
            />
          ))}
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

  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.accentButton,
    borderRadius: radius.button,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  newLabel: { ...type.button, fontSize: 12, color: colors.accentFg },

  filterStrip: { flexGrow: 0 },
  filters: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.lg },
  filterDot: { width: 6, height: 6, borderRadius: radius.pill },

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
