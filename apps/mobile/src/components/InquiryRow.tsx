import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { inquiryClientName, isClosedStatus, statusLabel } from '@/lib/inquiryDisplay';
import { relativeStamp } from '@/lib/time';
import { Avatar, initialsOf } from '@/components/Avatar';
import { InquiryStatusChip } from '@/components/StatusChip';
import { colors, hairline, radius, space, type } from '@/theme';

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
  updatedAt: string;
  client: { firstName: string; lastName: string } | null;
  /**
   * Three states, not two:
   *   an artist  show their avatar, bottom-right
   *   null       genuinely unassigned — say so, bottom-left
   *   undefined  do not mention the artist at all
   *
   * The artist's own list is the third case. Every row there is theirs by
   * construction, so naming them on each one is noise — but it was passing
   * `null`, which made every row read UNASSIGNED. They are assigned; they
   * are assigned to the person reading. Caught on screen.
   *
   * AD: an object rather than a bare name, because the row shows a face
   * now. `assignedArtist.user.avatarUrl` was already in the staff list
   * payload; nothing new is fetched for it.
   */
  artist?: { name: string; avatarUrl: string | null } | null;
  fromGuestStudio: { id: string; name: string } | null;
  /**
   * The first reference image, or null. Reference images are what the
   * CLIENT sent as the idea for the piece, so the first is the closest
   * thing a list row has to "what is this about".
   *
   * BOTH routes return these. An earlier comment here claimed the staff
   * projection "has no images at all" and the staff mapper hard-coded
   * null on the strength of it — so every row an OWNER or FRONT_DESK ever
   * saw showed the placeholder, whatever the data said. It is in
   * `INQUIRY_LIST_SELECT` (`referenceImages: true`) and on
   * `StaffInquiryListItem`, and always was.
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
  /*
   * A URL that does not load falls back to the same placeholder as no URL
   * at all, which is NOT what this did before: it rendered <Image> and,
   * when the fetch failed, left an empty dark square — strictly worse
   * than the placeholder, because it reads as a broken row rather than an
   * inquiry with no reference.
   *
   * Not hypothetical. 47 of the 62 reference URLs on the dev database
   * point at example.com (seed data), and any real studio will eventually
   * have an asset deleted out from under a URL. Avatar has always
   * handled this for faces; this is the same guard for thumbnails.
   */
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  if (!url || failed) {
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
      onError={() => setFailed(true)}
      accessible={false}
    />
  );
}

export function InquiryRow({ inquiry, onPress }: { inquiry: InquiryRowData; onPress?: () => void }) {
  const closed = isClosedStatus(inquiry.status);

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
          {/*
            ITEM 4. One right-aligned line: [chip] [date]. Those are the
            two things scanned down a list, so they share a fixed right
            edge on every row instead of landing wherever the title
            happens to end.

            The title is the ONLY thing that gives: `flexShrink: 0` on the
            chip and the stamp, `flex: 1` + `numberOfLines={1}` on the
            name. The name ellipsises long before either can wrap. Same
            lesson the toggle took five rounds to teach — pin what must
            not move and let exactly one thing absorb.
          */}
          <View style={styles.header}>
            <Text style={styles.client} numberOfLines={1}>
              {inquiryClientName(inquiry.client)}
            </Text>
            {/* Tone carries the meaning: warning = someone must act,
                danger = genuinely lost. Red arrives only via CLOSED_LOST. */}
            <InquiryStatusChip status={inquiry.status} />
            <Text style={styles.stamp}>{relativeStamp(inquiry.updatedAt)}</Text>
          </View>

          <Text style={styles.description} numberOfLines={2}>
            {inquiry.description}
          </Text>
        </View>
      </View>

      {/*
        ITEM 2 + 3. What used to be two lines of text — the channel word,
        the price range, the artist's name — is one line carrying at most
        a word and a face. Both removed things were true, and neither was
        ever the reason someone opened a row.

        Rendered only when it has something to say, so an assigned row on
        the artist's own list adds no empty strip.
      */}
      {inquiry.artist !== undefined || inquiry.fromGuestStudio ? (
        <View style={styles.footerLine}>
          {inquiry.artist === null ? <Text style={styles.unassigned}>UNASSIGNED</Text> : null}

          {inquiry.fromGuestStudio ? (
            <View style={styles.guest}>
              <Feather name="map-pin" size={10} color={colors.accent} />
              <Text style={styles.guestLabel} numberOfLines={1}>
                {inquiry.fromGuestStudio.name}
              </Text>
            </View>
          ) : null}

          {/* Hard right, whatever is or is not to its left. */}
          {inquiry.artist ? (
            <Avatar
              url={inquiry.artist.avatarUrl}
              initials={initialsOf(inquiry.artist.name)}
              size={22}
              style={styles.artistAvatar}
            />
          ) : null}
        </View>
      ) : null}
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
  /* `center`, not `baseline`: a chip and a text baseline do not agree,
     and on baseline the chip rode high against the name. */
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /* The one shrinkable thing in the row. */
  client: { ...type.heading, color: colors.fg, flex: 1 },
  stamp: { ...type.meta, color: colors.fgMuted, flexShrink: 0 },

  description: { ...type.small, color: colors.fgSecondary },

  footerLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  unassigned: { ...type.label, fontSize: 9, color: colors.accent },
  /* Hard right even when it is the only thing on the line. */
  artistAvatar: { marginLeft: 'auto' },
  guest: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '50%' },
  guestLabel: { ...type.meta, color: colors.accent },
});
