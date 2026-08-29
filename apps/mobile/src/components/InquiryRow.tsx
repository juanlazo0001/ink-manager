import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
   *   null       genuinely unassigned — say so
   *   undefined  do not mention the artist at all
   *
   * The artist's own list is the third case. Every row there is theirs by
   * construction, so naming them on each one is noise — but it was passing
   * `null`, which made every row read UNASSIGNED. They are assigned; they
   * are assigned to the person reading. Caught on screen.
   */
  artist?: { name: string; avatarUrl: string | null } | null;
  fromGuestStudio: { id: string; name: string } | null;
  /**
   * The first reference image, or null. Reference images are what the
   * CLIENT sent as the idea for the piece, so the first is the closest
   * thing a list row has to "what is this about" — which is what makes it
   * the card's BACKGROUND rather than a thumbnail beside the text.
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

/*
 * ─── THE CARD'S PROPORTION ──────────────────────────────────────────
 *
 * MEASURED off the owner's mockup (`design-refs/session-ao/target.jpg`),
 * not taken from the brief's estimate, because the two disagree and the
 * mockup is the named spec source.
 *
 *   card bounds in the mockup   2247 x 617 px
 *   ratio                       3.64 : 1
 *
 * The brief says "roughly 2.4:1", which at a 361pt card width would be
 * 150pt tall against the mockup's 99pt — a 50% difference in height, so
 * it is a real design decision rather than rounding. `CARD_RATIO` is one
 * constant precisely so the owner's gate can overrule it in one place.
 */
const CARD_RATIO = 3.64;

/*
 * ─── THE WASH ───────────────────────────────────────────────────────
 *
 * The session-E lesson, restated: this has to be legible over a
 * photograph nobody has seen. A gradient tuned against the mockup's own
 * (very dark) reference photo would fail the first time a client sends a
 * shot of white paper, and the failure is invisible in development
 * because the seed images are dark.
 *
 * So these stops are derived from the WCAG arithmetic for the worst
 * case — pure white behind them — and then verified by sampling real
 * composited pixels in the harness. The binding constraint is the
 * DESCRIPTION, not the name: `fgSecondary` (#c7bea9) has a relative
 * luminance of 0.518, so 4.5:1 requires the composited ground under it
 * to sit at or below L = 0.076, which over white means at least 0.69
 * black. The name (`fg`, L = 0.842) only needs 0.58.
 *
 * ─── WHY THERE IS NO "PHOTO WINDOW" ────────────────────────────────
 *
 * The first version of these stops opened to 0.10 alpha at 38% of the
 * card height, on the assumption the middle band was empty photo. It
 * measured 1.25:1 for the name over a white photo — a hard fail — and
 * the reason is worth keeping:
 *
 *   MEASURED text bands, as a fraction of card height, at 393pt
 *     date          0.13 – 0.29
 *     name          0.38 – 0.63
 *     description   0.63 – 0.81
 *
 * At the mockup's 3.64:1 the card is 99pt tall and the content occupies
 * 38% to 81% of it. The "middle band" IS the name. There is no empty
 * middle to open up, so the wash cannot both guarantee contrast and let
 * the photograph through — at this proportion those two are in direct
 * conflict, and contrast wins because the brief makes it a floor.
 *
 * The consequence is stated plainly in the session report rather than
 * hidden here: at 3.64:1 the reference photo contributes TEXTURE, not a
 * readable image. A taller card (the brief's own 2.4:1 estimate) would
 * buy back a genuine window. That is an owner call, and `CARD_RATIO`
 * plus these stops are the two things that move together if it changes.
 *
 * The top scrim looks like over-darkening and is not: the DATE beside
 * the chip is bare text on the photo. The chip carries its own tinted
 * fill, as the brief notes; the date does not, and at a "light up top"
 * value it measured 1.60:1 over white.
 *
 * Every number below is verified by sampling composited pixels in the
 * harness, not by this arithmetic — see the report's contrast table.
 */
const WASH_COLORS = [
  'rgba(0,0,0,0.66)', // the date's band
  'rgba(0,0,0,0.62)',
  'rgba(0,0,0,0.60)', // shallowest point — still above the 0.58 the name needs
  'rgba(0,0,0,0.82)',
  'rgba(0,0,0,0.92)',
  'rgba(0,0,0,0.95)', // the description sits in here
] as const;
const WASH_LOCATIONS = [0, 0.3, 0.36, 0.5, 0.7, 1] as const;

