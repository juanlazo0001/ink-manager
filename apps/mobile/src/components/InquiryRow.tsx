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
 * 3.77:1, measured off `design-refs/session-ap/intended-target.jpg` —
 * which supersedes session AO's 3.64:1 by the architect's ruling. Both
 * numbers, as asked:
 *
 *   AO, from design-refs/session-ao/target.jpg      3.64 : 1
 *   AP, from intended-target.jpg (middle card)      3.77 : 1
 *
 * A 3.5% change in height — 99pt to 96pt at a 361pt card. Which is to
 * say the ratio was never where the "needs more air" impression came
 * from; the PADDING was, and that is changed below.
 *
 * ─── WHY THE MIDDLE CARD ────────────────────────────────────────────
 *
 * The target's three cards are NOT the same height. Measured from their
 * own left-border column they run 356, 326 and 297px — shrinking by
 * ~30px per card down the image, linearly, which is a keystone artifact
 * of how that reference was produced rather than three different card
 * sizes. Their ratios therefore spread 3.46 / 3.77 / 4.14.
 *
 * The middle card sits at the image's vertical centre where keystone
 * distortion crosses zero, so it is the least distorted sample, and it
 * is the one taken. The spread is reported rather than averaged away:
 * this reference cannot pin the ratio tighter than about ±0.35, and AO's
 * 3.64 was already inside that band.
 */
/*
 * ─── AQ, ITEM 2: A STEP TALLER ──────────────────────────────────────
 *
 * 3.77 -> 3.60, an owner calibration. AP measured 3.77 off the target's
 * middle card and that measurement stands unchanged above; this is a
 * deliberate step away from it, not a correction to it.
 *
 *     361pt card    95.8pt tall  ->  100.3pt      +4.7%
 *
 * The internal proportions are untouched — the layout is still
 * `space-between` with the same padding relationships — so the card
 * gains height without redistributing what is inside it. The brief's
 * "keep the same proportional relationship" is satisfied by changing
 * only this constant.
 */
const CARD_RATIO = 3.6;

/*
 * ─── THE PHOTO IS A TEXTURE OVER THE CARD'S OWN GROUND ──────────────
 *
 * This is what session AP is really about, and the first attempt at it
 * was wrong in an instructive way, so both are recorded.
 *
 * SAMPLED FIRST — target vs the AO build on the owner's own device
 * (`design-refs/session-ap/`), over the photo band, which is 0.06-0.50
 * of card height and 0.06-0.45 of width (above the name block, left of
 * the chip):
 *
 *                      mean level   card-to-card spread
 *   intended target       34.4/255            8.3
 *   AO build (device)     45.0/255           16.1
 *
 * So AO ran +10.6 levels bright and 1.9x less uniform.
 *
 * THE FIRST FIX WAS A HEAVIER BLACK SCRIM, and it cannot work. A black
 * scrim MULTIPLIES: it scales every source by the same transmission, so
 * it can darken a bright photo but can never lift a dark one. Measured
 * at 0.72 it compressed a 155-level source difference to 41.6 — a
 * factor of 0.267, exactly as designed — and still left the bright card
 * at 51 and the dark card at 12. Darkening further only drives the dark
 * card to black. Convergence is unreachable that way at ANY value.
 *
 * WHAT THE TARGET ACTUALLY DOES is composite the photo at low opacity
 * over a ground that is dark but NOT black, which lifts the floor for
 * every source. Two independent readings of the target agree:
 *
 *   within-card texture range  37 levels over a ~200-level source
 *                              -> photo opacity ~0.185
 *   mean 34.4 at that opacity  -> ground 12.7-17.2 depending on the
 *                                 source mean assumed
 *
 * And the app already owns a token in that range: `surfaceInset`
 * (#120f0b) is level 14.7. So this is not a new colour, it is the
 * card's own ground showing through a faint photograph.
 *
 * The photo survives as texture and depth, which is the ruling: the
 * row's information is the name, description, status, date and avatar.
 */
