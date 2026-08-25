import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Eyebrow } from '@/components/ui';
import { MailPlusIcon, PhonePlusIcon } from '@/components/icons';
import { colors, hairline, radius, space, tones, type } from '@/theme';

type Mode = 'choose' | 'phone' | 'email';

/**
 * "Add contact info" — the sheet behind the Contact Info card's `+`.
 *
 * THE SHEET IS NOT NEW. It is the same bottom sheet this app already uses
 * for message actions, the channel picker and attach: a transparent
 * `Modal` that slides up, a dimmed backdrop that closes on tap, a
 * `surfaceRaised` panel with rounded top corners, an accent eyebrow, then
 * icon-and-label rows and a DONE.
 *
 * THE GLYPHS MOVED HERE in session T3. Session T2 drew the handset-plus
 * and envelope-plus for the per-group add buttons; folding those buttons
 * into one header action would have orphaned them, so they became this
 * sheet's row icons.
 *
 * SESSION AA MADE IT REAL. It used to open, offer two choices, and say
 * where the write lived. It now takes the value and writes it: pick a
 * kind, type the number or address and an optional label, save. Web's
 * own form is the same two fields — `PhoneInput` plus a free-text
 * "Label (optional, e.g. Mobile)".
 */
export function ContactAddSheet({
  visible,
  onClose,
  onAddPhone,
  onAddEmail,
}: {
  visible: boolean;
  onClose: () => void;
  onAddPhone: (phone: string, label: string | null) => void;
  onAddEmail: (email: string, label: string | null) => void;
}) {
  const [mode, setMode] = useState<Mode>('choose');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode('choose');
    setValue('');
    setLabel('');
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(mode === 'phone' ? 'Enter a phone number.' : 'Enter an email address.');
      return;
    }
    // Web's own bar, no lower: its `isValidPhoneDigits` wants ten digits,
    // and its email field is a browser `type="email"`. Anything stricter
    // here would refuse numbers the portal accepts.
    if (mode === 'phone' && trimmed.replace(/\D/g, '').length < 10) {
      setError('That does not look like a complete phone number.');
      return;
    }
    if (mode === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setError('That does not look like an email address.');
      return;
    }
    const trimmedLabel = label.trim() || null;
    if (mode === 'phone') onAddPhone(trimmed, trimmedLabel);
    else onAddEmail(trimmed, trimmedLabel);
    reset();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Eyebrow style={styles.eyebrow}>
            {mode === 'choose' ? 'Add contact info' : mode === 'phone' ? 'Add phone' : 'Add email'}
          </Eyebrow>

          {mode === 'choose' ? (
            <>
              <Pressable
                onPress={() => setMode('phone')}
                accessibilityRole="button"
                accessibilityLabel="Add phone"
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <PhonePlusIcon size={16} color={colors.fgSecondary} />
                <Text style={styles.actionLabel}>Add phone</Text>
              </Pressable>

              <Pressable
                onPress={() => setMode('email')}
                accessibilityRole="button"
                accessibilityLabel="Add email"
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <MailPlusIcon size={16} color={colors.fgSecondary} />
                <Text style={styles.actionLabel}>Add email</Text>
              </Pressable>
            </>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={(next) => {
                  setValue(next);
                  setError(null);
                }}
                placeholder={mode === 'phone' ? '(305) 299-7957' : 'name@example.com'}
                placeholderTextColor={colors.fgMuted}
                accessibilityLabel={mode === 'phone' ? 'Phone number' : 'Email address'}
                keyboardType={mode === 'phone' ? 'phone-pad' : 'email-address'}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
              <TextInput
                style={styles.input}
                value={label}
                onChangeText={setLabel}
                placeholder="Label (optional, e.g. Mobile)"
                placeholderTextColor={colors.fgMuted}
                accessibilityLabel="Label"
                autoCapitalize="words"
              />
              {error ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {error}
                </Text>
              ) : null}

              <View style={styles.buttons}>
                <Pressable
                  onPress={submit}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.save, pressed && styles.pressed]}
                >
                  <Text style={styles.saveLabel}>SAVE</Text>
                </Pressable>
                <Pressable
                  onPress={reset}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.back, pressed && styles.pressed]}
                >
                  <Text style={styles.backLabel}>BACK</Text>
                </Pressable>
              </View>
            </>
          )}

          <Pressable onPress={close} style={styles.done}>
            <Text style={styles.doneLabel}>DONE</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderTopWidth: hairline,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
  },
  eyebrow: { marginBottom: space.sm },

  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  actionLabel: { ...type.body, color: colors.fg },

  input: {
    minHeight: 44,
    marginTop: space.sm,
    backgroundColor: colors.inputBg,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: space.md,
    color: colors.fg,
    ...type.body,
  },
  error: { ...type.small, color: tones.danger, marginTop: space.sm },

  buttons: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  save: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  saveLabel: { ...type.button, color: colors.accentFg },
  back: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  backLabel: { ...type.button, color: colors.fgSecondary },

  done: { marginTop: space.md, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.accent },
  pressed: { opacity: 0.6 },
});
