import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { login, radius, space, type } from '@/theme';

/**
 * The web's `.btn-gold-gradient`, ported.
 *
 * Two stacked layers on web, and two here for the same reason: a shallow
 * ramp between two close golds, with a very faint white-to-dark sheen
 * over the top. The sheen is what stops it reading as a flat swatch; a
 * single hard specular highlight is what would make it read as plastic.
 *
 * The angle needs explaining. CSS `linear-gradient(100deg, …)` measures
 * clockwise from "to top", so 100deg points almost straight right and
 * very slightly down. React Native takes fractional start/end points
 * instead, so that direction becomes (sin 100°, −cos 100°) ≈ (0.98, 0.17),
 * i.e. left-to-right across a 0.17-of-height drop — hence y running
 * 0.415 → 0.585 rather than a flat 0.5.
 */
export function GoldGradientButton({
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
      style={({ pressed }) => [styles.wrap, inactive && styles.inactive, pressed && !inactive && styles.pressed, style]}
    >
      <LinearGradient
        colors={[login.buttonLight, login.buttonDeep]}
        start={{ x: 0, y: 0.415 }}
        end={{ x: 1, y: 0.585 }}
        style={StyleSheet.absoluteFill}
      />
      {/* The sheen, over the ramp — same order as the CSS, where the
          white-to-dark layer is listed first and therefore paints on top. */}
      <LinearGradient
        colors={[login.buttonSheenTop, login.buttonSheenBottom]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {busy ? (
        <ActivityIndicator color={login.buttonText} />
      ) : (
        <Text style={styles.label}>{label.toUpperCase()}</Text>
      )}
      {/* The 1px gold hairline, drawn last so neither gradient covers it. */}
      <View pointerEvents="none" style={styles.hairline} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 52,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    overflow: 'hidden',
  },
  // Web presses by deepening the ramp itself (`filter: brightness(0.9)`)
  // rather than swapping to a different flat colour. RN has no filter, so
  // a slight opacity drop over the dark photo reads closest.
  pressed: { opacity: 0.88 },
  inactive: { opacity: 0.5 },
  label: {
    ...type.button,
    color: login.buttonText,
    // .btn-gold-gradient's own tracking, not the app-wide button token's.
    letterSpacing: 1.2,
  },
  hairline: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: login.buttonBorder,
    borderRadius: radius.button,
  },
});
