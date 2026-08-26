import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StateMessage } from '@/components/ui';
import { colors } from '@/theme';

/**
 * Notifications — the bell's destination.
 *
 * **There is no data source, and that is a finding, not an omission.**
 *
 * Web's bell (`TopBar.tsx`, `aria-label="Mentions"`) opens a popover whose
 * entire contents are one hardcoded sentence:
 *
 *   "No mentions yet — internal mentions are coming to Conversations."
 *
 * No fetch, no query, no socket subscription, no unread state, and no
 * endpoint anywhere in `apps/api` that would back one. The mentions
 * feature has not been built on either client. PARITY-AUDIT.md §11 already
 * recorded this — "a thin surface today" — and it is still true.
 *
 * So this screen shows web's own sentence and nothing else. The
 * alternative would have been inventing a notifications API, which is
 * exactly what the brief said not to do. When a real feed lands, this is
 * the screen it lands in; the bell already navigates here.
 *
 * For the same reason there is no unread dot on the bell: there is no
 * count to derive one from, and a dot that never lights is worse than no
 * dot at all.
 */
export default function NotificationsScreen() {
  const router = useRouter();

  return (
    <ScreenShell edges={['top']}>
      <ScreenHeader title="Notifications" onBack={() => router.back()} right={<View style={styles.spacer} />} />
      <StateMessage
        eyebrow="Nothing yet"
        title="No mentions yet"
        body="Internal mentions are coming to Conversations. When someone tags you, it will show up here."
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  spacer: { width: 36 },
});
