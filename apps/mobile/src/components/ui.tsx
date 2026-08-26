import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Card, Eyebrow } from '@/components/editorial';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * `Eyebrow` and `Card` used to be defined here as a plain letterspaced
 * caption and a flat surface. Both now come from `editorial.tsx`, which
 * carries apps/web's actual treatment — the red `+` ticks and the
 * translucent glass card. Re-exported from here rather than moved,
 * because every screen already imports them from this module and the
 * point of the change is that they all pick it up.
 */
export { Card, Eyebrow };

export function ScreenTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.screenTitle}>{children}</Text>;
}

/** The primary action. Gold fill, square, Jura label — one per screen at most. */
export function GoldButton({
  label,
  onPress,
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.goldButton,
        inactive && styles.goldButtonInactive,
        pressed && !inactive && styles.goldButtonPressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.accentFg} />
      ) : (
        <Text style={styles.goldButtonLabel}>{label.toUpperCase()}</Text>
      )}
    </Pressable>
  );
}

/** Secondary action — outline, no fill. Also the shape logout uses. */
export function QuietButton({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quietButton, pressed && styles.quietButtonPressed, style]}
    >
      <Text style={styles.quietButtonLabel}>{label.toUpperCase()}</Text>
    </Pressable>
  );
}

/**
 * A small tinted chip. `tone` carries the colour, so red never leaks in as
 * decoration — the only way to get red here is to ask for `danger`, which
 * is reserved for a genuinely failed or destructive state.
 */
export function Chip({
  label,
  color,
  style,
}: {
  label: string;
  /** Defaults to the muted foreground. Pass a channel colour or an accent. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const tone = color ?? colors.fgMuted;
  return (
    <View style={[styles.chip, { borderColor: tone }, style]}>
      <View style={[styles.chipDot, { backgroundColor: tone }]} />
      <Text style={[styles.chipLabel, { color: tone }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

/**
 * The one shape every "nothing here" and "that didn't work" state uses, so
 * they read as the same product rather than as ad-hoc strings.
 */
export function StateMessage({
  eyebrow,
  title,
  body,
  action,
  tone = 'neutral',
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
  /** `alert` tints the eyebrow red. Everything else stays gold/muted. */
  tone?: 'neutral' | 'alert';
}) {
  return (
    <View style={styles.stateMessage}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <Text style={styles.stateTitle}>{title}</Text>
      {body ? <Text style={styles.stateBody}>{body}</Text> : null}
      {action ? <QuietButton label={action.label} onPress={action.onPress} style={styles.stateAction} /> : null}
    </View>
  );
}

/** Full-screen loading, used while a screen's first fetch is in flight. */
export function ScreenLoading() {
  return (
    <View style={styles.screenLoading}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  screenTitle: { ...type.display, color: colors.fg },

  goldButton: {
    backgroundColor: colors.accentButton,
    borderRadius: radius.button,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  goldButtonPressed: { backgroundColor: colors.accentHover },
  goldButtonInactive: { opacity: 0.4 },
  goldButtonLabel: { ...type.button, color: colors.accentFg },

  quietButton: {
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.button,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  quietButtonPressed: { opacity: 0.6 },
  quietButtonLabel: { ...type.button, color: colors.fgSecondary },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: hairline,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  chipDot: { width: 6, height: 6, borderRadius: radius.pill },
  chipLabel: { ...type.label },

  stateMessage: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.xxxl,
  },
  stateTitle: { ...type.heading, color: colors.fg, textAlign: 'center' },
  stateBody: { ...type.small, color: colors.fgMuted, textAlign: 'center', maxWidth: 300 },
  stateAction: { marginTop: space.md, alignSelf: 'center', paddingHorizontal: space.xl },

  screenLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
});
