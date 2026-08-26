import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TopBarActions } from '@/components/TopBar';
import { useAuth } from '@/context/auth';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * ONE letter, not two.
 *
 * Web's TopBar falls back to `(profile?.name ?? user.role ?? 'U').slice(0, 1)`
 * — a single character in Fraunces at `--color-accent-hover`. Mobile had
 * been building two initials in Jura at `--color-accent`, which is a
 * different mark for the same person in the same corner of the same
 * product.
 */
function initial(name: string | null, fallback: string): string {
  const source = name?.trim() || fallback;
  return (source.slice(0, 1) || 'U').toUpperCase();
}

/**
 * The shared top bar. The avatar on the right is the only route into the
 * account screen — there is no fifth tab for it, deliberately: the four
 * tabs are the work, and "who am I / sign out" is a corner, not a
 * destination.
 */
export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
}: {
  /** Omit when the screen's own header card already carries the name. */
  title?: string;
  subtitle?: string;
  /** Replaces the avatar. Used by screens that need their own action there. */
  right?: ReactNode;
  /** When given, a back chevron replaces the left padding. */
  onBack?: () => void;
}) {
  const router = useRouter();
  const { session } = useAuth();

  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Feather name="chevron-left" size={24} color={colors.fgSecondary} />
        </Pressable>
      ) : null}

      <View style={styles.titles}>
        {title ? (
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {/*
        ITEM 5: the SAME cluster the tabs bar renders — tasks with its
        badge, the bell, the account avatar. This header used to draw a
        lone avatar, so the corner changed shape every time you pushed a
        detail screen. `right` still overrides for the rare screen that
        needs its own control there.
      */}
      {right ?? <TopBarActions onOpenAccount={() => router.push('/account')} />}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
    backgroundColor: 'transparent',
  },
  back: { marginLeft: -space.sm },
  titles: { flex: 1, gap: 2 },
  title: { ...type.display, fontSize: 24, lineHeight: 29, color: colors.fg },
  subtitle: { ...type.meta, color: colors.fgMuted },
  avatar: {
    // h-9 w-9 on web's editorial branch.
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    // bg-surface-raised, web's own fallback ground.
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  /* font-display text-sm text-accent-hover */
  avatarLabel: { fontFamily: type.display.fontFamily, fontSize: 14, color: colors.accentHover },
  pressed: { opacity: 0.6 },
});