/**
 * The ground for a card with no reference photo.
 *
 * NOT a broken-image tile and not an empty black box: the card keeps its
 * exact layout and takes the app's own card surface, so a list of mixed
 * rows still scans as one list. The old row solved this with a 56pt
 * placeholder square; at full-bleed there is nothing to put a glyph
 * inside, so the surface itself is the answer.
 *
 * ─── THE WATERMARK OPTION WAS BUILT AND DOES NOT WORK ───────────────
 *
 * The brief offers a second treatment: the channel glyph, large and
 * muted, "if it reads tastefully". It was built (96pt, `fgFaint`, 16%
 * opacity, anchored bottom-right) and rendered, and it is INVISIBLE —
 * see `design-refs/session-ao/nophoto-watermark.png`.
 *
 * The reason is structural rather than a matter of taste, which is why
 * turning the opacity up is not the fix: the wash is painted OVER this
 * ground and runs 0.60 to 0.95 black. At the bottom-right corner where
 * a watermark wants to sit, 5% of whatever is underneath survives. Any
 * glyph faint enough to be tasteful is erased, and any glyph strong
 * enough to survive would have to compete with the name.
 *
 * So the contrast requirement and the watermark are mutually exclusive
 * at this proportion. Plain surface it is, and the option is recorded
 * as closed rather than untried.
 */
function NoPhotoGround() {
  return <View style={styles.noPhoto} />;
}

