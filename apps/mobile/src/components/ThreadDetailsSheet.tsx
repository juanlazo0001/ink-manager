import Feather from '@expo/vector-icons/Feather';
import type { ConversationThreadHeader } from '@ink-manager/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { channelLabel } from '@/components/ConversationRow';
import { Sheet } from '@/components/Sheet';
import { THREAD_AVATAR_HEADER, ThreadAvatar } from '@/components/ThreadAvatar';
import { Eyebrow } from '@/components/ui';
import { colors, space, type } from '@/theme';

/**
 * The ⓘ details sheet (§9 rev H, v1).
 *
 * ─── WHY IT EXISTS ──────────────────────────────────────────────────
 *
 * Session 12 removed the context-chip row, and the chip's tap was the
 * only path from a thread to its linked inquiry. The ⓘ had never been
 * wired — `ThreadHeader` accepted `onInfo`, nothing passed it, so the
 * button rendered muted and `disabled`. Under the spec's no-inert rule
 * that had to end one way or the other; the ruling is that the chip's
 * content and its navigation MOVE here rather than die.
 *
 * ─── NO NEW REQUESTS ────────────────────────────────────────────────
 *
 * Everything below is already on `ConversationThreadHeader`, which the
 * screen holds before this sheet can be opened. Nothing here fetches.
 *
 * ─── ABOUT THE SECOND LINE ──────────────────────────────────────────
 *
 * The retired two-line header's sub-line was
 *
 *     {channelLabel(channel).toUpperCase()}{handle ? ` · ${handle}` : ''}
 *
 * and the `handle` half never rendered: `ThreadHeader` declared a
 * `handle` prop, and no commit in this repo's history ever passed one —
 * there is no handle/number field on the thread payload to pass. So the
 * line that actually shipped was the channel's full name, and that is
 * what is reproduced here. A phone number or @handle would need data the
 * screen does not have, which is a new request, which this session is
 * not allowed to make. Recorded rather than quietly approximated.
 *
 * The channel is a property of the THREAD, not of a person, so on a
 * group every row shows the same one — which is true: everybody in a
 * group thread is reached the same way. It matches the badge the shared
 * avatar already draws on each row.
 */
