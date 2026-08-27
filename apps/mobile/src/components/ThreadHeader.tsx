import Feather from '@expo/vector-icons/Feather';
import { BlurView } from 'expo-blur';
import type { ConversationThreadHeader } from '@ink-manager/shared-types';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { THREAD_AVATAR_HEADER, ThreadAvatar } from '@/components/ThreadAvatar';
import { chat, colors, fonts, hairline, space } from '@/theme';

/**
 * The thread header (spec §9).
 *
 * ─── TRANSLUCENT, WITH A HONEST FALLBACK ────────────────────────────
 *
 * `expo-blur` over the thread, hairline underneath, content scrolling
 * beneath it. On Android `BlurView` is materially more expensive and has
 * historically been inconsistent, so this renders the solid raised-espresso
 * tint there instead of pretending — the spec asks for the fallback to be
 * stated rather than silently degraded, and this is that statement in
 * code.
 *
 * ─── NO CONTEXT-CHIP ROW (§9 rev H, owner ruling 2026-08-27) ────────
 *
 * This header used to carry a second row of gold-outlined chips under
 * the name, and a scroll-driven collapse that animated it to zero height
 * on scroll-down and back on scroll-up. Both are gone: the header is one
 * 44pt row, and the hairline sits directly beneath it.
 *
 * Worth recording because the removal is smaller than it sounds and the
 * name of the thing was misleading: the row never rendered conversation
 * TAGS. It rendered exactly one chip, built from `header.primaryInquiry`
 * — description · placement · status — which is why a thread whose
 * inquiry read description "TEST", placement "TEST", status NEW showed
 * `TEST · TEST · NEW`. `ConversationThreadTag` carries no human label to
 * render (see the deleted note's reasoning), so tags were never on
 * screen and no tag data is touched by their absence.
 *
 * The collapse retires with the row. Nothing else in this header ever
 * moved on scroll, so there is no residual choreography.
 */
export function ThreadHeader({
  header,
  channel,
  handle,
  onBack,
  onInfo,
}: {
  header: ConversationThreadHeader;
  /** The thread's channel, for the sub-line swatch + name. */
  channel: string;
  /** Phone number or handle, when the counterpart has one. */
  handle?: string | null;
  onBack: () => void;
  onInfo?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const name = header.counterpart?.name ?? 'Conversation';
  const isGroup = header.type === 'GROUP';
  const members = header.counterpart?.participants;

  const body = (
    <View style={styles.row}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={10}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      >
        {/* §9: cream, never red. Red on this screen is the bubble and
            the alerts, and a back chevron is neither. */}
        <Feather name="chevron-left" size={26} color={chat.textPrimary} />
      </Pressable>

      {/*
        §9 rev G: the list's own avatar-with-lettered-badge, at header
        scale. The channel used to be a swatch plus its full name on a
        second line under the title -- which is what made this header
        two rows tall and left a dead band above the name. The badge
        says the same thing in the space the avatar already occupies.
      */}
      <ThreadAvatar
        name={name}
        avatarUrl={header.counterpart?.avatarUrl}
        participants={members}
        channel={channel}
        scale={THREAD_AVATAR_HEADER}
      />

      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>

      <Pressable
        onPress={onInfo}
        accessibilityRole="button"
        accessibilityLabel="Conversation details"
        hitSlop={10}
        disabled={!onInfo}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      >
        <Feather name="info" size={20} color={onInfo ? chat.textPrimary : chat.textMuted} />
      </Pressable>
    </View>
  );

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + HEADER_PAD }]}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.solidFallback]} />
      )}
      {/* A tint over the blur: raw blur of a near-black thread reads as
          smudged rather than frosted. */}
      <View style={[StyleSheet.absoluteFill, styles.tint]} pointerEvents="none" />
      {body}
      <View style={styles.hairline} />
    </View>
  );
}

/**
 * §9 rev G: safe-area top + this + one 44pt row, and nothing else.
 * Rev H makes that literal — with the chip row gone the hairline is the
 * next sibling after the row, so this is now the whole header.
 */
const HEADER_PAD = 8;
const HEADER_ROW = 44;

const styles = StyleSheet.create({
  /* zIndex so the thread passes BENEATH the header (9) rather than over
     it: the list now translates upward with the keyboard, and a later
     sibling would otherwise paint on top of the identity row. */
  wrap: { overflow: 'hidden', zIndex: 10 },
  solidFallback: { backgroundColor: colors.surfaceRaised },
  tint: { backgroundColor: 'rgba(29, 24, 19, 0.72)' },

  /*
   * §9 rev G: ONE standard-height row. Fixed at 44 rather than left to
   * content, because content-height is what produced the dead band the
   * gate reported -- a two-line identity cluster made the row ~52 and put
   * the name below the optical centre. 44 is the same height every icon
   * button in this app already is.
   */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    height: HEADER_ROW,
  },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  identity: { flex: 1, gap: 1 },
  /* §1.2 / §9: Outfit 17/600 — names are never Fraunces. */
  /* §1.2 / §9: Outfit 17/600. It was type.body -- Outfit 400 -- which is
     body weight setting a person's name in the one place the screen has
     for identity. Also claims the middle now that there is no second
     line beneath it. */
  name: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.bodySemiBold,
    fontSize: 17,
    lineHeight: 22,
    color: chat.textPrimary,
  },

  hairline: { height: hairline, backgroundColor: chat.hairline },
  pressed: { opacity: 0.6 },
});
