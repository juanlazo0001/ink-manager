import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { chat, hairline, radius, type } from '@/theme';

/** A measured screen-coordinate box. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The send-fly (spec §10, signature gesture #2).
 *
 * ─── WHAT IT IS ─────────────────────────────────────────────────────
 *
 * The committed text lifts out of the composer as a pre-rendered own
 * bubble and springs (S4) to the place its real row will occupy,
 * cross-fading into that row at ~70%. It is the one moment in the app
 * where a thing you typed visibly *becomes* a message.
 *
 * ─── WHY IT LIVES OUTSIDE THE THREAD ────────────────────────────────
 *
 * Rendered as a sibling of the keyboard-translated container, positioned
 * in SCREEN coordinates. Inside that container it would inherit the
 * keyboard's translateY and fly to the wrong place the moment the
 * keyboard was open -- which is every time anyone sends anything.
 *
 * ─── WHY IT OWNS NO ANIMATION ───────────────────────────────────────
 *
 * `progress` and `fade` are the SCREEN's shared values, driven there.
 * This component mounts, lives ~380ms, and unmounts -- an animation whose
 * whole lifetime is one mount of the component that starts it is fragile
 * by construction, and measurably so: started from this component's own
 * mount effect, the shared value never left 0 in the web harness while an
 * identical animation in a long-lived component ran normally. Driving it
 * from the screen, which is mounted for the whole conversation, removes
 * the dependency on when this particular subtree happens to attach.
 */
export function SendFly({
  body,
  from,
  to,
  progress,
  fade,
}: {
  body: string;
  /** The composer, in screen coordinates. */
  from: Rect;
  /** Where the real row landed, in screen coordinates. */
  to: Rect;
  /** 0 -> at the composer, 1 -> at the row. Owned by the screen. */
  progress: SharedValue<number>;
  /** 1 -> clone visible, 0 -> handed off to the real row. */
  fade: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    left: from.x + (to.x - from.x) * progress.value,
    top: from.y + (to.y - from.y) * progress.value,
    width: from.width + (to.width - from.width) * progress.value,
  }));

  return (
    <Animated.View style={[styles.clone, style]} pointerEvents="none">
      <View style={styles.bubble}>
        <Text style={styles.body} numberOfLines={6}>
          {body}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clone: { position: 'absolute', zIndex: 100 },
  /* §2.1 anatomy, so the clone and the row it becomes are the same shape. */
  bubble: {
    alignSelf: 'flex-end',
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.bubble,
    borderWidth: hairline,
    backgroundColor: chat.bubbleOwnBg,
    borderColor: chat.bubbleOwnBg,
  },
  body: { ...type.message, lineHeight: 21, color: chat.bubbleOwnText },
});
