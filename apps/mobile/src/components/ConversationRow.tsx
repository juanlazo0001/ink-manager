import type { ConversationListItem } from '@ink-manager/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { channelColor, colors, hairline, radius, space, type } from '@/theme';
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

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
      <View style={[styles.avatar, unread && styles.avatarUnread]}>
        <Text style={[styles.avatarLabel, unread && styles.avatarLabelUnread]}>{initials(name)}</Text>
      </View>

      <View style={styles.middle}>
        <View style={styles.topLine}>
          <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.stamp}>{relativeStamp(item.lastMessageAt)}</Text>
        </View>

        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={2}>
          {/* An inbound message is what the client said; marking it makes
              a two-line preview readable without opening the thread. */}
          {item.lastMessage?.direction === 'OUTBOUND' ? 'You: ' : ''}
          {previewText}
        </Text>

        <View style={styles.metaLine}>
          {item.lastMessage ? (
            <View style={styles.channel}>
              <View style={[styles.channelDot, { backgroundColor: channelColor(item.lastMessage.channel) }]} />
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

  avatar: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  avatarUnread: { borderColor: colors.accent },
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
  channelDot: { width: 6, height: 6, borderRadius: radius.pill },
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
