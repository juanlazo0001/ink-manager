import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SCREEN_TOP_INSET } from '@/components/ScreenShell';
import { colors, fonts, radius, space, type } from '@/theme';

/**
 * A screen's title block: serif name, a muted line of live counts, and
 * one right-aligned action.
 *
 * ─── THE PATTERN CAME FROM FLASH ────────────────────────────────────
 *
 * Flash grew this shape first — "Flash", a summary line underneath, and
 * a "+" out at the right — and the owner picked it as the house pattern.
 * This is that, extracted verbatim, so Flash migrates onto it unchanged
 * and the other screens inherit rather than approximate it.
 *
 * THE SUB-HEADER IS COUNTS, NOT PROSE. It says what is actually on the
 * screen right now — "8 inquiries · 2 projects" — which is a different
 * job from an eyebrow. An eyebrow is a standing caption; this changes as
 * the data does, and that is why the screens taking this pattern lose
 * their eyebrow rather than stacking both.
 *
 * `action` is one control at most. A title row with two actions is a
 * toolbar, and this app already has one of those at the top of the
 * screen.
 */
export function ScreenTitle({
  title,
  counts,
  action,
}: {
  title: string;
  /** The live line. Omitted while the data is still loading. */
  counts?: string | null;
  action?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {counts ? (
          // Two lines, not one. The action slot became a labelled pill in
          // AC and takes real width now; Flash's own line ("2 available ·
          // 1 pending approval · 1 booked") was being cut mid-word at
          // 390pt. This is a summary, not chrome — wrapping it is right
          // and truncating it is not. Short lines are unaffected.
          <Text style={styles.counts} numberOfLines={2}>
            {counts}
          </Text>
        ) : null}
      </View>
      {action ? <View style={styles.actionSlot}>{action}</View> : null}
    </View>
  );
}

/**
 * "8 inquiries · 2 projects" — the one place the separator and the
 * pluralisation live, so two screens cannot disagree about either.
 * A zero drops out entirely rather than reading "0 archived".
 */
export function countLine(...parts: Array<[count: number, singular: string, plural?: string]>): string {
  return parts
    .filter(([n]) => n > 0)
    .map(([n, singular, plural]) => `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`)
    .join(' · ');
}

/**
 * The title row's one control — web's primary pill, carried over value
 * for value rather than approximated.
 *
 * ─── EXTRACTED FROM apps/web, NOT EYEBALLED ─────────────────────────
 *
 * `FlashGallery.tsx`'s own button is the canonical instance:
 *
 *     editorial-btn-primary flex items-center gap-2 rounded-full
 *     bg-accent px-4 py-2 text-bg
 *
 * plus `<PlusIcon className="h-4 w-4" />` and the label "New Flash". And
 * `.editorial-btn-primary` (index.css:1948) supplies the type:
 *
 *     font-family      var(--font-jura)
 *     font-weight      400
 *     font-size        11.5px
 *     letter-spacing   0.14em     -> 1.61px at 11.5
 *     text-transform   uppercase
 *
 * Which lands here as: gap 8, padding 16/8, radius full, 16px glyph,
 * `colors.accent` (#c99a5b — web's `bg-accent` under
 * `[data-theme="editorial-gold"]`) and `colors.bg` (#0e0b08) for the
 * label.
 *
 * **The label colour is `bg`, not `accentFg`.** Those are two different
 * values (#0e0b08 vs #171208) and web picked `text-bg` here. Close
 * enough to look identical, different enough that guessing would have
 * been a guess.
 *
 * THIS IS THE ACTION SLOT'S ONE ANATOMY. Before this it was an icon-only
 * circle in `accentButton` (#d5a05c) — a third gold, and a control that
 * made the reader work out what "+" meant on each screen. Web has always
 * said the word.
 *
 * The screen decides whether to render it at all. A control the viewer's
 * permissions do not allow is absent, never present-and-refusing — web
 * hides its own Add Client button the same way.
 */
export function TitleAction({
  Icon,
  label,
  onPress,
}: {
  Icon: (props: { size?: number; color: string }) => React.ReactElement;
  /** Shown on the button, uppercased, and used as its spoken name. */
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
    >
      <Icon size={16} color={colors.bg} />
      <Text
        style={styles.actionLabel}
        numberOfLines={1}
        // Chrome that must stay navigable, capped like `Pill`'s — and for
        // the same reason: an OS text-size setting can otherwise push this
        // button past the title beside it.
        maxFontSizeMultiplier={1.3}
      >
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    /*
     * WRAPS, because web's own header does — `flex flex-wrap
     * items-center justify-between gap-4` on FlashGallery.
     *
     * It earns its keep at 320pt. Once the action slot became a labelled
     * pill, "Inquiries" + "+ NEW INQUIRY" needed 131px of title and had
     * 130 — short by ONE pixel, which character-wrapped the word into
     * "Inquirie / s". A one-pixel miss is not a one-pixel problem: any
     * slightly longer screen name or button label lands in the same
     * place. So the row wraps like web's, the action takes its own line
     * when the title cannot have `TEXT_MIN_WIDTH`, and no title is ever
     * broken mid-word.
     */
    flexWrap: 'wrap',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: SCREEN_TOP_INSET,
    paddingBottom: space.md,
  },
  /*
   * Enough for the longest screen name this app has at the display size,
   * with room to spare — the threshold that decides whether the action
   * fits beside the title or drops below it.
   */
  text: { flex: 1, minWidth: 180, gap: 2 },
  /* Web's `justify-between`: hard right on a shared line, and still right
     when it has wrapped onto its own. */
  actionSlot: { marginLeft: 'auto' },
  title: { ...type.welcome, color: colors.fg },
  counts: { ...type.small, color: colors.fgMuted },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    // web: gap-2, px-4 py-2, rounded-full, bg-accent
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    flexShrink: 0,
  },
  actionLabel: {
    // .editorial-btn-primary, exactly.
    fontFamily: fonts.label,
    fontSize: 11.5,
    lineHeight: 14,
    letterSpacing: 1.61,
    color: colors.bg,
  },
  actionPressed: { opacity: 0.75 },
});
