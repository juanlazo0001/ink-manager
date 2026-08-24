import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, space } from '@/theme';

/**
 * A card's action, as a circular icon button.
 *
 * apps/web's own, measured off the running client detail rather than
 * read off class names. Web draws these at TWO sizes and mobile keeps
 * both, because the distinction is meaningful:
 *
 *              header (`h-11 w-11`)    row (`h-8 w-8`)
 *   size       44 x 44                 32 x 32
 *   glyph      16px                    16px
 *   radius     full                    full
 *   border     1px rgba(201, 154, 91, 0.18)  -- exactly `colors.border`
 *   fill       none                    none
 *   colour     `fg`                    `fgSecondary`
 *
 * A header action names the whole section, so it gets the full 44pt tap
 * target; a row action belongs to one line of a list and web deliberately
 * makes it recede. Below `md` web's header buttons are ALREADY icon-only
 * (`md:h-auto md:w-auto` plus a `hidden md:inline` label) -- so icon-only
 * is web's own phone form here, not a mobile invention.
 *
 * It is NOT the top bar's button, despite the shared diameter: that one
 * carries an inset fill and a drop shadow because it floats over content.
 * A card action sits inside a card, so web gives it a bare outline. Kept
 * as its own component rather than a variant flag, so neither drifts into
 * the other.
 *
 * DISABLED IS NOT INERT. An action mobile cannot perform yet renders in a
 * dimmed treatment and, when tapped, says why. A greyed circle that eats
 * the tap teaches nothing; this is the replacement for the persistent
 * explainer sentences that used to sit under every action and made the
 * card shout.
 */
export function CardIconButton({
  Icon,
  label,
  onPress,
  unavailableNote,
  size = 'header',
  style,
}: {
  Icon: (props: { size?: number; color: string }) => React.ReactElement;
  /** Spoken name — these buttons carry no visible text. */
  label: string;
  onPress?: () => void;
  /** Shown when tapped, if the action is not built yet. */
  unavailableNote?: string;
  /** `header` is web's 44pt circle; `row` its 32pt one. */
  size?: 'header' | 'row';
  style?: StyleProp<ViewStyle>;
}) {
  const enabled = !!onPress;
  const [pressedNote, setPressedNote] = useState(false);

  function handlePress() {
    if (enabled) {
      onPress();
      return;
    }
    if (unavailableNote) {
      // A brief, in-voice answer instead of silence.
      Alert.alert(label, unavailableNote);
      setPressedNote(true);
      setTimeout(() => setPressedNote(false), 1200);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Not `disabled`: the button still answers, it just cannot act.
      accessibilityState={{ disabled: !enabled }}
      accessibilityHint={enabled ? undefined : unavailableNote}
      style={({ pressed }) => [
        styles.button,
        size === 'row' && styles.buttonRow,
        !enabled && styles.disabled,
        (pressed || pressedNote) && styles.pressed,
        style,
      ]}
    >
      <Icon
        size={16}
        color={enabled ? (size === 'row' ? colors.fgSecondary : colors.fg) : colors.fgMuted}
      />
    </Pressable>
  );
}

/** The row these sit in — right-aligned, as web aligns them. */
export function CardActionRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  button: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  buttonRow: { width: 32, height: 32 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.6 },
});
