import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { Eyebrow } from '@/components/ui';
import { MessageIcon } from '@/components/icons';
import Feather from '@expo/vector-icons/Feather';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The client ROW's `⋯` menu.
 *
 * Distinct from `ClientMoreSheet`, which is the client DETAIL header's
 * overflow and holds Archive + a dimmed Delete. This one is the list's,
 * and it holds the actions that make sense without leaving the list.
 *
 * ─── SHARE IS ABSENT, AND THAT WAS THE INVESTIGATION'S ANSWER ───────
 *
 * The brief asked for Share, with a fallback chain ending "else omit
 * Share and report". Both earlier branches came back empty:
 *
 *   web's client share?   THERE ISN'T ONE. `ClientDetail.tsx`'s own `⋯`
 *                         menu holds exactly Archive/Unarchive and
 *                         Delete. The Clients TABLE has no per-row menu
 *                         at all. Nothing in apps/web produces a link
 *                         TO a client, and `navigator.share` is used
 *                         nowhere in the repo.
 *   a client public link? NOT A CLIENT-SCOPED ONE. Every public token in
 *                         `schema.prisma` hangs off an Inquiry, a
 *                         DepositForm, a LiabilityWaiver, a GiftCard or
 *                         a PrefillDraft. The Client model's only token
 *                         is `smsConsentToken` — single-use, expires,
 *                         and grants nothing but ticking a consent box.
 *                         The intake URL that `GET /clients/:id/
 *                         shareable-links` returns is
 *                         `/inquiry/{studio.slug}` — the STUDIO's form,
 *                         byte-identical for every client in the studio.
 *
 * Sharing that studio URL from a row headed by one person's name would
 * imply it is that person's link. It isn't. So Share is omitted rather
 * than faked, and the report carries what a real one would need.
 */
export function ClientRowActionsSheet({
  visible,
  name,
  archived,
  hasThread,
  busy,
  onClose,
  onMessage,
  onToggleArchive,
}: {
  visible: boolean;
  name: string;
  archived: boolean;
  /** Message navigates to an EXISTING thread; there is no create route on mobile. */
  hasThread: boolean;
  busy?: boolean;
  onClose: () => void;
  onMessage: () => void;
  onToggleArchive: () => void;
}) {
  /*
   * The confirm is a SECOND STATE OF THIS SHEET, not an `Alert.alert`.
   *
   * Two reasons, and the second is why it is worth the extra state.
   * First, an alert over a sheet is two stacked modals on iOS. Second,
   * `react-native-web` stubs `Alert.alert` to a no-op, so a confirm built
   * that way is invisible to the preview harness this app is verified
   * with — it could only ever be claimed, never shown. This one renders.
   */
  const [confirming, setConfirming] = useState(false);

  // A sheet that reopens must never reopen mid-confirm.
  useEffect(() => {
    if (!visible) setConfirming(false);
  }, [visible]);

  const archiveLabel = archived ? 'Unarchive' : 'Archive';

  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel={`Close actions for ${name}`}>
      <Eyebrow style={styles.eyebrow}>{name}</Eyebrow>

      {confirming ? (
        <>
          <Text style={styles.confirmTitle}>
            {archived ? `Put ${name} back in the list?` : `Archive ${name}?`}
          </Text>
          <Text style={styles.note}>
            {archived
              ? 'They return to the default client list.'
              : 'They come off the default list. Nothing is deleted, and Unarchive puts them back.'}
          </Text>

          <Pressable
            onPress={busy ? undefined : onToggleArchive}
            accessibilityRole="button"
            accessibilityLabel={`Confirm ${archiveLabel.toLowerCase()} ${name}`}
            accessibilityState={{ busy: !!busy }}
            style={({ pressed }) => [styles.action, styles.confirmAction, pressed && styles.pressed]}
          >
            {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            <Text style={[styles.actionLabel, styles.confirmLabel]}>Yes, {archiveLabel.toLowerCase()}</Text>
          </Pressable>

          <Pressable
            onPress={() => setConfirming(false)}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={styles.actionLabel}>Cancel</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable
            onPress={hasThread ? onMessage : undefined}
            accessibilityRole="button"
            accessibilityLabel={hasThread ? `Message ${name}` : `${name} has no chat thread yet`}
            accessibilityState={{ disabled: !hasThread }}
            style={({ pressed }) => [styles.action, !hasThread && styles.actionOff, pressed && styles.pressed]}
          >
            <MessageIcon size={18} color={hasThread ? colors.fgSecondary : colors.fgMuted} />
            <Text style={[styles.actionLabel, !hasThread && styles.actionLabelMuted]}>Message</Text>
          </Pressable>
          {hasThread ? null : (
            <Text style={styles.note}>
              {name} has no chat thread yet. Starting one is done in the portal.
            </Text>
          )}

          <View style={styles.rule} />

          <Pressable
            onPress={() => setConfirming(true)}
            accessibilityRole="button"
            accessibilityLabel={`${archiveLabel} ${name}`}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Feather name="archive" size={18} color={colors.fgSecondary} />
            <Text style={styles.actionLabel}>{archiveLabel}</Text>
          </Pressable>
        </>
      )}

      <Pressable onPress={onClose} style={styles.done} accessibilityRole="button">
        <Text style={styles.doneLabel}>DONE</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  eyebrow: { marginBottom: space.sm },

  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  actionOff: { opacity: 0.5 },
  actionLabel: { ...type.body, color: colors.fg },
  actionLabelMuted: { color: colors.fgMuted },
  note: { ...type.meta, color: colors.fgMuted, marginTop: -space.xs, marginBottom: space.sm },

  rule: { height: hairline, backgroundColor: colors.borderSoft, marginVertical: space.xs },

  confirmTitle: { ...type.body, color: colors.fg, marginBottom: space.xs },
  /* Gold, not red: archiving is reversible, so it is a confirmation, not
     a destruction. Red here would overstate what the button does — see
     CLAUDE.md's punctuation rule. */
  confirmAction: {
    borderWidth: hairline,
    borderColor: colors.accent,
    borderRadius: radius.pill,
    justifyContent: 'center',
    marginTop: space.xs,
  },
  confirmLabel: { color: colors.accent },

  done: { marginTop: space.md, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.accent },
  pressed: { opacity: 0.6 },
});
