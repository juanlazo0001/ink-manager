import { StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

export default function IndexScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ink Manager</Text>
      <Text style={styles.subtitle}>Mobile scaffold</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    gap: Spacing.two,
  },
  title: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '600',
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: 15,
  },
});
