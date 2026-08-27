import type { ConversationListItem } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { THREAD_AVATAR_LIST, ThreadAvatar } from '@/components/ThreadAvatar';
import { LIST_AVATAR, LIST_INSET } from '@/theme/listMetrics';
import { chat, colors, fonts, space } from '@/theme';
import { relativeStamp } from '@/lib/time';
import { isMuted } from '@/lib/conversations';

const CHANNEL_LABELS: Record<string, string> = {
  IN_APP: 'In-app',
  SMS: 'SMS',
  EMAIL: 'Email',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  PHONE: 'Phone',
  OTHER: 'Other',
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

/**
 * Who spoke, for the list preview.
 *
 * This needs the message's AUTHOR, and for a long time `GET /conversations`
 * did not return one -- its `lastMessage` projection was body, channel,
 * direction and createdAt. `direction` is not a substitute:
 *
 *  1. It separates the STUDIO from the CLIENT, not the viewer from
 *     everyone else. On a client thread an OUTBOUND message may well have
 *     been written by a colleague -- the API's own summary helper spells
 *     it out: `direction === INBOUND ? "Client" : "Studio"`.
 *  2. On STAFF and GROUP threads it is a CONSTANT. The API rejects any
 *     other value outright ("Staff conversations only support OUTBOUND
 *     direction"), so a direction test marked every row on those threads
 *     as the viewer's own, whoever wrote it.
 *
 * `lastMessage.authorUserId` / `.author` now exist, so this answers the
 * question properly: your own message says "You", a colleague's says their
 * first name, and an inbound client message has no author at all and so
 * says nothing.
 *
 * apps/web still tests `direction === 'OUTBOUND' ? 'You: '` on this same
 * line and still has the original bug; the field it needs is now there.
 */
function previewPrefix(item: ConversationListItem, viewerUserId?: string): string {
  const last = item.lastMessage;
  if (!last) return '';
  if (last.authorUserId && viewerUserId && last.authorUserId === viewerUserId) return 'You: ';
  const name = last.author?.name ?? last.author?.email;
  if (name) return `${name.split(' ')[0]}: `;
  return '';
}


export function ConversationRow({
  item,
  onPress,
  viewerUserId,
}: {
  item: ConversationListItem;
  onPress: () => void;
  /** Needed to say "You" rather than naming the viewer to themselves. */
  viewerUserId?: string;
}) {
  const name = item.counterpart?.name ?? 'Unknown';
  const unread = item.unreadCount > 0;
  const muted = isMuted(item.viewerState);
  const preview = item.lastMessage?.body?.trim();
  // `lastMessage.attachments` now says so outright, instead of being
  // inferred from an empty body. That inference was wrong in both
  // directions: a message with a caption AND images showed no indicator,
  // and any genuinely empty-bodied message claimed one. Web still infers
  // (`{body || '📷 Image'}`); mobile no longer has to.
  const hasAttachment = (item.lastMessage?.attachments?.length ?? 0) > 0;
  const previewText = preview || (hasAttachment ? 'Image' : item.lastMessage ? 'Message' : 'No messages yet');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}${unread ? `, ${item.unreadCount} unread` : ''}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {/*
        §8 rev F: the unread dot is GUTTER-ANCHORED -- absolutely
        positioned, vertically centred, inside the 20pt inset, occupying
        no layout width at all.

        It was in flex flow, on the argument that displacing the row makes
        unread threads scannable. The gate measured what that actually
        cost: every row carried ~35pt of lead-in against the spec's 20,
        because a reserved 8pt slot plus its gap pushes EVERY avatar in --
        read and unread alike -- to pay for a dot most rows do not draw.
        The whole list was indented to make room for an exception.

        Out of flow, the avatar sits at exactly 20 and read and unread
        rows align identically; the dot lives in the space that inset was
        always going to leave anyway.

        Red -- and this reverses an earlier note here that argued for gold
        because "an unread count is data". §8 asks for red and §8 is
        right: at 8pt this is punctuation, not a fill, which is precisely
        what CLAUDE.md reserves red for.
      */}
      {unread ? <View style={styles.unreadDot} /> : null}

      {/* The counterpart's own photo, for every thread type -- which is
          what web does: ProgressRingAvatar takes counterpart.avatarUrl on
          CLIENT, STAFF and GROUP alike and falls back to initials. Mobile
          had only ever drawn initials. */}
      {/*
        §8 rev G: one component for the row and the thread header, so the
        two cannot drift. Group threads get the duo-stack; everything else
        gets the single avatar it always had. The composite's footprint is
        LIST_AVATAR either way, so a group row does not sit differently
        from a client row -- and the separator's 76pt inset
        (20 + 44 + 12) stays correct without knowing which it is.
      */}
      <View style={styles.avatarWrap}>
        <ThreadAvatar
          name={name}
          avatarUrl={item.counterpart?.avatarUrl}
          participants={item.counterpart?.participants}
          channel={item.lastMessage?.channel ?? null}
          scale={THREAD_AVATAR_LIST}
          ring={unread ? colors.accent : undefined}
        />
      </View>

      <View style={styles.middle}>
        <View style={styles.topLine}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {/* §8: a small gold pin by the timestamp. The PINNED section
              label says which GROUP a row is in; this says the row itself
              is pinned, which still reads once you have scrolled the
              label off the top. */}
          {item.viewerState.isPinned ? (
            <Feather name="bookmark" size={11} color={colors.accent} />
          ) : null}
          {/* §8: mute suppresses the interruption, not the indicator --
              so this is the ONLY thing that changes on a muted row. The
              unread dot and preview keep behaving exactly as before. */}
          {muted ? <Feather name="bell-off" size={11} color={colors.fgMuted} /> : null}
          <Text style={styles.stamp}>{relativeStamp(item.lastMessageAt)}</Text>
        </View>

        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={2}>
          {previewPrefix(item, viewerUserId)}
          {hasAttachment ? (
            <Feather name="image" size={12} color={unread ? colors.fg : colors.fgMuted} />
          ) : null}
          {hasAttachment ? ' ' : ''}
          {previewText}
        </Text>
      </View>
    </Pressable>
  );
}

