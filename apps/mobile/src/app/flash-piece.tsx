import { FlashPieceStatus, type FlashPiece } from '@ink-manager/shared-types';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SwitchField, TextField } from '@/components/form/Fields';
import { FormScreen, useUnsavedChangesGuard } from '@/components/form/FormScreen';
import { ImageGridField } from '@/components/form/ImageFields';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Chip, Eyebrow, ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { ApiError } from '@/lib/api';
import { createFlashPiece, fetchFlashPieces, retireFlashPiece, updateFlashPiece } from '@/lib/flash';
import {
  canRetire,
  formatDuration,
  formatPrice,
  hoursToMinutes,
  minutesToHours,
  STATUS_LABELS,
  STATUS_TONES,
} from '@/lib/flashDisplay';
import { screenErrorMessage } from '@/lib/screenError';
import { rules, useForm } from '@/lib/useForm';
import { colors, hairline, radius, space, tones, type } from '@/theme';

/**
 * One flash piece: created, edited, or retired.
 *
 * The same screen for both because they are the same fields — web uses
 * one form for both too. What differs is what exists around it: a new
 * piece has no status and no retire action, an existing one has both.
 *
 * There is deliberately no delete. `POST /:id/retire` is the only exit
 * the API offers, it is one-way, and it works only from AVAILABLE. A
 * piece with a live request or a finished booking is history a studio may
 * need, so nothing here pretends otherwise.
 */

interface PieceForm extends Record<string, unknown> {
  imageUrl: string;
  title: string;
  description: string;
  priceDollars: string;
  durationHours: string;
  isOneOfOne: boolean;
}

const EMPTY: PieceForm = {
  imageUrl: '',
  title: '',
  description: '',
  priceDollars: '',
  durationHours: '',
  isOneOfOne: false,
};

/**
 * Mirrors the API's own rules rather than guessing at them: price and
 * duration must both be present and strictly positive (it rejects zero),
 * and an image and title are required to create a piece at all.
 */
function validate(values: PieceForm) {
  const errors: Partial<Record<keyof PieceForm, string>> = {};

  if (!values.imageUrl) errors.imageUrl = 'A flash piece needs an image.';
  if (!values.title.trim()) errors.title = 'Give this piece a title.';

  const price = rules.money(values.priceDollars, 'Price');
  if (price) errors.priceDollars = price;
  else if (!values.priceDollars.trim()) errors.priceDollars = 'Set a price.';
  else if (Number(values.priceDollars) <= 0) errors.priceDollars = 'Price has to be more than zero.';

  const hours = Number(values.durationHours);
  if (!values.durationHours.trim()) errors.durationHours = 'Estimate how long it takes.';
  else if (Number.isNaN(hours)) errors.durationHours = 'Session length must be a number.';
  else if (hours <= 0) errors.durationHours = 'Session length has to be more than zero.';

  return errors;
}

