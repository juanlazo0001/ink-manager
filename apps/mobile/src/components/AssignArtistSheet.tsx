import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { GoldGradientButton } from '@/components/GoldGradientButton';
import { Sheet } from '@/components/Sheet';
import { QuietButton } from '@/components/ui';
import { artistLabel, fetchArtists, type ArtistOption } from '@/lib/artists';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Pick an artist and assign them — a LIVE write.
 *
 * ─── MIRRORS WEB'S REQUEST EXACTLY ──────────────────────────────────
 *
 *   PATCH /inquiries/:id/assign      { artistId }
 *
 * which is `handleAssign` in `apps/web/src/pages/InquiryDetail.tsx`,
 * verbatim. Nothing is invented here.
 *
 * ─── WHAT THE ROUTE ENFORCES, AND WHO MAY DO IT ─────────────────────
 *
 * `routes/inquiries.ts`'s `PATCH /:id/assign` carries NO `requireRole`.
 * It gates on
 *
 *     hasPermissionAt(user, inquiry.studioId, 'inquiries.assignArtist')
 *
 * — the permission evaluated at the RECORD's studio, never the caller's
 * home studio. So this sheet gates on the permission too, never on the
 * role. That is not a stylistic choice: the matrix is studio-editable,
 * and `DEFAULT_ROLE_PERMISSIONS` gives this key to FRONT_DESK and NOT to
 * ARTIST, so an artist may not assign or reassign unless their studio has
 * granted it. Web forbids it, so mobile forbids it.
 *
 * The route also enforces, and this sheet does not attempt to duplicate:
 *   - the inquiry must be in a non-terminal status
 *   - the artist must belong to the inquiry's studio, by HOME studio OR
 *     an active guest membership
 *   - a FIRST assignment (status NEW) additionally moves the status to
 *     ARTIST_ASSIGNED; a reassignment does not
 *
 * Those are server truths. Re-deriving them here would be a second
 * source that can drift, so failures surface as the route's own message.
 */
export function AssignArtistSheet({
  visible,
  onClose,
  token,
  currentArtistId,
  assigning,
  error,
  onAssign,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
  currentArtistId: string | null;
  assigning: boolean;
  /** The route's own message on failure, surfaced verbatim. */
  error: string | null;
  onAssign: (artist: ArtistOption) => void;
}) {
  const [artists, setArtists] = useState<ArtistOption[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [picked, setPicked] = useState<string | null>(currentArtistId);

  useEffect(() => {
    setPicked(currentArtistId);
  }, [currentArtistId, visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoadError(false);
    fetchArtists(token)
      .then((rows) => {
        if (!cancelled) setArtists(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, token]);

  const chosen = useMemo(
    () => artists?.find((a) => a.id === picked) ?? null,
    [artists, picked],
  );

  /* Reassigning to whoever is already assigned is a no-op that would
     still write an audit row and a new assignedAt, so the button is
     inert until the pick actually changes something. */
  const changed = !!picked && picked !== currentArtistId;

  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel="Assign an artist">
      <View style={styles.body}>
        <Text style={styles.heading}>{currentArtistId ? 'Reassign artist' : 'Assign an artist'}</Text>

        {loadError ? (
          <Text style={styles.error}>The artist list could not be loaded.</Text>
        ) : artists === null ? (
          <ActivityIndicator color={colors.accent} />
        ) : artists.length === 0 ? (
          <Text style={styles.empty}>No artists at this studio yet.</Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {artists.map((artist) => {
              const on = artist.id === picked;
              const isCurrent = artist.id === currentArtistId;
              return (
                <Pressable
                  key={artist.id}
                  onPress={() => setPicked(artist.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && styles.pressed]}
                >
                  <Avatar
                    url={artist.user.avatarUrl}
                    initials={initialsOf(artistLabel(artist))}
                    size={32}
                  />
                  <Text style={styles.name} numberOfLines={1}>
                    {artistLabel(artist)}
                  </Text>
                  {isCurrent ? <Text style={styles.current}>CURRENT</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <QuietButton label="Cancel" onPress={onClose} style={styles.action} />
          <GoldGradientButton
            label={assigning ? 'Assigning…' : currentArtistId ? 'Reassign' : 'Assign'}
            onPress={() => chosen && changed && !assigning && onAssign(chosen)}
            style={[styles.action, (!changed || assigning) && styles.disabled]}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingBottom: space.md },
  heading: { ...type.sectionHeader, color: colors.fg },
  list: { maxHeight: 320 },
  listContent: { gap: space.xs },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm,
    borderRadius: radius.input,
    borderWidth: hairline,
    borderColor: 'transparent',
  },
  rowOn: { borderColor: colors.accent, backgroundColor: colors.surfaceInset },
  pressed: { opacity: 0.6 },

  name: { ...type.body, color: colors.fg, flex: 1 },
  current: { ...type.label, fontSize: 9, color: colors.fgMuted },

  empty: { ...type.small, color: colors.fgMuted },
  error: { ...type.small, color: colors.danger },

  actions: { flexDirection: 'row', gap: space.md, marginTop: space.xs },
  action: { flex: 1 },
  disabled: { opacity: 0.5 },
});
