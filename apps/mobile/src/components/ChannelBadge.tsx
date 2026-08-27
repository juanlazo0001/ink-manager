import { StyleSheet, Text, View } from 'react-native';

import { chat, colors, type } from '@/theme';

/**
 * §1.1: the channel, as a lettered badge anchored to the avatar's
 * bottom-right corner.
 *
 * ─── WHY LETTERS AND NOT A COLOUR ───────────────────────────────────
 *
 * The badge is deliberately NEUTRAL. This app already uses a coloured
 * square to mean *presence*, and if a coloured square also meant
 * *channel* the two would be indistinguishable at row scale. So the
 * semantics are split and kept split: coloured square = presence
 * (thread header only, §9), lettered circle = channel (list rows).
 *
 * §1.1 permits a subtle per-channel tint later as a nice-to-have, but it
 * must never be the only signal — the letters carry the meaning, and a
 * tint that isn't there yet costs nothing.
 *
 * ─── WHY IT IS ON THE AVATAR ────────────────────────────────────────
 *
 * It replaces a third line of row furniture (swatch + full channel word).
 * §8 wants every row to be exactly two text lines — name and preview —
 * and a channel is an attribute of the thread, so it belongs on the thing
 * that identifies the thread rather than on a line of its own. Two lines
 * per row is roughly a third more threads on a phone screen.
 *
 * ─── WHY A 2PT BORDER IN THE PAGE COLOUR ────────────────────────────
 *
 * The badge sits half-on the avatar. Without a ring in the PAGE colour it
 * reads as a smudge on the photo; with one it reads as a separate object
 * resting on top, which is what it is.
 */
const CHANNEL_CODES: Record<string, string> = {
  SMS: 'SMS',
  INSTAGRAM: 'IG',
  EMAIL: 'EM',
  FACEBOOK: 'FB',
  PHONE: 'PH',
  // §1.1 spells this one out: IN_APP renders as APP.
  IN_APP: 'APP',
};

/** Null for a channel with no code — better nothing than a wrong letter. */
export function channelCode(channel: string): string | null {
  return CHANNEL_CODES[channel] ?? null;
}

export function ChannelBadge({ channel }: { channel: string }) {
  const code = channelCode(channel);
  if (!code) return null;

  return (
    <View style={styles.badge} pointerEvents="none">
      <Text style={styles.code} numberOfLines={1}>
        {code}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chat.surfaceRaised,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  // §1.2: Jura, letter-spaced caps, and the smallest type in the row.
  code: { ...type.label, fontSize: 8, lineHeight: 10, letterSpacing: 0.5, color: chat.textMuted },
});
