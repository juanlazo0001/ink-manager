import { usePreventRemove } from '@react-navigation/native';
import { useNavigation } from 'expo-router';
import { useCallback, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The chrome every editing screen shares: a scroll area that gets out of
 * the keyboard's way, a save bar that only appears once something has
 * actually changed, and a guard against walking away from unsaved work.
 *
 * It is one component rather than a per-screen assembly because the
 * failure it prevents — losing typed work to a back swipe — is invisible
 * until it happens to someone, and it has to be impossible to forget.
 */

/**
 * Blocks leaving the screen while `dirty`, and asks first.
 *
 * `usePreventRemove` rather than a bare `beforeRemove` listener: on a
 * native stack the swipe-back gesture is driven natively, and only this
 * hook tells the native side to hold the screen. A listener alone would
 * catch the header button and Android's back button, then let an iOS
 * swipe throw the work away — the exact case a guard exists for.
 *
 * The alert is deliberately three-way. "Keep editing" is the default (and
 * the cancel role, so an errant tap outside is safe); discarding is
 * destructive and labelled as such.
 */
export function useUnsavedChangesGuard(dirty: boolean, options?: { onDiscard?: () => void }) {
  const navigation = useNavigation();
  // Set the instant the person confirms, so the re-dispatched navigation
  // is not caught by the guard it just cleared.
  const leaving = useRef(false);
  const onDiscard = options?.onDiscard;

  usePreventRemove(dirty && !leaving.current, ({ data }) => {
    Alert.alert(
      'Discard changes?',
      "You've made changes that haven't been saved. Leaving now loses them.",
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            leaving.current = true;
            onDiscard?.();
            navigation.dispatch(data.action);
          },
        },
      ],
      { cancelable: true },
    );
  });

  /**
   * For a save that ends in navigation: clears the guard for the trip so
   * a just-saved screen does not ask about the changes it just persisted.
   */
  const allowLeave = useCallback(() => {
    leaving.current = true;
  }, []);

  return { allowLeave };
}

export function FormScreen({
  children,
  dirty,
  saving,
  error,
  onSave,
  onDiscard,
  saveLabel = 'Save',
  /** Shown in the bar instead of the buttons — e.g. "Saved" after a write. */
  note,
}: {
  children: ReactNode;
  dirty: boolean;
  saving?: boolean;
  /** A failed save. Stays visible until the next attempt. */
  error?: string | null;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
  note?: string | null;
}) {
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      // Android resizes the window itself (`softwareKeyboardLayoutMode`
      // defaults to `resize` in Expo), so adding padding on top of that
      // double-counts the keyboard and leaves a gap.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: space.xxxl + insets.bottom + (dirty ? 84 : 0) }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {children}
      </ScrollView>

      {dirty || error || note ? (
        <View style={[styles.bar, { paddingBottom: space.md + insets.bottom }]}>
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : note ? (
            <Text style={styles.note}>{note}</Text>
          ) : null}

          {dirty ? (
            <View style={styles.barRow}>
              <Pressable
                onPress={onDiscard}
                disabled={saving}
                accessibilityRole="button"
                style={({ pressed }) => [styles.discard, pressed && styles.pressed, saving && styles.inactive]}
              >
                <Text style={styles.discardLabel}>DISCARD</Text>
              </Pressable>
              <Pressable
                onPress={onSave}
                disabled={saving}
                accessibilityRole="button"
                accessibilityState={{ busy: !!saving }}
                style={({ pressed }) => [styles.save, pressed && !saving && styles.savePressed, saving && styles.inactive]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.accentFg} />
                ) : (
                  <Text style={styles.saveLabel}>{saveLabel.toUpperCase()}</Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.surface,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
  },
  barRow: { flexDirection: 'row', gap: space.md },
  error: { ...type.small, color: colors.danger },
  note: { ...type.small, color: colors.fgMuted },

  discard: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.button,
  },
  discardLabel: { ...type.button, color: colors.fgSecondary },
  save: {
    flex: 2,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentButton,
    borderRadius: radius.button,
  },
  savePressed: { backgroundColor: colors.accentHover },
  saveLabel: { ...type.button, color: colors.accentFg },
  inactive: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
});
