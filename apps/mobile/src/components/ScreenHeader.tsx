import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/context/auth';
import { colors, hairline, radius, space, type } from '@/theme';

/** Two letters at most — a full name would not fit the circle. */
function initials(name: string | null, fallback: string): string {
  const source = name?.trim() || fallback;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  title: string;
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
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {right ?? (
        <Pressable
          onPress={() => router.push('/account')}
          accessibilityRole="button"
          accessibilityLabel="Account"
          hitSlop={8}
          style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
        >
          <Text style={styles.avatarLabel}>
            {initials(session?.profile.name ?? null, session?.profile.email ?? '?')}
          </Text>
        </Pressable>
      )}
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
    backgroundColor: colors.bg,
  },
  back: { marginLeft: -space.sm },
  titles: { flex: 1, gap: 2 },
  title: { ...type.display, fontSize: 24, lineHeight: 29, color: colors.fg },
  subtitle: { ...type.meta, color: colors.fgMuted },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  avatarLabel: { ...type.label, fontSize: 12, color: colors.accent },
  pressed: { opacity: 0.6 },
});
