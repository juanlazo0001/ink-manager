import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { Eyebrow } from '@/components/ui';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The confirm for deleting a personal task.
 *
 * A SHEET, NOT `Alert.alert`, and the reason is `ArchiveConfirmSheet`'s
 * own: react-native-web stubs `Alert.alert` to a no-op, so a confirm
 * built that way cannot be seen in the harness this app is verified
 * with. It could be claimed and never shown.
 *
 * ─── THIS ONE IS RED, AND ARCHIVE IS NOT ────────────────────────────
 *
 * `ArchiveConfirmSheet` is deliberately gold, on the grounds that
 * archiving is reversible and gold is therefore honest about it. Deleting
 * a task is not reversible — the route calls `prisma.personalTask.delete`
 * and there is no undo anywhere in this app — so this one is red. That is
 * the palette rule working as written rather than an inconsistency
 * between two sheets: red is punctuation for the destructive case, and
 * this is the destructive case.
 */
export function DeleteTaskConfirmSheet({
  visible,
  title,
  delegated,
  busy,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  /**
   * True when the task is on someone else's list and the caller is only
   * its creator. Worth saying out loud — deleting it takes the task away
   * from a person who may be counting on it.
   */
  delegated: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel="Close delete confirmation">
      <Eyebrow style={styles.eyebrow}>Task</Eyebrow>

      <Text style={styles.title} numberOfLines={3}>
        Delete “{title}”?
      </Text>
      <Text style={styles.note}>
        {delegated
          ? 'This removes it from their list as well as yours. It cannot be undone.'
          : 'This cannot be undone. Completing a task keeps it; deleting removes it for good.'}
      </Text>

      <Pressable
        onPress={busy ? undefined : onConfirm}
        accessibilityRole="button"
        accessibilityLabel={`Confirm delete ${title}`}
        accessibilityState={{ busy: !!busy }}
        style={({ pressed }) => [styles.action, styles.confirm, pressed && styles.pressed]}
      >
        {busy ? <ActivityIndicator size="small" color={colors.danger} /> : null}
        <Text style={[styles.actionLabel, styles.confirmLabel]}>Yes, delete</Text>
      </Pressable>

      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Text style={styles.actionLabel}>Cancel</Text>
      </Pressable>

      <View style={styles.tail} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  eyebrow: { marginBottom: space.sm },
  title: { ...type.body, color: colors.fg, marginBottom: space.xs },
  note: { ...type.meta, color: colors.fgMuted, marginBottom: space.sm },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  actionLabel: { ...type.body, color: colors.fg },

  /* An outline, not a fill. Red is punctuation here -- the standing rule
     is that it is never a large surface -- so the ring and the label
     carry it and the sheet stays the app's own ground. */
  confirm: {
    borderWidth: hairline,
    borderColor: colors.danger,
    borderRadius: radius.pill,
    marginTop: space.xs,
  },
  confirmLabel: { color: colors.danger },
  pressed: { opacity: 0.6 },
  tail: { height: space.xs },
});
