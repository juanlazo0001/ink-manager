import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, type ReactNode } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { colors, hairline, radius, space, type } from '@/theme';
import { duration, easing } from '@/theme/motion';

/**
 * Editorial Gold's shared visual language, ported from apps/web.
 *
 * Every treatment here has a named counterpart in the web app, cited on
 * each export. They are grouped in one module because they are one
 * vocabulary: an eyebrow, a card, a section header and a bar are how a
 * screen in this product is built, and a screen that reaches past them
 * for its own version is the drift this session exists to remove.
 */

/**
 * The eyebrow: letterspaced uppercase Jura flanked by red `+` glyphs.
 *
 * ONE RENDERING, NO VARIANTS. There used to be a `tone` prop — `muted`,
 * `accent`, `alert` — and it recoloured the TEXT while the ticks stayed
 * red regardless. That is how the Clients screen ended up with a red
 * eyebrow: session W read "red-tick eyebrow" as "red eyebrow" and passed
 * `tone="alert"`, which is a different thing entirely. Home's rendering
 * is canonical and is now the only one: muted text, red ticks, inline.
 *
 * `style` still reaches the ROW, for spacing. It has never reached the
 * text, so the four call sites that set `color` on it were no-ops; those
 * are gone too.
 *
 * ─── WEB'S LITERAL VALUES ───────────────────────────────────────────
 *
 * Extracted from `apps/web/src/components/Eyebrow.tsx`, not measured off
 * a screenshot:
 *
 *   container  inline-flex items-center gap-3      -> 12px between parts
 *   text       font-jura text-[11px] font-semibold
 *              tracking-[0.34em] text-fg-muted      -> Jura 600, 11px,
 *                                                      3.74px, fgMuted
 *   ticks      text-danger-strong text-[13px]
 *              tracking-normal                      -> 13px, 0 tracking
 *   meta       text-fg-muted/70 text-[11px]
 *              font-normal normal-case tracking-normal
 *
 * `type.eyebrow` already held every one of those numbers. What diverged
 * was a step session Y added — 9.5px at 0.5px tracking for any label over
 * 24 characters — to stop the Clients eyebrow overflowing at 320pt. That
 * is gone: it made two screens look like a different component, which is
 * what the owner kept seeing. A label too long for its screen is fixed by
 * shortening the LABEL.
 *
 * Web's `components/Eyebrow.tsx`:
 *   container  font-jura text-[11px] font-semibold tracking-[0.34em]
 *              text-fg-muted uppercase, gap-3
 *   ticks      text-danger-strong text-[13px], aria-hidden
 *   meta       text-fg-muted/70 text-[11px] font-normal normal-case
 *
 * The ticks use `--color-danger-strong`, which that token's own comment
 * reserves for "fills/borders/icon-strokes/dots, never text". These are
 * decorative glyphs carrying no meaning and hidden from assistive tech —
 * an icon stroke that happens to be typed — which is the sanctioned use,
 * and it is what web does here too.
 */
export function Eyebrow({
  children,
  meta,
  style,
}: {
  children: ReactNode;
  /** A date range, "All-time" — the card's contextual second line. */
  meta?: string;
  /**
   * Applied to the ROW, not the text — an eyebrow is a flex row of three
   * elements here, so spacing belongs on the container. Colour comes from
   * `tone`, which is why no call site sets one by hand.
   */
  style?: StyleProp<ViewStyle>;
}) {
  const label = String(children).toUpperCase();
  return (
    <View style={[styles.eyebrowRow, style]}>
      <Text style={styles.tick} accessibilityElementsHidden importantForAccessibility="no">
        +
      </Text>
      <Text
        style={styles.eyebrow}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text style={styles.tick} accessibilityElementsHidden importantForAccessibility="no">
        +
      </Text>
      {meta ? <Text style={styles.eyebrowMeta}>{meta}</Text> : null}
    </View>
  );
}

/**
 * A date range as an eyebrow — web passes exactly this through
 * `<CardShell caption={`${range.start} – ${range.end}`}>`, which renders
 * it through the same Eyebrow. An en dash, not a hyphen, as web writes it.
 */
export function DateRangeEyebrow({ start, end }: { start: string; end: string }) {
  return <Eyebrow>{`${start} – ${end}`}</Eyebrow>;
}