/*
 * ─── AQ, ITEM 1: ONE STEP LIGHTER ───────────────────────────────────
 *
 * 0.18 -> 0.21, an OWNER CALIBRATION and a deliberate divergence from
 * the 0.185 that session AP measured off the target. AP's number is not
 * withdrawn — it is still the best reading of `intended-target.jpg`, and
 * it is recorded above. This is a review note on top of it.
 *
 * A NOTE ON THE LEVER, because the brief's wording assumes a mechanism
 * that no longer exists. It asks to "reduce the base scrim by a few
 * percent". There is no base scrim: AP removed it after measuring that a
 * black scrim MULTIPLIES and therefore cannot converge a bright photo
 * and a dark one at any value. The equivalent control is this opacity,
 * where the scrim-equivalent is (1 - PHOTO_OPACITY):
 *
 *     scrim-equivalent   0.82  ->  0.79      a 3.7% relative reduction
 *     photo opacity      0.18  ->  0.21
 *
 * Lighter is therefore MORE photo, not less scrim, and the uniformity
 * behaviour is unchanged in kind: the compression factor simply moves
 * from 0.18 to 0.21, so bright and dark still converge, 17% less
 * tightly. Measured figures are in the session report.
 */
/*
 * ─── AS: ONE STEP LIGHTER AGAIN ─────────────────────────────────────
 *
 * 0.21 -> 0.24, the same +0.03 step AQ took, and the same lever: there
 * is still no base scrim, so the scrim-equivalent moves 0.79 -> 0.76.
 *
 * MEASURED, composited pixels at 393pt (not arithmetic):
 *
 *                        0.21    0.24
 *   thermostat name     12.49   11.83
 *   thermostat desc      5.63    5.46     floor is 4.5
 *   flat-white desc      5.28    5.14     the worst case that exists
 *   uniformity spread    30.2    34.1     levels, bright vs dark
 *
 * The no-photo card does not move at all (14.1 both times), which is the
 * control: with no photograph the opacity has nothing to composite.
 *
 * THE CEILING IS ~0.40, and it was measured rather than extrapolated: at
 * 0.41 the description over the thermostat reads 4.47, just under the
 * floor. A probe at 0.55 puts it at 3.75 and fails the NAME over white
 * too (4.41) -- run deliberately, because a contrast check that has
 * never failed is not evidence that it can. So 0.24 sits with real
 * margin, and the description remains the binding constraint.
 */
/*
 * ─── AT: ONE STEP LIGHTER AGAIN, AND PROBABLY THE LAST ──────────────
 *
 * 0.24 -> 0.27, the same +0.03 step as AQ and AS.
 *
 *                        0.24    0.27    floor
 *   thermostat name     11.83   11.18      4.5
 *   thermostat desc      5.46    5.28      4.5
 *   flat-white desc      5.14    4.90      4.5
 *   uniformity spread    34.1    38.6        -
 *
 * WHICH CONSTRAINT NOW BINDS HAS CHANGED, and that is the thing worth
 * knowing here. AS measured the ceiling over the THERMOSTAT fixture at
 * ~0.40. But the flat-white case -- the worst case the wash's arithmetic
 * was originally derived against, and the one a client photographing a
 * sheet of paper actually produces -- is falling roughly 0.24 per step
 * and reaches 4.5 at about 0.32.
 *
 * So there is approximately ONE more step of this size before the
 * absolute worst case loses the floor, and it will be flat white that
 * fails first, not the thermostat. A fourth step needs either a
 * measurement showing flat white still holds, or a decision that the
 * thermostat is the real-world bound and pure white is not.
 *
 * Uniformity keeps loosening as designed -- the compression factor IS
 * the opacity -- and the no-photo card stays at 14.1 throughout, which
 * is the control that proves the harness is measuring compositing.
 */