export function ThreadDetailsSheet({
  visible,
  onClose,
  onDismissed,
  header,
  channel,
  onPressInquiry,
  onPressClient,
}: {
  visible: boolean;
  onClose: () => void;
  /** Passed through to `Sheet` — see the navigation note below. */
  onDismissed?: () => void;
  header: ConversationThreadHeader;
  /** The thread's channel, resolved by the screen exactly as the header uses it. */
  channel: string;
  onPressInquiry: (inquiryId: string) => void;
  /**
   * Present only when there is somewhere to go: a CLIENT thread's
   * counterpart has a client record, a staff participant does not.
   */
  onPressClient?: (clientId: string) => void;
}) {
  const members = header.counterpart?.participants;
  /*
   * `participants` is present on GROUP threads ONLY (shared-types says
   * so, and says branching on its presence is equivalent to branching on
   * `type`). A CLIENT/STAFF thread is its single counterpart.
   */
  const people =
    members && members.length > 0
      ? members
      : header.counterpart
        ? [{ id: header.counterpart.id, name: header.counterpart.name, avatarUrl: header.counterpart.avatarUrl }]
        : [];

  /*
   * ─── WHICH ROWS NAVIGATE, AND WHY THE REST MUST NOT ───────────────
   *
   * A CLIENT thread's counterpart IS a client record, so its row goes to
   * `client/[id]`. The id is not inferred: `ConversationThreadHeader`
   * carries `clientId` directly, and the API builds the counterpart from
   * that same client (`routes/conversations.ts:163` returns
   * `conversation.client.id`), so the row and the destination cannot
   * disagree.
   *
   * STAFF PARTICIPANTS DO NOT NAVIGATE, and that is the no-inert rule
   * rather than an omission. There is no staff-profile route in this app:
   * `profile.tsx` takes no params (it is the viewer's own), there is no
   * `staff/[id]`, and the Team tab's own rows contain zero `router.push`
   * calls — nobody can open another staff member anywhere today. A
   * chevron promising a destination that does not exist is the violation;
   * a plain row is the truth.
   *
   * Group threads therefore render every member plainly, since group
   * members are staff by construction.
   */
  const clientId = header.type === 'CLIENT' ? header.clientId : null;
  const canOpenClient = !!clientId && !!onPressClient && !members?.length;

  const inquiry = header.primaryInquiry;
  /*
   * The removed chip's exact composition, character for character:
   * description first (what the thread is about), placement as the
   * qualifier, then the status with its underscores opened up.
   */
  const inquirySubject = inquiry
    ? [inquiry.description, inquiry.placement].filter(Boolean).join(' · ')
    : '';
  const inquiryLabel = inquiry
    ? [inquirySubject, inquiry.status.replace(/_/g, ' ')].filter(Boolean).join(' · ')
    : '';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onDismissed={onDismissed}
      accessibilityLabel="Close conversation details"
    >
      <Eyebrow style={styles.eyebrow}>Participants</Eyebrow>

      {people.length > 0 ? (
        people.map((person) => {
          const body = (
            <>
              <ThreadAvatar
                name={person.name}
                avatarUrl={person.avatarUrl}
                channel={channel}
                scale={THREAD_AVATAR_HEADER}
              />
              <View style={styles.personText}>
                <Text style={styles.personName} numberOfLines={1}>
                  {person.name}
                </Text>
                <Text style={styles.personMeta} numberOfLines={1}>
                  {channelLabel(channel).toUpperCase()}
                </Text>
              </View>
            </>
          );

          /* A plain View, not a disabled Pressable: a staff row should
             not report itself to assistive tech as a button that does
             nothing, and it must not flash on press either. */
          if (!canOpenClient || !clientId) {
            return (
              <View key={person.id} style={styles.person}>
                {body}
              </View>
            );
          }

          return (
            <Pressable
              key={person.id}
              onPress={() => onPressClient?.(clientId)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${person.name}'s client page`}
              style={({ pressed }) => [styles.person, pressed && styles.pressed]}
            >
              {body}
              <Feather name="chevron-right" size={18} color={colors.fgMuted} />
            </Pressable>
          );
        })
      ) : (
        <Text style={styles.personMeta}>No participants on this thread.</Text>
      )}

      {/* §9 rev H: absent entirely on a thread with no linked inquiry —
          not an empty section, which is the thing the chip row already
          got right by rendering nothing rather than an empty strip. */}
      {inquiry ? (
        <>
          <Eyebrow style={styles.eyebrowLater}>Linked inquiry</Eyebrow>

          <Pressable
            onPress={() => onPressInquiry(inquiry.id)}
            accessibilityRole="button"
            accessibilityLabel={`Open linked inquiry: ${inquiryLabel}`}
            style={({ pressed }) => [styles.inquiry, pressed && styles.pressed]}
          >
            <Text style={styles.inquiryLabel}>{inquiryLabel}</Text>
            <Feather name="chevron-right" size={18} color={colors.fgMuted} />
          </Pressable>
        </>
      ) : null}

      <Pressable onPress={onClose} style={styles.done}>
        <Text style={styles.doneLabel}>DONE</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  eyebrow: { marginBottom: space.sm },
  eyebrowLater: { marginTop: space.md, marginBottom: space.sm },

  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  personText: { flex: 1, minWidth: 0, gap: 1 },
  personName: { ...type.body, color: colors.fg },
  personMeta: { ...type.meta, color: colors.fgMuted },

  inquiry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  inquiryLabel: { ...type.body, color: colors.fg, flex: 1, minWidth: 0 },

  done: { marginTop: space.md, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.accent },
  pressed: { opacity: 0.6 },
});