/**
 * A card. Web's `.card-surface` under `[data-theme="editorial-gold"]`,
 * plus CardShell's own gradient:
 *
 *   border-radius   var(--radius-card)      10px
 *   background      var(--color-card-glass) #100f0ed6
 *   border-color    var(--color-border-glass) rgba(201,154,91,0.1)
 *   backdrop-filter blur(var(--blur-card))  16px
 *   overlay         bg-gradient-to-b from-white/[0.012] to-transparent
 *   padding         p-6                     24px
 *
 * The translucency is real — `#100f0ed6` is 84% opaque, so the background
 * photo genuinely reads through, which is the whole point of the treatment
 * over a photo. The BLUR is the one value deliberately not reproduced:
 * this repo's design rules forbid combining `backdrop-filter` with
 * animation until it has been tested on a real phone, and a screen of
 * these scrolls. Everything else about the surface is web's.
 */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.card, style]}>
      {/* CardShell's `from-white/[0.012]` top highlight. Absolutely
          positioned rather than wrapping the children, so it can never
          affect their layout. */}
      <LinearGradient
        colors={['rgba(255, 255, 255, 0.012)', 'rgba(255, 255, 255, 0)']}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

/**
 * A card's title.
 *
 * SENTENCE CASE, and that is a divergence from web, which sets these in
 * caps (`.sc` at `text-[20px]`). Owner-directed.
 *
 * The uppercasing lived HERE, in this one component, as
 * `String(children).toUpperCase()` — call sites always passed sentence
 * case ("Contact info", "Gift cards"). So this is a single change and
 * every card moved together; no strings were hardcoded in caps.
 *
 * Tracking drops with it. `type.sectionHeader` carries 1.02px, which is
 * 0.06em — letterspacing that exists to keep uppercase from setting
 * solid. Sentence case has ascenders and descenders doing that work
 * already, and the same tracking on mixed case reads as a gap between
 * every letter. `type.sectionHeader` carries the chosen value and the
 * reasoning behind it.
 */
