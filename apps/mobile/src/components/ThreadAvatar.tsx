import { StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { ChannelBadge } from '@/components/ChannelBadge';
import { threadAvatarLayout, type ThreadAvatarPerson } from '@/lib/threadAvatar';
import { chat, colors, fonts } from '@/theme';

/**
 * The thread's face — one avatar, or §8 rev G's duo-stack for a group —
 * with the lettered channel badge on it.
 *
 * ─── ONE COMPONENT, TWO PLACES ──────────────────────────────────────
 *
 * §8 and §9 rev G both specify this, at two scales, and explicitly ask
 * for one component. That is not tidiness: the badge treatment already
 * forked once in this app (the CHAT fab drew its own copy of the shared
 * count bubble, fixed in 06-g2), and an avatar that appears in a row and
 * again in the header of the screen that row opens is exactly the shape
 * of thing that drifts.
 *
 * ─── THE DUO-STACK ──────────────────────────────────────────────────
 *
 * Back avatar top-left, front avatar bottom-right, overlapping. The
 * footprint stays the size a SINGLE avatar would have occupied, so a
 * group row does not sit differently from a client row — the two circles
 * overlap into that box rather than widening it.
 *
 * Past two members the front circle stops being a person and becomes a
 * count (`+N`). Showing the second of five faces implies the group is two
 * people; a count says how many it actually is.
 */
export type { ThreadAvatarPerson };

/** §8: 40 back / 28 front in a list row. §9: 32 / 20 in the header. */
export const THREAD_AVATAR_LIST = { back: 40, front: 28, box: 44 } as const;
export const THREAD_AVATAR_HEADER = { back: 32, front: 20, box: 36 } as const;

export function ThreadAvatar({
  name,
  avatarUrl,
  participants,
  channel,
  scale = THREAD_AVATAR_LIST,
  ring,
}: {
  name: string;
  avatarUrl: string | null | undefined;
  /** Present on GROUP threads only — its presence IS the group test (§8). */
  participants?: ThreadAvatarPerson[];
  /** Null on a thread with no messages yet, which has no channel to show. */
  channel?: string | null;
  scale?: { back: number; front: number; box: number };
  ring?: string;
}) {
  /*
   * The one piece of real logic here lives in lib/threadAvatar.ts, where a
   * test can reach it. It shipped wrong precisely because it could not:
   * the duo-stack reads two participants while the group test required
   * only one, so a one-participant thread dereferenced undefined and took
   * the whole conversation list down at launch. See that module.
   */
  const layout = threadAvatarLayout(participants);

  return (
    <View style={[styles.box, { width: scale.box, height: scale.box }]}>
      {layout.kind === 'single' ? (
        <Avatar
          url={layout.person ? layout.person.avatarUrl : avatarUrl}
          initials={initialsOf(layout.person ? layout.person.name : name)}
          size={scale.back}
          ring={ring}
          style={styles.back}
          labelStyle={[styles.monogram, { fontSize: scale.back * 0.36 }]}
        />
      ) : (
        <>
          {/* First member, top-left. */}
          <Avatar
            url={layout.back.avatarUrl}
            initials={initialsOf(layout.back.name)}
            size={scale.back}
            ring={ring}
            style={styles.back}
            labelStyle={[styles.monogram, { fontSize: scale.back * 0.36 }]}
          />
          {/*
            Second member, bottom-right, with a ring in the PAGE colour so
            it reads as a separate circle resting on the first rather than
            a shape cut out of it — the same trick, for the same reason, as
            the channel badge below.
          */}
          <View style={[styles.front, { borderRadius: scale.front, borderColor: chat.surface }]}>
            {layout.kind === 'overflow' ? (
              <View
                style={[
                  styles.overflow,
                  { width: scale.front, height: scale.front, borderRadius: scale.front / 2 },
                ]}
              >
                <Text style={[styles.overflowLabel, { fontSize: scale.front * 0.36 }]}>
                  +{layout.count}
                </Text>
              </View>
            ) : (
              <Avatar
                url={layout.front.avatarUrl}
                initials={initialsOf(layout.front.name)}
                size={scale.front}
                labelStyle={[styles.monogram, { fontSize: scale.front * 0.36 }]}
              />
            )}
          </View>
        </>
      )}

      {/* §8/§9: the lettered badge rides the composite's bottom-right —
          the same component the list has always used, not a copy. */}
      {channel ? <ChannelBadge channel={channel} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'relative' },
  back: { position: 'absolute', top: 0, left: 0 },
  front: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    /* §8: a 2pt ring in the surface colour. */
    borderWidth: 2,
    overflow: 'hidden',
  },
  overflow: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  /* §1.2: monograms and counts on an avatar are Fraunces. */
  overflowLabel: { fontFamily: fonts.displaySemiBold, color: colors.fgMuted },
  monogram: { fontFamily: fonts.displaySemiBold, color: colors.fgMuted },
});
