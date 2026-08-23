import type { ConversationListItem } from '@ink-manager/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { ChannelSwatch } from '@/components/ChannelSwatch';
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
 * Who spoke last, when that can honestly be said.
 *
 * This used to print "You: " for `direction === 'OUTBOUND'`, which is
 * wrong twice over:
 *
 *  1. `MessageDirection` separates the STUDIO from the CLIENT, not the
 *     viewer from everyone else. On a client thread an OUTBOUND message
 *     may well have been written by a colleague -- the API's own summary
 *     helper spells this out: `direction === INBOUND ? "Client" : "Studio"`.
 *  2. On STAFF and GROUP threads it is a constant. The API rejects any
 *     other value outright -- "Staff conversations only support OUTBOUND
 *     direction" (conversations.ts) -- so EVERY row on those threads said
 *     "You:", whoever wrote the message. That is the reported symptom.
 *
 * The honest prefix needs the message's author, and `GET /conversations`
 * does not return one: its `lastMessage` projection is body, channel,
 * direction and createdAt, nothing more. Rather than invent an API field,
 * this says only what the data supports -- "Studio: " where the studio
 * spoke on a client thread, and nothing at all on staff threads, where
 * direction carries no information.
 *
 * apps/web has the identical bug on the same line, still unfixed.
 */
function previewPrefix(item: ConversationListItem): string {
  if (!item.lastMessage) return '';
  // Constant on these, so it can distinguish nobody.
  if (item.type !== 'CLIENT') return '';
  return item.lastMessage.direction === 'OUTBOUND' ? 'Studio: ' : '';
}


export function ConversationRow({ item, onPress }: { item: ConversationListItem; onPress: () => void }) {
  const name = item.counterpart?.name ?? 'Unknown';
  const unread = item.unreadCount > 0;
  const preview = item.lastMessage?.body?.trim();
  // An attachment-only message has an empty body — saying "No messages
  // yet" there would be wrong, so the two cases are distinguished.
  const previewText = preview || (item.lastMessage ? 'Attachment' : 'No messages yet');

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
        size={42}
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
          {previewPrefix(item)}
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
    paddingHorizontal: space.lg,
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
