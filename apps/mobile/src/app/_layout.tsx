import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ScreenBackground } from '@/components/ScreenBackground';
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
    /* `transparent`, not colors.bg: the photo/wash/grain stack is
       rendered ONCE below (RootLayout), the same way web renders it once
       from TopBar as a sibling of every routed page. An opaque screen
       background would hide it everywhere.

       Web's own comment notes that its pages DO stay opaque and the photo
       only shows in the margins. Mobile goes the other way deliberately:
       a phone has no margins, so an opaque page would mean the treatment
       never appears at all. Each screen keeps its own opaque surfaces
       (cards, rows, sheets) — it is only the page ground that opens up. */
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
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
        <Stack.Screen name="flash" />
        <Stack.Screen name="flash-piece" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="settings" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

/**
 * React Navigation paints its OWN container background from the active
 * theme, underneath every screen and above anything rendered as a sibling
 * of the navigator. Its default is `rgb(242, 242, 242)` — a near-white
 * that covered the photo stack completely, and that no `contentStyle` or
 * `sceneStyle` override reaches, because it is not the screen's
 * background.
 *
 * Found by rendering it: the layer was there, correctly sized, and simply
 * painted over. Transparent here lets the app's own ground show through
 * while every other navigator colour stays at the dark theme's values.
 */
const TRANSPARENT_NAV_THEME = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: 'transparent' },
};

export default function RootLayout() {
  return (
    // Required by the nav drawer's swipe-to-dismiss: gesture-handler does
    // nothing unless one of these is above every gesture in the tree. It
    // was already a dependency (SDK 54 ships it for expo-router) but had
    // never been mounted, because nothing gestured until now.
    <GestureHandlerRootView style={styles.root}>
    {/*
      TASK B (chat-ux/00-investigation). `KeyboardProvider` is the root
      half of `react-native-keyboard-controller`'s setup — it installs the
      per-frame keyboard-height listener that spec §4's composer
      choreography reads, and does nothing on its own.
      
      Mounted here and nowhere else: it renders its children unchanged and
      starts no animation, so no existing screen's behaviour moves. The
      only consumer today is the dev-only smoke screen; the real chat
      surface is untouched by this session.
      
      Above SafeAreaProvider on purpose — the library's own setup docs put
      it at the very top of the tree, and the insets context does not
      depend on it.
    */}
    <KeyboardProvider>
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        {/* Behind the navigator, so it survives every push/pop instead of
            being re-decoded per screen. */}
        <ScreenBackground />
        <ThemeProvider value={TRANSPARENT_NAV_THEME}>
          <RootNavigator />
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
    </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  booting: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
