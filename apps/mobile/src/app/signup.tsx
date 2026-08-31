import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
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

import { GoldGradientButton } from '@/components/GoldGradientButton';
import { LoginBackdrop } from '@/components/LoginBackdrop';
import { AuthCardSurface } from '@/components/AuthCardSurface';
import { ScreenShell } from '@/components/ScreenShell';
import {
  emptySignupDraft,
  MIN_PASSWORD_LENGTH,
  resendVerification,
  signUp,
  signupErrorMessage,
  validateSignup,
  type Persona,
  type SignupDraft,
} from '@/lib/signup';
import { colors, hairline, login as loginTokens, radius, space, type } from '@/theme';

const WORDMARK = require('../../assets/login/wordmark.png');
const COMPACT_HEIGHT = 700;

/**
 * Public self-serve signup — web's flow, on a phone.
 *
 * ─── THREE STEPS, BECAUSE WEB HAS THREE ─────────────────────────────
 *
 * persona -> details -> check-email. Web's `Signup.tsx` uses exactly
 * these, with the same copy, and this mirrors it rather than collapsing
 * them into one long form: the persona choice changes which fields the
 * next step shows, and asking it first is what lets a solo artist skip
 * the studio-name question entirely.
 *
 * ─── CHECK-EMAIL IS THE END, NOT A WAYPOINT ─────────────────────────
 *
 * Signup does not log anyone in. The 201 carries no token and login is
 * refused until the address is verified, so there is nothing to store and
 * nowhere to land. Web ends here too, with a resend and a way back to
 * sign-in, and so does this.
 *
 * ─── NO TERMS CHECKBOX ──────────────────────────────────────────────
 *
 * Web asks for no terms or privacy acceptance, sends none and records
 * none. Owner-confirmed decision to mirror that rather than invent a
 * consent nothing persists. See lib/signup.ts.
 */
type Step = 'persona' | 'details' | 'check-email';

const PERSONAS: { value: Persona; title: string; blurb: string }[] = [
  {
    value: 'STUDIO',
    title: 'I run a studio',
    blurb: 'Multiple artists, one shared calendar and client list.',
  },
  {
    value: 'SOLO',
    title: "I'm an independent artist",
    /* Web's own text, double hyphen and all. Rendering an em dash here
       instead would be better typography and a difference between the
       two clients -- flagged for a copy pass on BOTH rather than fixed
       on one. */
    blurb: 'Just you -- your own bookings, clients, and profile.',
  },
];

