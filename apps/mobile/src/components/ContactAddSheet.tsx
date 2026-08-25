import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Eyebrow } from '@/components/ui';
import { MailPlusIcon, PhonePlusIcon } from '@/components/icons';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * "Add contact info" — the sheet behind the Contact Info card's `+`.
 *
 * THE SHEET IS NOT NEW. It is the same bottom sheet this app already uses
 * for message actions, the channel picker and attach: a transparent
 * `Modal` that slides up, a dimmed backdrop that closes on tap, a
 * `surfaceRaised` panel with rounded top corners, an accent eyebrow, then
 * icon-and-label rows and a DONE. Matching it was the point — a second
 * modal style would be a second product.
 *
 * THE GLYPHS MOVED HERE. Session T2 drew the handset-plus and
 * envelope-plus for the per-group add buttons; folding those buttons into
 * one header action would have orphaned them, so they became this sheet's
 * row icons. They are still the only thing distinguishing the two
 * choices, and they still do that job — just one level in.
 *
 * OPENING IS FREE; WRITING IS GATED. Both rows are live enough to be
 * discovered — the sheet opens, the choices read clearly — and each says
 * in the app's own voice where the write lives, until M2 lands. That is
 * the owner's call: a control that cannot be opened teaches nothing about
 * what the app will do.
 */
export function ContactAddSheet({
  visible,
  onClose,
  onAddPhone,
  onAddEmail,
}: {
  visible: boolean;
  onClose: () => void;
  onAddPhone: () => void;
  onAddEmail: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Eyebrow style={styles.eyebrow}>Add contact info</Eyebrow>

          <Pressable
            onPress={onAddPhone}
            accessibilityRole="button"
            accessibilityLabel="Add phone"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <PhonePlusIcon size={16} color={colors.fgSecondary} />
            <Text style={styles.actionLabel}>Add phone</Text>
          </Pressable>

          <Pressable
            onPress={onAddEmail}
            accessibilityRole="button"
            accessibilityLabel="Add email"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <MailPlusIcon size={16} color={colors.fgSecondary} />
            <Text style={styles.actionLabel}>Add email</Text>
          </Pressable>

          <Pressable onPress={onClose} style={styles.done}>
            <Text style={styles.doneLabel}>DONE</Text>
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

  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  actionLabel: { ...type.body, color: colors.fg },

  done: { marginTop: space.md, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.accent },
  pressed: { opacity: 0.6 },
});
