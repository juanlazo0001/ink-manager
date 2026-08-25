import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text } from 'react-native';

import { Eyebrow } from '@/components/ui';
import { colors, hairline, radius, space, tones, type } from '@/theme';

/**
 * The client header's overflow menu — web's own `⋯`, which holds exactly
 * two things.
 *
 * ARCHIVE IS LIVE. The API's own comment calls it "soft, reversible hide
 * — same exclude-from-list-views treatment as a merge, but nothing is
 * repointed/destroyed and it can be undone", and there is a matching
 * `unarchive` route. That is ordinary CRUD, so it acts.
 *
 * DELETE IS NOT, deliberately. `DELETE /clients/:id` is
 * `requireRole(OWNER)`, permanently destroys the record, and web guards
 * it with a typed confirmation over a server-rendered preview of what
 * would go with it. None of that is in the set this session was cleared
 * for (contact CRUD, edit, archive, merge), and half-building a
 * destructive confirm is worse than not offering it. It renders, dimmed,
 * saying where it lives — the pattern every not-yet-built action on this
 * app uses.
 */
export function ClientMoreSheet({
  visible,
  archived,
  busy,
  onClose,
  onToggleArchive,
}: {
  visible: boolean;
  archived: boolean;
  busy?: boolean;
  onClose: () => void;
  onToggleArchive: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Eyebrow style={styles.eyebrow}>More</Eyebrow>

          <Pressable
            onPress={busy ? undefined : onToggleArchive}
            accessibilityRole="button"
            accessibilityLabel={archived ? 'Unarchive client' : 'Archive client'}
            accessibilityState={{ busy: !!busy }}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            {busy ? <ActivityIndicator size="small" color={colors.fgSecondary} /> : null}
            <Text style={styles.actionLabel}>{archived ? 'Unarchive client' : 'Archive client'}</Text>
          </Pressable>
          <Text style={styles.note}>
            {archived
              ? 'Puts them back in the client list.'
              : 'Hides them from the client list. Nothing is deleted, and you can undo it here.'}
          </Text>

          <Pressable
            onPress={() =>
              Alert.alert(
                'Delete client',
                'Deleting a client permanently destroys the record and everything attached to it. ' +
                  'That one is owner-only and lives in the portal.',
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Delete client"
            style={({ pressed }) => [styles.action, styles.actionOff, pressed && styles.pressed]}
          >
            <Text style={[styles.actionLabel, styles.actionLabelOff]}>Delete client</Text>
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
  eyebrow: { marginBottom: space.sm },

  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  actionOff: { opacity: 0.5 },
  actionLabel: { ...type.body, color: colors.fg },
  actionLabelOff: { color: tones.danger },
  note: { ...type.meta, color: colors.fgMuted, marginTop: -space.xs, marginBottom: space.sm },

  done: { marginTop: space.md, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.accent },
  pressed: { opacity: 0.6 },
});
