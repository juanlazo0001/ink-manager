import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import Feather from '@expo/vector-icons/Feather';
import { Pressable } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, Eyebrow, QuietButton } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { API_URL } from '@/lib/api';
import { colors, hairline, radius, space, type } from '@/theme';

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
    <ScreenShell edges={['top']}>
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

        {/* Only for an account that actually HAS an artist profile —
            which is not the same question as role === 'ARTIST'. A solo
            studio's first account is commonly an OWNER with one attached,
            and a FRONT_DESK account has none at all. */}
        {profile.artist ? (
          <Pressable
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          >
            <View style={styles.linkText}>
              <Text style={styles.linkTitle}>Artist profile</Text>
              <Text style={styles.linkBody}>Bio, rates, specialties, schedule and portfolio.</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.fgMuted} />
          </Pressable>
        ) : null}

        {profile.artist ? (
          <Pressable
            onPress={() => router.push('/flash')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          >
            <View style={styles.linkText}>
              <Text style={styles.linkTitle}>Flash gallery</Text>
              <Text style={styles.linkBody}>Your flash pieces and what's been requested.</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.fgMuted} />
          </Pressable>
        ) : null}

        <View style={styles.spacer} />

        <QuietButton label="Log out" onPress={logout} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  headerSpacer: { width: 36 },
  body: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.xl, gap: space.xl },
  identity: { gap: space.xs },
  name: { ...type.display, color: colors.fg },
  studio: { ...type.body, color: colors.accent },
  card: { paddingHorizontal: space.lg },
  row: { paddingVertical: space.md, gap: space.xs },
  rowValue: { ...type.body, color: colors.fg },
  divider: { height: hairline, backgroundColor: colors.borderSoft },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.cardGlass,
    borderWidth: hairline,
    borderColor: colors.cardBorder,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  linkText: { flex: 1, gap: 2 },
  linkTitle: { ...type.body, color: colors.fg },
  linkBody: { ...type.meta, color: colors.fgMuted },
  pressed: { opacity: 0.6 },
  spacer: { flex: 1 },
});