/*
 * ─── BA: THE STEP RAN OUT OF ROOM. 0.27 -> 0.28, AND THAT IS THE ───
 *
 * The brief asked for "another step lighter", meaning the +0.03 that AQ,
 * AS and AT each took. A third of that is all there is.
 *
 * MEASURED, flat white, description band, floor 4.5:
 *
 *     0.27   4.59      shipped before this
 *     0.28   4.53      shipped here -- the lightest value that holds
 *     0.29   4.45      FAILS
 *     0.30   4.38      FAILS -- the step actually asked for
 *
 * So the ceiling is between 0.28 and 0.29, and 0.30 is past it. The
 * failing probes were run deliberately: a contrast check that has never
 * failed is not evidence that it can.
 *
 * AT PREDICTED ~0.32 AND THAT NUMBER IS NOW WRONG, for a reason worth
 * recording. AT extrapolated from a two-point slope taken BEFORE AU
 * reworked the gradient itself (524c3d7). AU's smoothstep is lighter
 * through the description band by design, so the whole ladder shifted
 * down: AU re-measured 0.27 at 4.71 against AT's 4.90 and published it.
 * The remaining headroom AT described as "roughly one more step" was
 * spent by that change, not by this one.
 *
 * (This harness reads flat-white description ~0.12 lower than AU's did
 * -- 4.59 where AU published 4.71 -- while reproducing every other
 * figure AU published to the digit: photo bands 63.4/77.3, thermostat
 * name 10.40, and all three kink numbers. The residual is in the
 * description band alone and is not explained; it is stated because it
 * is the direction that matters, being the conservative one. On AU's
 * calibration 0.29 would read ~4.57 and pass. If a future session wants
 * that ninth hundredth, resolve the 0.12 first -- do not assume it away
 * in whichever direction is convenient.)
 *
 * The thermostat is nowhere near binding: 5.02 at 0.27, 4.97 at 0.28.
 * Flat white is the constraint, exactly as AT said it would be.
 *
 * GOING FURTHER IS AN OWNER CALL, not an implementation one: it means
 * deciding that a photograph of white paper or a bright stencil is not a
 * case worth protecting. Nothing here forecloses it.
 */
/*
 * ─── BC: THE OWNER LIFTED THE CONSTRAINT. 0.28 -> 0.34 ──────────────
 *
 * BA stopped at 0.28 because a photograph of white paper lost the 4.5
 * floor above it. Asked, the owner ruled: "No white paper not worth
 * protecting. Make lighter."
 *
 * SO THE BINDING CASE IS NOW THE THERMOSTAT, and it was re-measured
 * rather than assumed — AS's old ~0.40 ceiling predates AU's gradient
 * rework and does not apply. Thermostat description, floor 4.5:
 *
 *     0.28   4.97      where BA stopped
 *     0.31   4.83
 *     0.34   4.64      shipped here
 *     0.36   4.52      the ceiling — passes by two hundredths
 *     0.37   4.45      FAILS
 *
 * 0.34, not 0.36. The ceiling is a cliff edge, not a target: 0.36 clears
 * the floor by 0.02, which is inside the noise of a JPEG-textured
 * fixture, and the next person to touch the gradient would silently push
 * it under. 0.34 keeps 0.14 of margin and is still twice the +0.03 step
 * the earlier sessions took, which is what "make lighter" with the
 * constraint lifted should look like.
 *
 * ─── THE APP'S ONE KNOWN AA EXCEPTION ───────────────────────────────
 *
 * FLAT WHITE IS BELOW THE 4.5 FLOOR BY DESIGN: **4.08:1** for the
 * description line at 0.34, over a photograph that is pure white.
 *
 * A DELIBERATE OWNER DECISION, confirmed 2026-09-01: "the atmosphere
 * matters more than the AA floor here." Not a regression, not an
 * oversight, and not to be silently raised by an accessibility sweep —
 * raising it means darkening the card, which is the thing four sessions
 * of owner calibration were spent making lighter.
 *
 * WHAT WOULD CHANGE THE ANSWER, and the reason this is flagged rather
 * than merely recorded: if AA ever becomes MANDATORY rather than a
 * target — an App Store requirement, an enterprise customer's
 * procurement checklist, a studio's own accessibility policy — this is
 * the line item that fails it, and this constant is the lever. Nothing
 * else in the app is knowingly under the floor.
 *
 * The thermostat, which is what a real client photograph looks like,
 * reads 4.64 and passes. See CLAUDE.md, "Design".
 *
 * The no-photo control holds at 14.7 across every value measured in this
 * session, which is what proves the harness is reading compositing and
 * not something else.
 */
