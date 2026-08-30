import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { AuthCardSurface } from '@/components/AuthCardSurface';
import { ScreenShell } from '@/components/ScreenShell';
import { GoldGradientButton } from '@/components/GoldGradientButton';
import { LoginBackdrop } from '@/components/LoginBackdrop';
import { useAuth } from '@/context/auth';
import { API_URL } from '@/lib/api';
import { forgotPasswordUrl } from '@/lib/forgotPassword';
import { loginErrorMessage } from '@/lib/loginError';
import { colors, hairline, login as loginTokens, radius, space, type } from '@/theme';

const WORDMARK = require('../../assets/login/wordmark.png');

/**
 * Below this height the wordmark and the card cannot both sit centred
 * without crowding once the keyboard is up. iPhone SE is 667pt tall, so
 * it takes the compact treatment.
 */
const COMPACT_HEIGHT = 700;

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const { height } = useWindowDimensions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);

  const compact = height < COMPACT_HEIGHT;

  async function onSubmit() {
    if (submitting) return;
    // Deliberately NOT disabled-until-valid. Web's button is always live
    // (the form's own `required` does the validating), and a gold button
    // that sits dimmed until both fields are filled reads as muted at
    // rest -- which is the exact thing this pass set out to fix. Empty
    // fields get the same inline error treatment as a rejected sign-in.
    if (email.trim().length === 0 || password.length === 0) {
      setError('Enter your email and password.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      // No navigation call: the root layout's guards swap which routes
      // exist the moment status flips to 'signedIn'.
    } catch (err) {
      setError(loginErrorMessage(err));
      setSubmitting(false);
    }
  }

  async function onForgotPassword() {
    try {
      await WebBrowser.openBrowserAsync(forgotPasswordUrl(API_URL), {
        // An in-app browser sheet rather than a hand-off to Safari, so
        // dismissing it returns straight to this screen.
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        toolbarColor: colors.bg,
        controlsColor: colors.accent,
      });
    } catch {
      // Nothing useful to say if the system browser refuses to open, and
      // an error banner here would be about the wrong thing entirely.
    }
  }

  return (
    <View style={styles.root}>
      <LoginBackdrop />

      {/*
       * TRANSPARENT, and that is the whole point of this screen.
       *
       * This was `OpaqueScreenShell` from fe9080e until it was measured:
       * that shell is `backgroundColor: colors.bg`, painted as a SIBLING
       * ABOVE `<LoginBackdrop />`, so it covered the photograph, all
       * three gold rings and every gradient with flat #0e0b08. The login
       * screen rendered as an empty near-black field with a card on it.
       *
       * The sweep's intent was right and its layer was wrong. It asked
       * "should the app-wide root photo ground show through here?" —
       * correctly, no — and answered by painting opaque at the shell.
       * But `styles.root` below is ALREADY opaque
       * (`loginTokens.photoPlaceholder`), one level UNDER the backdrop.
       * The root ground was blocked before this shell was ever reached;
       * the only thing the opaque variant added was covering login's own
       * art.
       *
       * So the ordering is what matters, not the colour: an opaque floor
       * belongs BENEATH a backdrop, never above it. Login keeps its floor
       * at `styles.root` and its shell stays transparent.
       */}
      <ScreenShell>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={[styles.content, compact && styles.contentCompact]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            // This is what actually guarantees the password field clears
            // the keyboard on a short phone — KeyboardAvoidingView alone
            // runs out of room once the card is taller than what is left
            // of the viewport.
            automaticallyAdjustKeyboardInsets
          >
            <AuthCardSurface>
              {/* Inside the card, as its first child -- same as web,
                  where the wordmark is the first element of
                  .login-panel-surface rather than floating above it. */}
              <Image
                source={WORDMARK}
                style={[styles.wordmark, compact && styles.wordmarkCompact]}
                contentFit="contain"
                accessibilityLabel="Ink Manager"
              />

              <TextInput
                style={[styles.input, focused === 'email' && styles.inputFocused]}
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocused('email')}
                onBlur={() => setFocused(null)}
                placeholder="Email"
                placeholderTextColor={colors.fgMuted}
                accessibilityLabel="Email"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                returnKeyType="next"
                editable={!submitting}
              />

              <TextInput
                style={[styles.input, focused === 'password' && styles.inputFocused]}
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                placeholder="Password"
                placeholderTextColor={colors.fgMuted}
                accessibilityLabel="Password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={onSubmit}
                editable={!submitting}
              />

              {error ? (
                // Red, and only here: a rejected sign-in is exactly the
                // punctuation case the palette reserves it for.
                <View style={styles.errorRow}>
                  <View style={styles.errorRule} />
                  <Text style={styles.error} accessibilityRole="alert">
                    {error}
                  </Text>
                </View>
              ) : null}

              <GoldGradientButton label="Sign in" onPress={onSubmit} busy={submitting} style={styles.button} />

              <Pressable
                onPress={onForgotPassword}
                accessibilityRole="link"
                hitSlop={8}
                style={({ pressed }) => [styles.forgot, pressed && styles.forgotPressed]}
              >
                <Text style={styles.forgotLabel}>FORGOT PASSWORD?</Text>
              </Pressable>

              {/*
                AN ADDITION, NOT A MIRROR, and deliberate.

                Web's sign-in card has no link to signup at all -- its
                only entry points are the marketing site's "Sign Up"
                buttons, which point at web.inkmanager.app/signup. There
                is no marketing site on a phone, so without this the
                mobile signup screen would exist and be unreachable.

                Placement and wording are therefore ours: below forgot-
                password, in the same quiet treatment, so it reads as the
                secondary door it is rather than competing with Sign in.
                Owner-confirmed.
              */}
              <Pressable
                onPress={() => router.push('/signup')}
                accessibilityRole="link"
                hitSlop={8}
                style={({ pressed }) => [styles.createAccount, pressed && styles.forgotPressed]}
              >
                <Text style={styles.forgotLabel}>CREATE AN ACCOUNT</Text>
              </Pressable>
            </AuthCardSurface>

            {/* Which API this build talks to is otherwise invisible on a
                phone, and getting it wrong is the most likely reason a
                login "mysteriously" fails during testing. */}
            <Text style={styles.apiHint}>{API_URL.replace(/^https?:\/\//, '')}</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </ScreenShell>
    </View>
  );
}

const styles = StyleSheet.create({
  /* The opaque floor, UNDER <LoginBackdrop />. This is what keeps the
     app-wide root photo ground from showing through on login. */
  root: { flex: 1, backgroundColor: loginTokens.photoPlaceholder },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.xxl,
  },
  contentCompact: { paddingVertical: space.lg },

  // Web renders the wordmark at h-24 (96px) with mb-2. Matched here, and
  // trimmed on a short screen where the card needs the room more.
  wordmark: { width: '100%', height: 96, marginBottom: space.sm },
  wordmarkCompact: { width: '100%', height: 72, marginBottom: space.xs },


  // .login-input — note the 5px radius, which is web's own literal, not
  // the card's --radius-card.
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    borderRadius: 5,
    color: colors.fg,
    ...type.body,
    fontSize: 15,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginBottom: space.xl,
  },
  inputFocused: { borderColor: colors.accent },

  errorRow: { flexDirection: 'row', gap: space.md, alignItems: 'stretch', marginBottom: space.lg },
  errorRule: { width: 2, backgroundColor: colors.dangerStrong, borderRadius: 1 },
  error: { ...type.small, color: colors.danger, flex: 1 },

  // .login-button's own margin-top: 1em, on top of the password
  // field's mb-6 -- ~36px of separation in total, matching web.
  button: { marginTop: space.md },

  // Jura, 11px, bold, uppercase, tracking 0.14em, --login-smoke, centred,
  // mt-4 — the web link's exact treatment.
  forgot: { marginTop: space.lg, alignSelf: 'center' },
  createAccount: { marginTop: space.md, alignSelf: 'center' },
  forgotPressed: { opacity: 0.6 },
  forgotLabel: { ...type.label, fontSize: 11, letterSpacing: 1.54, color: colors.fgMuted },

  apiHint: { ...type.meta, color: colors.fgMuted, marginTop: space.xl, textAlign: 'center' },
});
