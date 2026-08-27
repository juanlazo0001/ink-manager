import Feather from '@expo/vector-icons/Feather';
import { BlurView } from 'expo-blur';
import type { ConversationThreadHeader } from '@ink-manager/shared-types';
import Animated, {
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { THREAD_AVATAR_HEADER, ThreadAvatar } from '@/components/ThreadAvatar';
import { chat, colors, fonts, hairline, radius, space, type } from '@/theme';

/** Spec §9: the chip row's own height, and how far it travels. */
export const CHIP_ROW_HEIGHT = 44;

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
 * ─── THE CHIP ROW COLLAPSES, THE IDENTITY DOES NOT ──────────────────
 *
 * Scrolling down collapses the context chips to zero height and fades
 * them; scrolling back up returns them. The name, avatar and channel line
 * never move — losing who you are talking to while reading history is
 * exactly the disorientation the collapse is meant to relieve.
 *
 * ─── CHIPS COME FROM DATA ALREADY IN HAND ───────────────────────────
 *
 * `primaryInquiry` (id/status/description/placement) is already on
 * `ConversationThreadHeader`. No new request is made, and a thread with no
 * linked inquiry renders no chip row at all rather than an empty strip.
 */
export function ThreadHeader({
  header,
  channel,
  handle,
  collapse,
  onBack,
  onInfo,
  onPressInquiry,
}: {
  header: ConversationThreadHeader;
  /** The thread's channel, for the sub-line swatch + name. */
  channel: string;
  /** Phone number or handle, when the counterpart has one. */
  handle?: string | null;
  /** 0 = chips fully open, 1 = fully collapsed. Driven by scroll. */
  collapse: SharedValue<number>;
  onBack: () => void;
  onInfo?: () => void;
  onPressInquiry?: (inquiryId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const name = header.counterpart?.name ?? 'Conversation';
  const isGroup = header.type === 'GROUP';
  const members = header.counterpart?.participants;

  const inquiry = header.primaryInquiry;
  const chips: { key: string; label: string; onPress?: () => void }[] = [];
  if (inquiry) {
    // Description first — it is what the thread is actually about — with
    // placement as the qualifier, then the status. Everything here is a
    // field the header already carries.
    const subject = [inquiry.description, inquiry.placement].filter(Boolean).join(' · ');
    chips.push({
      key: `inq:${inquiry.id}`,
      label: [subject, inquiry.status.replace(/_/g, ' ')].filter(Boolean).join(' · '),
      onPress: onPressInquiry ? () => onPressInquiry(inquiry.id) : undefined,
    });
  }
  /*
   * `tags` are deliberately NOT rendered as chips. `ConversationThreadTag`
   * types only `id`/`entityType`/`entityId` plus an index signature — there
   * is no guaranteed human label on it, and apps/web reads nothing but
   * `tag.id` from it either. Inventing a label field here would be
   * inventing API surface. The linked inquiry is the chip this screen can
   * render truthfully today.
   */

  const chipStyle = useAnimatedStyle(() => ({
    height: interpolate(collapse.value, [0, 1], [CHIP_ROW_HEIGHT, 0]),
    opacity: interpolate(collapse.value, [0, 0.6], [1, 0]),
  }));

  const body = (
    <>
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

      {chips.length > 0 ? (
        <Animated.View style={[styles.chipRow, chipStyle]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRowContent}
            // Load-bearing, the same note `Pill`'s row and `DayStrip` both
            // carry: a horizontal ScrollView in a flex column takes all the
            // height offered and stretches its children.
            style={styles.chipScroll}
          >
            {chips.map((c) => (
              <Pressable
                key={c.key}
                onPress={c.onPress}
                disabled={!c.onPress}
                accessibilityRole={c.onPress ? 'button' : undefined}
                style={({ pressed }) => [styles.chip, pressed && c.onPress && styles.pressed]}
              >
                {/* No clamp: 9 says the ROW scrolls. A capped, ellipsised
                    chip hides the status, which is the half people read. */}
                <Text style={styles.chipLabel}>{c.label.toUpperCase()}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>
      ) : null}
    </>
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

/** §9 rev G: safe-area top + this + one 44pt row, and nothing else. */
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

  chipRow: { justifyContent: 'center' },
  chipScroll: { flexGrow: 0 },
  chipRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  /* §9: gold outline, in the active-filter-chip style. */
  chip: {
    flexShrink: 0,
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: chat.accent,
    backgroundColor: 'rgba(201, 154, 91, 0.08)',
  },
  chipLabel: { ...type.label, fontSize: 9, color: chat.accent },

  hairline: { height: hairline, backgroundColor: chat.hairline },
  pressed: { opacity: 0.6 },
});