const PHOTO_OPACITY = 0.34;

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
 * DESCRIPTION, not the name: `fgMuted` (#9b927f, the token the style
 * actually uses -- this block said `fgSecondary` until session AS,
 * which was stale rather than wrong-in-kind) has a relative
 * luminance of 0.518, so 4.5:1 requires the composited ground under it
 * to sit at or below L = 0.076, which over white means at least 0.69
 * black. The name (`fg`, L = 0.842) only needs 0.58.
 *
 * NOW IT ONLY HAS ONE JOB. In AO this gradient carried both the card's
 * overall darkness AND the text's contrast, so its shallowest point was
 * pinned at 0.60 by what the name needed — which is why the AO card
 * could never be uniformly moody: the gradient had to stay dark
 * everywhere, and still tracked the photo's own brightness.
 *
 * `BASE_SCRIM` now owns darkness and uniformity. This owns contrast, and
 * starts fully transparent: at the top it adds nothing, because the base
 * has already taken the card to the target's level.
 *
 *   MEASURED text bands, as a fraction of card height, at 393pt
 *     date          0.13 – 0.29
 *     name          0.38 – 0.63
 *     description   0.63 – 0.81
 *
 * Combined transmission is the product of the two — (1 - base) x
 * (1 - gradient):
 *
 *     top    0.28 x 1.00 = 0.280
 *     0.40   0.28 x 0.90 = 0.252
 *     0.62   0.28 x 0.55 = 0.154
 *     bottom 0.28 x 0.28 = 0.078
 *
 * Every number is verified by sampling composited pixels in the harness
 * rather than trusting this arithmetic — see the report's tables.
 */
/*
 * ─── AU: THE GRADIENT IS GENERATED, NOT HAND-PLACED ─────────────────
 *
 * The four hand-placed stops above had a VISIBLE edge, and the cause is
 * measurable rather than a matter of taste. Their segment slopes were:
 *
 *     0.00 -> 0.40   slope 0.25
 *     0.40 -> 0.62   slope 1.59     <- a 6.4x jump
 *     0.62 -> 1.00   slope 0.71     <- and back down again
 *
 * A linear gradient is piecewise linear, so each of those corners is a
 * discontinuity in the FIRST derivative of luminance. The eye resolves
 * that as a band (Mach banding) -- it is looking at the kink, not the
 * darkness. Adding stops in the same shape would not help; the shape is
 * the problem.
 *
 * So the stops are sampled from a smooth curve instead. `t ** CURVE` is
 * monotone with a continuously varying slope and no corner anywhere, and
 * sampling it at STEPS points leaves slope changes ~1/STEPS^2 of the old
 * jump -- far below what the eye can pick out. The top stays clear
 * because the curve starts flat, which is also what keeps the photograph
 * readable as a photograph.
 *
 * PEAK owns the darkness, CURVE owns where the darkness arrives. They
 * are separate on purpose: "too dark" and "I can see the gradient" were
 * two different complaints and they have two different fixes.
 */
const WASH_PEAK = 0.72;
/* Where darkening begins. Above this the photograph is untouched. */
const WASH_START = 0.25;
const WASH_STEPS = 16;

/*
 * SMOOTHSTEP, not a power curve, and the difference is the whole point.
 *
 * `t ** k` was tried first and it is smooth but it arrives too late: it
 * puts its darkness at the very bottom, so the DESCRIPTION band (0.63 to
 * 0.81 of card height) sat too light and flat white fell to 3.97:1,
 * under the 4.5 floor. Measured, not guessed.
 *
 * smoothstep(3u^2 - 2u^3) has ZERO slope at both ends and a continuous
 * derivative throughout, so it has no corner to see, and its steep part
 * is in the MIDDLE -- which is exactly where the text is. Starting it at
 * WASH_START keeps the top of the card, where the photograph actually
 * reads, almost untouched.
 *
 * Against the old hand-placed stops, alpha at each landmark:
 *
 *          0.40   0.50   0.62   0.72   1.00
 *   old    0.10   0.26   0.45   0.52   0.72
 *   this   0.08   0.19   0.35   0.49   0.72
 *
 * Lighter everywhere the photograph shows, level with it where the
 * description needs a ground, identical at the bottom edge.
 */
