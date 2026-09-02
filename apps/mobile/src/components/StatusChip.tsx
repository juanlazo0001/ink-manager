import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { statusLabel, statusTone } from '@/lib/inquiryDisplay';
import { colors, radius, space, tones, type } from '@/theme';

/**
 * The one status chip.
 *
 * Extracted from apps/web's `StatusPill` in its editorial shape, at the
 * MOBILE-FIRST sizing web itself uses below the `sm` breakpoint — which
 * is to say, web's own phone rendering, measured off the running app
 * rather than read off the class names:
 *
 *   padding    4px 8px          (px-2 py-1)
 *   radius     full
 *   font       Jura, 9px, weight 400
 *   tracking   0.72px           (0.08em at 9px)
 *   gap        6px              (gap-1.5)
 *   dot        4x4 round        (h-1 w-1)
 *   background tone at 10% alpha        <- the tinted fill
 *   text       tone at full
 *
 * ONE DELIBERATE DIVERGENCE, owner-directed: WEB'S CHIPS ARE BORDERED
 * (`border-{tone}/50`, and `border-border-soft` for neutral) and mobile's
 * are not. The tinted fill alone carries the chip here. Do not "restore"
 * the stroke from web — it was removed on purpose.
 *
 * The TINTED FILL is the part mobile was missing: chips here were drawn
 * with a coloured border over the card's own background, which reads as
 * an outline rather than a status. `bg-{tone}/10` is what gives web's
 * chips their weight.
 *
 * Two details that are easy to get wrong and are deliberate here:
 *
 *   The DANGER dot is `danger-strong`, not `danger`. Web keys the dot off
 *   a separate map, and the readable-as-text red is too soft for a 4px
 *   dot.
 *
 *   NEUTRAL now takes the SAME 10% rule as every other tone. Web gives it
 *   `bg-white/[0.02]`, which works there only because a border draws the
 *   shape; at 2% with no stroke the chip disappears into the card. Its
 *   grey is still the neutral tone, so it reads as "no particular state"
 *   exactly as before — it is simply visible.
 */

/** A hex tone at a given alpha, since the palette is stored as hex. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type ChipTone = keyof typeof tones;

/** Web's fill alpha. Its border alpha is deliberately unused — see above. */
const FILL_ALPHA = 0.1;

export function StatusChip({
  tone,
  label,
  style,
}: {
  tone: ChipTone;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const color = tones[tone] ?? tones.neutral;

  /*
   * A CHIP WITH NOTHING TO SAY RENDERS NOTHING.
   *
   * The dot is drawn unconditionally, before the label — so an empty or
   * whitespace label produced exactly "a bare coloured dot with no chip",
   * which is what the owner photographed. Any call site handing this a
   * blank status could do it: `label={g.status}` on a gift card row,
   * `label={w.status ?? 'Pending'}` on a waiver, a status string the API
   * returns as "".
   *
   * Guarding at the component rather than at each call site, because the
   * next call site would have the same hole.
   */
  if (!label || !label.trim()) return null;

  // Web's own exception: the danger dot uses the stronger red.
  const dotColor = tone === 'danger' ? colors.dangerStrong : color;

  return (
    <View
      style={[styles.chip, { backgroundColor: withAlpha(color, FILL_ALPHA) }, style]}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text
        style={[styles.label, { color }]}
        numberOfLines={2}
        maxFontSizeMultiplier={1.3}
      >
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

/** The same chip, keyed off an inquiry/project status. */
export function InquiryStatusChip({
  status,
  label,
  style,
}: {
  status: string;
  /**
   * Overrides the label while keeping the status's colours — web's
   * `<StatusPill status={stage} label={PROJECT_STAGE_LABELS[stage]} />`,
   * which is how a converted project shows "Session Complete" instead of
   * "SCHEDULING". The TONE still comes from `status`, so a stage chip
   * cannot invent a colour the palette has no meaning for.
   */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <StatusChip
      tone={statusTone(status) as ChipTone}
      label={label ?? statusLabel(status)}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    // Never squeezed by a row that runs out of width.
    flexShrink: 0,
    gap: 6,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  // `mt-px` on web — the dot sits a hair low against uppercase Jura.
  dot: { width: 4, height: 4, borderRadius: radius.pill, marginTop: 1 },
  label: {
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.72,
  },
});
