import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { GoldGradientButton } from '@/components/GoldGradientButton';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/form/Fields';
import { QuietButton } from '@/components/ui';
import { artistLabel, fetchArtists, type ArtistOption } from '@/lib/artists';
import { validateBooking, type BookingDraft } from '@/lib/booking';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Book a CONSULTATION — a live write, and a money-free one.
 *
 * ─── WHY ONLY CONSULTATIONS ─────────────────────────────────────────
 *
 * The inquiry page has two booking paths and they are not variants of
 * each other. `POST /inquiries/:id/schedule` books a SESSION, and it
 * requires a non-empty `giftCardIds` — it creates the appointment and
 * attaches a client's paid deposit to it in one transaction. That is a
 * money move, and the brief gates money moves while listing booking as
 * live, so it is an owner call rather than an implementer's.
 *
 * A CONSULTATION goes through `POST /appointments` with
 * `appointmentType: 'CONSULTATION'`, which the route's own comment
 * describes as skipping "the gift-card requirement entirely -- it's an
 * informal, no-commitment step, not a booked session". No deposit, no
 * gift cards, no Stripe, and it can happen at any pipeline stage.
 *
 * ─── THE BUFFER WARNING IS SHOWN, NEVER ENFORCED ────────────────────
 *
 * The studio's scheduling buffer produces a warning the server returns
 * ALONGSIDE a successful booking — its own comment says it surfaces the
 * conflict "so staff can decide". So this sheet never refuses a time for
 * being close to another appointment; it books, then reports. Enforcing
 * it client-side would be inventing a rule the server deliberately
 * declined to make.
 */
export function ConsultationSheet({
  visible,
  onClose,
  token,
  clientName,
  draft,
  onDraftChange,
  booking,
  error,
  onBook,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
  clientName: string;
  draft: BookingDraft;
  onDraftChange: (next: BookingDraft) => void;
  booking: boolean;
  /** The route's own message on failure, surfaced verbatim. */
  error: string | null;
  onBook: () => void;
}) {
  const [artists, setArtists] = useState<ArtistOption[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoadError(false);
    fetchArtists(token)
      .then((rows) => !cancelled && setArtists(rows))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [visible, token]);

  const problem = validateBooking(draft);
  const set = (patch: Partial<BookingDraft>) => onDraftChange({ ...draft, ...patch });

  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel="Schedule a consultation">
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>Schedule a consultation</Text>
        <Text style={styles.lead}>
          An informal step with {clientName} — no deposit, and it can happen at any point in the
          project.
        </Text>

        <Text style={styles.sectionLabel}>ARTIST</Text>
        {loadError ? (
          <Text style={styles.error}>The artist list could not be loaded.</Text>
        ) : artists === null ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <View style={styles.artists}>
            {artists.map((artist) => {
              const on = artist.id === draft.artistId;
              return (
                <Pressable
                  key={artist.id}
                  onPress={() => set({ artistId: artist.id })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [styles.artist, on && styles.artistOn, pressed && styles.pressed]}
                >
                  <Avatar url={artist.user.avatarUrl} initials={initialsOf(artistLabel(artist))} size={28} />
                  <Text style={styles.artistName} numberOfLines={1}>
                    {artistLabel(artist)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <TextField
          label="Date"
          value={draft.date}
          onChange={(v) => set({ date: v })}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
        />

        <View style={styles.pair}>
          <View style={styles.half}>
            <TextField
              label="Starts"
              value={draft.startTime}
              onChange={(v) => set({ startTime: v })}
              placeholder="14:30"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.half}>
            <TextField
              label="Ends"
              value={draft.endTime}
              onChange={(v) => set({ endTime: v })}
              placeholder="15:30"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>

        {/* The times are read in THIS DEVICE's zone, which is the zone
            the person tapping is standing in. Said out loud because a
            booking is an instant, and a studio's staff can be travelling. */}
        <Text style={styles.hint}>Times are in your device&apos;s timezone.</Text>

        <TextField
          label="Notes (optional)"
          value={draft.notes}
          onChange={(v) => set({ notes: v })}
          placeholder="Anything the artist should know"
          multiline
        />

        {touched && problem ? <Text style={styles.error}>{problem}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <QuietButton label="Cancel" onPress={onClose} style={styles.action} />
          <GoldGradientButton
            label={booking ? 'Booking…' : 'Book it'}
            onPress={() => {
              setTouched(true);
              if (!problem && !booking) onBook();
            }}
            style={[styles.action, (booking || (touched && !!problem)) && styles.disabled]}
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingBottom: space.md },
  heading: { ...type.sectionHeader, color: colors.fg },
  lead: { ...type.small, color: colors.fgSecondary },
  sectionLabel: { ...type.meta, color: colors.fgMuted },

  artists: { gap: space.xs },
  artist: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm,
    borderRadius: radius.input,
    borderWidth: hairline,
    borderColor: 'transparent',
  },
  artistOn: { borderColor: colors.accent, backgroundColor: colors.surfaceInset },
  artistName: { ...type.body, color: colors.fg, flex: 1 },

  pair: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
  hint: { ...type.meta, color: colors.fgFaint },

  error: { ...type.small, color: colors.danger },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.xs },
  action: { flex: 1 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.6 },
});
