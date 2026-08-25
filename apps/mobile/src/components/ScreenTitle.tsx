import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SCREEN_TOP_INSET } from '@/components/ScreenShell';
import { colors, radius, space, type } from '@/theme';

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
        <Text style={styles.title}>{title}</Text>
        {counts ? (
          <Text style={styles.counts} numberOfLines={1}>
            {counts}
          </Text>
        ) : null}
      </View>
      {action ?? null}
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
 * The title row's one control, in Flash's own treatment — a filled
 * accent pill, not the bare outline a card action wears.
 *
 * It lives here rather than in each screen for the reason the title
 * itself does: three screens each keeping their own copy is how the
 * eyebrow drifted, and this is the same shape of thing.
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
  /** Spoken name — the button carries no visible text. */
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
      <Icon size={18} color={colors.accentFg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: SCREEN_TOP_INSET,
    paddingBottom: space.md,
  },
  text: { flex: 1, gap: 2 },
  title: { ...type.welcome, color: colors.fg },
  counts: { ...type.small, color: colors.fgMuted },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.accentButton,
    borderRadius: radius.button,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  actionPressed: { opacity: 0.75 },
});
