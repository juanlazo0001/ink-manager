import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/context/AuthContext';
import { useAuth } from '@/context/auth';
import { colors, useAppFonts } from '@/theme';

// Held open across the SecureStore read, the /users/me revalidation it
// triggers, AND the font load, so a returning user goes splash -> app with
// neither a login screen nor a flash of system-font type in between.
SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useAuth();
  const fontsReady = useAppFonts();
  const ready = status !== 'restoring' && fontsReady;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  // The splash is still up at this point; this only matters if hiding it
  // races ahead of the first render. A bare dark screen beats a flash of
  // the wrong route or of the wrong typeface.
  if (!ready) {
    return (
      <View style={styles.booting}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // Declarative guards rather than an imperative redirect: the routes the
  // current session isn't entitled to are never registered at all, so
  // there is no window in which a deep link or a stale back-stack entry
  // can land on one.
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="conversation/[id]" />
        <Stack.Screen name="appointment/[id]" />
        <Stack.Screen name="inquiry/[id]" />
        <Stack.Screen name="account" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        {/* Pushed, not presented as a modal like `account` above: the
            editor has an unsaved-changes guard, and a modal's swipe-down
            dismissal is a second way off the screen that the guard on a
            card presentation does not cover as reliably. */}
        <Stack.Screen name="profile" />
        <Stack.Screen name="profile-edit" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  booting: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
