import Feather from '@expo/vector-icons/Feather';
import { type ReactNode, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { hapticAction } from '@/lib/chatHaptics';
import { colors, space, type } from '@/theme';

/**
 * §8's row swipes: right reveals Pin, left reveals Mute and Archive.
 *
 * ─── WHY THE TWO SIDES COMMIT DIFFERENTLY ───────────────────────────
 *
 * Right is ONE action, so a full swipe commits it: pin is this viewer's
 * own preference, instantly reversible by the identical gesture, and
 * making someone swipe-then-tap for that is friction with nothing behind
 * it.
 *
 * Left is TWO actions, so a full swipe there has no defensible meaning —
 * which of them did you mean? It reveals and waits for a tap.
 *
 * That falls out to exactly what §8 rev E requires: ARCHIVE never
 * auto-commits. Archive is deliberately STUDIO-WIDE — `archivedAt` hides
 * the thread for everyone — and a studio-wide action taken by a thumb
 * that travelled slightly too far is not a thing this app should be able
 * to do. The rule is structural rather than a special case bolted onto
 * archive: one action, full swipe; more than one, tap to choose.
 *
 * ─── PANEL COLOURS ──────────────────────────────────────────────────
 *
 * Gold for pin (§8 says so, and pin is the screen's own quick-access
 * affordance), muted brown for mute, near-black for archive — archive
 * recedes because it is the one with reach beyond this viewer, and a
 * loud panel would invite the tap rather than warn about it. None of the
 * three is red: nothing here is destructive, and client conversations are
 * business records, which is why §8 has no Delete at all.
 */
export function ConversationSwipe({
  pinned,
  muted,
  onTogglePin,
  onToggleMute,
  onArchive,
  canArchive,
  children,
}: {
  pinned: boolean;
  muted: boolean;
  onTogglePin: () => void;
  onToggleMute: () => void;
  onArchive: () => void;
  /** False hides Archive entirely rather than showing a button that 403s. */
  canArchive: boolean;
  children: ReactNode;
}) {
  const ref = useRef<SwipeableMethods>(null);

  const close = () => ref.current?.close();

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      // Wide enough that a scroll is never mistaken for a swipe. The list
      // scrolls vertically and this is the only horizontal gesture on it,
      // so the two never have to negotiate anything subtler.
      leftThreshold={PANEL_WIDTH * 0.6}
      rightThreshold={PANEL_WIDTH * 0.6}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => (
        <Action
          label={pinned ? 'Unpin' : 'Pin'}
          icon="bookmark"
          style={styles.pin}
          labelStyle={styles.pinLabel}
          onPress={() => {
            close();
            onTogglePin();
          }}
        />
      )}
      // A full swipe right commits the pin without waiting for the tap.
      onSwipeableWillOpen={(direction) => {
        if (direction !== 'left') return;
        hapticAction();
        close();
        onTogglePin();
      }}
      renderRightActions={() => (
        <View style={styles.rightPanels}>
          <Action
            label={muted ? 'Unmute' : 'Mute'}
            icon={muted ? 'bell' : 'bell-off'}
            style={styles.mute}
            labelStyle={styles.mutedLabel}
            onPress={() => {
              close();
              onToggleMute();
            }}
          />
          {canArchive ? (
            <Action
              label="Archive"
              icon="archive"
              style={styles.archive}
              labelStyle={styles.archiveLabel}
              onPress={() => {
                close();
                onArchive();
              }}
            />
          ) : null}
        </View>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

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

  rightPanels: { flexDirection: 'row' },

  pin: { backgroundColor: colors.accent },
  pinLabel: { color: colors.accentFg },

  mute: { backgroundColor: colors.surfaceRaised },
  mutedLabel: { color: colors.fgSecondary },

  /* Recedes on purpose — see the header. */
  archive: { backgroundColor: colors.surfaceInset },
  archiveLabel: { color: colors.fgMuted },
});
