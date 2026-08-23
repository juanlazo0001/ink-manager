import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { channelColor, colors, radius } from '@/theme';

/**
 * A thread's channel tag.
 *
 * **Web uses a flat coloured swatch, not a glyph.** `ConversationsPanel`'s
 * `ChannelDot` is `h-3.5 w-3.5 shrink-0 rounded-[4px]` — a 14px rounded
 * square — filled from `CHANNEL_DOT_CLASSES`:
 *
 *   SMS        #2fb35c      EMAIL     #4a90d9
 *   FACEBOOK   #1877f2      PHONE     #8a8a92
 *   OTHER      #5a5a62      INSTAGRAM its brand gradient
 *
 * So the brief's "if web has none, design minimal monochrome glyphs" does
 * not apply: web has a convention for every channel, and it is colour
 * rather than shape. Those ARE third-party brand colours (Instagram's
 * gradient, Facebook blue) — sanctioned here because web already ships
 * them, which is the bar the brief set.
 *
 * `IN_APP` has no entry in web's map either, and falls through to OTHER's
 * grey. Mobile's palette matches, so the fallback is identical rather than
 * invented.
 *
 * Instagram is flattened to its mid-stop (#ee2a7b) rather than gradiented:
 * at 14px a three-stop gradient is indistinguishable from a flat fill, and
 * mobile's colour tokens were ported that way in an earlier session.
 */
export function ChannelSwatch({
  channel,
  size = 14,
  style,
}: {
  channel: string;
  /** 14 matches web. The frequent-row badge uses a smaller one. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        {
          width: size,
          height: size,
          // web: rounded-[4px], scaled with the swatch so a smaller one
          // stays proportionate rather than turning into a circle.
          borderRadius: Math.max(2, Math.round((size / 14) * 4)),
          backgroundColor: channelColor(channel),
        },
        style,
      ]}
    />
  );
}

/**
 * The same swatch as a badge clipped to an avatar's corner — used on the
 * frequent strip, where there is no room for a label beside it.
 *
 * The ring is the app's own ground rather than a border colour, so the
 * badge reads as sitting ON the avatar instead of being part of it.
 */
export function ChannelAvatarBadge({ channel }: { channel: string }) {
  return (
    <View style={styles.badgeRing}>
      <ChannelSwatch channel={channel} size={10} />
    </View>
  );
}

const styles = StyleSheet.create({
  badgeRing: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    padding: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
});