function buildWash(): { colors: string[]; locations: number[] } {
  const colors: string[] = [];
  const locations: number[] = [];
  for (let i = 0; i <= WASH_STEPS; i += 1) {
    const t = i / WASH_STEPS;
    const u = t <= WASH_START ? 0 : (t - WASH_START) / (1 - WASH_START);
    const eased = u * u * (3 - 2 * u);
    colors.push(`rgba(0,0,0,${(WASH_PEAK * eased).toFixed(4)})`);
    locations.push(t);
  }
  return { colors, locations };
}

const WASH = buildWash();
const WASH_COLORS = WASH.colors as unknown as readonly [string, string, ...string[]];
const WASH_LOCATIONS = WASH.locations as unknown as readonly [number, number, ...number[]];

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
          style={[StyleSheet.absoluteFill, styles.photo]}
          contentFit="cover"
          transition={140}
          placeholderContentFit="cover"
          onError={() => setFailed(true)}
          accessible={false}
        />
      ) : (
        <NoPhotoGround />
      )}

      {/* Over the scrim, under the content — contrast for the text.
          `pointerEvents none` so the whole card stays one press target. */}
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
            /* 0.265 of card height in the target against 0.289 in the
               AO build, measured the same way in both so the bias
               cancels — about 8% smaller. */
            size={32}
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
    /*
     * Asymmetric, from the target's own proportions. Measured as
     * fractions of card height, so the two references' different scales
     * do not matter:
     *
     *                        target        AO build
     *   chip row from top     0.108          0.190
     *   description to bottom 0.138          0.109
     *
     * The chip sits nearly twice as far down in the AO build, and the
     * description is closer to the floor. So the air moves from the top
     * of the card to the bottom of it — which is the whole of the
     * "name block sits lower with more breathing room" note, and it is
     * padding rather than the ratio.
     */
    /*
     * ─── AQ, ITEM 4: A UNIFORM STEP UP ──────────────────────────────
     *
     *     top         4  -> 8      bottom  8 -> 12
     *     horizontal  12 -> 16
     *
     * The brief offers two paths: match the target's breathing room "if
     * AP's measurement suggests it was under-applied; otherwise a
     * uniform step up". AP's measurements say it was NOT under-applied —
     * against the target the insets already met or exceeded it:
     *
     *                        target    AP shipped
     *   chip row from top     0.108      0.135     already further in
     *   description to bottom 0.138      0.135     matched
     *   left inset            0.035      0.039     already further in
     *
     * So this takes the second path, as an owner calibration: a uniform
     * step on all sides, knowingly moving further from the target's
     * proportions rather than toward them. It is affordable because item
     * 2 made the card taller in the same pass — the extra 4.5pt of
     * height covers the extra 8pt of vertical inset most of the way, and
     * the resulting fractions are in the session report.
     */
    paddingTop: space.sm,
    paddingBottom: space.md,
    paddingHorizontal: space.lg,
  },
  /* Closed and cold inquiries are history, not pipeline. */
  closed: { opacity: 0.5 },
  /* Press feedback per the motion canon's `fast` band. A photo card
     cannot take the old row's background-colour press — there is a
     photograph where that colour would go — so it dims instead. */
  pressed: { opacity: 0.72 },

  /* See PHOTO_OPACITY: the card's `surfaceInset` background IS the
     ground this composites over. */
  photo: { opacity: PHOTO_OPACITY },
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
  /*
   * ─── AQ, ITEM 3: ONE STEP GREYER ────────────────────────────────
   *
   * `fgSecondary` (#c7bea9) -> `fgMuted` (#9b927f), the next step down
   * the muted scale, so the line reads as clearly subordinate to the
   * name.
   *
   * This is the adjustment that fights item 1: a greyer text on a
   * lighter wash cuts contrast from both ends at once. AP measured this
   * line at 8.91:1 worst case, which left roughly 2x of headroom, and
   * the measured result after both changes is in the session report. If
   * it had not cleared 4.5:1 the instruction was to hold legibility —
   * it did clear, so no trade was needed.
   */
  description: { ...type.small, color: colors.fgMuted },
  artistAvatar: { flexShrink: 0 },

  guest: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  guestLabel: { ...type.meta, color: colors.accent },
});
