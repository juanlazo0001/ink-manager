import type { AppointmentListItem } from '@ink-manager/shared-types';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Eyebrow } from '@/components/ui';
import { fetchAppointments } from '@/lib/appointments';
import { stamp } from '@/lib/format';
import { attachGiftCardToAppointment, formatMoney, type GiftCard } from '@/lib/giftCards';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, radius, space, tones, type } from '@/theme';

/**
 * Point a gift card at one of its holder's upcoming sessions.
 *
 * ─── WHY THIS ONE IS LIVE WHEN VOID AND TRANSFER ARE NOT ────────────
 *
 * Because it is an association write, not a money one. See
 * `lib/giftCards.ts`'s `attachGiftCardToAppointment` for the evidence —
 * short version: the route sets a foreign key and logs a `rollover`; the
 * deposit arithmetic people assume is here lives on the appointment
 * creation path instead, which this screen cannot reach.
 *
 * ─── WHICH SESSIONS ARE OFFERED, AND WHY NOT ALL OF THEM ────────────
 *
 * The server accepts ANY appointment belonging to this card's client. It
 * is the UI that narrows to upcoming REQUESTED/CONFIRMED ones, which is
 * exactly what web does and for its stated reason: offering a cancelled
 * or already-finished session would be a confusing choice rather than a
 * real one.
 *
 * ─── THE CONFIRM STEP ───────────────────────────────────────────────
 *
 * Not a typed word — this is reversible: pointing the card somewhere
 * else, or nowhere, is the same route with a different body. A plain
 * two-step confirm is the honest weight for it. What the copy DOES say
 * is the consequence that is easy to miss: moving a card off an
 * appointment leaves that appointment without its deposit.
 */
export function AttachSessionSheet({
  visible,
  card,
  token,
  onClose,
  onAttached,
}: {
  visible: boolean;
  card: GiftCard;
  token: string | null;
  onClose: () => void;
  onAttached: (updated: GiftCard) => void;
}) {
  const [rows, setRows] = useState<AppointmentListItem[] | null>(null);
  const [picked, setPicked] = useState<AppointmentListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientId = card.client?.id ?? card.clientId ?? null;

  useEffect(() => {
    if (!visible || !token || !clientId) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    fetchAppointments(token, { clientId })
      .then((all) => {
        if (cancelled) return;
        const now = Date.now();
        setRows(
          all
            .filter(
              (a) =>
                (a.status === 'REQUESTED' || a.status === 'CONFIRMED') &&
                new Date(a.startTime).getTime() >= now &&
                a.id !== card.appointmentId,
            )
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setRows([]);
          setError(screenErrorMessage(err, "That client's sessions did not load."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible, token, clientId, card.appointmentId]);

  function reset() {
    setPicked(null);
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  async function run(appointmentId: string | null) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await attachGiftCardToAppointment(token, card.id, appointmentId);
      reset();
      onAttached(updated);
    } catch (err) {
      setError(screenErrorMessage(err, 'That card was not moved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Eyebrow style={styles.eyebrow}>Attach to a session</Eyebrow>

          {!picked ? (
            <>
              <Text style={styles.lead}>
                {formatMoney(card.amountCents)} goes toward whichever session you pick. Only this
                client&apos;s upcoming sessions are shown.
              </Text>

              <ScrollView style={styles.list}>
                {rows === null ? (
                  <ActivityIndicator style={styles.loading} color={colors.fgMuted} />
                ) : rows.length === 0 ? (
                  <Text style={styles.empty}>
                    This client has no other upcoming session to attach it to.
                  </Text>
                ) : (
                  rows.map((row) => (
                    <Pressable
                      key={row.id}
                      onPress={() => setPicked(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`Attach this card to the session on ${stamp(row.startTime)}`}
                      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    >
                      <Text style={styles.rowName}>{stamp(row.startTime)}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {[row.artist?.name, row.inquiry?.label].filter(Boolean).join(' · ') ||
                          'No artist assigned'}
                      </Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>

              {/* The route takes null, and this is the only way to reach
                  it — a card pointed at nothing is a real state, not an
                  error, and staff need it when a session moves. */}
              {card.appointmentId ? (
                <Pressable
                  onPress={busy ? undefined : () => void run(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Detach this card from its session"
                  style={({ pressed }) => [styles.detach, pressed && styles.pressed]}
                >
                  <Text style={styles.detachLabel}>DETACH FROM ITS SESSION</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.lead}>
                This card will be aimed at the session on{' '}
                <Text style={styles.strong}>{stamp(picked.startTime)}</Text>.
              </Text>

              <View style={styles.consequences}>
                <Text style={styles.consequence}>
                  • Nothing is charged or redeemed now — the value is spent at checkout.
                </Text>
                {card.appointmentId ? (
                  <Text style={styles.warning}>• The session it is on now loses this deposit.</Text>
                ) : null}
                <Text style={styles.consequence}>• You can move it again, or detach it.</Text>
              </View>

              {error ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {error}
                </Text>
              ) : null}

              <View style={styles.buttons}>
                <Pressable
                  onPress={busy ? undefined : () => void run(picked.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm attaching this card"
                  accessibilityState={{ busy }}
                  style={({ pressed }) => [styles.confirm, pressed && styles.pressed]}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.accentFg} />
                  ) : (
                    <Text style={styles.confirmLabel}>ATTACH</Text>
                  )}
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

          {!picked && error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <Pressable onPress={close} style={styles.done}>
            <Text style={styles.doneLabel}>CANCEL</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
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
  lead: { ...type.small, color: colors.fgSecondary, marginBottom: space.sm },
  strong: { color: colors.fg },

  list: { marginTop: space.sm, maxHeight: 280 },
  loading: { marginTop: space.lg },
  empty: { ...type.small, color: colors.fgMuted, marginTop: space.md },
  row: {
    paddingVertical: space.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
    gap: 2,
  },
  rowName: { ...type.body, color: colors.fg },
  rowMeta: { ...type.meta, color: colors.fgMuted },

  consequences: { gap: space.xs, marginTop: space.sm, marginBottom: space.sm },
  consequence: { ...type.small, color: colors.fgSecondary },
  warning: { ...type.small, color: tones.warning },
  error: { ...type.small, color: tones.danger, marginTop: space.sm },

  buttons: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  confirm: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentButton,
  },
  confirmLabel: { ...type.button, color: colors.accentFg },
  back: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  backLabel: { ...type.button, color: colors.fgSecondary },

  detach: {
    marginTop: space.md,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  detachLabel: { ...type.button, color: colors.fgSecondary },

  done: { alignItems: 'center', marginTop: space.lg },
  doneLabel: { ...type.button, color: colors.fgMuted },
  pressed: { opacity: 0.6 },
});
