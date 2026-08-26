import Feather from '@expo/vector-icons/Feather';
import { type ReactNode, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { colors, space, type } from '@/theme';

/**
 * The client row's swipe actions: swipe LEFT to reveal Message and
 * Archive behind the row (iOS Mail / Messages anatomy).
 *
 * Built on `ReanimatedSwipeable`, the same control `ConversationSwipe`
 * uses for the chat list, so the two lists answer a thumb identically.
 * That file is the precedent this one follows rather than a second
 * implementation of the same idea.
 *
 * ─── NO FULL-SWIPE COMMIT, AND THE RULE IS NOT NEW ──────────────────
 *
 * The brief allowed a full swipe to fire the primary action "if it feels
 * right". It doesn't, and `ConversationSwipe` had already worked out why
 * and written the rule down:
 *
 *     one action, full swipe; more than one, tap to choose.
 *
 * This side has TWO actions, so a full swipe has no defensible meaning —
 * which of them did you mean? It reveals and waits.
 *
 * The rule holds even when Message is hidden (a client with no thread
 * yet), which would leave Archive alone on the panel. `ConversationSwipe`
 * makes the same exception explicit for the same action: **Archive never
 * auto-commits.** It is a write with reach beyond this screen, and a
 * write taken by a thumb that travelled slightly too far is not a thing
 * this app should be able to do. Tapping it opens a confirm.
 *
 * ─── THE RED, AND THE STANDING RULE IT SITS AGAINST ─────────────────
 *
 * Archive's panel is `dangerStrong`, owner-directed for this session
 * ("ARCHIVE (red/destructive treatment)"). Recorded here because two
 * things in this repo point the other way and a later reader will
 * otherwise think it is drift:
 *
 *   1. CLAUDE.md: "Red is punctuation ... never a fill color or a large
 *      surface area", with exactly two sanctioned exceptions, both on the
 *      chat control.
 *   2. `ConversationSwipe` gives its own Archive a RECEDING near-black
 *      panel, and says why: archive is soft and reversible, so a loud
 *      panel "would invite the tap rather than warn about it".
 *
 * Archiving a client is likewise reversible — the API's own comment calls
 * it a "soft, reversible hide" and there is a matching unarchive route.
 * So the red overstates what the button does. Shipped as directed and
 * flagged in the report; `styles.archive` is the one line to change.
 */
export function ClientSwipe({
  archived,
  hasThread,
  onMessage,
  onArchive,
  children,
}: {
  archived: boolean;
  /** False hides Message rather than revealing a button that goes nowhere. */
  hasThread: boolean;
  onMessage: () => void;
  onArchive: () => void;
  children: ReactNode;
}) {
  const ref = useRef<SwipeableMethods>(null);
  const close = () => ref.current?.close();

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      /*
       * SCROLL vs SWIPE. `ReanimatedSwipeable` uses a Pan gesture with an
       * activeOffsetX window, so a mostly-vertical drag is never claimed
       * by it — the FlatList keeps the gesture and the row does not move.
       * The list scrolls vertically and this is the ONLY horizontal
       * gesture on it, so the two never have to negotiate anything
       * subtler. Same reasoning, same numbers as `ConversationSwipe`.
       */
      rightThreshold={PANEL_WIDTH * 0.6}
      overshootRight={false}
      /* Nothing on the right-swipe side: this row has no one-tap action
         worth committing without a confirm, so the gesture is one-way. */
      renderRightActions={() => (
        <View style={styles.panels}>
          {hasThread ? (
            <Action
              label="Message"
              icon="message-circle"
              style={styles.message}
              labelStyle={styles.messageLabel}
              onPress={() => {
                close();
                onMessage();
              }}
            />
          ) : null}
          <Action
            label={archived ? 'Unarchive' : 'Archive'}
            icon="archive"
            style={styles.archive}
            labelStyle={styles.archiveLabel}
            onPress={() => {
              close();
              onArchive();
            }}
          />
        </View>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

/** Matches `ConversationSwipe`, so a panel is the same width on both lists. */
const PANEL_WIDTH = 88;

function Action({
  label,
  icon,
  style,
  labelStyle,
  onPress,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  style: object;
  labelStyle: object;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, style, pressed && styles.pressed]}
    >
      <Feather name={icon} size={18} color={(labelStyle as { color: string }).color} />
      <Text style={[styles.actionLabel, labelStyle]} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { width: PANEL_WIDTH, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  actionLabel: { ...type.label, fontSize: 10 },
  pressed: { opacity: 0.75 },

  panels: { flexDirection: 'row' },

  message: { backgroundColor: colors.surfaceRaised },
  messageLabel: { color: colors.fgSecondary },

  /* Owner-directed red — see the header for the two standing rules this
     sits against and the one line to change if it is reversed. */
  archive: { backgroundColor: colors.dangerStrong },
  /* White, not cream: cream on dangerStrong measures 4.39:1, under the
     4.5:1 AA floor. CLAUDE.md records this for the chat control's label
     and it is the same fill and a smaller type size here. */
  archiveLabel: { color: '#ffffff' },
});
