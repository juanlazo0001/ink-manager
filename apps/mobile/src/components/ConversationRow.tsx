import type { ConversationListItem } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { ChannelBadge } from '@/components/ChannelBadge';
import { LIST_AVATAR, LIST_INSET } from '@/theme/listMetrics';
import { chat, colors, fonts, space } from '@/theme';
import { relativeStamp } from '@/lib/time';

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
        §8: the unread dot leads the row IN FLEX FLOW, not pinned to the
        edge. Pinned, it floats in the margin and every row's text starts
        in the same place whether or not anything is unread -- so the dot
        has to be looked FOR. In flow it displaces the row, which is what
        makes a screen of threads scannable at arm's length.

        Its space is reserved either way, so reading a thread does not
        make the column jog sideways.

        Red -- and this reverses an earlier note here that argued for gold
        because "an unread count is data". §8 asks for red and §8 is
        right: at 8pt this is punctuation, not a fill, which is precisely
        what CLAUDE.md reserves red for.
      */}
      <View style={styles.dotSlot}>{unread ? <View style={styles.unreadDot} /> : null}</View>

      {/* The counterpart's own photo, for every thread type -- which is
          what web does: ProgressRingAvatar takes counterpart.avatarUrl on
          CLIENT, STAFF and GROUP alike and falls back to initials. Mobile
          had only ever drawn initials. */}
      <View style={styles.avatarWrap}>
        <Avatar
          url={item.counterpart?.avatarUrl}
          initials={initialsOf(name)}
          // §8: 44. The separator's 76pt inset is 20 + 44 + 12 -- the rule
          // starts where the text starts -- so this number and
          // LIST_SEPARATOR_INSET move together; see theme/listMetrics.ts.
          size={LIST_AVATAR}
          ring={unread ? colors.accent : undefined}
          labelStyle={styles.avatarLabel}
        />
        {/* §1.1: the channel as letters ON the avatar, replacing a third
            line of row furniture. */}
        {item.lastMessage ? <ChannelBadge channel={item.lastMessage.channel} /> : null}
      </View>

      <View style={styles.middle}>
        <View style={styles.topLine}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
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

  /* Reserved whether or not the dot is drawn -- see the render. */
  dotSlot: { width: UNREAD_DOT, alignItems: 'center', justifyContent: 'center' },
  unreadDot: {
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
