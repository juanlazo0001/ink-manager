import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Ornament } from '@/components/editorial';
import { useAuth } from '@/context/auth';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The hamburger sheet — mobile's stand-in for web's permanent sidebar.
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
export function AppMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
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

      <SafeAreaView style={styles.sheetWrap} edges={['top', 'bottom']} pointerEvents="box-none">
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

          <ScrollView contentContainerStyle={styles.items}>
            <MenuItem icon="image" label="Flash Gallery" onPress={() => go('/flash')} />
            <MenuItem icon="user" label="Profile" onPress={() => go('/profile')} />
            <MenuItem icon="settings" label="Settings" onPress={() => go('/settings')} />
            <View style={styles.divider} />
            <MenuItem
              icon="log-out"
              label="Log out"
              onPress={() => {
                onClose();
                void logout();
              }}
            />
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
}: {
  icon: 'image' | 'user' | 'settings' | 'log-out';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
    >
      <Feather name={icon} size={17} color={colors.fgMuted} />
      <Text style={styles.itemLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  sheetWrap: { flex: 1, alignItems: 'flex-start' },
  sheet: {
    width: '82%',
    maxWidth: 320,
    flex: 1,
    // The same card colour every panel in the app uses, opaque here: a
    // translucent drawer over a scrolling screen is unreadable.
    backgroundColor: colors.cardGlassOpaque,
    borderRightWidth: hairline,
    borderRightColor: colors.border,
    paddingTop: space.xl,
  },
  header: { paddingHorizontal: space.lg, gap: 2 },
  studio: { ...type.heading, color: colors.fg },
  person: { ...type.small, color: colors.fgMuted },
  ornament: { marginVertical: space.lg, marginHorizontal: space.lg },

  items: { paddingHorizontal: space.sm, paddingBottom: space.xl },
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
