import type { ConversationListItem } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { ChannelSwatch } from '@/components/ChannelSwatch';
import { LIST_AVATAR, LIST_INSET } from '@/theme/listMetrics';
import { colors, hairline, radius, space, type } from '@/theme';
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
      {/* The counterpart's own photo, for every thread type -- which is
          what web does: ProgressRingAvatar takes counterpart.avatarUrl on
          CLIENT, STAFF and GROUP alike and falls back to initials. Mobile
          had only ever drawn initials. */}
      <Avatar
        url={item.counterpart?.avatarUrl}
        initials={initialsOf(name)}
        // §8: 44. The separator's 76pt inset is 20 + 44 + 12 -- the rule
        // starts where the text starts -- so this number and
        // LIST_SEPARATOR_INSET move together; see theme/listMetrics.ts.
        size={LIST_AVATAR}
        ring={unread ? colors.accent : undefined}
        style={styles.avatar}
        labelStyle={[styles.avatarLabel, unread && styles.avatarLabelUnread]}
      />

      <View style={styles.middle}>
        <View style={styles.topLine}>
          <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
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

        <View style={styles.metaLine}>
          {item.lastMessage ? (
            <View style={styles.channel}>
              <ChannelSwatch channel={item.lastMessage.channel} />
              <Text style={styles.channelLabel}>{channelLabel(item.lastMessage.channel).toUpperCase()}</Text>
            </View>
          ) : (
            <View />
          )}

          {unread ? (
            // Gold, not red. An unread count is data, and red in this
            // palette is reserved for something actually wrong.
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadCount}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

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

  avatar: { marginTop: 2 },
  avatarLabel: { ...type.label, fontSize: 13, color: colors.fgMuted },
  avatarLabelUnread: { color: colors.accent },

  middle: { flex: 1, gap: space.xs },
  topLine: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  name: { ...type.heading, color: colors.fgSecondary, flex: 1 },
  nameUnread: { color: colors.fg },
  stamp: { ...type.meta, color: colors.fgMuted },

  preview: { ...type.small, color: colors.fgMuted },
  previewUnread: { color: colors.fgSecondary },

  metaLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  channel: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  channelLabel: { ...type.label, color: colors.fgMuted },

  unreadBadge: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  unreadCount: { ...type.label, fontSize: 11, color: colors.accentFg },
});
