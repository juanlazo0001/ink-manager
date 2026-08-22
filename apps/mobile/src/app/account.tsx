import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, Eyebrow, QuietButton } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { API_URL } from '@/lib/api';
import { colors, hairline, space, type } from '@/theme';

/**
 * Roles arrive as enum values (OWNER, FRONT_DESK, ARTIST, CUSTOMER).
 * Presentation only — an unrecognised role falls through to its raw value
 * rather than being hidden.
 */
const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  FRONT_DESK: 'Front desk',
  ARTIST: 'Artist',
  CUSTOMER: 'Customer',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Eyebrow>{label}</Eyebrow>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const { session, logout } = useAuth();

  // Unreachable in practice — this route is only registered while a
  // session exists (see the root layout's guards).
  if (!session) return null;

  const { profile, studio } = session;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title="Account" onBack={() => router.back()} right={<View style={styles.headerSpacer} />} />

      <View style={styles.body}>
        <View style={styles.identity}>
          <Text style={styles.name}>{profile.name ?? profile.email}</Text>
          <Text style={styles.studio}>{studio?.name ?? 'Studio unavailable'}</Text>
        </View>

        <Card style={styles.card}>
          <Row label="Role" value={ROLE_LABELS[profile.role] ?? profile.role} />
          <View style={styles.divider} />
          <Row label="Email" value={profile.email} />
          <View style={styles.divider} />
          <Row label="Connected to" value={API_URL.replace(/^https?:\/\//, '')} />
        </Card>

        <View style={styles.spacer} />

        <QuietButton label="Log out" onPress={logout} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { width: 36 },
  body: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.xl, gap: space.xl },
  identity: { gap: space.xs },
  name: { ...type.display, color: colors.fg },
  studio: { ...type.body, color: colors.accent },
  card: { paddingHorizontal: space.lg },
  row: { paddingVertical: space.md, gap: space.xs },
  rowValue: { ...type.body, color: colors.fg },
  divider: { height: hairline, backgroundColor: colors.borderSoft },
  spacer: { flex: 1 },
});