export default function FlashPieceScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const isNew = !id;

  const form = useForm<PieceForm>(EMPTY, validate);
  const [piece, setPiece] = useState<FlashPiece | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [retiring, setRetiring] = useState(false);

  const { allowLeave } = useUnsavedChangesGuard(form.dirty);

  /**
   * There is no `GET /flash-pieces/:id` — the list route is the only read
   * path. Fetching the list and picking the row is therefore not laziness
   * but the only option; it also means the caller's own scoping is
   * applied by the server, so a piece that isn't theirs simply isn't
   * there.
   */
  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const all = await fetchFlashPieces(token);
      const found = all.find((p) => p.id === id) ?? null;
      if (!found) {
        setLoadError("That piece isn't in your gallery any more.");
      } else {
        setPiece(found);
        setLoadError(null);
        form.reset({
          imageUrl: found.imageUrl,
          title: found.title,
          description: found.description ?? '',
          priceDollars: String(found.priceCents / 100),
          durationHours: minutesToHours(found.estimatedDurationMinutes),
          isOneOfOne: found.isOneOfOne,
        });
      }
    } catch (err) {
      setLoadError(screenErrorMessage(err, 'this flash piece'));
    } finally {
      setLoading(false);
    }
    // `form` is intentionally excluded: its identity changes every render
    // and including it would refetch the gallery on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (!token) return;
    if (!form.validate()) {
      form.setFormError('Fix the highlighted fields, then save again.');
      return;
    }

    const minutes = hoursToMinutes(form.values.durationHours);
    if (minutes === null) return;

    // Whole-document on both paths. PATCH is partial on the API, but
    // sending everything makes an edit behave like the form looks: what
    // is on screen is what the piece becomes.
    const body = {
      imageUrl: form.values.imageUrl,
      title: form.values.title.trim(),
      description: form.values.description.trim() || null,
      priceCents: Math.round(Number(form.values.priceDollars) * 100),
      estimatedDurationMinutes: minutes,
      isOneOfOne: form.values.isOneOfOne,
    };

    setSaving(true);
    setNote(null);
    try {
      if (isNew) {
        await createFlashPiece(token, body);
        // A new piece has an id and a status the form can't show yet, and
        // the gallery is where both belong. Leaving is the save's result.
        allowLeave();
        router.back();
      } else {
        const updated = await updateFlashPiece(token, id!, body);
        setPiece(updated);
        form.commit(form.values);
        setNote('Saved.');
      }
    } catch (err) {
      form.setFormError(err instanceof ApiError ? err.message : screenErrorMessage(err, 'this piece'));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Confirmed, unlike web's, which retires on a single tap. Retiring is
   * one-way — there is no un-retire route — and on a phone the button
   * sits under a thumb next to Edit. A dialog is cheap; an accidentally
   * retired piece cannot be undone from this app at all.
   */
  function confirmRetire() {
    if (!piece) return;
    Alert.alert(
      `Retire "${piece.title}"?`,
      "It comes off your public gallery and can't be brought back from here. Nothing already booked is affected.",
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Retire', style: 'destructive', onPress: () => void handleRetire() },
      ],
    );
  }

  async function handleRetire() {
    if (!token || !piece) return;
    setRetiring(true);
    try {
      const updated = await retireFlashPiece(token, piece.id);
      setPiece(updated);
      setNote('Retired.');
    } catch (err) {
      // The API's own message names the state that blocked it ("Can't
      // retire a piece that's currently BOOKED"), which is exactly what
      // someone whose gallery moved under them needs to read.
      form.setFormError(err instanceof ApiError ? err.message : screenErrorMessage(err, 'this piece'));
    } finally {
      setRetiring(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Flash piece" onBack={() => router.back()} right={<View />} />
        <ScreenLoading />
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Flash piece" onBack={() => router.back()} right={<View />} />
        <StateMessage
          eyebrow="Not available"
          tone="alert"
          title="This piece didn't load"
          body={loadError}
          action={{ label: 'Back to gallery', onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader
        title={isNew ? 'New flash piece' : 'Edit piece'}
        subtitle={piece ? formatPrice(piece.priceCents) + ' · ' + formatDuration(piece.estimatedDurationMinutes) : undefined}
        onBack={() => router.back()}
        right={<View style={styles.headerSpacer} />}
      />

      <FormScreen
        dirty={form.dirty}
        saving={saving}
        error={form.formError}
        note={note}
        onSave={() => void handleSave()}
        onDiscard={() => {
          setNote(null);
          form.reset();
        }}
        saveLabel={isNew ? 'Create piece' : 'Save changes'}
      >
        {piece ? (
          <View style={styles.statusRow}>
            <Chip label={STATUS_LABELS[piece.status]} color={tones[STATUS_TONES[piece.status]]} />
            {piece.status === FlashPieceStatus.PENDING_APPROVAL ? (
              <Text style={styles.statusNote}>Someone has requested this piece and is waiting on a decision.</Text>
            ) : piece.status === FlashPieceStatus.BOOKED ? (
              <Text style={styles.statusNote}>This piece is booked.</Text>
            ) : null}
          </View>
        ) : null}

        <ImageGridField
          label="Image"
          hint="One image per piece. Uploads go straight to Cloudinary."
          token={token ?? ''}
          purpose="flash"
          urls={form.values.imageUrl ? [form.values.imageUrl] : []}
          onChange={(next) => form.setField('imageUrl', next[0] ?? '')}
          max={1}
        />
        {form.errors.imageUrl ? (
          <Text style={styles.error} accessibilityRole="alert">
            {form.errors.imageUrl}
          </Text>
        ) : null}

        <TextField
          label="Title"
          value={form.values.title}
          onChange={(v) => form.setField('title', v)}
          error={form.errors.title}
          placeholder="Snake and peony"
          autoCapitalize="sentences"
        />
        <TextField
          label="Description"
          value={form.values.description}
          onChange={(v) => form.setField('description', v)}
          hint="Optional. Shown to clients on your public gallery."
          multiline
        />
        <TextField
          label="Price"
          value={form.values.priceDollars}
          onChange={(v) => form.setField('priceDollars', v)}
          error={form.errors.priceDollars}
          keyboardType="decimal-pad"
          prefix="$"
          placeholder="0.00"
        />
        <TextField
          label="Session length (hours)"
          value={form.values.durationHours}
          onChange={(v) => form.setField('durationHours', v)}
          error={form.errors.durationHours}
          keyboardType="decimal-pad"
          placeholder="2"
          hint={
            hoursToMinutes(form.values.durationHours)
              ? `Saved as ${formatDuration(hoursToMinutes(form.values.durationHours)!)}.`
              : undefined
          }
        />
        <SwitchField
          label="One of one"
          description="Tattooed once and then retired. Leave off for a piece you'll repeat."
          value={form.values.isOneOfOne}
          onChange={(v) => form.setField('isOneOfOne', v)}
        />

        {form.values.imageUrl ? (
          <View style={styles.previewBlock}>
            <Eyebrow>Preview</Eyebrow>
            <Image source={{ uri: form.values.imageUrl }} style={styles.preview} contentFit="cover" transition={140} />
          </View>
        ) : null}

        {piece ? (
          <View style={styles.dangerBlock}>
            <Eyebrow>Retire</Eyebrow>
            {canRetire(piece) ? (
              <>
                <Text style={styles.hint}>
                  Takes it off your public gallery. One way — there's no un-retire from this app.
                </Text>
                <Pressable
                  onPress={confirmRetire}
                  disabled={retiring}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: retiring, busy: retiring }}
                  style={({ pressed }) => [styles.retire, retiring && styles.inactive, pressed && styles.pressed]}
                >
                  <Text style={styles.retireLabel}>{retiring ? 'RETIRING…' : 'RETIRE THIS PIECE'}</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.hint}>
                {piece.status === FlashPieceStatus.RETIRED
                  ? 'Already retired.'
                  : `A piece that's ${STATUS_LABELS[piece.status].toLowerCase()} can't be retired — resolve the request first.`}
              </Text>
            )}
          </View>
        ) : null}
      </FormScreen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  headerSpacer: { width: 36 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.lg, flexWrap: 'wrap' },
  statusNote: { ...type.meta, color: colors.fgMuted, flex: 1 },

  error: { ...type.meta, color: colors.danger },
  hint: { ...type.meta, color: colors.fgMuted },

  previewBlock: { gap: space.sm, paddingVertical: space.lg },
  preview: { width: '100%', aspectRatio: 1, borderRadius: radius.card, backgroundColor: colors.surfaceInset },

  dangerBlock: {
    gap: space.sm,
    marginTop: space.lg,
    paddingTop: space.lg,
    borderTopWidth: hairline,
    borderTopColor: colors.borderSoft,
  },
  // Outline, not a fill. Red is punctuation here: the border and the word
  // carry the warning, and the button is not a red slab.
  retire: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
    paddingHorizontal: space.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: colors.dangerStrong,
    borderRadius: radius.button,
  },
  retireLabel: { ...type.button, fontSize: 12, color: colors.danger },
  inactive: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
});
