import { Image } from 'expo-image';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { FacebookIcon, InstagramIcon } from '@/components/icons';
import { artistLabel, type ArtistOption } from '@/lib/artists';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * One artist, as web's Team page draws them.
 *
 * Mirrored section for section from `Team.tsx`'s artist card, in its
 * order, because the order is the information hierarchy: who they are,
 * what they say about themselves, where to find them, what they do, what
 * it looks like.
 *
 *     avatar + name + guest badge
 *     bio            two lines, clamped
 *     handles        Instagram, Facebook
 *     specialties    up to 4, then "+N more"
 *     portfolio      up to 4 thumbnails
 *
 * The two caps are web's own (`slice(0, 4)` on both), not a mobile
 * concession: a card is a summary, and an artist with twenty specialties
 * should not turn the roster into a wall of pills.
 *
 * ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────
 *
 * Web's card ends with an OWNER-only action row — View as, Edit account,
 * Delete. Those are portal actions, and this screen already says so in
 * its own footer ("Inviting, editing and removing people is done in the
 * portal"). Reproducing the buttons without the flows behind them would
 * be worse than their absence.
 *
 * Web's card is also a link to `/artists/:id`, a full profile page this
 * app does not have. The card is not pressable here rather than being
 * pressable and going nowhere.
 */
export function ArtistCard({ artist }: { artist: ArtistOption }) {
  const name = artistLabel(artist);
  const specialties = artist.specialties ?? [];
  const portfolio = artist.portfolioImages ?? [];
  const extraSpecialties = Math.max(0, specialties.length - 4);

  const open = async (url: string) => {
    try {
      if (!(await Linking.canOpenURL(url))) {
        Alert.alert('Cannot open this link', 'No app on this device can open it.');
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert('Cannot open this link', 'Something went wrong. Try again.');
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Avatar url={artist.user.avatarUrl} initials={initialsOf(name)} size={48} />
        <View style={styles.identity}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {/* Web prints the email under the name. Suppressed when the name
              IS the email -- `artistLabel` falls back to it, and the same
              string twice is not an identity block. */}
          {artist.user.name ? (
            <Text style={styles.email} numberOfLines={1}>
              {artist.user.email}
            </Text>
          ) : null}
        </View>
      </View>

      {artist.bio ? (
        <Text style={styles.bio} numberOfLines={2}>
          {artist.bio}
        </Text>
      ) : null}

      {artist.instagramHandle || artist.facebookProfileUrl ? (
        <View style={styles.handles}>
          {artist.instagramHandle ? (
            <Pressable
              onPress={() => void open(`https://instagram.com/${artist.instagramHandle}`)}
              accessibilityRole="link"
              accessibilityLabel={`${name} on Instagram`}
              hitSlop={6}
              style={({ pressed }) => [styles.handle, pressed && styles.pressed]}
            >
              <InstagramIcon size={14} color={colors.fgSecondary} />
            </Pressable>
          ) : null}
          {artist.facebookProfileUrl ? (
            <Pressable
              onPress={() => void open(artist.facebookProfileUrl!)}
              accessibilityRole="link"
              accessibilityLabel={`${name} on Facebook`}
              hitSlop={6}
              style={({ pressed }) => [styles.handle, pressed && styles.pressed]}
            >
              <FacebookIcon size={14} color={colors.fgSecondary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {specialties.length > 0 ? (
        <View style={styles.specialties}>
          {specialties.slice(0, 4).map((s) => (
            <View key={s} style={styles.pill}>
              <Text style={styles.pillLabel}>{s}</Text>
            </View>
          ))}
          {extraSpecialties > 0 ? (
            <Text style={styles.more}>+{extraSpecialties} more</Text>
          ) : null}
        </View>
      ) : null}

      {portfolio.length > 0 ? (
        /* Four across, square, matching web's grid. `flex: 1` on each with
           a gap rather than a fixed width, so the row fits any card width
           without arithmetic that would drift from the padding. */
        <View style={styles.portfolio}>
          {portfolio.slice(0, 4).map((url) => (
            <View key={url} style={styles.thumbWrap}>
              <Image source={{ uri: url }} style={styles.thumb} contentFit="cover" />
            </View>
          ))}
          {/* Keeps the last row aligned left when there are fewer than
              four, instead of stretching them to fill. */}
          {Array.from({ length: Math.max(0, 4 - portfolio.length) }).map((_, i) => (
            <View key={`spacer-${i}`} style={styles.thumbSpacer} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identity: { flexShrink: 1, gap: 2 },
  name: { ...type.heading, fontSize: 16, color: colors.fg },
  email: { ...type.small, color: colors.fgMuted },
  bio: { ...type.small, color: colors.fgMuted },

  handles: { flexDirection: 'row', gap: space.sm },
  handle: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.6 },

  specialties: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs },
  pill: {
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  pillLabel: { ...type.small, color: colors.fgMuted },
  more: { ...type.small, color: colors.fgMuted, paddingHorizontal: space.xs },

  portfolio: { flexDirection: 'row', gap: space.xs },
  thumbWrap: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.input,
    borderWidth: hairline,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  thumbSpacer: { flex: 1 },
  thumb: { width: '100%', height: '100%' },
});
