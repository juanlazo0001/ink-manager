import { useRouter } from 'expo-router';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Ornament } from '@/components/editorial';
import { LogoutIcon, PersonIcon, PhotoIcon, SettingsIcon } from '@/components/icons';
import { useAuth } from '@/context/auth';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The account menu, opened by the avatar — where web keeps Profile,
 * Settings and Log out already.
 *
 * It used to be a left-hand hamburger drawer. The hamburger is gone by
 * owner decision and its destinations moved here, so there is now ONE
 * overflow surface instead of two. Flash Gallery came across with them:
 * web reaches it from the sidebar, and mobile no longer has one.
 *
 * Anchored to the top-right under the avatar rather than filling the
 * screen, matching web's own `absolute right-0 top-12 w-48` dropdown.
 *
 * What is in it is not a design choice; it is web's own nav list filtered
 * to what an artist can reach AND what exists on this phone:
 *
 *   Dashboard, My Inquiries, Calendar   already tabs — a menu entry
 *                                       duplicating a tab is noise
 *   Clients        `clients.view`, which ARTIST lacks by default, and no
 *                  mobile screen exists. Omitted.
 *   Team           OWNER only. Omitted.
 *   Scan           `giftCards.view`, which ARTIST lacks. Omitted.
 *   Flash Gallery  `flashGallery.manage`, ARTIST default TRUE. Included.
 *
 * plus web's account menu, same filter:
 *
 *   Profile        included
 *   Settings       included
 *   View portal as OWNER only, no mobile equivalent. Omitted.
 *   Log out        included
 *
 * Omitted, not stubbed — an entry that opens nothing is worse than an
 * entry that is not there.
 *
 * The studio name lives here rather than in the bar. Web puts it in the
 * sidebar header, above the nav; the bar itself never carries it. Moving
 * it here is matching that hierarchy, not inventing one.
 */
export function AccountMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { session, logout } = useAuth();

  function go(path: '/flash' | '/profile' | '/settings') {
    onClose();
    router.push(path);
  }

  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      {/* The scrim is the dismiss target, so a tap anywhere off the sheet
          closes it — the same affordance web's own click-outside gives. */}
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close menu" accessibilityRole="button" />

      <SafeAreaView style={styles.sheetWrap} edges={['top']} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.studio} numberOfLines={1}>
              {session?.studio?.name ?? 'Studio unavailable'}
            </Text>
            <Text style={styles.person} numberOfLines={1}>
              {session?.profile.name ?? session?.profile.email}
            </Text>
          </View>

          <Ornament style={styles.ornament} />

          <View style={styles.items}>
            <MenuItem Icon={PhotoIcon} label="Flash Gallery" onPress={() => go('/flash')} />
            <MenuItem Icon={PersonIcon} label="Profile" onPress={() => go('/profile')} />
            <MenuItem Icon={SettingsIcon} label="Settings" onPress={() => go('/settings')} />
            <View style={styles.divider} />
            <MenuItem
              Icon={LogoutIcon}
              label="Log out"
              onPress={() => {
                onClose();
                void logout();
              }}
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function MenuItem({
  Icon,
  label,
  onPress,
}: {
  Icon: (props: { size?: number; color: string }) => React.ReactElement;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
    >
      <Icon size={17} color={colors.fgMuted} />
      <Text style={styles.itemLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  // Top-right, under the avatar it belongs to -- web's own
  // `absolute right-0 top-12` placement.
  sheetWrap: { flex: 1, alignItems: 'flex-end' },
  sheet: {
    width: 232,
    marginTop: 56,
    marginRight: space.lg,
    // The same card colour every panel in the app uses, opaque here: a
    // translucent menu over a scrolling screen is unreadable.
    backgroundColor: colors.cardGlassOpaque,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingTop: space.lg,
    paddingBottom: space.sm,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  header: { paddingHorizontal: space.lg, gap: 2 },
  studio: { ...type.heading, fontSize: 16, lineHeight: 21, color: colors.fg },
  person: { ...type.small, color: colors.fgMuted },
  ornament: { marginVertical: space.md, marginHorizontal: space.lg },

  items: { paddingHorizontal: space.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.card,
  },
  itemPressed: { backgroundColor: colors.surface },
  itemLabel: { ...type.body, color: colors.fgSecondary },
  divider: { height: hairline, backgroundColor: colors.borderSoft, marginVertical: space.sm, marginHorizontal: space.md },
});
