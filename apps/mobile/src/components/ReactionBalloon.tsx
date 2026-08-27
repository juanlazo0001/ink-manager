import { StyleSheet, Text, View } from 'react-native';

import { chat, colors, hairline, type } from '@/theme';

/**
 * §7 rev G: a reaction, as an opaque balloon on the bubble's top corner.
 *
 * ─── WHY THIS REPLACED THE STAMPS ───────────────────────────────────
 *
 * The shipped version was a translucent chip tucked under the bubble's
 * bottom edge. Two things were wrong with it on a real screen: it read as
 * part of the bubble rather than as a response TO it, and at 16% tint on
 * a dark ground it barely registered. iMessage's anatomy is a solid
 * balloon sitting ON the corner with a little tail pointing back at what
 * it is about, and that reads instantly.
 *
 * ─── WHICH CORNER ───────────────────────────────────────────────────
 *
 * The reactor's own side, which is the rule §7 rev G states and the one
 * that generalises: your reaction goes on the right (your side of the
 * thread), theirs on the left. So their reaction on your right-aligned
 * bubble lands top-left, and yours on their left-aligned bubble lands
 * top-right — the two cases the spec names, out of one rule rather than
 * two special cases.
 *
 * ─── THE TAIL ───────────────────────────────────────────────────────
 *
 * Two dots, descending toward the bubble and shrinking. They are what
 * make the balloon read as attached to THIS message rather than floating
 * between two of them, and they cost nothing: an absolutely positioned
 * pair, no layout impact, drawn on the side facing the bubble.
 */
export function ReactionBalloon({
  emoji,
  count,
  mine,
}: {
  emoji: string;
  count: number;
  /** The viewer's own reaction — gold, like every other "yours" in the app. */
  mine: boolean;
}) {
  return (
    <View style={[styles.balloon, mine ? styles.balloonMine : styles.balloonTheirs]}>
      <Text style={styles.glyph}>{emoji}</Text>
      {count > 1 ? (
        <Text style={[styles.count, mine && styles.countMine]}>{count}</Text>
      ) : null}
    </View>
  );
}

/**
 * The tail dots, drawn once per cluster rather than per balloon — a tail
 * on every balloon in a row of three is three tails pointing at the same
 * message.
 */
export function ReactionTail({ side, mine }: { side: 'left' | 'right'; mine: boolean }) {
  const fill = mine ? colors.accent : chat.surfaceRaised;
  return (
    <View style={[styles.tail, side === 'left' ? styles.tailLeft : styles.tailRight]} pointerEvents="none">
      <View style={[styles.dotBig, { backgroundColor: fill }]} />
      <View style={[styles.dotSmall, { backgroundColor: fill }]} />
    </View>
  );
}

/** §7 rev G: ~30pt balloon, ~16pt emoji. */
export const BALLOON = 30;

const styles = StyleSheet.create({
  balloon: {
    minWidth: BALLOON,
    height: BALLOON,
    borderRadius: BALLOON / 2,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    /* Opaque, and lifted off the bubble by a shadow rather than a ring --
       §7 rev G asks for both z-above and "slight". */
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  balloonMine: { backgroundColor: colors.accent },
  balloonTheirs: {
    backgroundColor: chat.surfaceRaised,
    borderWidth: hairline,
    borderColor: chat.hairline,
  },
  glyph: { fontSize: 16, lineHeight: 20 },
  /* §1.2: counts are Jura. Ink on gold, muted on espresso. */
  count: { ...type.label, fontSize: 10, color: chat.textMuted },
  countMine: { color: colors.accentFg },

  tail: { position: 'absolute', bottom: -7, alignItems: 'center', gap: 2 },
  tailLeft: { left: 6, alignItems: 'flex-start' },
  tailRight: { right: 6, alignItems: 'flex-end' },
  dotBig: { width: 7, height: 7, borderRadius: 3.5 },
  dotSmall: { width: 4, height: 4, borderRadius: 2 },
});