export function SectionHeader({
  children,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  /** Web's card titles carry `truncate`; pass 1 to match. */
  numberOfLines?: number;
}) {
  return (
    <Text style={[styles.sectionHeader, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

/**
 * The standard card: eyebrow caption, title, body — web's `CardShell`.
 * Callers pass the caption rather than assembling their own eyebrow, so
 * every card on every screen puts its metadata in the same place.
 */
export function EditorialCard({
  title,
  caption,
  children,
  style,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Card style={style}>
      {caption ? <Eyebrow style={styles.cardCaption}>{caption}</Eyebrow> : null}
      <SectionHeader>{title}</SectionHeader>
      <View style={styles.cardBody}>{children}</View>
    </Card>
  );
}

/**
 * One row of web's `HorizontalBarList`, value-for-value:
 *
 *   row gap     gap-3            12px
 *   label row   mb-1, text-xs; label text-fg-secondary, value font-medium text-fg
 *   track       h-3 bg-surface-inset, SQUARE — no radius
 *   fill        h-full rounded-r bg-accent   (right end only, 4px)
 *   width       max((value / max) * 100, value > 0 ? 3 : 0)
 *
 * The 3% floor is the detail that matters: without it a stage with one
 * inquiry against a max of forty draws nothing at all, and "one" and
 * "none" look identical.
 */
/**
 * The bar's fill, growing to width rather than appearing at it.
 *
 * apps/web animates exactly this: measured off the live dashboard, its
 * funnel bars transition `width, filter` over
 * `0.2s cubic-bezier(0.4, 0, 0.2, 1)`. Same duration, same curve here.
 *
 * Re-runs whenever the value changes, so switching the dashboard's date
 * range animates the bars to their new lengths instead of snapping.
 */
function AnimatedBarFill({ widthPct }: { widthPct: number }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(widthPct, { duration: duration.base, easing: easing.standard });
  }, [w, widthPct]);
  const style = useAnimatedStyle(() => ({ width: `${w.value}%` as const }));
  return <Animated.View style={[styles.barFill, style]} />;
}

export function FunnelBar({
  label,
  valueLabel,
  value,
  max,
}: {
  label: string;
  /** Web composes this as `${count} (${pct})`, e.g. `19 (79.2%)`. */
  valueLabel: string;
  value: number;
  max: number;
}) {
  const widthPct = Math.max((value / Math.max(max, 1)) * 100, value > 0 ? 3 : 0);
  return (
    <View>
      <View style={styles.barHead}>
        <Text style={styles.barLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.barValue}>{valueLabel}</Text>
      </View>
      <View
        style={styles.barTrack}
        accessibilityRole="image"
        accessibilityLabel={`${label}: ${valueLabel}`}
      >
        <AnimatedBarFill widthPct={widthPct} />
      </View>
    </View>
  );
}

/** The list wrapper — web's `flex flex-col gap-3`. */
export function FunnelBarList({ children }: { children: ReactNode }) {
  return <View style={styles.barList}>{children}</View>;
}

/**
 * The cream highlight chip. Web:
 * `bg-fg text-accent-fg font-display inline-block px-4 py-1 text-4xl italic
 *  shadow-lg shadow-black/30`.
 *
 * Web's own comment calls this "deliberately the ONLY use of this
 * treatment on the page, reserved for this one headline percentage rather
 * than sprinkled across every stat card". That restraint is part of the
 * treatment, so this export exists for exactly one caller.
 */
export function StatChip({ children }: { children: ReactNode }) {
  return (
    <View style={styles.statChipBox}>
      <Text style={styles.statChipText}>{children}</Text>
    </View>
  );
}

/**
 * The horizontal rule with a red diamond — web's `.ornament`:
 *
 *   height 15px
 *   ::before  1px rule, linear-gradient(90deg, transparent,
 *             var(--color-border-strong), transparent), top 7px
 *   ::after   8x8 var(--color-danger-strong), rotate(45deg), top 3px, centred
 */
export function Ornament({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.ornament, style]} pointerEvents="none">
      <LinearGradient
        colors={['transparent', colors.borderStrong, 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.ornamentRule}
      />
      <View style={styles.ornamentDiamond} />
    </View>
  );
}

/**
 * One label/value row inside a card — the client page's `Fact`, lifted
 * here so every card body in the app sets its facts the same way.
 *
 * ─── IT ABSORBED `DetailField` ──────────────────────────────────────
 *
 * There were two of these. `Fact` (client detail) set the label left and
 * the value right on one line; `DetailField` (`DetailSection.tsx`, the
 * inquiry and appointment screens) stacked the label above the value.
 * They also disagreed about the missing case: `Fact` demanded a string,
 * `DetailField` rendered an em dash for null and its comment explains
 * why —
 *
 *   "on a detail screen 'we don't have this' is information, and a
 *    silently absent row reads as a bug"
 *
 * which is right, and is now this component's behaviour everywhere. The
 * stacked layout was also right, for the values it was carrying: a
 * studio note or a long description right-aligned against its label is
 * unreadable. So the layout became `multiline` rather than a second
 * component, and the call site picks by the shape of its value, not by
 * which screen it happens to be on.
 */
export function Fact({
  label,
  value,
  multiline,
  last,
  leading,
}: {
  label: string;
  /** Null renders an em dash. That is deliberate — see above. */
  value: string | null | undefined;
  /** Stack the value under the label, left-aligned. For prose. */
  multiline?: boolean;
  /** Drops the rule. A trailing hairline under a card's last row is a
      stray line — the client page's own note, kept. */
  last?: boolean;
  /**
   * Rendered immediately before the value — an avatar, in practice.
   *
   * Here rather than in the caller because the value is right-aligned
   * and shrinkable: an avatar placed as a sibling of the whole Fact
   * would sit outside that alignment and drift away from the name as
   * the name's width changes. Ignored under `multiline`, where the
   * value is prose and a leading glyph would only interrupt it.
   */
  leading?: ReactNode;
}) {
  const shown = value && value.trim() ? value : '—';
  const text = (
    <Text style={[styles.factValue, multiline && styles.factValueStacked]} selectable>
      {shown}
    </Text>
  );
  return (
    <View style={[styles.fact, multiline && styles.factStacked, last && styles.factLast]}>
      <Text style={styles.factLabel}>{label.toUpperCase()}</Text>
      {leading && !multiline ? (
        <View style={styles.factLeading}>
          {leading}
          {text}
        </View>
      ) : (
        text
      )}
    </View>
  );
}

/**
 * A card section with nothing in it yet — "No deposit form sent."
 *
 * A sentence, not a `Fact`: there is no label/value pair here, only the
 * absence, and an em dash against an invented label would be worse than
 * saying it plainly. Both the client page and the staff inquiry screen
 * had grown this line privately, disagreeing only on the padding
 * (`space.sm` against `space.md`); this is the client page's.
 */
export function CardEmpty({ text }: { text: string }) {
  return <Text style={styles.cardEmpty}>{text}</Text>;
}

/** The short red rule above Lost / Cold Rate — web's `h-0.5 w-8 rounded-full bg-danger-strong`. */
export function RedRule({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.redRule, style]} />;
}

