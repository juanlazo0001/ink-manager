import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  KeyboardStickyView,
  useKeyboardHandler,
} from 'react-native-keyboard-controller';
import { useSharedValue } from 'react-native-reanimated';

import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenShell } from '@/components/ScreenShell';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * TASK B smoke test — `react-native-keyboard-controller` in OUR Expo Go
 * binary, not in principle.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────
 *
 * Spec §4 makes interactive keyboard dismissal a Part 2 *acceptance
 * requirement*, and it depends entirely on this library behaving inside
 * the App Store build of Expo Go. That is not a question a typecheck or a
 * bundler can answer — it is a native-module question, and the only
 * honest test is a screen on a real phone. This is the smallest such
 * screen: thirty rows, one input, nothing from the chat surface.
 *
 * ─── DEV-ONLY, AND UNREACHABLE OTHERWISE ────────────────────────────
 *
 * expo-router registers every file under `src/app` as a route, so the
 * route exists in any build. The gate is here, at the top of the
 * component: outside `__DEV__` it renders a dead end rather than the
 * harness. No drawer item, no tab, no link — reachable only by typing the
 * path, which is what "least invasive" means for a router that has no
 * concept of a conditional route file.
 *
 * DELETE THIS FILE when Part 2 lands. It has no other purpose.
 *
 * ─── WHAT TO JUDGE ON THE DEVICE ────────────────────────────────────
 *
 *   a. the input rides the keyboard with zero lag on open and close;
 *   b. dragging the list down past the keyboard's top edge moves the
 *      keyboard WITH the finger, and releasing mid-way either completes
 *      or cancels — that is `keyboardDismissMode="interactive"` plus this
 *      library's per-frame height, and it is the half a
 *      `KeyboardAvoidingView` fallback cannot do.
 */
const ROWS = Array.from({ length: 30 }, (_, i) => ({
  id: String(i + 1),
  label: `Row ${i + 1}`,
}));

export default function DevKeyboardSmokeScreen() {
  const router = useRouter();
  const [value, setValue] = useState('');

  /*
   * The per-frame height, read the way spec §4 intends it to be read.
   *
   * `useKeyboardHandler` runs on the UI thread, so this shared value is
   * current for the frame being drawn rather than one React commit behind
   * — which is the whole difference between "rides the keyboard" and
   * "chases it". Reported on screen below so the device gate can see
   * whether the number is actually moving.
   */
  const height = useSharedValue(0);
  const [reported, setReported] = useState(0);

  useKeyboardHandler(
    {
      onMove: (event) => {
        'worklet';
        height.value = event.height;
      },
      onEnd: (event) => {
        'worklet';
        height.value = event.height;
      },
    },
    [],
  );

  if (!__DEV__) {
    return (
      <ScreenShell>
        <ScreenHeader title="Not available" onBack={() => router.back()} right={<View style={styles.spacer} />} />
        <View style={styles.centre}>
          <Text style={styles.note}>This screen exists only in development builds.</Text>
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScreenHeader
        title="Keyboard smoke"
        subtitle="Task B"
        onBack={() => router.back()}
        right={<View style={styles.spacer} />}
      />

      <FlatList
        data={ROWS}
        keyExtractor={(row) => row.id}
        // (b) — the half that matters. Dragging the list toward the
        // keyboard drags the keyboard with it.
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{item.label}</Text>
          </View>
        )}
      />

      {/*
        (a) — `KeyboardStickyView` is the library's own per-frame offset
        applied to a container. Deliberately used instead of hand-rolling
        an animated style off `height` above: if the sticky view lags, the
        library is not working in this binary, and that is exactly what
        this screen is for.
      */}
      <KeyboardStickyView>
        <View style={styles.bar}>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder="Type — this bar should ride the keyboard"
            placeholderTextColor={colors.fgMuted}
            onFocus={() => setReported((n) => n + 1)}
          />
        </View>
      </KeyboardStickyView>

      <Text style={styles.debug}>focus events: {reported}</Text>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  spacer: { width: 44 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  note: { ...type.small, color: colors.fgMuted, textAlign: 'center' },

  list: { paddingBottom: space.xxl },
  row: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  rowLabel: { ...type.body, color: colors.fg },

  bar: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    minHeight: 40,
    backgroundColor: colors.inputBg,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    color: colors.fg,
    ...type.body,
    fontSize: 16,
  },
  debug: {
    ...type.meta,
    color: colors.fgFaint,
    textAlign: 'center',
    paddingVertical: 2,
  },
});