export default function SignupScreen() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const compact = height < COMPACT_HEIGHT;

  const [step, setStep] = useState<Step>('persona');
  const [draft, setDraft] = useState<SignupDraft>(emptySignupDraft);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent'>('idle');
  /* React state is not a submit guard -- it reads stale within a tick, so
     two taps both pass `!submitting`. Established in session AR-3 on the
     estimate send; the same shape applies to anything that creates. */
  const inFlight = useRef(false);

  const set = (patch: Partial<SignupDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function choosePersona(persona: Persona) {
    setError(null);
    set({ persona });
    setStep('details');
  }

  async function onSubmit() {
    const problem = validateSignup(draft);
    if (problem) {
      setError(problem);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setSubmitting(true);
    try {
      await signUp(draft);
      setStep('check-email');
    } catch (err) {
      setError(signupErrorMessage(err));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (resend === 'sending') return;
    setResend('sending');
    try {
      await resendVerification(draft.email);
      setResend('sent');
    } catch {
      /* Web shows no error here either: the route is deliberately quiet
         about whether the address matched anything, and a failure to
         resend is not something the person can act on differently. */
      setResend('sent');
    }
  }

  const field = (
    key: keyof SignupDraft,
    placeholder: string,
    extra: Partial<React.ComponentProps<typeof TextInput>> = {},
    /* Web gives the LAST field before the button `mb-6` where the others
       get `mb-3`. Measured: web's field pitch is 58px, mine was 63. */
    last = false,
  ) => (
    <TextInput
      style={[styles.input, last && styles.inputLast, focused === key && styles.inputFocused]}
      value={draft[key] as string}
      onChangeText={(v) => set({ [key]: v } as Partial<SignupDraft>)}
      onFocus={() => setFocused(key)}
      onBlur={() => setFocused(null)}
      placeholder={placeholder}
      placeholderTextColor={colors.fgMuted}
      accessibilityLabel={placeholder}
      {...extra}
    />
  );

  return (
    <View style={styles.root}>
      <LoginBackdrop />
      {/* Transparent shell, same as login: styles.root is already the
          opaque floor, and an opaque shell here would paint over the
          photograph (the bug session CUX-23 fixed on login). */}
      <ScreenShell>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={[styles.content, compact && styles.contentCompact]}
            keyboardShouldPersistTaps="handled"
          >
            <AuthCardSurface>
              {/* INSIDE the card, as the first child -- web's
                  Signup.tsx renders the logo as the first child of
                  .login-panel-surface, and mobile's own login screen
                  already does the same. This screen had it floating
                  above the card, which is what made the two look
                  unrelated. */}
              <Image
                source={WORDMARK}
                contentFit="contain"
                style={[styles.wordmark, compact && styles.wordmarkCompact]}
                accessibilityLabel="Ink Manager"
              />
              {step === 'persona' ? (
                <>
                  <Text style={styles.prompt}>How will you be using Ink Manager?</Text>
                  {PERSONAS.map((p) => (
                    <Pressable
                      key={p.value}
                      onPress={() => choosePersona(p.value)}
                      accessibilityRole="button"
                      accessibilityLabel={p.title}
                      style={({ pressed }) => [styles.persona, pressed && styles.personaPressed]}
                    >
                      <Text style={styles.personaTitle}>{p.title.toUpperCase()}</Text>
                      <Text style={styles.personaBlurb}>{p.blurb}</Text>
                    </Pressable>
                  ))}

                  {/* Web ends the persona step with this exact link. It
                      is the counterpart to login's CREATE AN ACCOUNT --
                      without it the two screens are a one-way door. */}
                  <Pressable
                    onPress={() => router.replace('/login')}
                    accessibilityRole="link"
                    hitSlop={8}
                    style={({ pressed }) => [styles.quiet, pressed && styles.quietPressed]}
                  >
                    <Text style={styles.quietLabel}>ALREADY HAVE AN ACCOUNT? SIGN IN</Text>
                  </Pressable>
                </>
              ) : null}

              {step === 'details' ? (
                <>
                  {draft.persona === 'STUDIO'
                    ? field('studioName', 'Studio name', { autoCapitalize: 'words' })
                    : null}
                  {field('ownerName', 'Your name', { autoCapitalize: 'words' })}
                  {field('email', 'Email', {
                    autoCapitalize: 'none',
                    autoCorrect: false,
                    keyboardType: 'email-address',
                  })}
                  {field('password', `Password (min ${MIN_PASSWORD_LENGTH} characters)`, {
                    secureTextEntry: true,
                    autoCapitalize: 'none',
                  })}
                  {field('phone', 'Phone (optional)', { keyboardType: 'phone-pad' }, true)}

                  {error ? (
                    <View style={styles.errorRow}>
                      <View style={styles.errorRule} />
                      <Text style={styles.error} accessibilityRole="alert">
                        {error}
                      </Text>
                    </View>
                  ) : null}

                  <GoldGradientButton
                    label={
                      submitting
                        ? 'Creating account…'
                        : draft.persona === 'STUDIO'
                          ? 'Create studio account'
                          : 'Create my account'
                    }
                    onPress={() => void onSubmit()}
                    busy={submitting}
                    style={styles.button}
                  />

                  <Pressable
                    onPress={() => {
                      setError(null);
                      setStep('persona');
                    }}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={({ pressed }) => [styles.quiet, pressed && styles.quietPressed]}
                  >
                    <Text style={styles.quietLabel}>BACK</Text>
                  </Pressable>
                </>
              ) : null}

              {step === 'check-email' ? (
                <>
                  <Text style={styles.prompt}>
                    Check your email at <Text style={styles.strong}>{draft.email.trim()}</Text> to
                    verify your account.
                  </Text>
                  <Pressable
                    onPress={() => void onResend()}
                    disabled={resend === 'sending'}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={({ pressed }) => [styles.quiet, pressed && styles.quietPressed]}
                  >
                    <Text style={styles.resendLabel}>
                      {resend === 'sent' ? 'EMAIL SENT' : resend === 'sending' ? 'SENDING…' : 'RESEND EMAIL'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.replace('/login')}
                    accessibilityRole="link"
                    hitSlop={8}
                    style={({ pressed }) => [styles.quiet, pressed && styles.quietPressed]}
                  >
                    <Text style={styles.quietLabel}>BACK TO SIGN IN</Text>
                  </Pressable>
                </>
              ) : null}
            </AuthCardSurface>
          </ScrollView>
        </KeyboardAvoidingView>
      </ScreenShell>
    </View>
  );
}

const styles = StyleSheet.create({
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
  wordmark: { width: '100%', height: 96, marginBottom: space.sm },
  wordmarkCompact: { width: '100%', height: 72, marginBottom: space.xs },
  prompt: { ...type.body, color: colors.fg, marginBottom: space.lg, textAlign: 'center' },
  strong: { color: colors.accent },

  persona: {
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    borderRadius: 5,
    padding: space.md,
    marginBottom: space.md,
  },
  personaPressed: { borderColor: colors.accent },
  personaTitle: { ...type.label, fontSize: 13, letterSpacing: 1.2, color: colors.fg, marginBottom: space.xs },
  personaBlurb: { ...type.small, color: colors.fgMuted },

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
    marginBottom: space.md,
  },
  inputLast: { marginBottom: space.xl },
  inputFocused: { borderColor: colors.accent },

  errorRow: { flexDirection: 'row', gap: space.md, alignItems: 'stretch', marginBottom: space.lg },
  errorRule: { width: 2, backgroundColor: colors.dangerStrong, borderRadius: 1 },
  error: { ...type.small, color: colors.danger, flex: 1 },

  button: { marginTop: space.xs },
  quiet: { marginTop: space.lg, alignSelf: 'center' },
  quietPressed: { opacity: 0.6 },
  quietLabel: { ...type.label, fontSize: 11, letterSpacing: 1.54, color: colors.fgMuted },
  resendLabel: { ...type.label, fontSize: 11, letterSpacing: 1.54, color: colors.accent },
});