const styles = StyleSheet.create({
  /*
   * NEVER WRAPS. `flexWrap: 'wrap'` was here, and on a long eyebrow the
   * row broke — dropping the closing `+` onto a line of its own, which is
   * not an eyebrow, it is a stray glyph. The ticks flank the text; that
   * is the whole anatomy.
   *
   * `gap: space.md` is 12px, which is web's `gap-3` exactly.
   *
   * When the text is too wide it ellipsizes. It no longer shrinks: the
   * shrink step made a long eyebrow render as a visibly different
   * component from a short one, and a label too long for its screen is a
   * copy problem, not a type problem.
   */
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  /*
   * The canonical colour, baked in.
   *
   * It used to come from the `tone` prop, so removing that prop left the
   * text with NO colour at all -- black on a black page, invisible rather
   * than muted. Caught by measuring the computed value rather than
   * trusting a render that merely looked dim.
   */
  eyebrow: { ...type.eyebrow, color: colors.fgMuted, flexShrink: 1 },
  tick: { ...type.eyebrow, fontSize: 13, letterSpacing: 0, color: colors.dangerStrong, flexShrink: 0 },
  eyebrowMeta: { ...type.meta, color: colors.fgMuted, opacity: 0.7 },

  card: {
    backgroundColor: colors.cardGlass,
    borderWidth: hairline,
    borderColor: colors.cardBorder,
    borderRadius: radius.card,
    padding: space.xl,
    overflow: 'hidden',
  },
  cardCaption: { marginBottom: space.sm },
  cardBody: { marginTop: space.xl - space.sm },

  sectionHeader: { ...type.sectionHeader, color: colors.fg },

  barList: { gap: space.md },
  barHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginBottom: space.xs },
  barLabel: { ...type.small, fontSize: 12, color: colors.fgSecondary, flex: 1 },
  barValue: { ...type.small, fontSize: 12, fontFamily: type.body.fontFamily, color: colors.fg },
  barTrack: { height: 12, width: '100%', backgroundColor: colors.surfaceInset },
  barFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },

  statChipBox: {
    alignSelf: 'flex-start',
    backgroundColor: colors.fg,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
    // shadow-lg shadow-black/30
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  statChipText: { ...type.statChip, color: colors.accentFg },

  ornament: { height: 15, justifyContent: 'center' },
  ornamentRule: { position: 'absolute', left: 0, right: 0, top: 7, height: 1 },
  ornamentDiamond: {
    position: 'absolute',
    left: '50%',
    top: 3,
    marginLeft: -4,
    width: 8,
    height: 8,
    backgroundColor: colors.dangerStrong,
    transform: [{ rotate: '45deg' }],
  },

  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm + 2,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  /* `flexShrink` so a long name still yields to the label rather than
     pushing the avatar off the row. */
  factLeading: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  /* Stacked: the row becomes a column, so `justifyContent` stops applying
     and the value needs its right-alignment taken back off. */
  factStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: space.xs },
  factLast: { borderBottomWidth: 0 },
  factLabel: { ...type.meta, color: colors.fgMuted },
  factValue: { ...type.body, color: colors.fg, flexShrink: 1, textAlign: 'right' },
  factValueStacked: { color: colors.fgSecondary, textAlign: 'left' },

  cardEmpty: { ...type.small, color: colors.fgMuted, paddingVertical: space.sm },

  redRule: { height: 2, width: 32, borderRadius: radius.pill, backgroundColor: colors.dangerStrong },
});
