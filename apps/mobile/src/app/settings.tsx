import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { EditorialCard } from '@/components/editorial';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenLoading } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { apiFetch } from '@/lib/api';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Settings, as an artist sees it: entirely read-only.
 *
 * Web's Settings has six tabs and shows an ARTIST exactly one — General —
 * because every other tab is gated on a permission an artist does not
 * hold (`canViewPolicies`, `canViewServices`, `canViewIntegrations`,
 * `canViewSystem`). Within General they see the studio's logo, name and
 * website, the sentence "You don't have permission to edit this.", and the
 * locations list. That is the whole surface, and it is what is here.
 *
 * PARITY-AUDIT.md §10 called this "the smallest gap here… nothing an
 * artist can change", and session B chose not to build it. It is built now
 * because the top bar's menu needs somewhere honest to send them — an
 * entry that opens nothing is worse than no entry.
 *
 * Studio name/logo/website come from the session, which already holds
 * them. Locations are the one fetch, and `GET /studios/:id/locations` is
 * open to any authenticated studio member — the API's own comment says so.
 */
interface StudioLocation {
  id: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
}

export default function SettingsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const studio = session?.studio ?? null;

  const [locations, setLocations] = useState<StudioLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.token || !studio) return;
    try {
      const data = await apiFetch<StudioLocation[]>(
        `/studios/${encodeURIComponent(studio.id)}/locations`,
        { token: session.token },
      );
      // Guarded because a screen should degrade to its empty state, not a
      // white screen, if this ever comes back as something other than a
      // list. Caught in preview when a stub answered with an object.
      setLocations(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(screenErrorMessage(err, 'your studio’s locations'));
    }
  }, [session?.token, studio]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScreenShell edges={['top']}>
      <ScreenHeader title="Settings" onBack={() => router.back()} right={<View style={styles.spacer} />} />

      <ScrollView contentContainerStyle={styles.content}>
        <EditorialCard title="Studio Profile" style={styles.card}>
          <View style={styles.studioRow}>
            {studio?.logoUrl ? (
              <Image source={{ uri: studio.logoUrl }} style={styles.logo} contentFit="contain" />
            ) : (
              <View style={[styles.logo, styles.logoEmpty]}>
                <Text style={styles.logoEmptyText}>No logo</Text>
              </View>
            )}
            <View style={styles.studioText}>
              <Text style={styles.studioName}>{studio?.name ?? 'Studio unavailable'}</Text>
              {studio?.website ? <Text style={styles.studioMeta}>{studio.website}</Text> : null}
              {/* Web's exact sentence for a caller without studios.manage. */}
              <Text style={styles.note}>You don&apos;t have permission to edit this.</Text>
            </View>
          </View>
        </EditorialCard>

        <EditorialCard title="Locations" style={styles.card}>
          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : locations === null ? (
            <ScreenLoading />
          ) : locations.length === 0 ? (
            // Web shows "No locations yet. Add your first one." only to
            // someone who CAN add one; everyone else gets the short form.
            <Text style={styles.note}>No locations yet.</Text>
          ) : (
            <View style={styles.locationList}>
              {locations.map((location) => (
                <View key={location.id} style={styles.location}>
                  <Text style={styles.locationName}>{location.name}</Text>
                  <Text style={styles.locationMeta}>
                    {[location.addressLine1, location.city, location.state].filter(Boolean).join(', ') ||
                      'No address on file'}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </EditorialCard>

        <Text style={styles.footer}>
          Everything else in Settings — policies, services, integrations, defaults — is managed from the web app by
          an owner.
        </Text>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  spacer: { width: 36 },
  content: { paddingBottom: space.xxxl },
  card: { marginHorizontal: space.lg, marginTop: space.lg },

  studioRow: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  logo: { width: 56, height: 56, borderRadius: radius.input, backgroundColor: colors.surfaceInset },
  logoEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: colors.border,
  },
  logoEmptyText: { ...type.meta, fontSize: 10, color: colors.fgMuted },
  studioText: { flex: 1, gap: 2 },
  studioName: { ...type.body, color: colors.fg },
  studioMeta: { ...type.small, color: colors.fgSecondary },
  note: { ...type.meta, color: colors.fgMuted, marginTop: space.sm },
  error: { ...type.small, color: colors.danger },

  locationList: { gap: space.md },
  location: { gap: 2 },
  locationName: { ...type.body, color: colors.fg },
  locationMeta: { ...type.meta, color: colors.fgMuted },

  footer: { ...type.meta, color: colors.fgMuted, paddingHorizontal: space.lg, paddingTop: space.xl },
});
