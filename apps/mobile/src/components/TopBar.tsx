import Feather from '@expo/vector-icons/Feather';
import { formatBubbleCount } from '@ink-manager/shared-types';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppMenu } from '@/components/AppMenu';
import { useAuth } from '@/context/auth';
import { colors, fonts, hairline, radius, space, type } from '@/theme';

/**
 * The app's top bar, replacing the per-screen title header.
 *
 * Ported from apps/web's `TopBar.tsx`, whose right-hand cluster is a row
 * of 44px circular icon buttons plus an avatar pill:
 *
 *   icon button  h-11 w-11 rounded-full border border-border-soft
 *                bg-surface-inset/80 text-fg-muted shadow-lg
 *   avatar pill  rounded-full border border-border-soft bg-surface-inset/80
 *                py-1 pl-1 pr-3 shadow-lg, avatar h-9 w-9, then a
 *                chevron-down
 *   badge        -right-1 -top-1 h-5 min-w-5 rounded-full bg-fg px-1
 *                text-[11px] text-accent-fg
 *
 * Note the badge is CREAM on dark, not red. Web's own comment ties it to
 * the Welcome header's "Welcome," colour and says every bubble in the app
 * (top bar, sidebar, chat FAB) uses that same pairing.
 *
 * Two deliberate differences from web, both of which follow web's own
 * rules rather than departing from them:
 *
 *   The tasks icon is gone. Web puts one in this cluster; on mobile Tasks
 *   is a tab, and its badge moved onto the tab item — the same count, on
 *   the thing that navigates there.
 *
 *   The name/role text beside the avatar is absent. Web hides it too:
 *   `hidden ... sm:flex`, and a phone is below that breakpoint. So this
 *   IS web's phone rendering — avatar and chevron only.
 *
 * The hamburger is mobile's own: web has a permanent sidebar and a phone
 * has nowhere to put one.
 */
export function TopBar({ right }: { right?: ReactNode }) {
  const router = useRouter();
  const { session } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <View style={styles.bar}>
        <IconButton
          icon="menu"
          label="Menu"
          onPress={() => setMenuOpen(true)}
        />

        <View style={styles.spacer} />

        {right}

        <IconButton
          icon="bell"
          label="Notifications"
          onPress={() => router.push('/notifications')}
        />

        <Pressable
          onPress={() => router.push('/account')}
          accessibilityRole="button"
          accessibilityLabel="Account menu"
          style={({ pressed }) => [styles.avatarPill, pressed && styles.pressed]}
        >
          {session?.profile.avatarUrl ? (
            <Image
              source={{ uri: session.profile.avatarUrl }}
              style={styles.avatar}
              contentFit="cover"
              transition={140}
              accessible={false}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>
                {(session?.profile.name?.trim() || session?.profile.role || 'U').slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <Feather name="chevron-down" size={14} color={colors.fgMuted} />
        </Pressable>
      </View>

      <AppMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

/** Web's `iconBtnClass`, as a control. */
function IconButton({
  icon,
  label,
  onPress,
  badge,
}: {
  icon: 'menu' | 'bell';
  label: string;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} unread` : label}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Feather name={icon} size={20} color={colors.fgMuted} />
      {badge && badge > 0 ? <Badge count={badge} /> : null}
    </Pressable>
  );
}

/**
 * The one bubble treatment, shared by the tab bar too — cream fill, dark
 * text, `99+` above ninety-nine.
 */
export function Badge({ count, style }: { count: number; style?: object }) {
  return (
    <View style={[styles.badge, style]} pointerEvents="none">
      <Text style={styles.badgeText}>{formatBubbleCount(count)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  spacer: { flex: 1 },

  /* h-11 w-11 rounded-full border-border-soft bg-surface-inset/80 shadow-lg */
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: colors.borderSoft,
    backgroundColor: 'rgba(18, 15, 11, 0.8)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },

  avatarPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.borderSoft,
    backgroundColor: 'rgba(18, 15, 11, 0.8)',
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: space.md,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  /* h-9 w-9 */
  avatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  /* font-display text-sm text-accent-hover */
  avatarInitial: { fontFamily: type.display.fontFamily, fontSize: 14, color: colors.accentHover },

  badge: {
    position: 'absolute',
    right: -4,
    top: -4,
    height: 20,
    minWidth: 20,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
    alignItems: 'center',
    justifyContent: 'center',
  },
    /* text-[11px] font-medium text-accent-fg */
  badgeText: { fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 14, color: colors.accentFg },

  pressed: { opacity: 0.6 },
});
