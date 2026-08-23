import type { ConversationListItem } from '@ink-manager/shared-types';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { ChannelAvatarBadge } from '@/components/ChannelSwatch';
import { Eyebrow } from '@/components/editorial';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The frequent strip: the five most recently active threads, as a
 * horizontal row of faces above the list.
 *
 * A mobile-first addition — web has no counterpart, and the owner approved
 * it as a deviation. Styled in Editorial Gold rather than the mockup's own
 * look: the app's eyebrow above it, the app's avatar treatment, the app's
 * channel swatch.
 *
 * ANY thread type, per the owner's amended spec. Session H shipped this
 * client-only on the reasoning that staff faces would crowd out clients;
 * the owner's decision is that the strip should simply follow recent
 * activity, whoever it is with, so the type filter is gone.
 *
 * "Most recently active" is `lastMessageAt` descending, which is the order
 * `GET /conversations` already returns — so this takes the first five
 * rather than re-sorting, and a thread with no messages yet (null
 * `lastMessageAt`) never displaces one that has them.
 */
export const FREQUENT_COUNT = 5;

/**
 * Below this the strip hides entirely: a two-face "frequent" row is noise
 * next to a list that already shows those same two threads.
 */
export const FREQUENT_MIN = 3;

export function frequentThreads(items: ConversationListItem[]): ConversationListItem[] {
  return items.filter((item) => item.lastMessageAt !== null).slice(0, FREQUENT_COUNT);
}

/**
 * A name that fits under a 64pt face.
 *
 * GROUP threads name every other participant, comma-separated ("Ana Ruiz,
 * Bo Lang"), so the comma is cut before the first word is taken —
 * otherwise the label reads "Ana,".
 */
export function firstName(name: string): string {
  const head = name.split(',')[0].trim();
  return head.split(/\s+/)[0] || name;
}

export function FrequentStrip({
  items,
  onOpen,
}: {
  items: ConversationListItem[];
  onOpen: (id: string) => void;
}) {
  const frequent = frequentThreads(items);
  // Too few to be worth a section of its own — the list below already
  // shows exactly these threads, in the same order.
  if (frequent.length < FREQUENT_MIN) return null;

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
                {/* Unread reads twice here: the gold ring (the same signal
                    the list row uses) and this dot, which stays legible
                    when a photo behind the ring is itself gold-ish. */}
                {unread ? <View style={styles.unreadDot} /> : null}
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

  unreadDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.bg,
  },

  name: { ...type.meta, color: colors.fgSecondary, textAlign: 'center' },
  nameUnread: { color: colors.fg },
  pressed: { opacity: 0.6 },
});