export function InquiryRow({ inquiry, onPress }: { inquiry: InquiryRowData; onPress?: () => void }) {
  const closed = isClosedStatus(inquiry.status);

  /*
   * A URL that does not load falls back to the SAME ground as no URL at
   * all. This guard is inherited from the old thumbnail and matters more
   * now, not less: a failed background is a whole card of nothing, where
   * a failed thumbnail was a 56pt square.
   *
   * Not hypothetical — 47 of the 62 reference URLs on the dev database
   * point at example.com, and any real studio will eventually have an
   * asset deleted out from under a URL.
   */
  const [failed, setFailed] = useState(false);
  const url = inquiry.thumbnailUrl ?? null;
  useEffect(() => setFailed(false), [url]);
  const showPhoto = !!url && !failed;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${inquiryClientName(inquiry.client)}, ${statusLabel(inquiry.status)}`}
      style={({ pressed }) => [styles.card, closed && styles.closed, pressed && onPress && styles.pressed]}
    >
      {showPhoto ? (
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={140}
          placeholderContentFit="cover"
          onError={() => setFailed(true)}
          accessible={false}
        />
      ) : (
        <NoPhotoGround />
      )}

      {/* Over the photo, under the content. `pointerEvents none` so the
          whole card stays one press target. */}
      <LinearGradient
        colors={WASH_COLORS}
        locations={WASH_LOCATIONS}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/*
        Top-right, one line: [chip] [date]. The mockup's own anatomy, and
        the same rule the old row used — these are the two things scanned
        down a list, so they share a fixed right edge on every card.
      */}
      <View style={styles.topRow}>
        {inquiry.fromGuestStudio ? (
          <View style={[styles.guest, styles.onPhoto]}>
            <Feather name="map-pin" size={10} color={colors.accent} />
            <Text style={styles.guestLabel} numberOfLines={1}>
              {inquiry.fromGuestStudio.name}
            </Text>
          </View>
        ) : null}

        <View style={styles.topRight}>
          {/*
            THE CHIP NEEDS A GROUND, and does not carry one.

            The brief exempts chips on the grounds that they "carry their
            own ground". Measured, they do not: `StatusChip`'s fill is its
            tone at FILL_ALPHA = 0.1, so 90% of whatever is behind it
            shows through. Over a white photo its label measured 2.50:1
            (and 1.86:1 for the neutral tone) -- the same session-E
            failure the rest of this card is engineered against, in the
            one element that was assumed safe.

            The chip itself is NOT forked or altered: it is used exactly
            as every other screen uses it, and this card gives it an
            opaque backing to sit on. That keeps the fix where the
            problem is -- a translucent chip over a photograph -- rather
            than changing a component that is correct on the twenty-odd
            solid surfaces it already appears on.
          */}
          <View style={styles.chipBacking}>
            <InquiryStatusChip status={inquiry.status} />
          </View>
          <Text style={styles.stamp}>{relativeStamp(inquiry.updatedAt)}</Text>
        </View>
      </View>

      {/*
        Bottom: the name block left, the artist's face right.

        UNASSIGNED sits ABOVE the name rather than beside it. Beside it,
        it competes with the name for the one shrinkable line at 320pt;
        above, it reads as a label on the block and costs nothing that
        matters. (The brief left this to judgment and asked to see it.)
      */}
      <View style={styles.bottomRow}>
        <View style={styles.nameBlock}>
          <Text style={styles.client} numberOfLines={1}>
            {inquiryClientName(inquiry.client)}
          </Text>
          <Text style={styles.description} numberOfLines={1}>
            {inquiry.description}
          </Text>
        </View>

        {/*
          UNASSIGNED TAKES THE ARTIST'S OWN SLOT, which is both the
          honest place for it and the only one that survives 320pt.

          The brief left this to judgment and asked to see it. It was
          first built above the name, and two measurements moved it:
          the accent gold read 2.26:1 there (that band is the wash's
          shallowest), and at 320pt the card is 79pt tall, where a
          fourth line pushed the DESCRIPTION out of a fixed-height card
          entirely -- silent data loss on exactly the rows a studio most
          needs to act on.

          Bottom-right is the "who is on this" slot. An avatar when
          someone is, the word when nobody is. It costs the name block
          nothing, and it is self-grounded for the same reason the chip
          is.
        */}
        {inquiry.artist === null ? (
          <View style={styles.onPhoto}>
            <Text style={styles.unassigned}>UNASSIGNED</Text>
          </View>
        ) : null}

        {inquiry.artist ? (
          <Avatar
            url={inquiry.artist.avatarUrl}
            initials={initialsOf(inquiry.artist.name)}
            size={34}
            style={styles.artistAvatar}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    aspectRatio: CARD_RATIO,
    borderRadius: radius.card,
    /* Both the photo and the wash are absolutely filled, so the corners
       only exist if the card clips them. */
    overflow: 'hidden',
    borderWidth: hairline,
    borderColor: colors.cardBorder,
    /* The ground behind a photo that has not decoded yet — never white. */
    backgroundColor: colors.surfaceInset,
    justifyContent: 'space-between',
    padding: space.md,
  },
  /* Closed and cold inquiries are history, not pipeline. */
  closed: { opacity: 0.5 },
  /* Press feedback per the motion canon's `fast` band. A photo card
     cannot take the old row's background-colour press — there is a
     photograph where that colour would go — so it dims instead. */
  pressed: { opacity: 0.72 },

  noPhoto: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.cardGlass },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /* Hard right, whatever is or is not to its left. */
  topRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginLeft: 'auto' },
  /*
   * Dark enough that the chip's 10%-alpha fill composites over THIS
   * rather than over the photograph.
   *
   * 0.72, and the value is set by the WEAKEST tone rather than the
   * common one. At 0.55 the purple ARTIST_ASSIGNED chip cleared the
   * floor at 4.94:1 while NEUTRAL (#9b927f, a muted grey-brown) sat at
   * 3.68:1 -- it is the one tone with little headroom, and it passes
   * everywhere else in the app only because those grounds are
   * near-black. A backing tuned to the chip that happened to be in the
   * fixture would have shipped that failure.
   */
  chipBacking: { backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: radius.pill },
  /* The same ground, for the two accent-gold runs that are not inside a
     chip. Padded, because unlike the chip they have no inset of their
     own and a fill flush to the glyphs reads as a highlighter. */
  onPhoto: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
  },
  stamp: { ...type.meta, color: colors.fg, flexShrink: 0 },

  bottomRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  /* The one shrinkable thing on the card. */
  nameBlock: { flex: 1, minWidth: 0 },
  unassigned: { ...type.label, fontSize: 9, color: colors.accent },
  client: { ...type.heading, color: colors.fg },
  description: { ...type.small, color: colors.fgSecondary },
  artistAvatar: { flexShrink: 0 },

  guest: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  guestLabel: { ...type.meta, color: colors.accent },
});