/** §8: an 8pt dot -- punctuation, not a fill. */
const UNREAD_DOT = 8;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.md,
    // §8: 20, shared with the controls row above so the two read as one
    // column. See theme/listMetrics.ts.
    paddingHorizontal: LIST_INSET,
    paddingVertical: space.md,
    // Transparent, so the background photo reads behind the list the same
    // way it does behind every other screen. The pressed state still
    // paints a real surface, which is what makes a tap visible.
    backgroundColor: 'transparent',
  },
  pressed: { backgroundColor: colors.surface },

  /*
   * Centred in the gutter the 20pt inset already provides, and taking no
   * layout width -- see the render for why that is the whole point.
   * `top: '50%'` plus half the dot is the vertical centre without needing
   * to know the row's height, which varies with a one- or two-line
   * preview.
   */
  unreadDot: {
    position: 'absolute',
    left: (LIST_INSET - UNREAD_DOT) / 2,
    top: '50%',
    marginTop: -UNREAD_DOT / 2,
    width: UNREAD_DOT,
    height: UNREAD_DOT,
    borderRadius: UNREAD_DOT / 2,
    backgroundColor: chat.alert,
  },

  /*
   * `alignSelf: flex-start` is load-bearing, not tidiness. The row is a
   * flex row, so by default this wrapper STRETCHES to the row's full
   * height -- and the badge, anchored to the wrapper's bottom, then hung
   * 19pt below the avatar instead of 3 (measured: offsetBottom -19).
   * Hugging the avatar makes "bottom-right" mean the avatar's corner.
   */
  avatarWrap: { marginTop: 2, alignSelf: 'flex-start' },
  /* §1.2: the monogram is the one place Fraunces belongs at row scale --
     it is a mark, not a name. The name itself is Outfit, below. */
  avatarLabel: { fontFamily: fonts.displaySemiBold, fontSize: 16, lineHeight: 20, color: colors.fgMuted },

  middle: { flex: 1, gap: 3 },
  topLine: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  /*
   * §1.2: Outfit 16/600, cream. This was type.heading -- Fraunces 19 --
   * i.e. display type setting a person's name, which §1.2 forbids in
   * those words: at row scale it shouts.
   *
   * It does NOT change with unread. The row already says unread twice
   * (the dot, and the preview lifting); a third signal on the name is
   * emphasis competing with itself, and it left read threads looking
   * greyed-out rather than merely calm.
   */
  name: { fontFamily: fonts.bodySemiBold, fontSize: 16, lineHeight: 21, color: colors.fg, flex: 1 },
  /* §8: Jura 11, muted, right. */
  stamp: { fontFamily: fonts.labelSemiBold, fontSize: 11, letterSpacing: 0.4, color: colors.fgMuted },

  /* §8: Outfit 14, two-line clamp. */
  preview: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.fgMuted },
  previewUnread: { color: colors.fgSecondary },
});
