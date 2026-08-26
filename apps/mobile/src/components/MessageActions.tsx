import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Eyebrow } from '@/components/ui';
import { REACTION_EMOJIS, type ReactionEmoji } from '@/lib/conversations';
import { stamp } from '@/lib/format';
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
  failure,
  /** The viewer's current reaction on this message, if any. */
  myReaction,
  canEdit,
  /** False for a message with no text — there is nothing to put on the clipboard. */
  canCopy,
  copied,
  detail,
  images,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onSaveImage,
}: {
  visible: boolean;
  onClose: () => void;
  /**
   * §2.4 rev E. `kind` is the whole point: it decides which items exist,
   * and it is derived from `deliveryStatus`, not guessed from `status`.
   */
  failure?: {
    kind: 'local' | 'provider';
    /** One sentence, in the viewer's language, about what happened. */
    explanation: string;
    onRetry?: () => void;
    onDiscard?: () => void;
  } | null;
  myReaction?: string | null;
  canEdit: boolean;
  canCopy: boolean;
  copied: boolean;
  /**
   * ITEM 2/5 — the facts that used to sit under every bubble.
   *
   * Channel, exact time and "Edited" were true on every row and read on
   * almost none, so they left the thread and live here, one long-press
   * away. This is where they belong: it is the "tell me about THIS
   * message" surface.
   */
  detail?: { channel: string; sentAt: string; edited: boolean } | null;
  /** Image attachments on this message, if any — enables Save. */
  images?: string[];
  onReact: (emoji: ReactionEmoji) => void;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onSaveImage?: (url: string) => void;
}) {
  const savable = images ?? [];
  if (!visible) return null;

  return (
    <View style={styles.sheet}>
      {/*
        §2.4 rev E: what a FAILED message offers depends on WHY it failed,
        and the two cases are not interchangeable.

        A LOCAL failure never reached the API, so the body is still in
        hand and Retry means something. A PROVIDER failure was accepted by
        the API and then rejected by the carrier -- retrying would send a
        second message, and there is no local copy to discard because the
        server has the real one. Offering Retry there is offering a button
        that does the wrong thing.
      */}
      {failure ? (
        <View style={styles.failure}>
          <Text style={styles.failureText}>{failure.explanation}</Text>
        </View>
      ) : null}

      {failure?.kind === 'local' ? (
        <Pressable
          onPress={failure.onRetry}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Feather name="rotate-cw" size={16} color={colors.accent} />
          <Text style={[styles.actionLabel, styles.actionLabelAccent]}>Retry</Text>
        </Pressable>
      ) : null}

      {failure ? <View style={styles.divider} /> : null}

      {/* Reactions stay a plain row here for now; §7 rev D moves them
          into a tapback above the lifted bubble, which is 5B's job. */}
      {failure ? null : (
        <>
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
        </>
      )}

      {failure ? null : (
          <Pressable
            onPress={onReply}
            accessibilityRole="button"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Feather name="corner-up-left" size={16} color={colors.fgSecondary} />
            <Text style={styles.actionLabel}>Reply</Text>
          </Pressable>
      )}

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

          {savable.length > 0 && onSaveImage ? (
            <Pressable
              // One image saves it; several save the first, because the
              // sheet belongs to the MESSAGE and picking among them is the
              // viewer's job — it has its own save on the picture you are
              // actually looking at.
              onPress={() => onSaveImage(savable[0])}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Feather name="download" size={16} color={colors.fgSecondary} />
              <Text style={styles.actionLabel}>
                {savable.length > 1 ? 'Save first image' : 'Save image'}
              </Text>
            </Pressable>
          ) : null}

          {detail ? (
            <>
              <View style={styles.divider} />
              <View style={styles.detail}>
                <Text style={styles.detailText}>
                  {detail.channel} · {stamp(detail.sentAt)}
                  {detail.edited ? ' · Edited' : ''}
                </Text>
              </View>
            </>
          ) : null}

      {/* §2.4 rev E: a LOCAL failure can be thrown away -- nothing on the
          server knows about it. A provider failure cannot: the message
          exists, and hiding it would be pretending it never went. */}
      {failure?.kind === 'local' && failure.onDiscard ? (
        <Pressable
          onPress={failure.onDiscard}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Feather name="trash-2" size={16} color={colors.danger} />
          <Text style={[styles.actionLabel, styles.actionLabelDanger]}>Discard</Text>
        </Pressable>
      ) : null}

      <Pressable onPress={onClose} style={styles.done}>
        <Text style={styles.doneLabel}>CANCEL</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  /* §7: raised espresso, radius 16, cream text. It is a panel the
     overlay places, not a modal of its own -- the scrim, the lifted clone
     and the dismissal all belong to MessageOverlay now. */
  sheet: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.lg,
  },

  failure: { paddingBottom: space.sm },
  failureText: { ...type.small, color: colors.fgSecondary },
  eyebrow: { marginBottom: space.sm },

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

  detail: { paddingTop: space.sm, paddingHorizontal: space.xs },
  detailText: { ...type.meta, color: colors.fgMuted },
  divider: { height: hairline, backgroundColor: colors.border, marginTop: space.md, marginBottom: space.xs },

  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  actionLabel: { ...type.body, color: colors.fg },
  actionLabelDone: { color: colors.accent },
  actionLabelAccent: { color: colors.accent },
  actionLabelDanger: { color: colors.danger },

  done: { marginTop: space.md, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.accent },
  pressed: { opacity: 0.6 },
});
