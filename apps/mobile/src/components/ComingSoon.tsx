import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { StateMessage } from '@/components/ui';
import { colors } from '@/theme';

/**
 * The three tabs that aren't built yet. One component rather than three
 * near-identical files, and written in the app's own voice -- a tab that
 * says "This screen has not been implemented" reads as a bug, not as a
 * roadmap.
 */
export function ComingSoon({ title, line }: { title: string; line: string }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title={title} />
      <View style={styles.body}>
        <StateMessage eyebrow="Next up" title={line} body="Messages is live today. This one lands in a later release." />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  body: { flex: 1, justifyContent: 'center' },
});
