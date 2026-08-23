import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  ensureLibraryPermission,
  pickImage,
  toAvatarDataUrl,
  uploadToCloudinary,
  type UploadPurpose,
} from '@/lib/upload';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The two image controls, over the two upload mechanisms that already
 * exist in this product (see `src/lib/upload.ts`): an avatar, which is a
 * base64 data URL on the user row, and a gallery, whose images are
 * uploaded straight to Cloudinary and stored as URLs.
 *
 * Both surface the same three things, because on a phone all three
 * happen: the library permission being refused, an upload taking real
 * seconds over cellular, and an upload failing outright.
 */

function refusedPermissionAlert() {
  Alert.alert(
    'Photo access is off',
    'Ink Manager needs access to your photos to add images. You can turn it on in Settings.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ],
  );
}

/**
 * Circular avatar with a change/remove affordance.
 *
 * `onChange` receives a `data:image/...` string — the shape
 * `PATCH /users/me` takes — or null when removed. Persisting it is the
 * screen's job, not this control's: the avatar sits inside a form whose
 * save is a single deliberate act, and a control that wrote on its own
 * would break that.
 */
export function AvatarField({
  label,
  value,
  fallbackInitials,
  onChange,
}: {
  label: string;
  value: string | null;
  fallbackInitials: string;
  onChange: (next: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = useCallback(async () => {
    setError(null);
    if (!(await ensureLibraryPermission())) {
      refusedPermissionAlert();
      return;
    }
    setBusy(true);
    try {
      const picked = await pickImage({ forAvatar: true });
      if (picked) onChange(toAvatarDataUrl(picked));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That photo could not be used.');
    } finally {
      setBusy(false);
    }
  }, [onChange]);

  return (
    <View style={styles.avatarBlock}>
      <Pressable
        onPress={() => void choose()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Change ${label}`}
        accessibilityState={{ busy }}
        style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
      >
        {busy ? (
          <ActivityIndicator color={colors.accent} />
        ) : value ? (
          <Image source={{ uri: value }} style={styles.avatarImage} contentFit="cover" />
        ) : (
          <Text style={styles.avatarInitials}>{fallbackInitials}</Text>
        )}
        <View style={styles.avatarBadge}>
          <Feather name="camera" size={12} color={colors.accentFg} />
        </View>
      </Pressable>

      <View style={styles.avatarActions}>
        <Text style={styles.avatarLabel}>{label.toUpperCase()}</Text>
        <Pressable onPress={() => void choose()} disabled={busy} hitSlop={8} accessibilityRole="button">
          <Text style={styles.link}>{value ? 'Change photo' : 'Add a photo'}</Text>
        </Pressable>
        {value ? (
          <Pressable onPress={() => onChange(null)} disabled={busy} hitSlop={8} accessibilityRole="button">
            <Text style={styles.linkQuiet}>Remove</Text>
          </Pressable>
        ) : null}
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A gallery of Cloudinary-hosted images: reorderable only by removal, as
 * on web, with an add tile that picks, uploads, and appends the resulting
 * `secure_url`.
 *
 * The upload is done here rather than deferred to save, because that is
 * how web does it and because deferring would mean holding several
 * multi-megabyte files in memory until someone taps Save. What the form
 * saves is the list of URLs.
 */
export function ImageGridField({
  label,
  hideLabel,
  hint,
  token,
  purpose,
  urls,
  onChange,
  max,
}: {
  label: string;
  /** Visible label only; the add button keeps its accessibility label. */
  hideLabel?: boolean;
  hint?: string;
  token: string;
  purpose: UploadPurpose;
  urls: string[];
  onChange: (next: string[]) => void;
  max?: number;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = max != null && urls.length >= max;

  const add = useCallback(async () => {
    setError(null);
    if (!(await ensureLibraryPermission())) {
      refusedPermissionAlert();
      return;
    }
    const picked = await pickImage();
    if (!picked) return;
    setUploading(true);
    try {
      const url = await uploadToCloudinary(token, purpose, picked);
      onChange([...urls, url]);
    } catch (err) {
      // Named as an upload failure, not a save failure: nothing about the
      // rest of the form was touched, and the retry is just tapping again.
      setError(err instanceof Error ? err.message : "That image didn't upload. Try again.");
    } finally {
      setUploading(false);
    }
  }, [onChange, purpose, token, urls]);

  return (
    <View style={styles.gridBlock}>
      {hideLabel ? null : <Text style={styles.avatarLabel}>{label.toUpperCase()}</Text>}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <View style={styles.grid}>
        {urls.map((url, index) => (
          <View key={`${url}-${index}`} style={styles.tile}>
            <Image source={{ uri: url }} style={styles.tileImage} contentFit="cover" transition={120} />
            {/* A sibling of the image, not a child of a pressable tile:
                nesting pressables makes the touch target ambiguous. */}
            <Pressable
              onPress={() => onChange(urls.filter((_, i) => i !== index))}
              accessibilityRole="button"
              accessibilityLabel={`Remove image ${index + 1}`}
              hitSlop={6}
              style={({ pressed }) => [styles.tileRemove, pressed && styles.pressed]}
            >
              <Feather name="x" size={13} color={colors.fg} />
            </Pressable>
          </View>
        ))}

        {full ? null : (
          <Pressable
            onPress={() => void add()}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel={`Add to ${label}`}
            accessibilityState={{ busy: uploading }}
            style={({ pressed }) => [styles.tile, styles.addTile, pressed && styles.pressed]}
          >
            {uploading ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <>
                <Feather name="plus" size={20} color={colors.accent} />
                <Text style={styles.addLabel}>ADD</Text>
              </>
            )}
          </Pressable>
        )}
      </View>

      {uploading ? <Text style={styles.hint}>Uploading…</Text> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {/* Only worth saying when there is a count to reach. For a
          single-image field the add tile simply disappearing already says
          it, and the sentence reads like a scolding. */}
      {full && (max ?? 0) > 1 ? <Text style={styles.hint}>{`That's the maximum of ${max}.`}</Text> : null}
    </View>
  );
}

const TILE = 96;

const styles = StyleSheet.create({
  avatarBlock: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.md },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  avatarImage: { width: 82, height: 82, borderRadius: radius.pill },
  avatarInitials: { ...type.display, color: colors.accent },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.accentButton,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  avatarActions: { flex: 1, gap: space.xs },
  avatarLabel: { ...type.label, color: colors.fgMuted },
  link: { ...type.small, color: colors.accent },
  linkQuiet: { ...type.small, color: colors.fgMuted },

  gridBlock: { gap: space.sm, paddingVertical: space.md },
  hint: { ...type.meta, color: colors.fgMuted },
  error: { ...type.meta, color: colors.danger },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceInset,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  tileImage: { width: '100%', height: '100%', borderRadius: radius.card },
  tileRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(14, 11, 8, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: { alignItems: 'center', justifyContent: 'center', gap: space.xs, borderStyle: 'dashed' },
  addLabel: { ...type.label, color: colors.accent },

  pressed: { opacity: 0.6 },
});
