import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Sheet } from '@/components/Sheet';

import { Eyebrow, GoldButton, QuietButton } from '@/components/ui';
import { colors, hairline, radius, space, type } from '@/theme';

export type RespondMode = 'approve' | 'decline';

/**
 * The confirm step for an artist's decision on their own project.
 *
 * On DECLINE the API sets the inquiry back to NEW and clears
 * assignedArtistId -- it returns to the studio's pool unassigned, it does
 * NOT close. The copy says so, because "declined" reads like "rejected
 * and finished" and that is not what happens.
 *
 * The two halves are deliberately NOT symmetrical, because the API is
 * not either:
 *
 * - **Decline** is a real one-step action. `PATCH /:id/respond` needs
 *   nothing but a non-empty note, so mobile does it here, in full.
 * - **Approve** is estimate COMPOSITION — a price range, a time range and
 *   a session plan, all validated server-side. Web presents it as a form,
 *   not a button. Faking it on a phone would mean either inventing an
 *   estimate builder this session did not scope, or sending a
 *   half-populated estimate to a real client. So the control is present
 *   (hiding it would misrepresent what an artist can do) and it hands off
 *   honestly.
 *
 * The approve panel also states the CONSEQUENCE, which depends on
 * `inquiries.artistSendEstimate` at the project's studio: with it the
 * estimate really goes to the client, without it front desk sends. Same
 * reasoning as the Conversations composer's live-send strip — on a phone,
 * "this reaches a real person" should never be a surprise.
 */
export function InquiryRespondSheet({
  mode,
  onClose,
  onDecline,
  submitting,
  error,
  approveSendsToClient,
  clientName,
}: {
  mode: RespondMode | null;
  onClose: () => void;
  onDecline: (note: string) => void;
  submitting: boolean;
  error: string | null;
  approveSendsToClient: boolean;
  clientName: string;
}) {
  const [note, setNote] = useState('');

  // Cleared when the sheet is dismissed, so a reopened decline never
  // arrives pre-filled with an abandoned reason.
  useEffect(() => {
    if (mode === null) setNote('');
  }, [mode]);

  const canDecline = note.trim().length > 0 && !submitting;

  return (
    <Sheet visible={mode !== null} onClose={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {mode === 'decline' ? (
              <>
                <Eyebrow>Decline this project</Eyebrow>
                <Text style={styles.title}>Let the studio know why</Text>
                <Text style={styles.body}>
                  {clientName}&apos;s project goes back to the studio as an unassigned enquiry — it stops being
                  yours and leaves your list. It is not closed or lost. Your note is what front desk sees.
                </Text>

                <TextInput
                  style={styles.input}
                  value={note}
                  onChangeText={setNote}
                  placeholder="Not my style, fully booked, needs a bigger piece…"
                  placeholderTextColor={colors.fgMuted}
                  accessibilityLabel="Reason for declining"
                  multiline
                  editable={!submitting}
                  autoFocus
                />

                {error ? (
                  <View style={styles.errorRow}>
                    <View style={styles.errorRule} />
                    <Text style={styles.error} accessibilityRole="alert">
                      {error}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.actions}>
                  <QuietButton label="Cancel" onPress={onClose} style={styles.action} />
                  {/* Red, and this is the case the palette reserves it
                      for: a destructive, hard-to-undo decision. */}
                  <Pressable
                    onPress={() => onDecline(note.trim())}
                    disabled={!canDecline}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.declineButton,
                      !canDecline && styles.declineDisabled,
                      pressed && canDecline && styles.pressed,
                    ]}
                  >
                    <Text style={styles.declineLabel}>{submitting ? 'DECLINING…' : 'DECLINE'}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Eyebrow>Approve this project</Eyebrow>
                <Text style={styles.title}>The estimate is built in the portal</Text>
                <Text style={styles.body}>
                  Approving means writing the estimate — a price range, a time range and the session plan. That
                  builder isn&apos;t on the phone yet, so this one happens on the web.
                </Text>

                <View style={styles.consequence}>
                  <Feather
                    name={approveSendsToClient ? 'send' : 'inbox'}
                    size={14}
                    color={approveSendsToClient ? colors.accent : colors.fgMuted}
                  />
                  <Text style={[styles.consequenceText, approveSendsToClient && styles.consequenceLive]}>
                    {approveSendsToClient
                      ? `At this studio, approving sends the estimate straight to ${clientName}.`
                      : 'At this studio, your estimate is saved for front desk to send — it does not reach the client directly.'}
                  </Text>
                </View>

                <View style={styles.actions}>
                  <QuietButton label="Close" onPress={onClose} style={styles.action} />
                  <GoldButton label="Got it" onPress={onClose} style={styles.action} />
                </View>
              </>
            )}
        </KeyboardAvoidingView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  eyebrowAccent: { color: colors.accent },
  eyebrowAlert: { color: colors.danger },
  title: { ...type.heading, color: colors.fg },
  body: { ...type.small, color: colors.fgMuted },

  input: {
    marginTop: space.md,
    minHeight: 92,
    backgroundColor: colors.inputBg,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    color: colors.fg,
    ...type.body,
    fontSize: 15,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    textAlignVertical: 'top',
  },

  errorRow: { flexDirection: 'row', gap: space.md, alignItems: 'stretch', marginTop: space.md },
  errorRule: { width: 2, backgroundColor: colors.dangerStrong, borderRadius: 1 },
  error: { ...type.small, color: colors.danger, flex: 1 },

  consequence: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderWidth: hairline,
    borderColor: colors.borderSoft,
    borderRadius: radius.card,
  },
  consequenceText: { ...type.small, color: colors.fgMuted, flex: 1 },
  consequenceLive: { color: colors.fgSecondary },

  actions: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  action: { flex: 1 },
  declineButton: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    borderWidth: hairline,
    borderColor: colors.dangerStrong,
  },
  declineDisabled: { opacity: 0.4 },
  declineLabel: { ...type.button, color: colors.danger },
  pressed: { opacity: 0.7 },
});
