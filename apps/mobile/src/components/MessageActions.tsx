import Feather from '@expo/vector-icons/Feather';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Eyebrow } from '@/components/ui';
import { REACTION_EMOJIS, type ReactionEmoji } from '@/lib/conversations';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The message action sheet — long-press a bubble to open it.
 *
 * Mirrors apps/web's own iMessage-style menu exactly: one row of the six
 * reaction emoji, then Reply, Copy, and Edit. Web puts that menu at the
 * bubble's corner because it has hover and right-click to open it; a
 * phone has neither, so the same content is presented as the bottom sheet
 * this app already uses for the channel and attach pickers.
 *
 * Gating follows web's:
 *
 * - **React / Reply / Copy** — every real message. Not a shared-inquiry
 *   card, which is not a chat bubble with a body worth quoting.
 * - **Edit** — STAFF/GROUP threads only, and only your own message. The
 *   API enforces both: a CLIENT thread is an immutable record of what
 *   actually went over SMS/Email, and someone else's message is not yours
 *   to rewrite, not even as an OWNER.
 *
 * Reactions are an upsert, one per person per message, so the viewer's
 * current choice is marked and tapping it again clears it.
 */
export function MessageActions({
  visible,
  onClose,
  /** The viewer's current reaction on this message, if any. */
  myReaction,
  canEdit,
  /** False for a message with no text — there is nothing to put on the clipboard. */
  canCopy,
  copied,
  onReact,
  onReply,
  onCopy,
  onEdit,
}: {
  visible: boolean;
  onClose: () => void;
  myReaction?: string | null;
  canEdit: boolean;
  canCopy: boolean;
  copied: boolean;
  onReact: (emoji: ReactionEmoji) => void;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Eyebrow style={styles.eyebrow}>React</Eyebrow>
          <View style={styles.emojiRow}>
            {REACTION_EMOJIS.map((emoji) => {
              const mine = myReaction === emoji;
              return (
                <Pressable
                  key={emoji}
                  onPress={() => onReact(emoji)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mine }}
                  accessibilityLabel={mine ? `Remove ${emoji} reaction` : `React ${emoji}`}
                  style={({ pressed }) => [styles.emoji, mine && styles.emojiMine, pressed && styles.pressed]}
                >
                  <Text style={styles.emojiGlyph}>{emoji}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.divider} />

          <Pressable
            onPress={onReply}
            accessibilityRole="button"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Feather name="corner-up-left" size={16} color={colors.fgSecondary} />
            <Text style={styles.actionLabel}>Reply</Text>
          </Pressable>

          {canCopy ? (
            <Pressable
              onPress={onCopy}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Feather name={copied ? 'check' : 'copy'} size={16} color={copied ? colors.accent : colors.fgSecondary} />
              <Text style={[styles.actionLabel, copied && styles.actionLabelDone]}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>
          ) : null}

          {canEdit ? (
            <Pressable
              onPress={onEdit}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Feather name="edit-2" size={16} color={colors.fgSecondary} />
              <Text style={styles.actionLabel}>Edit</Text>
            </Pressable>
          ) : null}

          <Pressable onPress={onClose} style={styles.done}>
            <Text style={styles.doneLabel}>CANCEL</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderTopWidth: hairline,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
  },
  eyebrow: { color: colors.accent, marginBottom: space.sm },

  emojiRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.xs },
  emoji: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: 'transparent',
  },
  // The viewer's own reaction, marked the same way a selected pill is.
  emojiMine: { borderColor: colors.accent, backgroundColor: 'rgba(201, 154, 91, 0.08)' },
  emojiGlyph: { fontSize: 24, lineHeight: 30 },

  divider: { height: hairline, backgroundColor: colors.border, marginTop: space.md, marginBottom: space.xs },

  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  actionLabel: { ...type.body, color: colors.fg },
  actionLabelDone: { color: colors.accent },

  done: { marginTop: space.md, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.accent },
  pressed: { opacity: 0.6 },
});
