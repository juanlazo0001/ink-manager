import Feather from '@expo/vector-icons/Feather';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Eyebrow } from '@/components/ui';
import { chat, colors, hairline, radius, space, type } from '@/theme';

/**
 * What happens when a failed message is tapped (spec §2.4, §7).
 *
 * ─── WHY A SHEET AND NOT A SILENT RESEND ────────────────────────────
 *
 * Tapping the failed row used to fire `doSend` immediately. That is the
 * wrong default for a message that reaches a client's actual phone over
 * SMS: the reason it failed might be the reason it should not be sent
 * again at all — a wrong number, a client who replied STOP. Three named
 * outcomes beat one reflex.
 *
 * **Retry** re-sends through the same path with the failed row's own id,
 * so the bubble is replaced in place rather than a second one stacking
 * beneath it. **Copy text** is the escape hatch when the send is wrong but
 * the words were right. **Discard** removes it locally, which is the whole
 * truth: a failed message never reached the server, so there is nothing
 * there to delete.
 *
 * Destructive styling on Discard only — red is punctuation here, and this
 * is the one irreversible choice on the sheet.
 */
export function RetrySheet({
  visible,
  canCopy,
  onRetry,
  onCopy,
  onDiscard,
  onClose,
}: {
  visible: boolean;
  /** False for an image-only message — there is nothing to put on the clipboard. */
  canCopy: boolean;
  onRetry: () => void;
  onCopy: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Eyebrow style={styles.eyebrow}>Not delivered</Eyebrow>
          <Text style={styles.lead}>
            This message never reached the server, so nothing was sent to the client.
          </Text>

          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Feather name="refresh-cw" size={16} color={colors.fgSecondary} />
            <Text style={styles.actionLabel}>Retry</Text>
          </Pressable>

          {canCopy ? (
            <Pressable
              onPress={onCopy}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Feather name="copy" size={16} color={colors.fgSecondary} />
              <Text style={styles.actionLabel}>Copy text</Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={onDiscard}
            accessibilityRole="button"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Feather name="trash-2" size={16} color={chat.alertText} />
            <Text style={[styles.actionLabel, styles.discard]}>Discard</Text>
          </Pressable>

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
  eyebrow: { marginBottom: space.sm },
  lead: { ...type.small, color: colors.fgSecondary, marginBottom: space.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  actionLabel: { ...type.body, color: colors.fg },
  discard: { color: chat.alertText },
  done: { alignItems: 'center', marginTop: space.lg },
  doneLabel: { ...type.button, color: colors.fgMuted },
  pressed: { opacity: 0.6 },
});
