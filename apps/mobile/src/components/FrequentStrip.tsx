import { ConversationType, type ConversationListItem } from '@ink-manager/shared-types';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { ChannelAvatarBadge } from '@/components/ChannelSwatch';
import { Eyebrow } from '@/components/editorial';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The frequent strip: the five most recently active CLIENT threads, as a
 * horizontal row of faces above the list.
 *
 * A mobile-first addition — web has no counterpart, and the owner approved
 * it as a deviation. Styled in Editorial Gold rather than the mockup's own
 * look: the app's eyebrow above it, the app's avatar treatment, the app's
 * channel swatch.
 *
 * CLIENT threads only, deliberately. Staff threads are colleagues an
 * artist reaches constantly and already knows by name — putting them here
 * would fill the strip with the same four faces every day and bury the
 * clients, who are the ones this is for.
 *
 * "Most recently active" is `lastMessageAt` descending, which is the order
 * `GET /conversations` already returns — so this takes the first five
 * rather than re-sorting, and a thread with no messages yet (null
 * `lastMessageAt`) never displaces one that has them.
 */
export const FREQUENT_COUNT = 5;

export function frequentThreads(items: ConversationListItem[]): ConversationListItem[] {
  return items
    .filter((item) => item.type === ConversationType.CLIENT && item.lastMessageAt !== null)
    .slice(0, FREQUENT_COUNT);
}

/** First name only — the strip is 64pt wide per face and a surname will not fit. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function FrequentStrip({
  items,
  onOpen,
}: {
  items: ConversationListItem[];
  onOpen: (id: string) => void;
}) {
  const frequent = frequentThreads(items);
  // Nothing to show is not an empty state worth drawing — the list below
  // already says the inbox is quiet.
  if (frequent.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Eyebrow style={styles.eyebrow}>Frequent</Eyebrow>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.strip}
        contentContainerStyle={styles.stripContent}
      >
        {frequent.map((item) => {
          const name = item.counterpart?.name ?? 'Unknown';
          const unread = item.unreadCount > 0;
          return (
            <Pressable
              key={item.id}
              onPress={() => onOpen(item.id)}
              accessibilityRole="button"
              accessibilityLabel={unread ? `${name}, ${item.unreadCount} unread` : name}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              {/* The badge sits proud of the avatar, so it cannot live
                  inside a clipping parent. Avatar clips; badge is a
                  sibling in an unclipped wrapper. */}
              <View style={styles.avatarWrap}>
                <Avatar
                  url={item.counterpart?.avatarUrl}
                  initials={initialsOf(name)}
                  size={52}
                  ring={unread ? colors.accent : undefined}
                  labelStyle={styles.initials}
                />
                {item.lastMessage ? <ChannelAvatarBadge channel={item.lastMessage.channel} /> : null}
              </View>
              <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
                {firstName(name)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}


const styles = StyleSheet.create({
  wrap: {
    paddingTop: space.md,
    paddingBottom: space.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  eyebrow: { paddingHorizontal: space.lg, paddingBottom: space.md },
  strip: { flexGrow: 0 },
  stripContent: { flexDirection: 'row', gap: space.lg, paddingHorizontal: space.lg },

  item: { width: 64, alignItems: 'center', gap: space.sm },
  avatarWrap: { width: 52, height: 52 },
  initials: { ...type.label, fontSize: 15, color: colors.fgMuted },

  name: { ...type.meta, color: colors.fgSecondary, textAlign: 'center' },
  nameUnread: { color: colors.fg },
  pressed: { opacity: 0.6 },
});
