import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AuthProvider } from '@/context/AuthContext';
import { useAuth } from '@/context/auth';
import { Colors } from '@/constants/theme';

// Held open across the SecureStore read + the /users/me revalidation it
// triggers, so a returning user goes splash -> home with no login screen
// flashing past in between.
SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== 'restoring') {
      SplashScreen.hideAsync();
    }
  }, [status]);

  // The splash is still up at this point; this only matters if hiding it
  // races ahead of the first navigator render, and a bare dark screen
  // reads better than a flash of the wrong route.
  if (status === 'restoring') {
    return (
      <View style={styles.restoring}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  // Declarative guards rather than an imperative redirect: the routes the
  // current session isn't entitled to are never registered at all, so
  // there is no window in which a deep link or a stale back-stack entry
  // can land on one.
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  restoring: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
});
