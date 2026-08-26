import { Pressable, StyleSheet, Text, View, ActivityIndicator } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { Eyebrow } from '@/components/ui';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The archive / unarchive confirm for a client row.
 *
 * ─── WHAT THIS WAS, AND WHY IT SHRANK ───────────────────────────────
 *
 * Session AI shipped this as `ClientRowActionsSheet`: a `⋯` menu holding
 * Message, Archive, and a confirm state. Session AJ is an owner decision
 * that SWIPE replaces that menu, so Message and the Archive entry point
 * both moved onto `ClientSwipe`'s panels and the menu branch here became
 * unreachable. Rather than leave dead code behind a prop, the file keeps
 * the one part that is still wanted — the confirm — and drops the rest.
 *
 * The confirm survives on its own merits, and AI's reason for building it
 * as a SHEET STATE rather than an `Alert.alert` still holds: an alert over
 * a row is a second modal, and `react-native-web` stubs `Alert.alert` to a
 * no-op, so a confirm built that way is invisible to the preview harness
 * this app is verified with. It could be claimed, never shown. This one
 * renders.
 */
export function ArchiveConfirmSheet({
  visible,
  name,
  archived,
  busy,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  name: string;
  archived: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const verb = archived ? 'Unarchive' : 'Archive';

  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel={`Close ${verb.toLowerCase()} confirmation`}>
      <Eyebrow style={styles.eyebrow}>{name}</Eyebrow>

      <Text style={styles.title}>{archived ? `Put ${name} back in the list?` : `Archive ${name}?`}</Text>
      <Text style={styles.note}>
        {archived
          ? 'They return to the default client list.'
          : 'They come off the default list. Nothing is deleted, and Unarchive puts them back.'}
      </Text>

      <Pressable
        onPress={busy ? undefined : onConfirm}
        accessibilityRole="button"
        accessibilityLabel={`Confirm ${verb.toLowerCase()} ${name}`}
        accessibilityState={{ busy: !!busy }}
        style={({ pressed }) => [styles.action, styles.confirm, pressed && styles.pressed]}
      >
        {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        <Text style={[styles.actionLabel, styles.confirmLabel]}>Yes, {verb.toLowerCase()}</Text>
      </Pressable>

      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Text style={styles.actionLabel}>Cancel</Text>
      </Pressable>
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

  /* Gold, not red: archiving is reversible, so this is a confirmation and
     not a destruction. The RED lives on the swipe panel, owner-directed;
     repeating it here would double down on overstating the action. */
  confirm: {
    borderWidth: hairline,
    borderColor: colors.accent,
    borderRadius: radius.pill,
    marginTop: space.xs,
  },
  confirmLabel: { color: colors.accent },
  pressed: { opacity: 0.6 },
});
