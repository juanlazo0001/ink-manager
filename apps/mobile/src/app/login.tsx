import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow, GoldButton } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { API_URL } from '@/lib/api';
import { loginErrorMessage } from '@/lib/loginError';
import { colors, hairline, radius, space, type } from '@/theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  async function onSubmit() {
    if (!canSubmit) return;

    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      // Deliberately no navigation call: the root layout's guards swap
      // which routes exist the moment status flips to 'signedIn'.
    } catch (err) {
      setError(loginErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Eyebrow style={styles.eyebrow}>Ink Manager</Eyebrow>
            <Text style={styles.title}>Sign in{'\n'}to your studio</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Eyebrow>Email</Eyebrow>
              <TextInput
                style={[styles.input, focused === 'email' && styles.inputFocused]}
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocused('email')}
                onBlur={() => setFocused(null)}
                placeholder="you@studio.com"
                placeholderTextColor={colors.fgMuted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                returnKeyType="next"
                editable={!submitting}
              />
            </View>

            <View style={styles.field}>
              <Eyebrow>Password</Eyebrow>
              <TextInput
                style={[styles.input, focused === 'password' && styles.inputFocused]}
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                placeholder="••••••••"
                placeholderTextColor={colors.fgMuted}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={onSubmit}
                editable={!submitting}
              />
            </View>

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

            <GoldButton label="Sign in" onPress={onSubmit} disabled={!canSubmit} busy={submitting} />
          </View>

          {/* Which API this build talks to is otherwise invisible on a
              phone, and getting it wrong is the most likely reason a login
              "mysteriously" fails during testing. */}
          <Text style={styles.apiHint}>{API_URL.replace(/^https?:\/\//, '')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.xxxl,
    gap: space.xxxl,
  },
  header: { gap: space.md },
  eyebrow: { color: colors.accent },
  title: { ...type.display, fontSize: 34, lineHeight: 40, color: colors.fg },
  form: { gap: space.lg },
  field: { gap: space.sm },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    color: colors.fg,
    ...type.body,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  inputFocused: { borderColor: colors.accent },
  errorRow: { flexDirection: 'row', gap: space.md, alignItems: 'stretch' },
  errorRule: { width: 2, backgroundColor: colors.dangerStrong, borderRadius: 1 },
  error: { ...type.small, color: colors.danger, flex: 1 },
  apiHint: { ...type.meta, color: colors.fgMuted, textAlign: 'center' },
});
