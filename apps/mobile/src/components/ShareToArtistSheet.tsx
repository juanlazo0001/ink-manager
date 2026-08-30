import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { GoldGradientButton } from '@/components/GoldGradientButton';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/form/Fields';
import { QuietButton } from '@/components/ui';
import { artistLabel, type ArtistOption } from '@/lib/artists';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Share this inquiry with an artist.
 *
 * ─── WHAT THIS ACTUALLY DOES, SINCE THE NAME IS AMBIGUOUS ───────────
 *
 * Not a link, and not a visibility flag. `POST /:id/share-to-artist`
 * posts an IN_APP message into a staff conversation with the chosen
 * artist, tagged `metadata.kind = "shared_inquiry"`. Nothing leaves the
 * app. The native share sheet would have been the wrong tool, and the
 * label is kept as web words it ("Share with artist") so the two clients
 * agree.
 *
 * ─── THE BODY IS SEEDED FROM THE SERVER ─────────────────────────────
 *
 * `GET /:id/share-to-artist/preview` returns the exact text the route
 * would send if none were supplied, so the composer opens with the real
 * message and the person edits it. Typing into a blank box would invite a
 * thinner message than the default, which already carries the project's
 * details and its reference photos.
 *
 * Sending with the body untouched is therefore the ordinary case, not a
 * shortcut — the server treats a blank body as "use the default", but
 * this sends what is on screen so that what was read is what is sent.
 *
 * ─── WHO IT CAN GO TO ───────────────────────────────────────────────
 *
 * `artistUserId`, the USER id — the route rejects an `Artist.id`. The
 * target must hold the ARTIST role in the inquiry's own studio, home or
 * guest; the route re-checks and 400s otherwise, so this list is a
 * convenience and never the authority.
 */
export function ShareToArtistSheet({
  visible,
  onClose,
  artists,
  selectedUserId,
  onSelect,
  body,
  onBodyChange,
  attachments,
  loadingPreview,
  sending,
  sent,
  error,
  onSend,
}: {
  visible: boolean;
  onClose: () => void;
  artists: ArtistOption[];
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
  body: string;
  onBodyChange: (value: string) => void;
  attachments: string[];
  loadingPreview: boolean;
  sending: boolean;
  /** Set after a successful send, so the sheet can confirm rather than just vanish. */
  sent: boolean;
  error: string | null;
  onSend: () => void;
}) {
  const canSend = !!selectedUserId && body.trim().length > 0 && !sending && !loadingPreview;

  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel="Share with artist">
      <View style={styles.body}>
        {sent ? (
          <>
            <Text style={styles.heading}>Sent</Text>
            <Text style={styles.para}>
              It&apos;s in your conversation with them — they&apos;ll see it in the app.
            </Text>
            <QuietButton label="Done" onPress={onClose} style={styles.full} />
          </>
        ) : (
          <>
            <Text style={styles.heading}>Share with artist</Text>

            {artists.length === 0 ? (
              <Text style={styles.para}>
                No artists in this studio yet, so there is nobody to share this with.
              </Text>
            ) : (
              <>
                <Text style={styles.label}>Send to</Text>
                <View style={styles.artists}>
                  {artists.map((artist) => {
                    const label = artistLabel(artist);
                    return (
                      <Pressable
                        key={artist.user.id}
                        onPress={() => onSelect(artist.user.id)}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        accessibilityState={{ selected: selectedUserId === artist.user.id }}
                        style={({ pressed }) => [
                          styles.artist,
                          selectedUserId === artist.user.id && styles.artistOn,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Avatar url={artist.user.avatarUrl} initials={initialsOf(label)} size={28} />
                        <Text style={styles.artistName} numberOfLines={1}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <TextField
                  label="Message to artist"
                  value={loadingPreview ? 'Loading…' : body}
                  onChange={onBodyChange}
                  multiline
                  editable={!loadingPreview}
                />

                {attachments.length > 0 ? (
                  <Text style={styles.para}>
                    {attachments.length === 1
                      ? '1 reference photo goes with it.'
                      : `${attachments.length} reference photos go with it.`}
                  </Text>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <View style={styles.row}>
                  <QuietButton label="Cancel" onPress={onClose} style={styles.half} />
                  <GoldGradientButton
                    label={sending ? 'Sending…' : 'Send'}
                    onPress={() => canSend && onSend()}
                    style={[styles.half, !canSend && styles.disabled]}
                  />
                </View>
              </>
            )}
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  heading: { ...type.heading, color: colors.fg },
  label: { ...type.label, color: colors.fgMuted },
  para: { ...type.small, color: colors.fgMuted },
  artists: { gap: space.xs },
  artist: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.input,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  artistOn: { borderColor: colors.accent, backgroundColor: colors.surfaceInset },
  pressed: { opacity: 0.7 },
  artistName: { ...type.body, color: colors.fg, flexShrink: 1 },
  row: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
  full: { width: '100%' },
  disabled: { opacity: 0.45 },
  error: { ...type.small, color: colors.danger },
});
