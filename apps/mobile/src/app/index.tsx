import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';

// Roles come off the API as enum values (OWNER, FRONT_DESK, ARTIST,
// CUSTOMER). Only presentation -- an unrecognized role falls through to
// the raw value rather than being hidden.
const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  FRONT_DESK: 'Front desk',
  ARTIST: 'Artist',
  CUSTOMER: 'Customer',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const { session, logout } = useAuth();

  // Unreachable in practice -- this route is only registered while the
  // session exists (see the root layout's guards) -- but the type is
  // nullable and an empty render beats a non-null assertion.
  if (!session) return null;

  const { profile, studio } = session;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Signed in</Text>
          <Text style={styles.name}>{profile.name ?? profile.email}</Text>
        </View>

        <View style={styles.card}>
          <Row label="Role" value={ROLE_LABELS[profile.role] ?? profile.role} />
          <View style={styles.divider} />
          <Row label="Studio" value={studio?.name ?? 'Unavailable'} />
          <View style={styles.divider} />
          <Row label="Email" value={profile.email} />
        </View>

        <View style={styles.spacer} />

        <Pressable
          style={({ pressed }) => [styles.logout, pressed && styles.logoutPressed]}
          onPress={logout}
          accessibilityRole="button"
        >
          <Text style={styles.logoutLabel}>Log out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.five,
  },
  header: { gap: Spacing.one },
  eyebrow: {
    color: Colors.accent,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  name: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '600',
  },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  rowLabel: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  rowValue: {
    color: Colors.text,
    fontSize: 15,
    flexShrink: 1,
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: Colors.inputBorder,
  },
  spacer: { flex: 1 },
  logout: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  logoutPressed: { opacity: 0.7 },
  logoutLabel: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
});
