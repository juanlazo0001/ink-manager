import { create } from 'qrcode/lib/core/qrcode';
import { useMemo } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors, radius, space } from '@/theme';

/**
 * A QR code, drawn as SVG.
 *
 * THE SAME MECHANISM WEB USES, not a lookalike. apps/web's `QrCode.tsx`
 * calls `QRCode.toDataURL(value)` from the `qrcode` package; this calls
 * that same package's `create(value)` and paints the matrix it returns.
 * Identical encoder, identical output — only the rasteriser differs,
 * because web has a canvas and this does not.
 *
 * WHY NOT `react-native-qrcode-svg`: it would have been a new dependency
 * whose job is exactly this, wrapping a fork of the encoder already in
 * this repo. `qrcode/lib/core/qrcode` is pure JavaScript — no canvas, no
 * `Buffer`, no `fs`, nothing native — so it bundles under Metro and runs
 * in Expo Go, which a native module could not do without a custom dev
 * client the project has no Apple account for.
 *
 * ONE PATH, NOT N RECTS. A 25x25 matrix is 625 nodes if each dark module
 * is its own `<Rect>`; as a single path with one `M h v h z` subpath per
 * module it is one node. On a list that matters, and this screen may hold
 * several.
 *
 * Rendered on white with a quiet margin, as web does (`bg-white p-2`) and
 * as every scanner expects — a QR on a dark ground fails to read on a lot
 * of hardware.
 */
export function QrCode({
  value,
  size = 140,
  style,
}: {
  value: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const path = useMemo(() => {
    try {
      const { modules } = create(value, { errorCorrectionLevel: 'M' });
      const count = modules.size;
      const data = modules.data;
      let d = '';
      for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
          if (data[row * count + col]) {
            d += `M${col} ${row}h1v1h-1z`;
          }
        }
      }
      return { d, count };
    } catch {
      // A code that cannot be encoded shows nothing rather than a broken
      // square — the code text beside it is still readable and scannable
      // by hand, exactly as web's own failure path leaves it.
      return null;
    }
  }, [value]);

  if (!path || !path.d) {
    return <View style={[styles.frame, { width: size, height: size }, style]} />;
  }

  return (
    <View style={[styles.frame, { width: size, height: size }, style]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${path.count} ${path.count}`}>
        <Rect x="0" y="0" width={path.count} height={path.count} fill="#ffffff" />
        <Path d={path.d} fill="#000000" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  // Web: `rounded-lg border border-border bg-white p-2`.
  frame: {
    backgroundColor: '#ffffff',
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.sm,
    overflow: 'hidden',
  },
});
