import Feather from '@expo/vector-icons/Feather';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Eyebrow } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { ApiError } from '@/lib/api';
import { resolveScanCode, unsupportedMessage } from '@/lib/scan';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Scan a client's gift-card QR.
 *
 * This is the one surface where the phone beats the desktop outright:
 * apps/web's own `/scan` renders "Camera unavailable — this device or
 * browser doesn't support camera scanning" on a laptop. The flow is
 * otherwise web's, step for step — resolve the code, open the gift card,
 * and decline recognised-but-unsupported codes in web's exact words.
 *
 * expo-camera rather than vision-camera: it ships inside Expo Go for
 * SDK 54, so this runs on the owner's phone today. vision-camera would
 * need a custom dev client, which this project has no Apple account for
 * (see apps/mobile/README.md).
 */
export default function ScanScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A camera fires onBarcodeScanned continuously while the code is in
  // frame. Without this latch the same card resolves dozens of times and
  // pushes a screen per frame.
  const busyRef = useRef(false);

  const resolve = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!token || !code || busyRef.current) return;
      busyRef.current = true;
      setResolving(true);
      setError(null);
      try {
        const result = await resolveScanCode(token, code);
        if (result.recordType === 'giftCard' && result.giftCardId) {
          router.push({ pathname: '/gift-card/[id]', params: { id: result.giftCardId } });
          return;
        }
        setError(
          result.supported === false ? unsupportedMessage(result.recordType) : 'Code not found.',
        );
      } catch (err) {
        setError(
          err instanceof ApiError && err.status === 404
            ? 'Code not found.'
            : 'Something went wrong resolving that code.',
        );
      } finally {
        busyRef.current = false;
        setResolving(false);
      }
    },
    [token, router],
  );

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      void resolve(result.data);
    },
    [resolve],
  );

  const granted = permission?.granted ?? false;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title="Scan" onBack={() => router.back()} />

      <View style={styles.body}>
        <Text style={styles.lede}>Scan a client&apos;s gift card QR, or type the code below.</Text>

        <View style={styles.viewfinder}>
          {granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              // QR only: every code this app prints is a QR, and listening
              // for more formats means more frames rejected, not more
              // codes found.
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={resolving ? undefined : onBarcodeScanned}
            />
          ) : (
            <View style={styles.permission}>
              <Feather name="camera-off" size={22} color={colors.fgMuted} />
              <Text style={styles.permissionText}>
                {permission && !permission.canAskAgain
                  ? 'Camera access is off. Turn it on in Settings to scan, or type the code below.'
                  : 'Allow camera access to scan a code.'}
              </Text>
              {permission?.canAskAgain !== false ? (
                <Pressable
                  onPress={requestPermission}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.allow, pressed && styles.pressed]}
                >
                  <Text style={styles.allowLabel}>ALLOW CAMERA</Text>
                </Pressable>
              ) : null}
            </View>
          )}

          {granted ? <View style={styles.reticle} pointerEvents="none" /> : null}
        </View>

        <Eyebrow style={styles.eyebrow}>Enter code manually</Eyebrow>
        <View style={styles.manualRow}>
          <TextInput
            style={styles.input}
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="Code printed under the QR"
            placeholderTextColor={colors.fgMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={() => resolve(manualCode)}
            accessibilityLabel="Gift card code"
          />
          <Pressable
            onPress={() => resolve(manualCode)}
            disabled={!manualCode.trim() || resolving}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.go,
              (!manualCode.trim() || resolving) && styles.goDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.goLabel}>{resolving ? '…' : 'GO'}</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={styles.error}>
            <Feather name="alert-circle" size={14} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: space.lg, gap: space.md },
  lede: { ...type.body, color: colors.fgSecondary },

  viewfinder: {
    aspectRatio: 1,
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: colors.surfaceInset,
    borderWidth: hairline,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A frame to aim with, rather than a full-bleed camera with no target.
  reticle: {
    position: 'absolute',
    width: '62%',
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: radius.card,
    opacity: 0.9,
  },
  permission: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.xl },
  permissionText: { ...type.small, color: colors.fgMuted, textAlign: 'center' },
  allow: {
    marginTop: space.sm,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  allowLabel: { ...type.button, color: colors.accent },

  eyebrow: { color: colors.accent, marginTop: space.sm },
  manualRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 44,
    backgroundColor: colors.inputBg,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    color: colors.fg,
    ...type.body,
    fontSize: 16,
    paddingHorizontal: space.md,
  },
  go: {
    minWidth: 60,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accentButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goDisabled: { backgroundColor: colors.surface },
  goLabel: { ...type.button, color: colors.accentFg },

  error: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  errorText: { ...type.small, color: colors.danger, flex: 1 },
  pressed: { opacity: 0.6 },
});
