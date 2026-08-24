import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, space, tones } from '@/theme';

/**
 * A card's action, as a circular icon button.
 *
 * apps/web's own, measured off the running client detail rather than
 * read off class names:
 *
 *   size    44 x 44
 *   glyph   16px
 *   radius  full
 *   border  1px rgba(201, 154, 91, 0.18)   -- exactly `colors.border`
 *   fill    none
 *
 * Below `md` web's header buttons are ALREADY icon-only (`md:h-auto
 * md:w-auto` plus a `hidden md:inline` label) -- so icon-only is web's
 * own phone form here, not a mobile invention.
 *
 * ONE SIZE, EVERYWHERE. Web draws row-level actions smaller (`h-8 w-8`,
 * in `fg-secondary`) than section actions (`h-11 w-11`), and mobile
 * mirrored that split until the owner saw it on the device: a card whose
 * header buttons and row buttons are different sizes reads as two
 * unrelated controls, and 32pt is under the 44pt iOS tap-target floor
 * anyway. There is now a single size token and no variant to pick, so a
 * per-card size cannot come back by accident.
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
  tone = 'default',
  style,
}: {
  Icon: (props: { size?: number; color: string }) => React.ReactElement;
  /** Spoken name — these buttons carry no visible text. */
  label: string;
  onPress?: () => void;
  /** Shown when tapped, if the action is not built yet. */
  unavailableNote?: string;
  /**
   * `danger` for a destructive control. Web writes its Remove links in
   * `text-danger`, and losing that colour when the words became a glyph
   * would strip the row's only warning that the button deletes something.
   */
  tone?: 'default' | 'danger';
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
        !enabled && styles.disabled,
        (pressed || pressedNote) && styles.pressed,
        style,
      ]}
    >
      <Icon size={16} color={glyphColor(enabled, tone)} />
    </Pressable>
  );
}

/**
 * Red survives being disabled, at reduced opacity like everything else.
 * A destructive control that greys out entirely reads as a different
 * button, and this one still answers when tapped.
 */
function glyphColor(enabled: boolean, tone: 'default' | 'danger'): string {
  if (tone === 'danger') return tones.danger;
  return enabled ? colors.fg : colors.fgMuted;
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
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.6 },
});
