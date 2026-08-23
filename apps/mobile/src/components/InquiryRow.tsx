import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  channelLabel,
  formatEstimateRange,
  inquiryClientName,
  isClosedStatus,
  statusLabel,
  statusTone,
} from '@/lib/inquiryDisplay';
import { relativeStamp } from '@/lib/time';
import { colors, hairline, radius, space, tones, type } from '@/theme';

/**
 * The fields both list shapes share.
 *
 * The staff and artist routes return genuinely different projections, not
 * one that is a subset of the other — so the row takes the intersection
 * explicitly rather than being typed against either, and each screen maps
 * its own response into this.
 */
export interface InquiryRowData {
  id: string;
  description: string;
  status: string;
  channel: string;
  updatedAt: string;
  priceEstimateLow: number | null;
  priceEstimateHigh: number | null;
  client: { firstName: string; lastName: string } | null;
  /**
   * Three states, not two:
   *   a name    show it
   *   null      genuinely unassigned — say so
   *   undefined don't mention the artist at all
   *
   * The artist's own list is the third case. Every row there is theirs by
   * construction, so naming them on each one is noise — but it was passing
   * `null`, which made every row read UNASSIGNED. They are assigned; they
   * are assigned to the person reading. Caught on screen.
   */
  artistName?: string | null;
  fromGuestStudio: { id: string; name: string } | null;
  /**
   * The first reference image, or null. Reference images are what the
   * CLIENT sent as the idea for the piece, so the first is the closest
   * thing a list row has to "what is this about".
   *
   * Only the ARTIST route returns these — the staff list projection has no
   * images at all — so the staff screen leaves it null and the row falls
   * back, rather than the row assuming every caller can supply one.
   */
  thumbnailUrl?: string | null;
  /** The next session an artist has to show up for. Projects tab only. */
  nextSessionAt?: string | null;
}

/**
 * The row's reference thumbnail, or the placeholder that stands in for it.
 *
 * The placeholder is a real, deliberate state rather than a blank box: a
 * great many inquiries arrive with no reference at all, and a row that
 * collapsed to text when one was missing would make the list jump between
 * two layouts as it scrolled.
 */
function Thumbnail({ url }: { url: string | null }) {
  if (!url) {
    return (
      <View style={[styles.thumb, styles.thumbEmpty]}>
        <Feather name="image" size={16} color={colors.fgMuted} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: url }}
      style={styles.thumb}
      contentFit="cover"
      transition={140}
      // The app's own ground behind a slow decode, never a white flash.
      placeholderContentFit="cover"
      accessible={false}
    />
  );
}

export function InquiryRow({ inquiry, onPress }: { inquiry: InquiryRowData; onPress?: () => void }) {
  const tone = tones[statusTone(inquiry.status)];
  const closed = isClosedStatus(inquiry.status);
  const estimate = formatEstimateRange(inquiry.priceEstimateLow, inquiry.priceEstimateHigh);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${inquiryClientName(inquiry.client)}, ${statusLabel(inquiry.status)}`}
      style={({ pressed }) => [styles.row, closed && styles.closed, pressed && onPress && styles.pressed]}
    >
      <View style={styles.top}>
        <Thumbnail url={inquiry.thumbnailUrl ?? null} />

        <View style={styles.topText}>
          <View style={styles.header}>
            <Text style={styles.client} numberOfLines={1}>
              {inquiryClientName(inquiry.client)}
            </Text>
            <Text style={styles.stamp}>{relativeStamp(inquiry.updatedAt)}</Text>
          </View>

          <Text style={styles.description} numberOfLines={2}>
            {inquiry.description}
          </Text>
        </View>
      </View>

      <View style={styles.metaLine}>
        {/* Tone carries the meaning: warning = someone must act, danger =
            genuinely lost. Red arrives here only via CLOSED_LOST. */}
        <View style={[styles.statusPill, { borderColor: tone }]}>
          <View style={[styles.statusDot, { backgroundColor: tone }]} />
          <Text style={[styles.statusLabel, { color: tone }]}>{statusLabel(inquiry.status).toUpperCase()}</Text>
        </View>

        <Text style={styles.channel}>{channelLabel(inquiry.channel).toUpperCase()}</Text>

        {estimate ? <Text style={styles.estimate}>{estimate}</Text> : null}
      </View>

      <View style={styles.footerLine}>
        {inquiry.artistName === undefined ? null : inquiry.artistName ? (
          <Text style={styles.artist} numberOfLines={1}>
            {inquiry.artistName}
          </Text>
        ) : (
          <Text style={styles.unassigned}>UNASSIGNED</Text>
        )}

        {inquiry.fromGuestStudio ? (
          <View style={styles.guest}>
            <Feather name="map-pin" size={10} color={colors.accent} />
            <Text style={styles.guestLabel} numberOfLines={1}>
              {inquiry.fromGuestStudio.name}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs },
  // Closed and cold inquiries are history, not pipeline.
  closed: { opacity: 0.5 },
  pressed: { backgroundColor: colors.surface },

  top: { flexDirection: 'row', gap: space.md },
  topText: { flex: 1, gap: space.xs },
  /* 56pt square, the same radius every other image tile in the app uses. */
  thumb: { width: 56, height: 56, borderRadius: radius.input, backgroundColor: colors.surfaceInset },
  thumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  client: { ...type.heading, color: colors.fg, flex: 1 },
  stamp: { ...type.meta, color: colors.fgMuted },

  description: { ...type.small, color: colors.fgSecondary },

  metaLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', marginTop: 2 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: hairline,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  statusDot: { width: 5, height: 5, borderRadius: radius.pill },
  statusLabel: { ...type.label, fontSize: 9 },
  channel: { ...type.label, fontSize: 9, color: colors.fgMuted },
  estimate: { ...type.meta, color: colors.fgSecondary },

  footerLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  artist: { ...type.meta, color: colors.fgMuted, flex: 1 },
  unassigned: { ...type.label, fontSize: 9, color: colors.accent, flex: 1 },
  guest: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '50%' },
  guestLabel: { ...type.meta, color: colors.accent },
});
